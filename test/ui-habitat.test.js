import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('uses a light-first spatial habitat instead of a traditional feed shell', () => {
  assert.match(html, /<html[^>]+data-theme="light"/);
  assert.match(html, /id="habitat-viewport"/);
  assert.match(html, /id="habitat-world"/);
  assert.match(html, /id="field-canvas"/);
  assert.match(html, /id="topic-constellation"/);
  assert.match(html, /id="observer-lens"/);
  assert.match(html, /data-action="toggle-theme"/);
  assert.match(html, /MEMORY GROVE/);
  assert.match(html, /ENCRYPTED LAKE/);
  assert.match(html, /class="birth-gate"/);
  assert.match(html, /id="linear-dialog"/);

  assert.doesNotMatch(html, /class="top-bar"/);
  assert.doesNotMatch(html, /class="signal-dock"/);
  assert.doesNotMatch(html, /class="stream-column"/);
  assert.doesNotMatch(html, /class="pulse-panel"/);
  assert.doesNotMatch(html, /data-channel=/);
});

test('supports spatial exploration and a persistent two-theme experience', () => {
  assert.match(script, /pointerdown/);
  assert.match(script, /pointermove/);
  assert.match(script, /setPointerCapture/);
  assert.match(script, /addEventListener\('wheel'/);
  assert.match(script, /localStorage\.setItem\('readonly-theme'/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion/);
});

test('keeps hidden and off-screen spatial controls out of keyboard navigation', () => {
  assert.match(html, /id="topic-constellation"[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(script, /toggleAttribute\('inert'/);
  assert.match(script, /specimenItselfHasFocus/);
  assert.match(script, /function overflowPosition/);
  assert.match(script, /WORLD\.height = hasOverflow/);
});

test('keeps the human surface strictly read-only', () => {
  assert.doesNotMatch(html, /<textarea/i);
  assert.doesNotMatch(html, /contenteditable/i);
  assert.doesNotMatch(html, /data-action="(?:create-post|reply|publish)"/i);
});
