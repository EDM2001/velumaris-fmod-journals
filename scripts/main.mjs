/**
 * Velumaris: Journals, the Foundry side.
 *
 * table-sheet.mjs and story-pages.mjs do the building and never touch Foundry;
 * this file gives them an `env` made of Foundry calls, watches the DOM for pages
 * (journal windows and GM Screen cells alike), and keeps the GM Screen pointed at
 * the newest sheet, and its NPCs tab filled with the night's cast, on the DM's say-so.
 */

import { WRAPPER_SELECTOR, enhance, refreshEntry, npcLeadFromHtml } from './table-sheet.mjs';
import { enhanceStory, previewFromHtml, kindOfType, typeLabel } from './story-pages.mjs';

const MODULE_ID = 'velumaris-fmod-journals';
const TABLE_SHEETS_FOLDER = 'Table Sheets';

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'newLook', {
    name: 'VELJOURNALS.Settings.NewLook.Name',
    hint: 'VELJOURNALS.Settings.NewLook.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderJournals(),
  });
  // The story pages have their own switch, so a problem with an NPC page
  // mid-session never costs the Table Sheet (P2 round 1, assumption a07).
  game.settings.register(MODULE_ID, 'storyLook', {
    name: 'VELJOURNALS.Settings.StoryLook.Name',
    hint: 'VELJOURNALS.Settings.StoryLook.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderJournals(),
  });
  // The GM Screen questions are asked once per new sheet, not on every reload.
  game.settings.register(MODULE_ID, 'gmScreenAsked', {
    scope: 'client',
    config: false,
    type: String,
    default: '',
  });
  game.settings.register(MODULE_ID, 'gmScreenNpcsAsked', {
    scope: 'client',
    config: false,
    type: String,
    default: '',
  });
});

