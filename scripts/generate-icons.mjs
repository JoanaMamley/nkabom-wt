// Renders the PWA icons and favicon with headless Chrome: the centre symbol of the WomenTrust
// Graduate Association logo (public/icons/mark.svg, orange on transparent) on white. The symbol
// is 60% of the icon's height, inside the central 80% circle, so the same image also works as a
// maskable icon. meta-app-icon.png, the Meta app's icon for Facebook login (NKB-211), is the symbol
// on transparent, which Meta asks for. A new logo needs only a new mark.svg. Run with npm run icons and commit the
// results. Set CHROME to the Chrome binary if it is not in the default macOS location.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const icons = resolve('public/icons');
const mark = readFileSync(join(icons, 'mark.svg')).toString('base64');

// [file, size in pixels]
const outputs = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

const work = mkdtempSync(join(tmpdir(), 'nkabom-icons-'));

// height: the symbol's share of the icon's height. transparent: no white background.
function render(size, file, height = 0.6, transparent = false) {
  const page = join(work, `${size}.html`);
  writeFileSync(
    page,
    `<!doctype html><html><body style="margin:0;background:${transparent ? 'transparent' : '#fff'};display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<img style="display:block;height:${Math.round(size * height)}px" src="data:image/svg+xml;base64,${mark}">`,
  );
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      ...(transparent ? ['--default-background-color=00000000'] : []),
      `--window-size=${size},${size}`,
      `--screenshot=${file}`,
      `file://${page}`,
    ],
    { stdio: 'ignore' },
  );
}

try {
  for (const [name, size] of outputs) {
    render(size, join(icons, name));
  }
  // At the usual size, so it fits inside the round crop Meta's upload shows.
  render(1024, join(icons, 'meta-app-icon.png'), 0.6, true);

  // favicon.ico holds one 32 px PNG, which every current browser reads.
  const png32 = join(work, 'favicon-32.png');
  // Never masked, so the symbol can fill it, and is still readable at 32 px.
  render(32, png32, 0.94);
  const png = readFileSync(png32);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(32, 6); // width
  header.writeUInt8(32, 7); // height
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // image data offset
  writeFileSync(resolve('public/favicon.ico'), Buffer.concat([header, png]));
} finally {
  rmSync(work, { recursive: true, force: true });
}
