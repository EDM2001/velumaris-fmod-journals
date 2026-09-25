/**
 * Velumaris: Journals, the Foundry side.
 *
 * table-sheet.mjs does the building and never touches Foundry; this file gives it
 * an `env` made of Foundry calls, watches the DOM for pushed pages (journal windows
 * and GM Screen cells alike), and keeps the GM Screen pointed at the newest sheet
 * on the DM's say-so.
 */

import { WRAPPER_SELECTOR, enhance, refreshEntry, npcLeadFromHtml } from './table-sheet.mjs';

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
  // The GM Screen question is asked once per new sheet, not on every reload.
  game.settings.register(MODULE_ID, 'gmScreenAsked', {
    scope: 'client',
    config: false,
    type: String,
    default: '',
  });
});

Hooks.once('ready', () => {
  // Table Sheets are GM-only entries, so there is nothing here for a player.
  if (!game.user.isGM) return;
  const env = foundryEnv();

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

  new MutationObserver((mutations) => {
    for (const m of mutations) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  // A tick made in another window or on another GM client.
  Hooks.on('updateJournalEntry', (entry, change) => {
    if (change && change.flags && change.flags[MODULE_ID]) refreshEntry(entry.id, env);
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

// ── env: everything table-sheet.mjs needs from Foundry ─────────────────────

function foundryEnv() {
  const nameCache = new Map();
  let pack;

  const npcPack = () => {
    if (pack !== undefined) return pack;
    pack =
      game.packs.find(
        (p) =>
          p.documentName === 'JournalEntry' &&
          String(p.metadata.packageName || '').startsWith('velumaris-fmod-compendium') &&
          p.metadata.name === 'journals'
      ) || null;
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
    theme(node) {
      const themed = node.closest('.theme-light, .theme-dark');
      if (themed) return themed.classList.contains('theme-light') ? 'light' : 'dark';
      return document.body.classList.contains('theme-light') ? 'light' : 'dark';
    },

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
  if (game.settings.get(MODULE_ID, 'gmScreenAsked') === newest.id) return;

  let config;
  try {
    config = game.settings.get('gm-screen', 'gm-screen-config');
  } catch {
    return;
  }
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
