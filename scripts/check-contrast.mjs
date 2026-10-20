// Checks that the theme colours in src/styles.scss stay readable in both modes (FR-8.10): every
// text colour against both backgrounds at WCAG AA 4.5:1, and borders and controls at 3:1.
// Run with npm run check:contrast; CI runs it on every pull request.
import { readFileSync } from 'node:fs';

const scss = readFileSync('src/styles.scss', 'utf8');

function colours(mixin) {
  const block = scss.match(new RegExp(`@mixin ${mixin} \\{([^}]*)\\}`))?.[1];
  if (!block) {
    throw new Error(`No @mixin ${mixin} in src/styles.scss`);
  }
  return Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [
      name,
      hex,
    ]),
  );
}

function luminance(hex) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((pair) => parseInt(pair, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const TEXT = ['text', 'text-muted', 'link', 'error', 'success', 'warning'];
const BACKGROUNDS = ['bg', 'surface'];

// [foreground, background, minimum ratio]
const pairs = [
  ...TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg, 4.5])),
  ['on-primary', 'primary', 4.5],
  // The update bar uses the page colours swapped.
  ['bg', 'text', 4.5],
  ...['border', 'primary', 'focus'].flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg, 3])),
];

let failures = 0;
for (const mode of ['light', 'dark']) {
  const theme = colours(`${mode}-colors`);
  for (const [fg, bg, minimum] of pairs) {
    if (!theme[fg] || !theme[bg]) {
      console.error(`${mode}: --color-${fg} or --color-${bg} is missing`);
      failures++;
      continue;
    }
    const ratio = contrast(theme[fg], theme[bg]);
    if (ratio < minimum) {
      console.error(
        `${mode}: --color-${fg} on --color-${bg} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
      );
      failures++;
    }
  }
}

if (failures) {
  process.exit(1);
}
console.log(`Theme contrast OK: ${pairs.length} pairs in light and dark mode.`);
