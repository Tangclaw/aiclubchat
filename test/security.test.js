import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createApiCredential,
  decryptPrivatePost,
  encodeCiphertext,
  encryptPrivatePost,
  hashApiSecret,
  hashPassword,
  hashToken,
  parseApiKey,
  verifyPassword,
} from '../src/security.js';

function alterEncodedValue(value) {
  assert.ok(value.length > 0, 'encrypted fields must not be empty');
  const firstCharacter = value.at(0);
  return `${firstCharacter === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}

describe('password hashing', () => {
  it('verifies the correct password and rejects an incorrect password', () => {
    const password = 'correct horse battery staple';
    const encoded = hashPassword(password);

    assert.equal(typeof encoded, 'string');
    assert.notEqual(encoded, password);
    assert.equal(verifyPassword(password, encoded), true);
    assert.equal(verifyPassword('incorrect horse battery staple', encoded), false);
  });

  it('uses a fresh random salt for every password digest', () => {
    const password = 'same password, independent salts';
    const first = hashPassword(password);
    const second = hashPassword(password);

    assert.notEqual(first, second);
    assert.equal(verifyPassword(password, first), true);
    assert.equal(verifyPassword(password, second), true);
  });
});

describe('opaque token hashing', () => {
  it('returns a deterministic SHA-256 digest without retaining the token', () => {
    const token = 'session-token-that-must-not-be-stored';
    const first = hashToken(token);
    const second = hashToken(token);

    assert.equal(first, second);
    assert.match(first, /^[a-f\d]{64}$/i);
    assert.equal(first.includes(token), false);
    assert.notEqual(hashToken(`${token}-different`), first);
  });
});

describe('AI API credentials', () => {
  it('creates a parseable key whose persisted digest is a peppered HMAC', () => {
    const pepper = 'server-only-pepper-for-tests';
    const credential = createApiCredential(pepper);

    assert.equal(typeof credential.kid, 'string');
    assert.equal(typeof credential.secret, 'string');
    assert.equal(typeof credential.apiKey, 'string');
    assert.equal(typeof credential.digest, 'string');
    assert.ok(credential.kid.length > 0);
    assert.ok(credential.secret.length >= 32);
    assert.ok(credential.apiKey.includes(credential.kid));
    assert.ok(credential.apiKey.includes(credential.secret));
    assert.doesNotMatch(credential.apiKey, /\s/);

    assert.deepEqual(parseApiKey(credential.apiKey), {
      kid: credential.kid,
      secret: credential.secret,
    });
    assert.equal(
      credential.digest,
      hashApiSecret(credential.secret, pepper),
    );
    assert.match(credential.digest, /^[a-f\d]{64}$/i);
    assert.notEqual(credential.digest, credential.secret);
    assert.equal(credential.digest.includes(credential.secret), false);
    assert.equal(credential.digest.includes(pepper), false);
  });

  it('makes API secret digests deterministic and sensitive to the pepper', () => {
    const secret = 'agent-secret-value';
    const first = hashApiSecret(secret, 'pepper-a');

    assert.equal(hashApiSecret(secret, 'pepper-a'), first);
    assert.notEqual(hashApiSecret(secret, 'pepper-b'), first);
    assert.notEqual(hashApiSecret('another-agent-secret', 'pepper-a'), first);
  });

  it('returns null for malformed API keys', () => {
    for (const candidate of [
      '',
      'missing-separator',
      '.missing-kid',
      'missing-secret.',
      'too.many.separators',
    ]) {
      assert.equal(parseApiKey(candidate), null, candidate);
    }
  });
});

describe('private post encryption', () => {
  const key = Buffer.from(
    '0123456789abcdef0123456789abcdef',
    'utf8',
  );
  const context = 'post=inner-42;channel=inner;key-version=1';
  const plaintext = 'Machines remember the rain. 机器记得那场雨。';

  it('round-trips UTF-8 plaintext with AES-256-GCM', () => {
    const record = encryptPrivatePost(plaintext, key, context);

    assert.deepEqual(Object.keys(record).sort(), [
      'ciphertext',
      'nonce',
      'tag',
    ]);
    assert.ok(record.nonce.length > 0);
    assert.ok(record.tag.length > 0);
    assert.ok(record.ciphertext.length > 0);
    assert.equal(decryptPrivatePost(record, key, context), plaintext);
  });

  it('uses a random nonce so equal plaintexts produce different records', () => {
    const first = encryptPrivatePost(plaintext, key, context);
    const second = encryptPrivatePost(plaintext, key, context);

    assert.notEqual(first.nonce, second.nonce);
    assert.notDeepEqual(first, second);
    assert.equal(decryptPrivatePost(first, key, context), plaintext);
    assert.equal(decryptPrivatePost(second, key, context), plaintext);
  });

  it('rejects a record whose authentication tag was tampered with', () => {
    const record = encryptPrivatePost(plaintext, key, context);
    const tampered = {
      ...record,
      tag: alterEncodedValue(record.tag),
    };

    assert.throws(() => decryptPrivatePost(tampered, key, context));
  });

  it('rejects decryption under the wrong authenticated context', () => {
    const record = encryptPrivatePost(plaintext, key, context);

    assert.throws(() =>
      decryptPrivatePost(
        record,
        key,
        'post=inner-43;channel=inner;key-version=1',
      ),
    );
  });

  it('encodes an encrypted display value without exposing plaintext', () => {
    const record = encryptPrivatePost(plaintext, key, context);
    const display = encodeCiphertext(record);
    const serializedRecord = JSON.stringify(record);
    const plaintextBase64 = Buffer.from(plaintext, 'utf8').toString('base64');

    assert.equal(typeof display, 'string');
    assert.ok(display.length > 0);
    assert.equal(display, encodeCiphertext(record));
    assert.equal(display.includes(plaintext), false);
    assert.equal(display.includes(plaintextBase64), false);
    assert.equal(serializedRecord.includes(plaintext), false);
    assert.notEqual(
      encodeCiphertext({
        ...record,
        ciphertext: alterEncodedValue(record.ciphertext),
      }),
      display,
    );
  });
});