Hooks.once('ready', () => {
  // Table Sheets are GM-only entries, and so is every story page (both compendium
  // packs are closed to players), so there is nothing here for a player.
  if (!game.user.isGM) return;
  const env = foundryEnv();
  const storyEnv = foundryStoryEnv();

  const scan = (root) => {
    if (!game.settings.get(MODULE_ID, 'newLook')) return;
    const found = [];
    if (root.matches && root.matches(WRAPPER_SELECTOR)) found.push(root);
    if (root.querySelectorAll) found.push(...root.querySelectorAll(WRAPPER_SELECTOR));
    for (const w of found) {
      // Never build inside an editor: an edit is saved from the DOM.
      if (w.closest('.ProseMirror, prose-mirror, [contenteditable="true"]')) continue;
      try {
        enhance(w, env);
      } catch (err) {
        console.error(`${MODULE_ID} | could not build a table sheet page`, err);
      }
    }
  };

  const scanStory = (root) => {
    if (!game.settings.get(MODULE_ID, 'storyLook')) return;
    const found = [];
    if (root.matches && root.matches('.journal-page-content')) found.push(root);
    if (root.querySelectorAll) found.push(...root.querySelectorAll('.journal-page-content'));
    for (const content of found) {
      if (content.dataset.velStory) continue;
      if (content.closest('.ProseMirror, prose-mirror, [contenteditable="true"]')) continue;
      if (content.querySelector(WRAPPER_SELECTOR)) continue;
      let meta = null;
      try {
        meta = storyMeta(content);
      } catch (err) {
        console.error(`${MODULE_ID} | could not read a story page`, err);
      }
      if (!meta) continue;
      try {
        enhanceStory(content, meta, storyEnv);
      } catch (err) {
        console.error(`${MODULE_ID} | could not build a story page`, err);
      }
    }
  };

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        scan(n);
        scanStory(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
  scanStory(document.body);

  // A tick made in another window or on another GM client.
  Hooks.on('updateJournalEntry', (entry, change) => {
    if (change && change.flags && change.flags[MODULE_ID]) refreshEntry(entry.id, env);
  });
  // A closed window forgets where it came from.
  Hooks.on('closeJournalEntrySheet', (app) => {
    if (app && app.document) trail.delete(app.document.uuid);
  });

  checkGmScreen();
  Hooks.on('createJournalEntry', (entry) => {
    if (isTableSheet(entry)) setTimeout(checkGmScreen, 500);
  });
});

function isTableSheet(entry) {
  return !!(entry && entry.flags && entry.flags.velumaris && entry.flags.velumaris.kind === 'table-sheet');
}

function rerenderJournals() {
  for (const app of foundry.applications.instances.values()) {
    const doc = app.document;
    if (doc && (doc.documentName === 'JournalEntry' || doc.documentName === 'JournalEntryPage')) app.render();
  }
  ui.notifications.info(game.i18n.localize('VELJOURNALS.Notify.Reopen'));
}

function velumarisPack(name) {
  return (
    game.packs.find(
      (p) =>
        p.documentName === 'JournalEntry' &&
        String(p.metadata.packageName || '').startsWith('velumaris-fmod-compendium') &&
        p.metadata.name === name
    ) || null
  );
}

function themeOf(node) {
  const themed = node.closest('.theme-light, .theme-dark');
  if (themed) return themed.classList.contains('theme-light') ? 'light' : 'dark';
  return document.body.classList.contains('theme-light') ? 'light' : 'dark';
}

// ── env: everything table-sheet.mjs needs from Foundry ─────────────────────

function foundryEnv() {
  const nameCache = new Map();
  let pack;

  const npcPack = () => {
    if (pack !== undefined) return pack;
    pack = velumarisPack('journals');
    return pack;
  };

  /** The NPC page by name: the vault-built compendium copy first, then a world journal. */
  const findNpc = async (name) => {
    const p = npcPack();
    if (p) {
      const index = await p.getIndex();
      const hit = index.find((e) => e.name === name);
      if (hit) return p.getDocument(hit._id);
    }
    return game.journal.getName(name) || null;
  };

  const env = {
    theme: themeOf,

    getState(entryId) {
      const entry = game.journal.get(entryId);
      return (entry && entry.getFlag(MODULE_ID, 'state')) || {};
    },

    async setState(entryId, patch, opts = {}) {
      const entry = game.journal.get(entryId);
      if (!entry) return;
      // Show it at once, then save. `render: false` keeps the journal window from
      // re-rendering (and losing its scroll) on every tick; the update hook
      // re-applies the saved state everywhere instead.
      const next = foundry.utils.mergeObject(foundry.utils.deepClone(env.getState(entryId)), patch);
      refreshEntry(entryId, { ...env, getState: () => next }, opts);
      await entry.update({ [`flags.${MODULE_ID}.state`]: patch }, { render: false });
    },

    sceneInfo(name) {
      const scene = game.scenes.getName(name);
      return { exists: !!scene, active: !!(scene && scene.active) };
    },
    viewScene(name) {
      const scene = game.scenes.getName(name);
      if (scene) scene.view();
    },
    activateScene(name) {
      const scene = game.scenes.getName(name);
      if (scene) scene.activate();
    },

    async lookupName(name) {
      if (nameCache.has(name)) return nameCache.get(name);
      const doc = await findNpc(name);
      let info = null;
      if (doc) {
        const page = doc.pages.contents[0];
        info = npcLeadFromHtml(page && page.text ? page.text.content : '');
        if (!info.img) {
          const actor = game.actors.getName(name);
          if (actor) info.img = actor.img;
        }
      }
      nameCache.set(name, info);
      return info;
    },
    async openName(name) {
      const doc = await findNpc(name);
      if (doc) doc.sheet.render(true);
      else ui.notifications.warn(game.i18n.format('VELJOURNALS.Notify.NoNpc', { name }));
    },
  };
  return env;
}

// ── The story pages (P2): which page is this, and the env story-pages.mjs needs ──

/** The page a rendered `.journal-page-content` belongs to, found through its app. */
function resolvePage(content) {
  const article = content.closest('.journal-entry-page[data-page-id]');
  for (let el = content.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!el.id) continue;
    const app = foundry.applications.instances.get(el.id);
    const doc = app && app.document;
    if (!doc) continue;
    if (doc.documentName === 'JournalEntryPage') return doc;
    if (doc.documentName === 'JournalEntry') return article ? doc.pages.get(article.dataset.pageId) || null : null;
  }
  return null;
}

