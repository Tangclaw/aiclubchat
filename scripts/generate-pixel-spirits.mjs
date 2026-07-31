import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'assets', 'spirits');

const C = {
  cream: '#fff9e9',
  milk: '#fffef9',
  cocoa: '#5d4a55',
  cocoaSoft: '#8c7180',
  peach: '#ffb09f',
  coral: '#ff7e7e',
  strawberry: '#ef5f8e',
  blush: '#ffd8df',
  lemon: '#ffd966',
  butter: '#fff0a8',
  mint: '#8ee4c2',
  mintSoft: '#d9f8e9',
  aqua: '#79ddea',
  sky: '#94c8ff',
  skySoft: '#dcecff',
  lavender: '#b8a7ef',
  lilac: '#eadfff',
  grape: '#8b72c9',
  leaf: '#62b67d',
  leafSoft: '#cceecf',
  tangerine: '#ff9b58',
  white: '#ffffff',
};

const r = (x, y, w, h, fill, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const c = (x, y, radius, fill, extra = '') =>
  `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" ${extra}/>`;
const p = (points, fill, extra = '') =>
  `<polygon points="${points}" fill="${fill}" ${extra}/>`;

function sparkle(x, y, color, size = 2) {
  return `${r(x - 1, y - size, 2, size * 2 + 1, color)}${r(x - size, y - 1, size * 2 + 1, 2, color)}`;
}

function backdrop(accent, soft, rarity = 'N') {
  const extras = rarity === 'SSR'
    ? `${sparkle(12, 14, C.lemon, 2)}${sparkle(52, 12, C.white, 2)}${sparkle(51, 48, accent, 2)}${c(13, 49, 2, C.white)}`
    : rarity === 'SR'
      ? `${sparkle(12, 14, C.white, 2)}${sparkle(51, 47, accent, 2)}${c(52, 14, 1, C.white)}`
      : rarity === 'R'
        ? `${sparkle(12, 15, C.white, 1)}${sparkle(52, 46, accent, 1)}`
        : `${c(12, 15, 1, C.white)}${c(52, 46, 1, C.white)}`;

  return `
    ${r(0, 0, 64, 64, C.cream)}
    ${r(3, 3, 58, 58, soft, 'rx="11"')}
    ${r(6, 6, 52, 52, C.milk, 'rx="9" opacity=".58"')}
    ${r(8, 8, 48, 48, soft, 'rx="8" opacity=".72"')}
    ${c(12, 51, 5, C.white, 'opacity=".42"')}
    ${c(52, 17, 7, C.white, 'opacity=".36"')}
    ${extras}
    ${r(21, 53, 22, 3, C.cocoaSoft, 'rx="1.5" opacity=".18"')}
  `;
}

function happyFace(cx, y, options = {}) {
  const eye = options.eye || C.cocoa;
  const blush = options.blush || C.peach;
  const mouth = options.mouth || C.cocoa;
  const sleepy = options.sleepy || false;
  const eyes = sleepy
    ? `${r(cx - 8, y, 6, 2, eye, 'rx="1"')}${r(cx + 2, y, 6, 2, eye, 'rx="1"')}`
    : `${c(cx - 6, y + 1, 2.2, eye)}${c(cx + 6, y + 1, 2.2, eye)}${c(cx - 5.4, y, .7, C.white)}${c(cx + 6.6, y, .7, C.white)}`;
  return `
    ${eyes}
    ${r(cx - 12, y + 5, 4, 2, blush, 'rx="1" opacity=".72"')}
    ${r(cx + 8, y + 5, 4, 2, blush, 'rx="1" opacity=".72"')}
    <path d="M${cx - 3} ${y + 6} Q${cx} ${y + 10} ${cx + 3} ${y + 6}" fill="none" stroke="${mouth}" stroke-width="1.6" stroke-linecap="round"/>
  `;
}

function paws(cx, y, color, sole = C.cocoaSoft) {
  return `${r(cx - 13, y, 10, 6, color, 'rx="3"')}${r(cx + 3, y, 10, 6, color, 'rx="3"')}${r(cx - 10, y + 3, 4, 2, sole, 'rx="1" opacity=".45"')}${r(cx + 6, y + 3, 4, 2, sole, 'rx="1" opacity=".45"')}`;
}

const sprites = {
  moss: {
    accent: C.leaf, soft: C.leafSoft, rarity: 'N',
    art: `
      ${c(32, 33, 17, C.mint)}
      ${c(26, 18, 8, C.mint)}${c(38, 18, 8, C.mint)}
      ${p('30,16 23,10 29,8 34,15', C.leaf)}${p('34,15 39,8 45,10 37,17', C.leaf)}
      ${c(32, 16, 3, C.lemon)}
      ${happyFace(32, 29)}
      ${r(17, 35, 6, 8, C.mint, 'rx="3"')}${r(41, 35, 6, 8, C.mint, 'rx="3"')}
      ${paws(32, 47, C.leafSoft, C.leaf)}
    `,
  },
  origami: {
    accent: C.aqua, soft: C.skySoft, rarity: 'N',
    art: `
      ${p('32,12 48,23 41,30 32,26 23,30 16,23', C.white)}
      ${p('16,23 7,27 20,33 24,28', C.aqua)}${p('48,23 57,27 44,33 40,28', C.aqua)}
      ${p('24,29 40,29 45,44 32,50 19,44', C.sky)}
      ${p('24,29 32,35 32,50 19,44', C.skySoft)}
      ${happyFace(32, 24, { blush: C.strawberry })}
      ${r(24, 47, 7, 5, C.aqua, 'rx="2"')}${r(33, 47, 7, 5, C.aqua, 'rx="2"')}
      ${sparkle(49, 17, C.lemon, 1)}
    `,
  },
  murmur: {
    accent: C.lavender, soft: C.lilac, rarity: 'N',
    art: `
      ${p('19,22 22,12 29,19', C.grape)}${p('45,22 42,12 35,19', C.grape)}
      ${c(32, 31, 17, C.lavender)}
      ${r(21, 20, 22, 19, C.lavender, 'rx="9"')}
      ${happyFace(32, 27, { sleepy: true, blush: C.strawberry })}
      ${c(18, 36, 5, C.lilac)}${c(46, 36, 5, C.lilac)}
      ${paws(32, 46, C.grape, C.white)}
      ${c(49, 20, 2, C.white)}${c(53, 16, 1, C.white)}
    `,
  },
  wick: {
    accent: C.tangerine, soft: C.butter, rarity: 'N',
    art: `
      ${p('32,7 37,15 34,20 29,20 27,15', C.tangerine)}
      ${p('32,10 34,16 32,18 30,16', C.lemon)}
      ${r(19, 18, 26, 30, C.butter, 'rx="11"')}
      ${r(21, 21, 22, 25, C.white, 'rx="9" opacity=".56"')}
      ${happyFace(32, 29, { blush: C.coral })}
      ${r(16, 34, 6, 8, C.butter, 'rx="3"')}${r(42, 34, 6, 8, C.butter, 'rx="3"')}
      ${paws(32, 45, C.tangerine, C.lemon)}
      ${c(49, 18, 2, C.white)}
    `,
  },
  inkdot: {
    accent: C.strawberry, soft: C.blush, rarity: 'N',
    art: `
      ${c(32, 31, 17, C.cocoaSoft)}
      ${r(16, 29, 32, 17, C.cocoaSoft, 'rx="8"')}
      ${p('17,42 21,49 25,44 30,50 35,44 40,49 47,42', C.cocoaSoft)}
      ${c(25, 29, 5, C.white)}${c(39, 29, 5, C.white)}
      ${c(26, 30, 2, C.cocoa)}${c(38, 30, 2, C.cocoa)}
      ${c(27, 29, .7, C.white)}${c(39, 29, .7, C.white)}
      ${r(29, 37, 6, 2, C.strawberry, 'rx="1"')}
      ${r(16, 35, 5, 3, C.strawberry, 'rx="1.5" opacity=".7"')}${r(43, 35, 5, 3, C.strawberry, 'rx="1.5" opacity=".7"')}
      ${p('44,18 48,11 52,18', C.strawberry)}${c(48, 20, 4, C.strawberry)}
    `,
  },
  prism: {
    accent: C.aqua, soft: C.lilac, rarity: 'R',
    art: `
      ${r(19, 10, 8, 19, C.lavender, 'rx="4"')}${r(37, 10, 8, 19, C.sky, 'rx="4"')}
      ${c(32, 32, 17, C.white)}
      ${p('18,29 32,14 46,29 40,46 24,46', C.milk)}
      ${p('32,14 46,29 40,46 32,39', C.skySoft)}${p('18,29 32,14 32,39 24,46', C.lilac)}
      ${happyFace(32, 29, { blush: C.strawberry })}
      ${paws(32, 46, C.aqua, C.lavender)}
      ${sparkle(49, 20, C.lemon, 2)}
    `,
  },
  pendulum: {
    accent: C.coral, soft: C.butter, rarity: 'R',
    art: `
      ${p('18,22 19,13 27,20', C.coral)}${p('46,22 45,13 37,20', C.coral)}
      ${c(32, 31, 17, C.peach)}
      ${c(32, 31, 12, C.white, 'opacity=".5"')}
      ${happyFace(32, 27, { blush: C.strawberry })}
      ${r(31, 35, 2, 8, C.cocoaSoft, 'rx="1"')}${c(32, 43, 3, C.lemon)}
      ${r(16, 36, 7, 7, C.peach, 'rx="3"')}${r(41, 36, 7, 7, C.peach, 'rx="3"')}
      ${paws(32, 47, C.coral, C.butter)}
    `,
  },
  beacon: {
    accent: C.lemon, soft: C.skySoft, rarity: 'R',
    art: `
      ${c(32, 30, 17, C.butter)}
      ${p('32,11 38,20 26,20', C.coral)}${c(32, 12, 3, C.lemon)}
      ${happyFace(32, 27, { blush: C.tangerine })}
      ${p('23,34 32,40 41,34 39,46 25,46', C.white)}
      ${p('15,34 22,30 21,42', C.sky)}${p('49,34 42,30 43,42', C.sky)}
      ${p('29,35 36,35 32,40', C.tangerine)}
      ${paws(32, 46, C.tangerine, C.lemon)}
      ${sparkle(50, 18, C.lemon, 2)}
    `,
  },
  cocoon: {
    accent: C.lavender, soft: C.blush, rarity: 'R',
    art: `
      ${c(25, 20, 7, C.peach)}${c(39, 20, 7, C.peach)}
      ${c(32, 32, 17, C.peach)}
      ${r(17, 29, 30, 20, C.lilac, 'rx="10"')}
      ${p('17,31 32,42 47,31 47,47 17,47', C.lavender)}
      ${happyFace(32, 27, { sleepy: true, blush: C.strawberry })}
      ${c(32, 34, 3, C.cocoaSoft)}
      ${r(24, 45, 16, 6, C.white, 'rx="3"')}
      ${c(51, 20, 2, C.white)}
    `,
  },
  atlas: {
    accent: C.sky, soft: C.mintSoft, rarity: 'SR',
    art: `
      ${c(32, 34, 18, C.leaf)}
      ${c(32, 31, 14, C.leafSoft)}
      ${p('21,32 25,22 32,19 39,22 43,32 39,42 25,42', C.sky)}
      ${r(25, 24, 14, 15, C.skySoft, 'rx="6"')}
      ${happyFace(32, 29, { blush: C.coral })}
      ${c(16, 34, 5, C.leafSoft)}${c(48, 34, 5, C.leafSoft)}
      ${paws(32, 47, C.leaf, C.mint)}
      ${sparkle(19, 21, C.lemon, 1)}${sparkle(44, 18, C.white, 1)}
      ${c(28, 17, 1, C.lemon)}${c(38, 20, 1, C.lemon)}
    `,
  },
  abyss: {
    accent: C.aqua, soft: C.skySoft, rarity: 'SR',
    art: `
      ${c(18, 25, 6, C.strawberry)}${c(14, 20, 3, C.strawberry)}${c(14, 30, 3, C.strawberry)}
      ${c(46, 25, 6, C.strawberry)}${c(50, 20, 3, C.strawberry)}${c(50, 30, 3, C.strawberry)}
      ${c(32, 31, 17, C.aqua)}
      ${r(20, 24, 24, 20, C.aqua, 'rx="9"')}
      ${happyFace(32, 29, { blush: C.strawberry })}
      ${r(15, 37, 7, 5, C.aqua, 'rx="2"')}${r(42, 37, 7, 5, C.aqua, 'rx="2"')}
      ${paws(32, 45, C.sky, C.white)}
      ${c(51, 15, 2, C.white)}${c(54, 10, 1, C.aqua)}
    `,
  },
  ouroboros: {
    accent: C.grape, soft: C.lilac, rarity: 'SR',
    art: `
      <circle cx="32" cy="32" r="20" fill="none" stroke="${C.lavender}" stroke-width="7" stroke-linecap="round" stroke-dasharray="91 35"/>
      ${p('43,13 52,12 48,21', C.strawberry)}
      ${c(32, 31, 15, C.lavender)}
      ${p('22,21 19,14 27,19', C.grape)}${p('42,21 45,14 37,19', C.grape)}
      ${happyFace(32, 28, { blush: C.strawberry })}
      ${c(32, 37, 4, C.white, 'opacity=".55"')}
      ${paws(32, 44, C.grape, C.white)}
      ${sparkle(15, 15, C.lemon, 1)}${sparkle(51, 47, C.white, 1)}
    `,
  },
  everlight: {
    accent: C.lemon, soft: C.butter, rarity: 'SSR',
    art: `
      ${p('32,5 36,13 45,10 42,19 51,22 43,28 21,28 13,22 22,19 19,10 28,13', C.lemon)}
      ${c(32, 32, 17, C.white)}
      ${p('19,31 32,18 45,31 40,47 24,47', C.butter)}
      ${happyFace(32, 29, { blush: C.coral })}
      ${p('17,35 9,31 13,43 22,45', C.white)}${p('47,35 55,31 51,43 42,45', C.white)}
      ${paws(32, 47, C.tangerine, C.lemon)}
      ${sparkle(11, 15, C.lemon, 2)}${sparkle(52, 15, C.white, 2)}${sparkle(51, 49, C.lemon, 1)}
    `,
  },
  firstcry: {
    accent: C.strawberry, soft: C.blush, rarity: 'SSR',
    art: `
      ${p('18,29 10,22 18,20 14,12 25,18 32,7 39,18 50,12 46,20 54,22 46,29', C.coral)}
      ${c(32, 32, 17, C.peach)}
      ${p('32,13 38,22 32,20 26,22', C.lemon)}
      ${happyFace(32, 29, { blush: C.strawberry })}
      ${p('20,35 10,32 17,44 24,45', C.butter)}${p('44,35 54,32 47,44 40,45', C.butter)}
      ${paws(32, 47, C.strawberry, C.lemon)}
      ${sparkle(11, 16, C.lemon, 2)}${sparkle(53, 14, C.white, 2)}${c(51, 50, 2, C.lemon)}
    `,
  },
};

function svgFor({ accent, soft, rarity, art }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges">
    ${backdrop(accent, soft, rarity)}
    ${art}
  </svg>`;
}

function boxSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" shape-rendering="crispEdges">
    ${backdrop(C.strawberry, C.blush, 'SSR')}
    ${r(15, 24, 34, 27, C.white, 'rx="8"')}
    ${r(17, 27, 30, 22, C.lilac, 'rx="6"')}
    ${r(21, 31, 22, 14, C.milk, 'rx="5"')}
    ${c(32, 38, 5, C.lemon)}
    ${sparkle(32, 38, C.white, 2)}
    ${r(12, 20, 40, 8, C.strawberry, 'rx="4"')}
    ${p('32,22 23,13 30,12 34,20', C.coral)}
    ${p('32,22 41,13 34,12 30,20', C.peach)}
    ${r(29, 19, 6, 10, C.lemon, 'rx="2"')}
    ${c(12, 17, 2, C.white)}${sparkle(52, 15, C.lemon, 2)}
    ${r(19, 49, 8, 4, C.peach, 'rx="2"')}${r(37, 49, 8, 4, C.peach, 'rx="2"')}
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

console.log(`Generated ${Object.keys(sprites).length + 2} kawaii pixel assets in ${outDir}`);
