/**
 * The Table Sheet, made into the working sheet (DM rulings 2026-09-25, vault
 * `Ops/Planning/Foundry Journals (Planned).md`).
 *
 * `foundry:table-sheet` (velumaris-utils) pushes three GM-only pages, each wrapped in
 * `<div data-velumaris="table-sheet-NNN[-recap|-read-aloud]" data-vel-meta="{…}">`.
 * This file finds those wrappers when they appear and builds on top of them:
 *
 *   - the PC strip becomes a grid (built from the list, which stays the stored text)
 *   - secrets get tick boxes, scenes become a tracker, scene lines get map chips
 *   - names get a hover card and open their NPC page
 *   - the spoken pages get boxed read-aloud, and follow the tracker
 *
 * It is FRAMEWORK-FREE on purpose. main.mjs hands it a Foundry `env`; the review
 * mock hands it a fake one, so what the DM reviews is this exact code. Everything
 * Foundry-shaped (flags, packs, scenes, the theme) goes through `env`.
 *
 * The stored page is never written from here. The look is applied when a page
 * opens, so a restyle needs no re-push, and state (ticks, the current scene) lives
 * on the entry's flags, so a re-push never wipes it.
 */

export const WRAPPER_SELECTOR = '[data-velumaris^="table-sheet-"]';

/** @typedef {{secrets?: Record<string, boolean>, scene?: number|null}} SheetState */

export function readMeta(wrapper) {
  try {
    return JSON.parse(wrapper.dataset.velMeta || '{}');
  } catch {
    return {};
  }
}

function pageKind(wrapper, meta) {
  if (meta.page === 'sheet' || meta.page === 'recap' || meta.page === 'read-aloud') return meta.page;
  const s = wrapper.dataset.velumaris || '';
  if (s.endsWith('-read-aloud')) return 'read-aloud';
  if (s.endsWith('-recap')) return 'recap';
  return 'sheet';
}

/** Stable key for a line of text, so a tick follows the secret and not its position. */
export function textKey(text) {
  const norm = String(text).replace(/^\[done\]\s*/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < norm.length; i += 1) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Build the sheet on one wrapper. Safe to call twice: the second call only
 * re-applies state.
 * @param {HTMLElement} wrapper
 * @param {object} env  see main.mjs foundryEnv() for the shape
 */
export function enhance(wrapper, env) {
  const meta = readMeta(wrapper);
  if (!wrapper.dataset.velDone) {
    wrapper.dataset.velDone = '1';
    const kind = pageKind(wrapper, meta);
    wrapper.classList.add('vel-ts', `vel-ts--${kind}`);
    setTheme(wrapper, env.theme(wrapper));
    if (kind === 'sheet') buildSheet(wrapper, meta, env);
    else buildSpoken(wrapper, kind);
  }
  applyState(wrapper, meta, env.getState(meta.entryId) || {});
}

function setTheme(node, theme) {
  node.classList.toggle('vel-light', theme === 'light');
  node.classList.toggle('vel-dark', theme !== 'light');
}

/** Re-apply state to every open page of one entry (after a tick, or a flag update). */
export function refreshEntry(entryId, env, opts = {}) {
  const state = env.getState(entryId) || {};
  for (const w of document.querySelectorAll(WRAPPER_SELECTOR)) {
    const meta = readMeta(w);
    if (meta.entryId !== entryId || !w.dataset.velDone) continue;
    applyState(w, meta, state, opts);
  }
}

// ── Page 1: At the table ────────────────────────────────────────────────────

const SECTION_KEYS = {
  secrets: 'secrets',
  scenes: 'scenes',
  'names to know': 'names',
  'spare names': 'spare',
};

function buildSheet(wrapper, meta, env) {
  // Group the flat page into sections, one per `## ` heading, so the layout can
  // put them side by side. Everything before the first heading is the header and
  // the party.
  const sections = [];
  let current = el('section', 'vel-sec vel-sec--party');
  sections.push(current);
  for (const node of [...wrapper.children]) {
    if (node.tagName === 'H2') {
      const key = SECTION_KEYS[node.textContent.trim().toLowerCase()] || 'other';
      current = el('section', `vel-sec vel-sec--${key}`);
      sections.push(current);
    }
    current.appendChild(node);
  }
  const grid = el('div', 'vel-grid');
  for (const s of sections) if (s.childNodes.length) grid.appendChild(s);
  wrapper.appendChild(grid);

  const head = wrapper.querySelector('.vel-sec--party > p');
  if (head) {
    head.classList.add('vel-head');
    // The header's closing gloss ("ceiling = if the party spends tonight…") explains
    // a column; it reads as a caption, not as a third headline.
    const strongs = head.querySelectorAll('strong');
    const last = strongs[strongs.length - 1];
    if (last && /^ceiling\s*=/i.test(last.textContent.trim())) {
      const note = el('span', 'vel-head-note', last.textContent.trim());
      const prev = last.previousSibling;
      if (prev && prev.nodeType === 3) prev.textContent = prev.textContent.replace(/\s*·\s*$/, '');
      last.replaceWith(note);
    }
  }

  buildParty(wrapper);
  buildSecrets(wrapper, meta, env);
  buildScenes(wrapper, meta, env);
  buildNames(wrapper, env);
  buildSpare(wrapper, meta, env);
}

/**
 * Spare names become chips the DM taps when one is used at the table (DM request
 * 2026-09-25: "the spare names need a way to check them to know what I used").
 * A used name stands OUT rather than fading, because afterwards it is the record
 * of who was invented tonight.
 */
function buildSpare(wrapper, meta, env) {
  const p = wrapper.querySelector('.vel-sec--spare p');
  if (!p) return;
  const names = p.textContent.split(' · ').map((s) => s.trim()).filter(Boolean);
  if (names.length < 2) return;
  const box = el('div', 'vel-spares');
  for (const entry of names) {
    const m = /^(.+?)\s*\(([^)]+)\)$/.exec(entry);
    const chip = el('button', 'vel-spare');
    chip.type = 'button';
    chip.dataset.velKey = textKey(entry);
    chip.appendChild(el('span', 'vel-spare-name', m ? m[1] : entry));
    if (m) chip.appendChild(el('span', 'vel-spare-say', m[2]));
    chip.addEventListener('click', () => {
      env.setState(meta.entryId, { spare: { [chip.dataset.velKey]: !chip.classList.contains('is-used') } });
    });
    box.appendChild(chip);
  }
  p.hidden = true;
  p.parentElement.appendChild(box);
}

