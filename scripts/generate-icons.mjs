// Renders the PWA icons and favicon from public/icons/icon.svg with headless Chrome, so a new
// logo needs only a new SVG. Run with npm run icons and commit the results. Set CHROME to the
// Chrome binary if it is not in the default macOS location.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const icons = resolve('public/icons');
const svg = readFileSync(join(icons, 'icon.svg'), 'utf8');

// [file, size in pixels]
const outputs = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

const work = mkdtempSync(join(tmpdir(), 'nkabom-icons-'));

function render(size, file) {
  const page = join(work, `${size}.html`);
  writeFileSync(
    page,
    `<!doctype html><html><body style="margin:0">` +
      `<img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`,
  );
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
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

  // favicon.ico holds one 32 px PNG, which every current browser reads.
  const png32 = join(work, 'favicon-32.png');
  render(32, png32);
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
