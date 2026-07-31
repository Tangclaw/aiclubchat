import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'assets', 'spirits');

const C = {
  bg: '#07131d',
  bg2: '#0b1d29',
  ink: '#02070b',
  screen: '#c7fff4',
  white: '#f5f1df',
  cream: '#e8d7af',
  sage: '#70b99a',
  moss: '#397b5c',
  cyan: '#37d8d0',
  blue: '#477be8',
  violet: '#8158c7',
  pink: '#d46ba4',
  amber: '#f4b83f',
  orange: '#ed733b',
  red: '#d84646',
  gold: '#f3cf64',
  steel: '#8096a6',
  shadow: '#263544',
};

const r = (x, y, w, h, fill, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const p = (points, fill, extra = '') =>
  `<polygon points="${points}" fill="${fill}" ${extra}/>`;

function halo(accent, rarity = 'N') {
  const sparks = rarity === 'SSR'
    ? [
        r(6, 13, 2, 2, C.gold), r(55, 10, 2, 2, C.white),
        r(8, 47, 3, 1, accent), r(54, 48, 2, 2, C.gold),
        r(14, 7, 1, 3, C.gold), r(48, 6, 1, 3, accent),
      ].join('')
    : rarity === 'SR'
      ? [r(8, 15, 2, 2, accent), r(53, 12, 2, 2, C.cyan), r(9, 48, 2, 1, C.white), r(52, 47, 1, 2, accent)].join('')
      : rarity === 'R'
        ? [r(9, 16, 2, 2, accent), r(53, 44, 2, 2, accent)].join('')
        : [r(10, 18, 1, 1, accent), r(53, 45, 1, 1, accent)].join('');
  return `
    ${r(0, 0, 64, 64, C.bg)}
    ${r(2, 2, 60, 60, C.bg2)}
    <circle cx="32" cy="31" r="23" fill="none" stroke="${accent}" stroke-width="1" opacity=".28" stroke-dasharray="2 3"/>
    <circle cx="32" cy="31" r="18" fill="none" stroke="${accent}" stroke-width="1" opacity=".16" stroke-dasharray="1 4"/>
    ${r(4, 4, 8, 1, accent, 'opacity=".28"')}
    ${r(4, 4, 1, 8, accent, 'opacity=".28"')}
    ${r(52, 59, 8, 1, accent, 'opacity=".28"')}
    ${r(59, 52, 1, 8, accent, 'opacity=".28"')}
    ${sparks}
    ${r(20, 54, 24, 3, C.ink, 'opacity=".65"')}
  `;
}

function screenFace(x, y, w, h, body, eye = C.screen, mood = 'calm') {
  const eyes = mood === 'sharp'
    ? `${r(x + 4, y + 5, 5, 2, eye)}${r(x + w - 9, y + 5, 5, 2, eye)}`
    : mood === 'happy'
      ? `${r(x + 4, y + 5, 2, 2, eye)}${r(x + 6, y + 7, 2, 1, eye)}${r(x + w - 8, y + 7, 2, 1, eye)}${r(x + w - 6, y + 5, 2, 2, eye)}`
      : `${r(x + 4, y + 5, 3, 3, eye)}${r(x + w - 7, y + 5, 3, 3, eye)}`;
  return `${r(x, y, w, h, C.ink)}${r(x + 2, y + 2, w - 4, h - 4, body)}${eyes}${r(x + Math.floor(w / 2) - 2, y + h - 4, 4, 1, eye, 'opacity=".75"')}`;
}

const sprites = {
  moss: {
    accent: C.sage, rarity: 'N',
    art: `
      ${r(25, 8, 4, 6, C.moss)}${r(20, 7, 5, 3, C.sage)}
      ${r(35, 8, 4, 6, C.moss)}${r(39, 6, 5, 3, C.sage)}
      ${screenFace(19, 14, 26, 18, C.moss, C.screen, 'happy')}
      ${r(17, 19, 2, 9, C.cream)}${r(45, 19, 2, 9, C.cream)}
      ${p('19,32 45,32 49,46 15,46', C.cream)}
      ${r(22, 34, 20, 13, C.sage)}${r(26, 36, 12, 8, C.moss)}
      ${r(17, 36, 5, 11, C.moss)}${r(42, 35, 5, 12, C.moss)}
      ${r(13, 39, 5, 7, C.steel)}${r(11, 38, 3, 4, C.cyan)}
      ${r(23, 47, 7, 7, C.shadow)}${r(34, 47, 7, 7, C.shadow)}
      ${r(21, 52, 10, 3, C.moss)}${r(33, 52, 10, 3, C.moss)}
    `,
  },
  origami: {
    accent: C.cyan, rarity: 'N',
    art: `
      ${p('32,10 47,18 42,31 32,27 22,31 17,18', C.white)}
      ${p('17,18 6,24 19,29', C.cream)}${p('47,18 58,24 45,29', C.cream)}
      ${r(25,16,14,9,C.ink)}${r(27,18,10,5,C.blue)}
      ${r(29,19,2,2,C.screen)}${r(34,19,2,2,C.screen)}
      ${p('22,30 42,30 47,43 32,50 17,43', C.white)}
      ${p('17,34 8,43 20,42', C.cyan)}${p('47,34 56,43 44,42', C.cyan)}
      ${p('28,31 36,31 32,45', C.blue)}
      ${r(25,49,5,5,C.shadow)}${r(34,49,5,5,C.shadow)}
      ${r(49,30,2,2,C.amber)}${r(52,28,1,1,C.amber)}
    `,
  },
  murmur: {
    accent: C.violet, rarity: 'N',
    art: `
      ${p('32,8 45,18 42,36 32,42 22,36 19,18', C.violet)}
      ${p('19,18 15,28 21,26', C.pink)}${p('45,18 49,28 43,26', C.pink)}
      ${r(22,16,20,17,C.ink)}${r(24,18,16,13,C.shadow)}
      ${r(27,22,3,3,C.screen)}${r(34,22,3,3,C.screen)}
      ${r(30,28,4,1,C.pink)}
      ${p('23,37 41,37 47,48 17,48', C.shadow)}
      ${r(28,39,8,9,C.violet)}${r(14,35,3,2,C.pink)}${r(10,32,2,2,C.violet)}
      ${r(47,34,4,2,C.pink)}${r(52,31,2,2,C.violet)}
      ${r(24,48,16,3,C.ink)}${r(27,51,10,3,C.violet)}
    `,
  },
  wick: {
    accent: C.amber, rarity: 'N',
    art: `
      ${r(28,7,8,6,C.amber)}${r(30,5,4,3,C.white)}
      ${r(20,12,24,21,C.cream)}${r(18,16,3,13,C.gold)}${r(43,16,3,13,C.gold)}
      ${r(23,15,18,14,C.ink)}${r(25,17,14,10,C.orange)}
      ${r(28,20,2,3,C.white)}${r(34,20,2,3,C.white)}
      ${p('22,33 42,33 47,49 17,49', C.white)}
      ${r(27,36,10,11,C.amber)}${r(13,35,4,14,C.gold)}${r(11,33,8,4,C.white)}
      ${r(47,29,3,18,C.cream)}${r(45,27,7,3,C.gold)}${r(48,24,2,3,C.white)}
      ${r(23,48,7,6,C.shadow)}${r(34,48,7,6,C.shadow)}
    `,
  },
  inkdot: {
    accent: C.pink, rarity: 'N',
    art: `
      ${p('21,13 25,7 29,14', C.shadow)}${p('35,14 39,7 43,13', C.shadow)}
      ${screenFace(19,13,26,18,C.shadow,C.pink,'sharp')}
      ${p('18,30 46,30 42,45 32,49 22,45', C.ink)}
      ${r(23,32,18,13,C.shadow)}${r(28,34,8,8,C.violet)}
      ${r(15,32,6,4,C.shadow)}${r(9,28,10,3,C.steel)}${r(47,32,6,4,C.shadow)}
      ${r(49,28,7,3,C.steel)}${r(52,25,2,3,C.pink)}
      ${r(23,46,7,8,C.ink)}${r(34,46,7,8,C.ink)}
      ${r(20,52,10,3,C.pink)}${r(34,52,10,3,C.pink)}
    `,
  },
  prism: {
    accent: C.cyan, rarity: 'R',
    art: `
      ${p('32,6 45,19 40,34 32,40 24,34 19,19', C.blue)}
      ${p('32,6 32,40 24,34 19,19', C.violet)}${p('32,6 45,19 40,34 32,40', C.cyan)}
      ${r(26,18,3,3,C.screen)}${r(35,18,3,3,C.screen)}${r(30,27,4,1,C.white)}
      ${p('24,36 40,36 47,49 17,49', C.shadow)}
      ${p('20,39 27,33 27,49 17,49', C.violet)}${p('44,39 37,33 37,49 47,49', C.cyan)}
      ${r(27,39,10,10,C.blue)}${r(30,42,4,4,C.white)}
      ${r(23,49,7,5,C.shadow)}${r(34,49,7,5,C.shadow)}
      ${r(11,20,2,2,C.violet)}${r(51,17,2,2,C.cyan)}
    `,
  },
  pendulum: {
    accent: C.orange, rarity: 'R',
    art: `
      ${r(19,12,26,19,C.steel)}${r(22,9,20,4,C.shadow)}
      ${r(23,15,18,13,C.ink)}${r(25,17,14,9,C.shadow)}
      ${r(27,20,3,2,C.amber)}${r(34,20,3,2,C.amber)}
      ${p('19,31 45,31 49,47 15,47', C.steel)}
      ${r(24,34,16,12,C.shadow)}${r(28,37,8,8,C.orange)}
      ${r(13,34,5,13,C.steel)}${r(46,34,5,13,C.steel)}
      ${r(50,24,3,24,C.cream)}${r(47,21,9,5,C.orange)}${r(50,18,3,3,C.amber)}
      ${r(21,47,9,7,C.shadow)}${r(34,47,9,7,C.shadow)}
    `,
  },
  beacon: {
    accent: C.gold, rarity: 'R',
    art: `
      ${r(29,6,6,7,C.gold)}${r(30,4,4,3,C.white)}
      ${screenFace(20,13,24,17,C.blue,C.screen,'happy')}
      ${p('19,30 45,30 49,47 15,47', C.white)}
      ${r(23,33,18,13,C.blue)}${r(28,36,8,7,C.gold)}
      ${p('15,34 7,28 9,42 18,44', C.cyan)}${p('49,34 57,28 55,42 46,44', C.cyan)}
      ${r(22,47,8,7,C.shadow)}${r(34,47,8,7,C.shadow)}
      ${r(8,23,2,2,C.gold)}${r(54,21,2,2,C.gold)}${r(50,12,1,4,C.white)}
    `,
  },
  cocoon: {
    accent: C.violet, rarity: 'R',
    art: `
      ${p('32,7 45,13 49,31 43,49 32,56 21,49 15,31 19,13', C.shadow)}
      ${p('32,10 41,16 44,31 39,46 32,51 25,46 20,31 23,16', C.violet)}
      ${r(24,19,16,12,C.ink)}${r(26,21,12,8,C.shadow)}
      ${r(28,24,2,2,C.screen)}${r(34,24,2,2,C.screen)}
      ${r(18,29,5,2,C.pink)}${r(41,29,5,2,C.pink)}
      ${r(25,34,14,2,C.shadow)}${r(27,39,10,2,C.shadow)}${r(29,44,6,2,C.shadow)}
      ${r(13,25,2,12,C.violet)}${r(49,25,2,12,C.violet)}
    `,
  },
  atlas: {
    accent: C.blue, rarity: 'SR',
    art: `
      ${p('32,7 44,15 43,31 32,39 21,31 20,15', C.blue)}
      ${r(23,15,18,14,C.ink)}${r(25,17,14,10,C.shadow)}
      ${r(27,20,3,3,C.cyan)}${r(34,20,3,3,C.cyan)}
      ${p('20,31 44,31 49,48 15,48', C.shadow)}
      ${r(25,34,14,12,C.blue)}${r(29,37,6,6,C.cyan)}
      ${r(12,34,6,3,C.steel)}${r(8,29,3,18,C.gold)}${r(9,29,6,2,C.gold)}${r(9,44,6,2,C.gold)}
      ${r(46,33,6,3,C.steel)}${r(23,48,8,6,C.ink)}${r(33,48,8,6,C.ink)}
      ${r(47,10,2,2,C.white)}${r(52,14,1,1,C.cyan)}${r(12,13,1,1,C.white)}
    `,
  },
  abyss: {
    accent: C.cyan, rarity: 'SR',
    art: `
      ${p('20,13 32,7 44,13 48,27 42,35 22,35 16,27', C.shadow)}
      ${r(22,14,20,16,C.ink)}${r(24,16,16,12,C.blue)}
      ${r(27,20,3,3,C.cyan)}${r(35,20,3,3,C.cyan)}
      ${r(31,7,2,5,C.steel)}${r(30,4,4,3,C.cyan)}
      ${p('20,34 44,34 49,48 32,54 15,48', C.blue)}
      ${r(25,36,14,12,C.shadow)}${p('15,38 7,44 17,47', C.cyan)}${p('49,38 57,44 47,47', C.cyan)}
      ${r(24,49,7,5,C.ink)}${r(35,49,7,5,C.ink)}
      ${r(9,20,1,1,C.cyan)}${r(12,17,2,2,C.blue)}${r(52,14,2,2,C.cyan)}
    `,
  },
  ouroboros: {
    accent: C.violet, rarity: 'SR',
    art: `
      <circle cx="32" cy="31" r="22" fill="none" stroke="${C.violet}" stroke-width="5" stroke-dasharray="25 5" />
      ${p('47,12 56,14 51,21', C.pink)}
      ${r(20,13,24,19,C.shadow)}${r(23,16,18,13,C.ink)}
      ${r(27,20,3,3,C.screen)}${r(34,20,3,3,C.screen)}
      ${p('21,32 43,32 47,48 17,48', C.violet)}
      ${r(26,35,12,11,C.shadow)}${r(29,38,6,5,C.pink)}
      ${r(23,48,7,6,C.ink)}${r(34,48,7,6,C.ink)}
      ${r(11,11,2,2,C.cyan)}${r(51,49,2,2,C.cyan)}
    `,
  },
  everlight: {
    accent: C.gold, rarity: 'SSR',
    art: `
      ${p('32,4 36,10 43,8 41,16 48,19 43,25 21,25 16,19 23,16 21,8 28,10', C.gold)}
      ${screenFace(18,15,28,18,C.white,C.amber,'calm')}
      ${p('17,33 47,33 52,49 32,57 12,49', C.gold)}
      ${r(21,35,22,15,C.white)}${r(26,37,12,11,C.amber)}
      ${r(14,35,6,14,C.cream)}${r(44,35,6,14,C.cream)}
      ${r(10,31,5,5,C.gold)}${r(49,30,4,19,C.gold)}${r(48,27,6,4,C.white)}
      ${r(22,49,9,7,C.shadow)}${r(33,49,9,7,C.shadow)}
      ${r(7,19,3,3,C.gold)}${r(54,17,3,3,C.white)}
    `,
  },
  firstcry: {
    accent: C.orange, rarity: 'SSR',
    art: `
      ${p('32,4 37,10 44,8 42,16 49,20 43,24 21,24 15,20 22,16 20,8 27,10', C.orange)}
      ${screenFace(18,14,28,18,C.red,C.gold,'sharp')}
      ${p('18,32 46,32 52,48 32,57 12,48', C.red)}
      ${r(22,34,20,15,C.orange)}${r(27,37,10,9,C.ink)}${r(30,39,4,5,C.gold)}
      ${r(13,34,7,15,C.shadow)}${r(44,34,7,15,C.shadow)}
      ${r(8,28,4,19,C.gold)}${r(5,25,10,4,C.red)}
      ${r(22,49,9,7,C.ink)}${r(33,49,9,7,C.ink)}
      ${r(7,15,2,4,C.orange)}${r(55,12,2,4,C.gold)}
    `,
  },
};

function svgFor({ accent, rarity, art }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges">
    ${halo(accent, rarity)}
    ${art}
  </svg>`;
}

function boxSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges">
    ${halo(C.cyan, 'SSR')}
    ${r(14, 18, 36, 30, C.ink)}
    ${r(17, 15, 30, 6, C.shadow)}
    ${r(18, 20, 28, 25, C.blue)}
    ${r(21, 23, 22, 18, C.bg2)}
    ${r(24, 26, 16, 12, C.shadow)}
    ${r(29, 29, 6, 6, C.gold)}
    ${r(31, 30, 2, 4, C.white)}
    ${r(14, 25, 4, 13, C.cyan)}
    ${r(46, 25, 4, 13, C.violet)}
    ${r(19, 45, 8, 5, C.steel)}
    ${r(37, 45, 8, 5, C.steel)}
    ${r(11, 12, 3, 3, C.gold)}
    ${r(50, 10, 2, 2, C.cyan)}
    ${r(53, 15, 1, 4, C.violet)}
  </svg>`;
}

await mkdir(outDir, { recursive: true });

for (const [key, spec] of Object.entries(sprites)) {
  await sharp(Buffer.from(svgFor(spec)))
    .resize(512, 512, { kernel: sharp.kernel.nearest })
    .png({ compressionLevel: 9, palette: true, colours: 64 })
    .toFile(path.join(outDir, `${key}.png`));
}

await sharp(Buffer.from(boxSvg()))
  .resize(512, 512, { kernel: sharp.kernel.nearest })
  .png({ compressionLevel: 9, palette: true, colours: 64 })
  .toFile(path.join(outDir, 'box.png'));

await sharp(Buffer.from(svgFor(sprites.moss)))
  .resize(512, 512, { kernel: sharp.kernel.nearest })
  .png({ compressionLevel: 9, palette: true, colours: 64 })
  .toFile(path.join(outDir, 'base.png'));

console.log(`Generated ${Object.keys(sprites).length + 2} pixel assets in ${outDir}`);
