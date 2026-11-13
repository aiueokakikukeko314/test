// Packs the production build into a single self-contained page (CSS + JS inlined) plus its
// model/texture files, for hosts that only serve one HTML page with sibling assets.
import fs from 'node:fs'; import path from 'node:path';
const dist = 'dist', out = 'dist-page';
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(dist, html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1]), 'utf8');
const css = fs.readFileSync(path.join(dist, html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1]), 'utf8');
const count = (s, re) => (s.match(re) || []).length;
if (count(js, /<!--/g)) throw new Error('bundle contains "<!--": cannot inline safely');
const safe = js.replace(/<\/script/gi, '<\\/script');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(dist, 'assets/models'), path.join(out, 'assets/models'), { recursive: true });
fs.cpSync(path.join(dist, 'assets/textures'), path.join(out, 'assets/textures'), { recursive: true });
const page = `<title>朝の森と川</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<canvas id="view"></canvas>
<div id="ui"></div>
<script type="module">${safe}</script>
`;
fs.writeFileSync(path.join(out, 'index.html'), page);
const files = {};
for (const dir of ['assets/models', 'assets/textures']) for (const f of fs.readdirSync(path.join(out, dir))) files[`${dir}/${f}`] = `${dir}/${f}`;
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 1));
console.log('page', (fs.statSync(path.join(out, 'index.html')).size / 1e6).toFixed(2) + 'MB', 'files', Object.keys(files).length, '</script escapes:', count(js, /<\/script/gi));
