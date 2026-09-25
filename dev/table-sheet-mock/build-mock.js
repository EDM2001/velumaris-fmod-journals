// Build a review mock: real Table Sheet pages + the module's own CSS and script,
// with Foundry replaced by a fake env (mock.template.html). The DM reviews it as a
// published Artifact before anything is deployed (the 2026-09-25 P1 review).
//
//   cd ../velumaris-utils && node scripts/foundry/table-sheet.js --session 144 --dry-run --html-out <dir>
//   node dev/table-sheet-mock/build-mock.js <dir>          -> <dir>/journals-mock.html
//
// The page HTML comes from --html-out; portraits and lead lines come from the vault.
// For the story pages (P2), copy this pattern rather than this file.
const fs = require('fs');
const path = require('path');
// sharp lives in the sibling utils repo; this dev tool has no node_modules of its own.
const sharp = require(path.resolve(__dirname, '..', '..', '..', 'velumaris-utils', 'node_modules', 'sharp'));

const S = path.resolve(process.argv[2] || '.');
const MOD = path.resolve(__dirname, '..', '..');
const VAULT = path.resolve(MOD, '..', 'velumaris-vault', 'Eras', 'Era 2 - Love Death and Jaz Era');

const pick = (suffix) => {
  const f = fs.readdirSync(S).find((n) => new RegExp(`^table-sheet-\\d+${suffix}\\.html$`).test(n));
  if (!f) throw new Error(`no table-sheet-NNN${suffix}.html in ${S} (run table-sheet.js --html-out first)`);
  return fs.readFileSync(path.join(S, f), 'utf8');
};
const sheet = pick('');
const recap = pick('-recap');
const readAloud = pick('-read-aloud');

// Module CSS with the fonts inlined (the artifact cannot fetch them).
let css = fs.readFileSync(path.join(MOD, 'styles/journals.css'), 'utf8');
css = css.replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_m, f) => {
  const b64 = fs.readFileSync(path.join(MOD, 'fonts', f)).toString('base64');
  return `url(data:font/woff2;base64,${b64})`;
});

// Module core as a classic script.
const core = fs.readFileSync(path.join(MOD, 'scripts/table-sheet.mjs'), 'utf8').replace(/^export /gm, '');

// Name cards: from the vault notes, as the compendium would carry them.
function findNote(name) {
  const stack = [path.join(VAULT, 'NPC Codex')];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === `${name}.md`) return p;
    }
  }
  return null;
}
function findImage(base) {
  const stack = [path.join(VAULT, 'images')];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === base) return p;
    }
  }
  return null;
}
async function npc(name) {
  const file = findNote(name);
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const embed = (text.match(/!\[\[([^\]|]+\.webp)/) || [])[1];
  let img = null;
  if (embed) {
    const src = findImage(embed.split('/').pop());
    if (src) {
      const buf = await sharp(src).resize(144, 144, { fit: 'cover', position: 'top' }).webp({ quality: 78 }).toBuffer();
      img = `data:image/webp;base64,${buf.toString('base64')}`;
    }
  }
  // The lead: the first quote block after the infobox.
  const blocks = text.split(/\n(?!>)/).filter((b) => b.startsWith('>'));
  const quote = blocks.find((b) => !/\[!infobox\]/i.test(b)) || '';
  let lead = quote
    .split('\n')
    .map((l) => l.replace(/^>\s?/, ''))
    .join(' ')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (lead.length > 260) {
    const cut = lead.slice(0, 260);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '));
    lead = stop > 80 ? cut.slice(0, stop + 1) : `${cut}…`;
  }
  return { img, lead };
}

(async () => {
  const namesHtml = (sheet.split('data-vel-block="names"')[1] || '').split('</div>')[0];
  const names = [...namesHtml.matchAll(/<li><strong>([^<]+)<\/strong>/g)].map((m) => m[1]).filter((n) => !/^(Aydriann|Dax|Mack|Orianna|Peach|Rozibynne|Ember)$/.test(n));
  const npcs = {};
  for (const n of names) npcs[n] = await npc(n);
  console.log('cards:', Object.entries(npcs).map(([k, v]) => `${k}:${v ? (v.img ? 'img' : 'noimg') : 'none'}`).join(' '));

  const tpl = fs.readFileSync(path.join(__dirname, 'mock.template.html'), 'utf8');
  const out = tpl
    .replace('/*MODULE_CSS*/', () => css)
    .replace('<!--SHEET-->', () => sheet)
    .replace('<!--READ_ALOUD-->', () => readAloud)
    .replace('<!--RECAP-->', () => recap)
    .replace('/*MODULE_CORE*/', () => core)
    .replace('/*NPCS*/', () => `const NPCS = ${JSON.stringify(npcs)};`);
  fs.writeFileSync(path.join(S, 'journals-mock.html'), out, 'utf8');
  console.log('written', (out.length / 1024).toFixed(0), 'KB');
})();
