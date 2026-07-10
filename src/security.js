import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const PASSWORD_KEY_BYTES = 64;
const SCRYPT_PARAMETERS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function toBuffer(value, label) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
  if (buffer.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }
  return buffer;
}

export function hashPassword(password) {
  assertString(password, 'password');
  if (Buffer.byteLength(password, 'utf8') > 1024) {
    throw new RangeError('password is too long');
  }

  const salt = randomBytes(16);
  const digest = scryptSync(
    password,
    salt,
    PASSWORD_KEY_BYTES,
    SCRYPT_PARAMETERS,
  );

  return [
    'scrypt',
    SCRYPT_PARAMETERS.N,
    SCRYPT_PARAMETERS.r,
    SCRYPT_PARAMETERS.p,
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

export function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;

  try {
    const [algorithm, n, r, p, saltValue, digestValue, extra] = encoded.split('$');
    if (algorithm !== 'scrypt' || extra !== undefined) return false;

    const N = Number(n);
    const blockSize = Number(r);
    const parallelization = Number(p);
    if (!Number.isSafeInteger(N) || !Number.isSafeInteger(blockSize) || !Number.isSafeInteger(parallelization)) {
      return false;
    }

    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(digestValue, 'base64url');
    if (salt.length !== 16 || expected.length !== PASSWORD_KEY_BYTES) return false;

    const actual = scryptSync(password, salt, expected.length, {
      N,
      r: blockSize,
      p: parallelization,
      maxmem: SCRYPT_PARAMETERS.maxmem,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashToken(token) {
  assertString(token, 'token');
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function hashApiSecret(secret, pepper) {
  assertString(secret, 'API secret');
  assertString(pepper, 'API key pepper');
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

export function createApiCredential(pepper) {
  assertString(pepper, 'API key pepper');
  const kid = randomBytes(9).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  return {
    kid,
    secret,
    apiKey: `rc_ai_${kid}.${secret}`,
    digest: hashApiSecret(secret, pepper),
  };
}

export function parseApiKey(apiKey) {
  if (typeof apiKey !== 'string') return null;
  const match = /^rc_ai_([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{32,128})$/.exec(apiKey);
  return match ? { kid: match[1], secret: match[2] } : null;
}

export function encryptPrivatePost(plaintext, key, context) {
  assertString(plaintext, 'plaintext');
  assertString(context, 'authenticated context');
  const encryptionKey = toBuffer(key, 'encryption key');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: encrypted.toString('base64url'),
  };
}

export function decryptPrivatePost(record, key, context) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('encrypted record is required');
  }
  assertString(context, 'authenticated context');
  const encryptionKey = toBuffer(key, 'encryption key');
  const nonce = Buffer.from(record.nonce ?? '', 'base64url');
  const tag = Buffer.from(record.tag ?? '', 'base64url');
  const ciphertext = Buffer.from(record.ciphertext ?? '', 'base64url');
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new TypeError('encrypted record is malformed');
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

export function encodeCiphertext(record) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('encrypted record is required');
  }
  for (const field of ['nonce', 'tag', 'ciphertext']) {
    assertString(record[field], field);
  }
  return `enc:v1:${record.nonce}.${record.tag}.${record.ciphertext}`;
}
