// Build a review mock for the GM guides: the real pushed pages + the module's own CSS
// and scripts, with Foundry replaced by a fake env (mock.template.html). The DM reviews
// it as a published Artifact before anything is deployed (GM guides round 1, a08).
//
//   cd ../velumaris-utils && node scripts/foundry/run-guides.js --html-out <dir>
//   node dev/guides-mock/build-mock.js <dir>          -> <dir>/guides-mock.html
//
// The counters are read off the live world actors the run guide names (read-only relay),
// so the mock opens on the numbers Foundry has tonight.
const fs = require('fs');
const path = require('path');

const S = path.resolve(process.argv[2] || '.');
const MOD = path.resolve(__dirname, '..', '..');
const UTILS = path.resolve(MOD, '..', 'velumaris-utils');
const { fetchActorByUuid } = require(path.join(UTILS, 'scripts', 'foundry', 'lib', 'actor-fetch.js'));

const pick = (prefix) => {
  const f = fs.readdirSync(S).find((n) => n.startsWith(prefix) && n.endsWith('.html'));
  if (!f) throw new Error(`no ${prefix}*.html in ${S} (run run-guides.js --html-out first)`);
  return fs.readFileSync(path.join(S, f), 'utf8');
};
const runGuide = pick('run-guide-');
const arcGuide = pick('arc-guide-');

// Module CSS: the guide styles inlined in place of their @import, fonts as data URIs
// (the artifact can fetch neither). The story pages' import is dropped: no story page here.
let css = fs.readFileSync(path.join(MOD, 'styles/journals.css'), 'utf8');
css = css.replace("@import url('story-pages.css');", '');
css = css.replace("@import url('guides.css');", () => fs.readFileSync(path.join(MOD, 'styles/guides.css'), 'utf8'));
css = css.replace(/url\('\.\.\/fonts\/([^']+)'\)/g, (_m, f) => {
  const b64 = fs.readFileSync(path.join(MOD, 'fonts', f)).toString('base64');
  return `url(data:font/woff2;base64,${b64})`;
});

// Module code as one classic script: table-sheet.mjs (readMeta, textKey) then guides.mjs.
const strip = (src) => src.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const core = [strip(fs.readFileSync(path.join(MOD, 'scripts/table-sheet.mjs'), 'utf8')), strip(fs.readFileSync(path.join(MOD, 'scripts/guides.mjs'), 'utf8'))].join('\n');

function metaOf(html) {
  const m = /data-vel-meta="([^"]*)"/.exec(html);
  return m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&')) : {};
}

/** The counters main.mjs's env.actorCounters() would return, from the actor's source. */
function countersOf(doc) {
  const res = doc.system.resources || {};
  const pool = (r) => {
    const max = Number(r && r.max) || 0;
    return max ? { max, value: Math.max(0, max - (Number(r.spent) || 0)) } : null;
  };
  const uses = [];
  for (const it of doc.items || []) {
    const u = it.system && it.system.uses;
    const max = Number(u && u.max) || 0;
    if (!max || /legendary resistance/i.test(it.name)) continue;
    const rec = (u.recovery || [])[0] || {};
    const recharge = rec.period === 'recharge' ? String(rec.formula || '6').replace(/^(\d)$/, '$1–6') : null;
    uses.push({ key: it._id, name: it.name.replace(/\s*\(.*\)\s*$/, ''), max, value: Math.max(0, max - (Number(u.spent) || 0)), recharge });
  }
  return { name: doc.name, legres: pool(res.legres), legact: pool(res.legact), uses };
}

(async () => {
  const meta = metaOf(runGuide);
  const counters = {};
  for (const a of meta.actors || []) {
    const { doc } = await fetchActorByUuid(a.uuid);
    counters[a.uuid] = countersOf(doc);
  }
  console.log('counters:', JSON.stringify(counters));

  const tpl = fs.readFileSync(path.join(__dirname, 'mock.template.html'), 'utf8');
  const out = tpl
    .replace('/*MODULE_CSS*/', () => css)
    .replace('<!--RUN_GUIDE-->', () => runGuide)
    .replace('<!--ARC_GUIDE-->', () => arcGuide)
    .replace('/*MODULE_CORE*/', () => core)
    .replace('/*COUNTERS*/', () => `var COUNTERS = ${JSON.stringify(counters)};`);
  fs.writeFileSync(path.join(S, 'guides-mock.html'), out, 'utf8');
  console.log('written', (out.length / 1024).toFixed(0), 'KB');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
