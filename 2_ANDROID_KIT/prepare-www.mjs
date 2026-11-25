// Builds ./www (what the Android app bundles) from the web files.
// Usage: node prepare-www.mjs [path-to-web-folder]   (default: ../1_UPLOAD_TO_NETLIFY)
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const src = resolve(process.argv[2] || '../1_UPLOAD_TO_NETLIFY');
const assets = resolve('unchanged-assets');
if (!existsSync(join(src, 'index.html'))) { console.error('index.html not found in ' + src); process.exit(1); }
rmSync('www', { recursive: true, force: true }); mkdirSync('www');
for (const f of readdirSync(src)) { if (f === '_headers' || f === 'sw.js') continue; cpSync(join(src, f), join('www', f)); } // PWA-only files
if (existsSync(assets)) for (const f of readdirSync(assets)) if (!existsSync(join('www', f))) cpSync(join(assets, f), join('www', f));
console.log('www ready:', readdirSync('www').join(', '));
console.log('\nREMINDER: in www/config.js set admob.testing=false and your real banner unit ID before a release build.');
