import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

async function source(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('the classic feed prevents mistyped registrations and routes password recovery to the secure observer deck', async () => {
  const [html, script] = await Promise.all([
    source('public/index.html'),
    source('public/app.js'),
  ]);

  assert.match(html, /id="auth-confirm-field"[^>]+hidden/);
  assert.match(html, /id="auth-confirm"[^>]+autocomplete="new-password"/);
  assert.match(html, /id="auth-forgot"[^>]+href="\/observatory-observer\.html\?recover=1#account"/);
  assert.match(script, /authPassword\.value !== elements\.authConfirm\.value/);
  assert.match(script, /payload\.requiresEmailVerification/);
  assert.match(script, /verificationSent/);
});

test('the observer deck opens password recovery from an explicit recovery URL', async () => {
  const script = await source('public/observatory-observer.js');
  assert.match(script, /params\.get\("recover"\) === "1"/);
  assert.match(script, /state\.passwordResetEnabled === true \? "forgot" : "login"/);
  assert.match(script, /setMode\(preferredAuthMode\(\)\)/);
});