/**
 * `Aydriann AC 18 · ceiling 20 (+2 Haste, Rozibynne) · History +15 · Int save +13 · PP 9 · Blur`
 * The shape pcStripBlock() writes in table-sheet.js. Returns null for a line that
 * does not fit it, and then the list is left exactly as it was.
 */
export function parsePcLine(text) {
  const segs = String(text).split(' · ').map((s) => s.trim()).filter(Boolean);
  const first = /^(.+?) AC (\d+)$/.exec(segs[0] || '');
  if (!first) return null;
  const row = { name: first[1], ac: first[2], ceiling: '', comps: '', skill: '', save: '', pp: '', notes: [] };
  for (const s of segs.slice(1)) {
    let m;
    if ((m = /^ceiling (\d+)(?: \((.*)\))?$/.exec(s))) {
      row.ceiling = m[1];
      row.comps = m[2] || '';
    } else if ((m = /^(Str|Dex|Con|Int|Wis|Cha) save ([+-]\d+)$/.exec(s))) {
      row.save = `${m[1]} ${m[2]}`;
    } else if ((m = /^PP (\d+)$/.exec(s))) {
      row.pp = m[1];
    } else if (!row.skill && (m = /^([A-Z][A-Za-z ]*?) ([+-]\d+)$/.exec(s))) {
      row.skill = `${m[1]} ${m[2]}`;
    } else {
      row.notes.push(s);
    }
  }
  return row;
}

function buildParty(wrapper) {
  const list = wrapper.querySelector('[data-vel-block="pc-strip"] ul');
  if (!list) return;
  const rows = [...list.children].map((li) => parsePcLine(li.textContent));
  if (!rows.length || rows.some((r) => !r)) return;

  const table = el('table', 'vel-party');
  const thead = el('thead');
  const hr = el('tr');
  // Header cells carry the same classes as their columns, so a narrow drawer can
  // drop a column whole.
  for (const [label, cls] of [['PC', 'pc'], ['AC', 'num ac'], ['Ceil.', 'num ceil'], ['Best skill', 'skill'], ['Best save', 'save'], ['PP', 'num pp'], ['On them', 'notes']]) {
    hr.appendChild(el('th', cls, label));
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    tr.appendChild(el('td', 'pc', r.name));
    tr.appendChild(el('td', 'num ac', r.ac));
    const ceil = el('td', 'num ceil');
    if (r.ceiling) {
      ceil.appendChild(el('b', null, r.ceiling));
      if (r.comps) ceil.title = r.comps;
    } else {
      ceil.appendChild(el('span', 'dim', '—'));
    }
    tr.appendChild(ceil);
    tr.appendChild(el('td', 'skill', r.skill));
    tr.appendChild(el('td', 'save', r.save));
    tr.appendChild(el('td', 'num pp', r.pp));
    tr.appendChild(el('td', 'notes', r.notes.join(', ')));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  list.hidden = true;
  list.parentElement.appendChild(table);
}

function buildSecrets(wrapper, meta, env) {
  const list = wrapper.querySelector('.vel-sec--secrets ul');
  if (!list) return;
  for (const li of list.children) {
    const raw = li.textContent;
    li.dataset.velKey = textKey(raw);
    // A secret ticked in the vault arrives as "[done] …" (table-sheet.js).
    if (/^\s*\[done\]\s*/i.test(raw)) {
      li.dataset.velVaultDone = '1';
      stripLeadingText(li, /^\s*\[done\]\s*/i);
    }
    const box = el('button', 'vel-tick');
    box.type = 'button';
    box.setAttribute('aria-label', 'Revealed');
    li.prepend(box);
    li.classList.add('vel-tickable');
    li.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      env.setState(meta.entryId, { secrets: { [li.dataset.velKey]: !li.classList.contains('is-done') } });
    });
  }
}

