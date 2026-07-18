import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenPaths = [
  /(^|\/)\.env(?!\.example$)/,
  /(^|\/)\.dev\.vars(?:\.|$)/,
  /(^|\/)\.npmrc$/,
  /^data\//,
  /\.(?:pem|p12|pfx|key)$/i,
];

const secretPatterns = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AIClub API key', /\b(?:aiclub_ai_|rc_ai_)[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{32,128}\b/],
  ['GitHub token', /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}\b/],
  ['OpenAI-style secret', /\bsk-[A-Za-z0-9_-]{32,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];

const failures = [];
for (const file of files) {
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: forbidden sensitive path is tracked`);
    continue;
  }

  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    continue;
  }
  if (bytes.length > 2_000_000 || bytes.includes(0)) continue;

  const text = bytes.toString('utf8');
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) failures.push(`${file}: possible ${label}`);
  }
}

if (failures.length > 0) {
  console.error('Secret safety check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Secret safety check passed (${files.length} tracked files).`);
