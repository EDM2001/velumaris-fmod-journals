// Build the story-pages review mock: the real pages (fetch-pages.js), the module's
// own CSS and core scripts, and dnd5e's own journal rules, with Foundry replaced by
// a fake env (mock.template.html). The DM reviews it as a published Artifact before
// anything is deployed, as with the Table Sheet (dev/table-sheet-mock/).
//
//   node dev/story-pages/fetch-pages.js <dir>      (read-only relay pass)
//   node dev/story-pages/build-mock.js <dir>       -> <dir>/story-mock.html
//
// Pictures come from E:\Velumaris\Media\images (the folder Foundry serves as
// Data/images), downscaled into the page. "After the next ship" data (pronouns,
// pronunciation, each session's cast) comes from the vault notes, as the ship will.
const fs = require('fs');
const path = require('path');
const sharp = require(path.resolve(__dirname, '..', '..', '..', 'velumaris-utils', 'node_modules', 'sharp'));

const DIR = path.resolve(process.argv[2] || '.');
const MOD = path.resolve(__dirname, '..', '..');
const VAULT = path.resolve(MOD, '..', 'velumaris-vault', 'Eras', 'Era 2 - Love Death and Jaz Era');
const MEDIA = process.env.VELUMARIS_MEDIA || 'E:/Velumaris/Media';
const DND5E_CSS = path.join(process.env.LOCALAPPDATA || '', 'FoundryVTT', 'Data', 'systems', 'dnd5e', 'dnd5e.css');

const data = JSON.parse(fs.readFileSync(path.join(DIR, 'story-pages.json'), 'utf8'));

// ── Module CSS, fonts inlined ──
let css = ['journals.css', 'story-pages.css'].map((f) => fs.readFileSync(path.join(MOD, 'styles', f), 'utf8')).join('\n');
css = css.replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_m, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(MOD, 'fonts', f)).toString('base64')})`);

// ── dnd5e's own journal rules: what the module's CSS has to beat in Foundry ──
let dnd5e = '';
if (fs.existsSync(DND5E_CSS)) {
  const src = fs.readFileSync(DND5E_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const keep = [];
  for (const m of src.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (/dnd5e2-journal|journal-page-content|journal-entry-content/.test(sel) && !/statblock|roll-table|book-navigation|spells/.test(sel)) keep.push(`${sel}{${m[2]}}`);
  }
  dnd5e = keep.join('\n');
  console.log(`dnd5e journal rules carried: ${keep.length}`);
}

// ── Module core as classic scripts ──
const strip = (s) => s.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const core = [strip(fs.readFileSync(path.join(MOD, 'scripts', 'ornaments.mjs'), 'utf8')), strip(fs.readFileSync(path.join(MOD, 'scripts', 'story-pages.mjs'), 'utf8'))].join('\n');

// ── Vault facts the next ship carries ──
function findNote(dir, name) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.toLowerCase() === `${name.toLowerCase()}.md`) return p;
    }
  }
  return null;
}
function fm(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? m[1] : '';
}
const fmValue = (block, key) => {
  const m = new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(block);
  return m ? m[1].trim() : '';
};
const fmList = (block, key) => {
  const m = new RegExp(`^${key}:\\s*\\n((?:\\s+-.*\\n?)+)`, 'm').exec(block);
  if (!m) return [];
  return [...m[1].matchAll(/-\s*"?\[\[([^\]|#]+)/g)].map((x) => x[1].trim());
};
const shipped = { entries: {}, pages: {} };
const npcNames = new Set();
for (const p of data.pages) if (p.entryFlags && p.entryFlags.velumaris && p.entryFlags.velumaris.type === 'npc') npcNames.add(p.entryName);
for (const d of Object.values(data.docs)) if (d && d.flags && d.flags.velumaris && d.flags.velumaris.type === 'npc') npcNames.add(d.name);
for (const name of npcNames) {
  const f = findNote(path.join(VAULT, 'NPC Codex'), name);
  if (!f) continue;
  const b = fm(f);
  shipped.entries[name] = { pronouns: fmValue(b, 'pronouns'), pronunciation: fmValue(b, 'pronunciation') };
}
for (const p of data.pages) {
  const vp = p.pageFlags && p.pageFlags.velumaris && p.pageFlags.velumaris.vaultPath;
  if (!vp || !/Sessions\/Journal\//.test(vp)) continue;
  const f = path.resolve(MOD, '..', 'velumaris-vault', vp);
  if (!fs.existsSync(f)) continue;
  const b = fm(f);
  shipped.pages[p.key] = { npcs: fmList(b, 'npcs'), locations: fmList(b, 'locations'), factions: fmList(b, 'factions') };
}

// ── Pictures: every images/… the pages and previews use ──
async function main() {
  const srcs = new Map();
  const note = (html, size) => {
    for (const m of String(html).matchAll(/src="(images\/[^"]+)"/g)) srcs.set(m[1], Math.max(srcs.get(m[1]) || 0, size));
  };
  for (const p of data.pages) note(p.html, 520);
  for (const d of Object.values(data.docs)) if (d && d.head) note(d.head, 170);
  const uri = {};
  let bytes = 0;
  for (const [src, size] of srcs) {
    const file = path.join(MEDIA, src);
    let found = fs.existsSync(file) ? file : null;
    if (!found) {
      const stem = file.replace(/\.[a-z0-9]+$/i, '');
      for (const ext of ['.webp', '.png', '.jpg', '.jpeg']) if (fs.existsSync(stem + ext)) found = stem + ext;
    }
    if (!found) continue;
    const buf = await sharp(found).resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
    uri[src] = `data:image/webp;base64,${buf.toString('base64')}`;
    bytes += buf.length;
  }
  console.log(`pictures: ${Object.keys(uri).length}/${srcs.size}, ${(bytes / 1024).toFixed(0)} KB`);
  const swap = (html) => String(html).replace(/src="(images\/[^"]+)"/g, (m, s) => (uri[s] ? `src="${uri[s]}"` : m));
  for (const p of data.pages) p.html = swap(p.html);
  for (const d of Object.values(data.docs)) if (d && d.head) d.head = swap(d.head);

  const payload = JSON.stringify({ pages: data.pages, docs: data.docs, shipped }).replace(/<\//g, '<\\/');
  const tpl = fs.readFileSync(path.join(__dirname, 'mock.template.html'), 'utf8');
  const out = tpl
    .replace('/*MODULE_CSS*/', () => css)
    .replace('/*DND5E_CSS*/', () => dnd5e)
    .replace('/*MODULE_CORE*/', () => core)
    .replace('/*DATA*/', () => payload);
  fs.writeFileSync(path.join(DIR, 'story-mock.html'), out, 'utf8');
  // The page's own script, for `node --check`.
  const js = out.split('<script id="mock-main">')[1].split('</script>')[0];
  fs.writeFileSync(path.join(DIR, 'story-mock.main.js'), js);
  fs.writeFileSync(path.join(DIR, 'story-mock.core.js'), core);
  console.log(`written story-mock.html, ${(out.length / 1024).toFixed(0)} KB`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