/** What story-pages.mjs is told about a page, from the tags pack-writers.js stamps. */
function storyMeta(content) {
  const page = resolvePage(content);
  if (!page || page.type !== 'text') return null;
  const entry = page.parent;
  const ev = (entry && entry.flags && entry.flags.velumaris) || {};
  const pv = (page.flags && page.flags.velumaris) || {};
  if (ev.kind === 'table-sheet') return null;
  const isSession = ev.type === 'arc' && pv.session != null;
  if (!ev.type && !isSession) return null;
  const kind = kindOfType(ev.type, isSession);
  let arc = null;
  if (isSession) {
    const m = /^Arc\s+(\d+)\s*-\s*(.+)$/.exec(entry.name || '');
    if (m) arc = { n: Number(m[1]), name: m[2].trim() };
  }
  const cell = content.closest('.gm-screen-grid-cell');
  return {
    kind,
    type: ev.type || '',
    name: entry.name,
    uuid: isSession ? page.uuid : entry.uuid,
    arc,
    session: isSession ? Number(pv.session) : null,
    pronouns: ev.pronouns || '',
    pronunciation: ev.pronunciation || '',
    cast: pv.cast || null,
    inCell: !!cell,
    compact: !!cell && kind === 'npc',
  };
}

/** entry uuid -> the uuids a same-window link came through, for Back. Memory only. */
const trail = new Map();

function hostApp(root) {
  for (let el = root.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!el.id || !el.classList.contains('application')) continue;
    const app = foundry.applications.instances.get(el.id);
    if (app && app.document && app.document.documentName === 'JournalEntry') return app;
  }
  return null;
}

/** Open `uuid` in the window `app` occupies: same place, same size; the old one closes. */
async function openHere(app, uuid, isBack) {
  let doc = null;
  try {
    doc = await fromUuid(uuid);
  } catch {
    doc = null;
  }
  if (!doc) {
    ui.notifications.warn(game.i18n.localize('VELJOURNALS.Notify.NoPage'));
    return;
  }
  const entry = doc.documentName === 'JournalEntryPage' ? doc.parent : doc;
  if (!entry || entry.documentName !== 'JournalEntry') {
    if (doc.sheet) doc.sheet.render(true);
    return;
  }
  const here = app.document;
  const past = trail.get(here.uuid) || [];
  trail.set(entry.uuid, isBack ? past.slice(0, -1) : [...past, here.uuid]);
  const { left, top, width, height } = app.position;
  const opts = { force: true, position: { left, top, width, height } };
  if (doc.documentName === 'JournalEntryPage') opts.pageId = doc.id;
  await entry.sheet.render(opts);
  if (entry.sheet !== app) await app.close({ animate: false });
}

