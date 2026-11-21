// Construit une page unique et autonome (mode solo) : tout le jeu tourne dans le navigateur.
// Usage : node scripts/build-offline.mjs [sortie.html]
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || path.join(ROOT, 'dist', 'playroom-solo.html');

const engine = {
  name: 'engine',
  setup(b) {
    b.onResolve({ filter: /^\.\/engine\// }, args => ({ path: path.join(ROOT, 'server', args.path.slice('./engine/'.length)) }));
  },
};

const res = await build({
  entryPoints: [path.join(ROOT, 'public', 'app.js')],
  bundle: true, format: 'esm', minify: true, write: false, target: 'es2020',
  plugins: [engine], splitting: false,
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const icon = fs.readFileSync(path.join(ROOT, 'public', 'icon.svg'), 'utf8');
let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
html = html
  .replace(/<link rel="manifest"[^>]*>\n?/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}">`)
  .replace(/<link rel="stylesheet" href="\/style.css">/, `<style>${css}</style>`)
  .replace(/<script type="module" src="\/app.js"><\/script>/, `<script>window.PLAYROOM_OFFLINE=true</script><script type="module">${js}</script>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`OK ${out} (${Math.round(html.length / 1024)} Ko)`);
