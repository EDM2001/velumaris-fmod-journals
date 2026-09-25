// Fetch the real story pages for the review mock, READ-ONLY, through the relay.
//
//   node dev/story-pages/fetch-pages.js <scratch dir>     -> <dir>/story-pages.json
//
// For each sample page: the page HTML as Foundry renders it (enrichHTML, so links are
// real `a.content-link` anchors and DM-only sections are `section.secret`), and the
// tags pack-writers stamps. For every page they link to: its name, tags and the start
// of its stored HTML, which is what the module's preview cards are built from.
// ⚠️ The relay client is usually the DM's own browser: nothing here renders a
// window or writes a document.
const fs = require('fs');
const path = require('path');
const relay = require(path.resolve(__dirname, '..', '..', '..', 'velumaris-utils', 'scripts', 'foundry', '_relay.js'));

const OUT = path.resolve(process.argv[2] || '.');
const SAMPLES = {
  npcs: ['Wick', 'Gardhu', 'Solder', 'Dolly', 'Tess', 'Muvara'],
  places: ['Eden', 'Scion Guardians'],
  arc: 'Arc 8 - Eden',
  sessions: [141, 142],
};

const body = `
const want = ${relay.safeJson(SAMPLES)};
const jp = game.packs.find((p) => p.documentName === 'JournalEntry' && String(p.metadata.packageName || '').startsWith('velumaris-fmod-compendium') && p.metadata.name === 'journals');
const sp = game.packs.find((p) => p.documentName === 'JournalEntry' && String(p.metadata.packageName || '').startsWith('velumaris-fmod-compendium') && p.metadata.name === 'journals-sessions');
const TE = foundry.applications.ux.TextEditor.implementation;
const idx = await jp.getIndex({ fields: ['flags.velumaris'] });
const pages = [];
const addEntry = async (name) => {
  const hit = idx.find((e) => e.name === name);
  if (!hit) return;
  const doc = await jp.getDocument(hit._id);
  const pg = doc.pages.contents[0];
  const html = await TE.enrichHTML(pg.text.content, { relativeTo: pg, secrets: true });
  pages.push({ key: name, entryUuid: doc.uuid, entryName: doc.name, entryFlags: doc.flags, pageId: pg.id, pageName: pg.name, pageFlags: pg.flags, html });
};
for (const n of want.npcs) await addEntry(n);
for (const n of want.places) await addEntry(n);
const sidx = await sp.getIndex();
const arcHit = sidx.find((e) => e.name === want.arc);
if (arcHit) {
  const arc = await sp.getDocument(arcHit._id);
  for (const pg of arc.pages.contents) {
    const f = pg.flags && pg.flags.velumaris;
    if (!f || !want.sessions.includes(f.session)) continue;
    const html = await TE.enrichHTML(pg.text.content, { relativeTo: pg, secrets: true });
    pages.push({ key: 'S' + f.session, entryUuid: arc.uuid, entryName: arc.name, entryFlags: arc.flags, pageId: pg.id, pageName: pg.name, pageUuid: pg.uuid, pageFlags: pg.flags, html });
  }
}
const linked = {};
for (const p of pages) {
  const d = new DOMParser().parseFromString(p.html, 'text/html');
  for (const a of d.querySelectorAll('a.content-link[data-uuid]')) linked[a.dataset.uuid] = true;
}
const docs = {};
for (const uuid of Object.keys(linked)) {
  try {
    const doc = await fromUuid(uuid);
    if (!doc) { docs[uuid] = null; continue; }
    if (doc.documentName === 'JournalEntry') {
      const pg = doc.pages.contents[0];
      docs[uuid] = { documentName: 'JournalEntry', name: doc.name, flags: doc.flags, head: pg && pg.text ? String(pg.text.content).slice(0, 5000) : '' };
    } else if (doc.documentName === 'JournalEntryPage') {
      docs[uuid] = { documentName: 'JournalEntryPage', name: doc.name, parentName: doc.parent && doc.parent.name, parentUuid: doc.parent && doc.parent.uuid, flags: doc.flags, head: doc.text ? String(doc.text.content).slice(0, 5000) : '' };
    } else {
      docs[uuid] = { documentName: doc.documentName, name: doc.name, img: doc.img || null };
    }
  } catch (err) {
    docs[uuid] = { error: String(err) };
  }
}
return { pages, docs };
`;

(async () => {
  const res = await relay.execute(relay.buildScript('p2-mock-fetch', body));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'story-pages.json'), JSON.stringify(res, null, 1));
  console.log('pages:', res.pages.map((p) => `${p.key} ${p.html.length}`).join(', '));
  console.log('linked docs:', Object.keys(res.docs).length, 'missing:', Object.values(res.docs).filter((d) => !d).length);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