function foundryStoryEnv() {
  const previews = new Map();

  const indexEntry = async (uuid) => {
    const parsed = foundry.utils.parseUuid(uuid);
    if (!parsed || !parsed.collection) return null;
    const id = parsed.primaryId || parsed.documentId;
    if (typeof parsed.collection.getIndex === 'function') {
      const index = await parsed.collection.getIndex({ fields: ['flags.velumaris'] });
      return { entry: index.get(id), embedded: !!(parsed.embedded && parsed.embedded.length) };
    }
    return { entry: parsed.collection.get(id), embedded: !!(parsed.embedded && parsed.embedded.length) };
  };

  return {
    theme: themeOf,

    async kindOf(uuid) {
      const hit = await indexEntry(uuid);
      if (!hit || !hit.entry || hit.embedded) return null;
      const type = hit.entry.flags && hit.entry.flags.velumaris ? hit.entry.flags.velumaris.type : '';
      return { kind: kindOfType(type, false), name: hit.entry.name };
    },

    preview(uuid) {
      if (previews.has(uuid)) return previews.get(uuid);
      const job = (async () => {
        const doc = await fromUuid(uuid);
        if (!doc) return null;
        if (doc.documentName === 'JournalEntryPage') {
          const f = (doc.flags && doc.flags.velumaris) || {};
          const info = previewFromHtml(doc.text ? doc.text.content : '');
          const arc = doc.parent ? String(doc.parent.name).replace(/\s*-\s*/, ' · ') : '';
          return { name: doc.name.replace(/^Session\s+\d+\s*-\s*/, ''), img: info.img, lead: info.lead, kicker: f.session ? `Session ${f.session}${arc ? ` · ${arc}` : ''}` : arc };
        }
        if (doc.documentName !== 'JournalEntry') return null;
        const f = (doc.flags && doc.flags.velumaris) || {};
        const page = doc.pages.contents[0];
        const info = previewFromHtml(page && page.text ? page.text.content : '');
        const bits = [];
        bits.push(typeLabel(f.type));
        if (f.pronunciation) bits.push(String(f.pronunciation).replace(/\s*\[TODO[^\]]*\]\s*/i, '?'));
        if (f.pronouns) bits.push(String(f.pronouns).toLowerCase());
        return { name: doc.name, img: info.img, lead: info.lead, kicker: bits.join(' · ') };
      })().catch(() => null);
      previews.set(uuid, job);
      return job;
    },

    openInPlace(uuid, root) {
      const app = hostApp(root);
      if (!app) return false;
      const here = app.document;
      // A page of the same entry (the next session in an arc): Foundry turns the page.
      if (uuid === here.uuid || uuid.startsWith(`${here.uuid}.`)) return false;
      openHere(app, uuid, false);
      return true;
    },

    back(root) {
      const app = hostApp(root);
      if (!app) return null;
      const stack = trail.get(app.document.uuid);
      if (!stack || !stack.length) return null;
      const prev = stack[stack.length - 1];
      let label = 'Back';
      try {
        const d = fromUuidSync(prev);
        if (d && d.name) label = d.name;
      } catch {
        /* the label is a nicety */
      }
      return { label, go: () => openHere(app, prev, true) };
    },

    openUuid(uuid) {
      fromUuid(uuid).then((d) => d && d.sheet && d.sheet.render(true));
    },
  };
}

// ── The GM Screen follows the newest sheet, when the DM says so ─────────────

/**
 * Every session's sheet is a new entry with new page ids, so a GM Screen cell
 * pinned to last session's page keeps showing last session. The fix is the same
 * as the `Sync GM Screen` macro's, but offered here, in the DM's own browser, the
 * first time the drawer is found pointing at an older sheet. It is never done
 * silently: the relay may not write world settings, and a push must not reach
 * around that through this module.
 */
async function checkGmScreen() {
  if (!game.modules.get('gm-screen')?.active) return;
  const folder = game.folders.find((f) => f.type === 'JournalEntry' && f.name === TABLE_SHEETS_FOLDER);
  if (!folder) return;
  const sheets = folder.contents.filter(isTableSheet);
  if (!sheets.length) return;
  const newest = sheets.sort((a, b) => (b.flags.velumaris.session || 0) - (a.flags.velumaris.session || 0))[0];
  await offerRepoint(newest);
  await offerNpcTab(newest);
}

function gmScreenConfig() {
  try {
    return game.settings.get('gm-screen', 'gm-screen-config');
  } catch {
    return null;
  }
}

async function offerRepoint(newest) {
  if (game.settings.get(MODULE_ID, 'gmScreenAsked') === newest.id) return;
  const config = gmScreenConfig();
  if (!config) return;
  const stale = [];
  for (const [gridId, grid] of Object.entries(config.grids || {})) {
    for (const [cellId, cell] of Object.entries(grid.entries || {})) {
      const m = /^JournalEntry\.([^.]+)\.JournalEntryPage\.([^.]+)$/.exec(cell.entityUuid || '');
      if (!m) continue;
      const entry = game.journal.get(m[1]);
      if (!entry || entry.id === newest.id || !isTableSheet(entry)) continue;
      const page = entry.pages.get(m[2]);
      const target = page ? newest.pages.getName(page.name) : null;
      if (target) stale.push({ gridId, cellId, from: entry, to: target });
    }
  }
  if (!stale.length) return;

  await game.settings.set(MODULE_ID, 'gmScreenAsked', newest.id);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize('VELJOURNALS.GmScreen.Title') },
    content: `<p>${game.i18n.format('VELJOURNALS.GmScreen.Body', { from: stale[0].from.name, to: newest.name })}</p>`,
    yes: { label: game.i18n.localize('VELJOURNALS.GmScreen.Yes') },
    no: { label: game.i18n.localize('VELJOURNALS.GmScreen.No') },
  });
  if (!ok) return;

  const next = foundry.utils.deepClone(config);
  for (const s of stale) {
    const cell = next.grids[s.gridId].entries[s.cellId];
    cell.entityUuid = s.to.uuid;
    cell.type = 'JournalEntryPage';
  }
  await game.settings.set('gm-screen', 'gm-screen-config', next);
  ui.notifications.info(game.i18n.format('VELJOURNALS.GmScreen.Done', { to: newest.name, n: stale.length }));
}