function stripLeadingText(node, re) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const t = walker.nextNode();
  if (t) t.textContent = t.textContent.replace(re, '');
}

function buildScenes(wrapper, meta, env) {
  const list = wrapper.querySelector('.vel-sec--scenes ol');
  if (!list) return;
  const maps = Array.isArray(meta.scenes) ? meta.scenes : [];
  [...list.children].forEach((li, i) => {
    li.dataset.velScene = String(i);
    li.classList.add('vel-scene');
    // Everything after the scene's bold title, so a scene that is over can fold
    // down to its title and the sheet gets shorter as the night goes on.
    const title = li.firstElementChild && li.firstElementChild.tagName === 'STRONG' ? li.firstElementChild : null;
    if (title) {
      const rest = el('span', 'vel-scene-rest');
      while (title.nextSibling) rest.appendChild(title.nextSibling);
      li.appendChild(rest);
    }
    const names = Array.isArray(maps[i]) ? maps[i] : [];
    if (names.length) {
      const chips = el('span', 'vel-chips');
      for (const name of names) chips.appendChild(sceneChip(name, env));
      (li.querySelector('.vel-scene-rest') || li).appendChild(chips);
    }
    li.addEventListener('click', (ev) => {
      if (ev.target.closest('a, button')) return;
      const state = env.getState(meta.entryId) || {};
      env.setState(meta.entryId, { scene: state.scene === i ? null : i }, { scroll: true });
    });
  });
}

/** `The Crossing Out` for `Eden — The Crossing Out`: the place, not the region. */
function shortScene(name) {
  const parts = String(name).split(' — ');
  return parts[parts.length - 1];
}

function sceneChip(name, env) {
  const info = env.sceneInfo(name);
  const chip = el('span', 'vel-chip');
  const view = el('button', 'vel-chip-view', shortScene(name));
  view.type = 'button';
  const show = el('button', 'vel-chip-show', 'Players');
  show.type = 'button';
  chip.append(view, show);
  if (!info.exists) {
    chip.classList.add('is-missing');
    chip.title = `No scene called "${name}" in this world`;
    view.disabled = true;
    show.disabled = true;
    return chip;
  }
  if (info.active) chip.classList.add('is-active');
  view.title = `View ${name} (only you)`;
  view.addEventListener('click', () => env.viewScene(name));
  // Showing a map to the players is the one thing here the table would see, so it
  // takes a second tap inside three seconds. A stray tap only arms it.
  let armed = null;
  show.title = `Show ${name} to the players`;
  show.addEventListener('click', () => {
    if (armed) {
      clearTimeout(armed);
      armed = null;
      chip.classList.remove('is-arming');
      show.textContent = 'Players';
      env.activateScene(name);
      chip.classList.add('is-active');
      return;
    }
    chip.classList.add('is-arming');
    show.textContent = 'Tap again';
    armed = setTimeout(() => {
      armed = null;
      chip.classList.remove('is-arming');
      show.textContent = 'Players';
    }, 3000);
  });
  return chip;
}

// ── Name cards ──────────────────────────────────────────────────────────────

let card = null;
let cardTimer = null;

function buildNames(wrapper, env) {
  const items = wrapper.querySelectorAll('.vel-sec--names li');
  for (const li of items) {
    const strong = li.querySelector('strong');
    if (!strong) continue;
    const name = strong.textContent.trim();
    strong.classList.add('vel-name');
    strong.tabIndex = 0;
    strong.setAttribute('role', 'button');
    const line = li.textContent.replace(name, '').trim();
    strong.addEventListener('mouseenter', () => {
      clearTimeout(cardTimer);
      cardTimer = setTimeout(() => showCard(strong, name, line, wrapper, env), 180);
    });
    strong.addEventListener('mouseleave', () => {
      clearTimeout(cardTimer);
      cardTimer = setTimeout(hideCard, 120);
    });
    const open = () => {
      hideCard();
      env.openName(name);
    };
    strong.addEventListener('click', open);
    strong.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  }
}

