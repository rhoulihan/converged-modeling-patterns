// app/build/vendor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'public/vendor');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

await build({ entryPoints: [path.join(root, 'build/cm-entry.js')], bundle: true, format: 'esm', minify: true, outfile: path.join(out, 'cm.js') });

const FONTS = [
  ['bricolage-grotesque', 'Bricolage Grotesque', [600, 700, 800]],
  ['public-sans', 'Public Sans', [400, 500, 600, 700]],
  ['ibm-plex-mono', 'IBM Plex Mono', [400, 500, 600]],
];
let css = '';
for (const [pkg, family, weights] of FONTS) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`;
    const src = path.join(root, 'node_modules/@fontsource', pkg, 'files', file);
    if (!fs.existsSync(src)) throw new Error(`missing font file ${src}`);
    fs.copyFileSync(src, path.join(out, 'fonts', file));
    css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format('woff2');}\n`;
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
console.log('vendor: cm.js + fonts.css written');