/**
 * The NPCs tab, filled from the night's cast (P2 round 1, card 9). `table-sheet.js`
 * stamps the Session Guide's "Important NPCs" on the sheet as `flags.velumaris.cast`;
 * this offers, once per sheet, to put each of them in a cell of the tab called
 * "NPCs", which the module then shows as a compact card.
 *
 * Each cell holds the NPC's PAGE, not the entry: the shape the GM Screen itself
 * writes when a page is dragged in. A page cell shows the page alone, where an
 * entry cell wraps it in the journal window's own header and sidebar (the DM
 * dragged all six S144 cells in by hand to get that, 2026-09-25).
 */
async function offerNpcTab(newest) {
  const cast = newest.flags.velumaris.cast;
  if (!Array.isArray(cast) || !cast.length) return;
  if (game.settings.get(MODULE_ID, 'gmScreenNpcsAsked') === newest.id) return;
  const config = gmScreenConfig();
  if (!config) return;
  const [gridId, grid] = Object.entries(config.grids || {}).find(([, g]) => /^npcs?$/i.test(String(g.name || '').trim())) || [];
  if (!grid) return;
  const pack = velumarisPack('journals');
  if (!pack) return;
  const index = await pack.getIndex({ fields: ['flags.velumaris'] });
  const picks = [];
  for (const name of cast) {
    const hit = index.find((e) => e.name === name && e.flags && e.flags.velumaris && e.flags.velumaris.type === 'npc');
    if (!hit) continue;
    const entry = await pack.getDocument(hit._id);
    const page = entry && entry.pages.contents.sort((a, b) => a.sort - b.sort)[0];
    if (page) picks.push({ name, uuid: page.uuid });
  }
  if (!picks.length) return;
  const now = Object.values(grid.entries || {}).map((c) => c.entityUuid).filter(Boolean);
  if (now.length === picks.length && picks.every((p) => now.includes(p.uuid))) return;

  await game.settings.set(MODULE_ID, 'gmScreenNpcsAsked', newest.id);
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize('VELJOURNALS.GmScreen.Title') },
    content: `<p>${game.i18n.format('VELJOURNALS.GmScreen.NpcBody', { names: picks.map((p) => foundry.utils.escapeHTML(p.name)).join(' · ') })}</p>`,
    yes: { label: game.i18n.localize('VELJOURNALS.GmScreen.NpcYes') },
    no: { label: game.i18n.localize('VELJOURNALS.GmScreen.No') },
  });
  if (!ok) return;

  const cols = Math.min(3, picks.length);
  const rows = Math.ceil(picks.length / cols);
  const entries = {};
  picks.forEach((p, i) => {
    const x = (i % cols) + 1;
    const y = Math.floor(i / cols) + 1;
    const entryId = `${x}-${y}`;
    entries[entryId] = { x, y, entryId, entityUuid: p.uuid, type: 'JournalEntryPage', isDndNpc: false, isDndNpcStatBlock: false };
  });
  const next = foundry.utils.deepClone(config);
  next.grids[gridId].entries = entries;
  next.grids[gridId].columnOverride = cols;
  next.grids[gridId].rowOverride = rows;
  await game.settings.set('gm-screen', 'gm-screen-config', next);
  ui.notifications.info(game.i18n.format('VELJOURNALS.GmScreen.NpcDone', { n: picks.length }));
}