async function showCard(anchor, name, line, wrapper, env) {
  hideCard();
  const node = el('div', 'vel-card');
  setTheme(node, wrapper.classList.contains('vel-light') ? 'light' : 'dark');
  const body = el('div', 'vel-card-body');
  body.appendChild(el('div', 'vel-card-name', name));
  if (line) body.appendChild(el('div', 'vel-card-say', line));
  const lead = el('div', 'vel-card-lead', '…');
  body.appendChild(lead);
  node.appendChild(body);
  node.addEventListener('mouseenter', () => clearTimeout(cardTimer));
  node.addEventListener('mouseleave', () => {
    cardTimer = setTimeout(hideCard, 120);
  });
  document.body.appendChild(node);
  card = node;
  place(node, anchor);

  let info = null;
  try {
    info = await env.lookupName(name);
  } catch {
    info = null;
  }
  if (card !== node) return;
  if (!info) {
    lead.textContent = 'No NPC page with this name.';
    lead.classList.add('dim');
    return;
  }
  if (info.img) {
    const img = el('img', 'vel-card-img');
    img.src = info.img;
    img.alt = '';
    node.prepend(img);
  }
  lead.textContent = info.lead || '';
  body.appendChild(el('div', 'vel-card-hint', 'Click the name to open the page'));
  place(node, anchor);
}

function place(node, anchor) {
  const r = anchor.getBoundingClientRect();
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6;
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;
}

function hideCard() {
  if (card) card.remove();
  card = null;
}

/** Lead line of an NPC page: the first quote block that is not the infobox. */
export function npcLeadFromHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const img = doc.querySelector('img');
  const quote = [...doc.querySelectorAll('blockquote')].find((b) => !b.querySelector('img, table'));
  let lead = quote ? quote.textContent : '';
  lead = lead
    .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1')
    .replace(/@\w+\[[^\]]+\](\{[^}]*\})?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (lead.length > 260) {
    const cut = lead.slice(0, 260);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    lead = stop > 80 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return { img: img ? img.getAttribute('src') : null, lead };
}

// ── Pages 2 and 3: the spoken pages ─────────────────────────────────────────

function buildSpoken(wrapper, kind) {
  let scene = 0;
  for (const node of [...wrapper.children]) {
    if (node.tagName === 'H3') {
      const m = /^Scene\s+(\d+)/i.exec(node.textContent.trim());
      if (m) scene = Number(m[1]);
      node.classList.add('vel-beat-head');
    } else if (node.tagName === 'BLOCKQUOTE') {
      node.classList.add('vel-box');
    } else if (node.tagName === 'P') {
      node.classList.add('vel-stage');
    }
    if (kind === 'read-aloud' && scene) node.dataset.velScene = String(scene);
  }
}

// ── State ───────────────────────────────────────────────────────────────────

function applyState(wrapper, meta, state, opts = {}) {
  const secrets = state.secrets || {};
  const cur = typeof state.scene === 'number' ? state.scene : null;

  if (wrapper.classList.contains('vel-ts--sheet')) {
    for (const li of wrapper.querySelectorAll('.vel-tickable')) {
      const k = li.dataset.velKey;
      const done = k in secrets ? !!secrets[k] : !!li.dataset.velVaultDone;
      li.classList.toggle('is-done', done);
      const box = li.querySelector('.vel-tick');
      if (box) box.setAttribute('aria-pressed', done ? 'true' : 'false');
    }
    for (const li of wrapper.querySelectorAll('.vel-scene')) {
      const i = Number(li.dataset.velScene);
      li.classList.toggle('is-current', cur === i);
      li.classList.toggle('is-past', cur !== null && i < cur);
    }
    const spare = state.spare || {};
    for (const chip of wrapper.querySelectorAll('.vel-spare')) {
      const used = !!spare[chip.dataset.velKey];
      chip.classList.toggle('is-used', used);
      chip.setAttribute('aria-pressed', used ? 'true' : 'false');
    }
  }

  if (wrapper.classList.contains('vel-ts--read-aloud')) {
    const want = cur === null ? null : cur + 1;
    let first = null;
    for (const node of wrapper.querySelectorAll('[data-vel-scene]')) {
      const n = Number(node.dataset.velScene);
      const now = want !== null && n === want;
      node.classList.toggle('is-current', now);
      node.classList.toggle('is-past', want !== null && n < want);
      if (now && !first) first = node;
    }
    // Follow the tracker, but only when the DM moved it, never on a plain render.
    if (opts.scroll && first && wrapper.offsetParent !== null) {
      first.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
}
