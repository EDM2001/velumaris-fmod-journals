/**
 * The story pages in look A (P2, DM rulings 2026-09-25, vault
 * `Ops/Planning/Foundry Journals (Planned).md`): NPC pages, session journals, places
 * and factions, as the compendium module stores them.
 *
 * The pages are the vault notes converted by `pack-writers.js` in velumaris-utils.
 * Nothing here writes them: the look is built on the rendered page every time it
 * opens, so a restyle needs no Ship Compendium. What gets built:
 *
 *   - a header card in an ornate frame: an NPC's portrait, name, how to say it,
 *     pronouns, status and where, lead, voice line, statblock, associates; a
 *     session's arc, number, title, dates, cover, beats and cast; a place's or
 *     faction's picture, kind and lead
 *   - "What Players Know" boxed, DM-only sections in a marked panel
 *   - jump links on long pages, upkeep notes folded, date tags dimmed
 *   - a preview card on every journal link, and (through env) links that open in
 *     the window you are reading, with Back
 *   - in a GM Screen cell, an NPC page shrinks to its header card
 *
 * FRAMEWORK-FREE, like table-sheet.mjs: main.mjs hands it a Foundry `env`, and the
 * review mock hands it a fake one, so the mock runs this exact file.
 */

import { SPRITE, MOTIF_BY_ARC, ARC_COLOURS } from './ornaments.mjs';

/** @typedef {'npc'|'session'|'place'|'faction'|'other'} StoryKind */

/**
 * @typedef {object} StoryMeta
 * @property {StoryKind} kind
 * @property {string} type          the vault note's `type:` (npc, settlement, organization, arc…)
 * @property {string} name
 * @property {string} uuid          the entry (or, for a session, the page)
 * @property {{n:number,name:string}|null} arc   session pages only
 * @property {number|null} session
 * @property {string} pronouns      '' until the ship that carries them
 * @property {string} pronunciation ''  "    "
 * @property {{npcs?:string[],locations?:string[],factions?:string[]}|null} cast
 * @property {boolean} inCell       inside a GM Screen cell
 * @property {boolean} compact      show only the header card (an NPC in a GM Screen cell)
 */

const KIND_LABEL = {
  settlement: 'Settlement',
  location: 'Location',
  region: 'Region',
  organization: 'Faction',
  npc: 'NPC',
};

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** The hidden sprite every frame `<use>`s, once per document. */
export function ensureSprite(doc = document) {
  if (doc.getElementById('vel-ornament-sprite')) return;
  const holder = doc.createElement('div');
  holder.id = 'vel-ornament-sprite';
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  holder.innerHTML = SPRITE;
  doc.body.appendChild(holder);
}

/** An ornate frame layer: four mirrored corners and the two rules between them. */
function frame(motif) {
  const layer = el('div', 'vel-of');
  layer.setAttribute('aria-hidden', 'true');
  for (const c of ['tl', 'tr', 'bl', 'br']) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('class', `vel-of-c vel-of-${c}`);
    for (const id of ['vel-of-frame', `vel-of-${motif}`]) {
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#${id}`);
      svg.appendChild(use);
    }
    layer.appendChild(svg);
  }
  for (const e of ['t', 'b', 'l', 'r']) layer.appendChild(el('i', `vel-of-e vel-of-${e}`));
  return layer;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Build the look on one rendered page. Safe to call twice.
 * @param {HTMLElement} root   the page's `.journal-page-content`
 * @param {StoryMeta} meta
 * @param {object} env         see main.mjs storyEnv() for the shape
 */
export function enhanceStory(root, meta, env) {
  if (root.dataset.velStory) return;
  root.dataset.velStory = meta.kind;
  ensureSprite(root.ownerDocument);

  const theme = env.theme(root);
  root.classList.add('vel-sp', `vel-sp--${meta.kind}`, theme === 'light' ? 'vel-light' : 'vel-dark');
  if (meta.inCell) root.classList.add('vel-sp--cell');
  const arc = meta.kind === 'session' && meta.arc ? meta.arc.n : null;
  if (arc && ARC_COLOURS[arc]) root.style.setProperty('--vel-accent', ARC_COLOURS[arc][theme === 'light' ? 'light' : 'dark']);

  prepUpkeep(root);
  prepSecrets(root);
  hideEmptySections(root);

  let head = null;
  if (meta.kind === 'npc') head = npcHeader(root, meta, env);
  else if (meta.kind === 'session') head = sessionHeader(root, meta, env);
  else if (meta.kind === 'place' || meta.kind === 'faction') head = placeHeader(root, meta);

  if (meta.kind !== 'session') boxKnown(root);

  const back = !meta.inCell && env.back ? env.back(root) : null;
  if (back) {
    const b = el('button', 'vel-back', `← ${back.label}`);
    b.type = 'button';
    b.title = `Back to ${back.label}`;
    b.addEventListener('click', () => back.go());
    root.prepend(b);
  }

  if (meta.compact && head) {
    root.classList.add('vel-sp--compact');
    const open = el('button', 'vel-open-full', 'Open the full page');
    open.type = 'button';
    open.addEventListener('click', () => env.openUuid(meta.uuid));
    (head.querySelector('.vel-head-actions') || head.querySelector('.vel-head-body') || head).appendChild(open);
  } else if (meta.kind !== 'session') {
    jumpLinks(root, 'H2', head);
  }

  prepLinks(root, meta, env);
}

// ── Upkeep notes (card 8: fold the dated notes, dim the date tags) ─────────

const ISO_DATE = /\b20\d\d-\d\d-\d\d\b/;
const DATE_TAG = /\([^()]*\b20\d\d-\d\d-\d\d\b[^()]*\)/g;

/** A paragraph that is nothing but one italic note carrying a date. */
function isUpkeepPara(p) {
  if (p.tagName !== 'P' || p.closest('.vel-head')) return false;
  const kids = [...p.childNodes].filter((n) => !(n.nodeType === 3 && !n.textContent.trim()));
  if (kids.length !== 1 || kids[0].tagName !== 'EM') return false;
  const text = p.textContent.trim();
  // A dated tag in parentheses on its own is a tag, not a note.
  return ISO_DATE.test(text) && !/^\(.*\)$/.test(text);
}

export function prepUpkeep(root) {
  for (const p of [...root.querySelectorAll('p')]) {
    if (!isUpkeepPara(p)) continue;
    const date = (p.textContent.match(ISO_DATE) || [''])[0];
    const box = el('details', 'vel-upkeep');
    const sum = el('summary', null, 'Upkeep note');
    if (date) sum.appendChild(el('span', 'vel-upkeep-date', date));
    box.appendChild(sum);
    p.replaceWith(box);
    box.appendChild(p);
  }
  // An italic "(amended 2026-09-21 — see …)" can hold a link, so match the whole <em>.
  for (const em of root.querySelectorAll('em')) {
    const t = em.textContent.trim();
    if (/^\(.*\)$/.test(t) && ISO_DATE.test(t)) em.classList.add('vel-datetag');
  }
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement && n.parentElement.closest('.vel-datetag, .vel-upkeep, script, style')) continue;
    DATE_TAG.lastIndex = 0;
    if (DATE_TAG.test(n.textContent)) hits.push(n);
  }
  for (const n of hits) {
    const frag = root.ownerDocument.createDocumentFragment();
    let last = 0;
    const text = n.textContent;
    DATE_TAG.lastIndex = 0;
    for (let m = DATE_TAG.exec(text); m; m = DATE_TAG.exec(text)) {
      if (m.index > last) frag.appendChild(root.ownerDocument.createTextNode(text.slice(last, m.index)));
      frag.appendChild(el('span', 'vel-datetag', m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(root.ownerDocument.createTextNode(text.slice(last)));
    n.replaceWith(frag);
  }
}

/** A heading with nothing under it before the next (Gardhu's Roleplaying, today). */
function hideEmptySections(root) {
  const kids = [...root.children];
  kids.forEach((n, i) => {
    if (n.tagName !== 'H2') return;
    const next = kids[i + 1];
    if (!next || next.tagName === 'H2' || next.tagName === 'H1') n.hidden = true;
  });
}

// ── DM-only sections (card 7: open, in a marked panel) ─────────────────────

function prepSecrets(root) {
  for (const s of root.querySelectorAll('section.secret')) {
    s.classList.add('vel-secret');
    if (!s.querySelector(':scope > .vel-secret-tag')) s.prepend(el('div', 'vel-secret-tag', 'DM only'));
  }
}

// ── "What Players Know" (card 4) ───────────────────────────────────────────

function boxKnown(root) {
  const h = [...root.children].find((n) => n.tagName === 'H2' && /^what players know$/i.test(n.textContent.trim()));
  if (!h) return;
  const box = el('div', 'vel-known');
  box.appendChild(el('div', 'vel-known-tag', 'What players know'));
  h.before(box);
  h.classList.add('vel-known-h');
  box.appendChild(h);
  while (box.nextSibling && !/^(H1|H2|SECTION)$/.test(box.nextSibling.tagName || '')) box.appendChild(box.nextSibling);
}

// ── Headers ─────────────────────────────────────────────────────────────────

function headShell(kind, motif) {
  const head = el('div', `vel-head vel-head--${kind}`);
  head.appendChild(frame(motif));
  return head;
}

function tableRows(table) {
  const rows = {};
  if (!table) return rows;
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 2) continue;
    rows[cells[0].textContent.trim().toLowerCase()] = cells[1];
  }
  return rows;
}

/** Copies of the links in a table cell, one per target. */
function linksIn(cell, seen = new Set()) {
  const out = [];
  if (!cell) return out;
  for (const a of cell.querySelectorAll('a.content-link')) {
    const key = a.dataset.uuid || a.textContent;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a.cloneNode(true));
  }
  return out;
}

function firstBefore(root, selector, stopTag = 'H2') {
  for (const n of root.children) {
    if (n.tagName === stopTag) return null;
    if (n.matches(selector)) return n;
  }
  return null;
}

function npcHeader(root, meta, env) {
  const h1 = firstBefore(root, 'h1');
  const statP = [...root.children].find((n) => n.tagName === 'P' && n.firstElementChild && n.firstElementChild.tagName === 'STRONG' && /^statblock/i.test(n.firstElementChild.textContent.trim()));
  const infobox = [...root.children].find((n) => n.tagName === 'BLOCKQUOTE' && n.querySelector('img, table'));
  const lead = [...root.children].find((n) => n.tagName === 'BLOCKQUOTE' && n !== infobox && !n.querySelector('img, table'));
  if (!h1 && !infobox) return null;

  // Many notes carry the respelling in the body, as `*(GARD-hoo)*` under the lead.
  // The header shows it; the ship's `pronunciation:` wins once it arrives.
  const firstH2 = [...root.children].findIndex((n) => n.tagName === 'H2');
  const respellP = [...root.children].find(
    (n, i) =>
      (firstH2 < 0 || i < firstH2) &&
      n.tagName === 'P' &&
      n.children.length === 1 &&
      n.firstElementChild.tagName === 'EM' &&
      RESPELL.test(n.textContent.trim())
  );
  const respelling = respellP ? RESPELL.exec(respellP.textContent.trim())[1] : '';

  const rows = tableRows(infobox && infobox.querySelector('table'));
  const img = infobox ? infobox.querySelector('img') : null;
  const head = headShell('npc', 'gem');

  if (img) {
    const pic = el('img', 'vel-head-img');
    pic.src = img.getAttribute('src');
    pic.alt = '';
    head.appendChild(pic);
  }
  const body = el('div', 'vel-head-body');
  const kicker = rows.category ? `NPC · ${rows.category.textContent.trim()}` : 'NPC';
  body.appendChild(el('div', 'vel-head-kicker', kicker));

  const name = el('div', 'vel-head-name', (h1 ? h1.textContent : meta.name).trim());
  const said = meta.pronunciation || respelling;
  if (said) {
    const unsure = /\[TODO/i.test(said);
    const say = said.replace(/\s*\[TODO[^\]]*\]\s*/i, '').trim();
    if (say) {
      const s = el('span', 'vel-say', unsure ? `${say}?` : say);
      s.title = unsure ? 'How to say it (not yet confirmed)' : 'How to say it';
      name.appendChild(s);
    }
  }
  body.appendChild(name);

  const line = el('div', 'vel-head-meta');
  if (meta.pronouns) line.appendChild(el('span', 'vel-pron', meta.pronouns.toLowerCase()));
  const status = rows.status ? rows.status.textContent.trim() : '';
  if (status) {
    const st = el('span', `vel-status${/dead|deceased|destroyed/i.test(status) ? ' is-dead' : ''}`, status.charAt(0).toUpperCase() + status.slice(1));
    line.appendChild(st);
  }
  const seen = new Set();
  const where = [...linksIn(rows.region, seen), ...linksIn(rows.locations, seen), ...linksIn(rows.factions, seen)];
  for (const a of where) {
    line.appendChild(el('span', 'vel-sep', '·'));
    line.appendChild(a);
  }
  if (line.childNodes.length) body.appendChild(line);

  if (lead) {
    const p = el('div', 'vel-head-lead');
    for (const n of lead.querySelectorAll(':scope > p')) {
      const c = n.cloneNode(true);
      p.appendChild(c);
    }
    body.appendChild(p);
  }

  const voice = voiceLine(root);
  if (voice) {
    const v = el('div', 'vel-head-voice');
    v.appendChild(el('span', 'vel-lbl', 'Voice'));
    v.appendChild(el('span', null, voice));
    body.appendChild(v);
  }

  const actions = el('div', 'vel-head-actions');
  const statLink = statP ? statP.querySelector('a.content-link') : null;
  if (statLink) {
    const b = statLink.cloneNode(true);
    b.classList.add('vel-btn');
    b.textContent = 'Statblock';
    actions.appendChild(b);
  }
  const assoc = linksIn(rows.associates);
  if (assoc.length) {
    const box = el('span', 'vel-assoc');
    box.appendChild(el('span', 'vel-lbl', 'With'));
    for (const a of assoc) {
      a.classList.add('vel-chip');
      box.appendChild(a);
    }
    actions.appendChild(box);
  }
  if (actions.childNodes.length) body.appendChild(actions);
  head.appendChild(body);

  for (const n of [h1, statP, infobox, lead, respellP]) if (n) n.hidden = true;
  root.prepend(head);
  return head;
}

/** `(GARD-hoo)`, `(MOO-VAHR-uh)`, `(TESS)`: a respelling, its stress in capitals. */
const RESPELL = /^\(([A-Za-z'’ -]*[A-Z]{2}[A-Za-z'’ -]*)\)$/;

/** The first bold sentence of Roleplaying: "Her voice is short and flat…". */
function voiceLine(root) {
  const h = [...root.children].find((n) => n.tagName === 'H2' && /^roleplaying\b/i.test(n.textContent.trim()));
  if (!h) return '';
  const p = h.nextElementSibling;
  if (!p || p.tagName !== 'P') return '';
  const first = p.firstChild && p.firstChild.nodeType === 3 && !p.firstChild.textContent.trim() ? p.firstChild.nextSibling : p.firstChild;
  if (!first || first.nodeType !== 1 || first.tagName !== 'STRONG') return '';
  return first.textContent.trim();
}

const REAL_DATE = /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/;

function sessionHeader(root, meta, env) {
  const kids = [...root.children];
  const h1 = kids.find((n) => n.tagName === 'H1');
  if (!h1) return null;
  const i = kids.indexOf(h1);
  const before = kids.slice(0, i);
  const fcP = before.find((n) => n.tagName === 'P' && n.children.length === 1 && n.firstElementChild.tagName === 'EM' && n.textContent.trim() === n.firstElementChild.textContent.trim());
  const after = kids.slice(i + 1, i + 5);
  const realP = after.find((n) => n.tagName === 'P' && REAL_DATE.test(n.textContent.trim()));
  const coverP = after.find((n) => n.tagName === 'P' && n.querySelector('img') && !n.textContent.trim());
  const cover = coverP ? coverP.querySelector('img') : null;

  const motif = (meta.arc && MOTIF_BY_ARC[meta.arc.n]) || 'gem';
  const head = headShell('session', motif);
  const body = el('div', 'vel-head-body');
  if (meta.arc) body.appendChild(el('div', 'vel-badge', `Arc ${meta.arc.n} · ${meta.arc.name}`));
  if (meta.session) body.appendChild(el('div', 'vel-head-num', `Session ${meta.session}`));
  body.appendChild(el('div', 'vel-head-name', h1.textContent.trim()));
  const dates = el('div', 'vel-head-dates');
  if (fcP) dates.appendChild(el('span', 'vel-fc', fcP.textContent.trim()));
  if (realP) dates.appendChild(el('span', 'vel-real', `Played ${realP.textContent.trim()}`));
  if (dates.childNodes.length) body.appendChild(dates);
  head.appendChild(body);
  if (cover) {
    const pic = el('img', 'vel-head-cover');
    pic.src = cover.getAttribute('src');
    pic.alt = '';
    head.appendChild(pic);
  }
  for (const n of [fcP, h1, realP, coverP]) if (n) n.hidden = true;
  root.prepend(head);

  // The beats, in order, as links that jump to each one.
  const beats = [...root.children].filter((n) => n.tagName === 'H3');
  if (beats.length > 1) {
    const nav = el('nav', 'vel-jump vel-beats');
    nav.setAttribute('aria-label', 'Beats');
    beats.forEach((h, k) => {
      const b = el('button', 'vel-jump-link');
      b.type = 'button';
      b.appendChild(el('span', 'vel-jump-n', String(k + 1)));
      b.appendChild(document.createTextNode(h.textContent.trim()));
      b.addEventListener('click', () => h.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      nav.appendChild(b);
    });
    head.after(nav);
  }

  castChips(root, meta, env, head);
  return head;
}

/**
 * Who and where the session is about: the vault note's own lists once the ship
 * carries them (`meta.cast`), until then every NPC, place and faction the prose links.
 */
function castChips(root, meta, env, head) {
  const box = el('div', 'vel-cast');
  const groups = { npc: el('div', 'vel-cast-row'), place: el('div', 'vel-cast-row'), faction: el('div', 'vel-cast-row') };
  const label = { npc: 'People', place: 'Places', faction: 'Factions' };
  for (const k of Object.keys(groups)) {
    groups[k].appendChild(el('span', 'vel-lbl', label[k]));
    groups[k].hidden = true;
    box.appendChild(groups[k]);
  }
  box.hidden = true;
  const nav = head.nextElementSibling && head.nextElementSibling.classList.contains('vel-beats') ? head.nextElementSibling : head;
  nav.after(box);

  const first = new Map();
  for (const a of root.querySelectorAll('a.content-link[data-uuid]')) {
    if (a.closest('.vel-head, .vel-cast')) continue;
    if (!first.has(a.dataset.uuid)) first.set(a.dataset.uuid, a);
  }
  const wanted = meta.cast
    ? {
        npc: new Set((meta.cast.npcs || []).map((s) => s.toLowerCase())),
        place: new Set((meta.cast.locations || []).map((s) => s.toLowerCase())),
        faction: new Set((meta.cast.factions || []).map((s) => s.toLowerCase())),
      }
    : null;

  Promise.all(
    [...first.entries()].map(async ([uuid, a]) => {
      let info = null;
      try {
        info = await env.kindOf(uuid);
      } catch {
        info = null;
      }
      return { uuid, a, info };
    })
  ).then((list) => {
    const placed = { npc: new Set(), place: new Set(), faction: new Set() };
    for (const { a, info } of list) {
      if (!info || !groups[info.kind]) continue;
      const nm = (info.name || a.textContent).trim();
      if (wanted && !wanted[info.kind].has(nm.toLowerCase())) continue;
      const chip = a.cloneNode(true);
      chip.classList.add('vel-chip');
      chip.textContent = nm;
      // The source link was wired before this (async) copy was made; wire the copy afresh.
      delete chip.dataset.velLink;
      groups[info.kind].appendChild(chip);
      groups[info.kind].hidden = false;
      placed[info.kind].add(nm.toLowerCase());
    }
    // Names the note lists but the prose never links still get a (plain) chip.
    if (meta.cast) {
      const src = { npc: meta.cast.npcs, place: meta.cast.locations, faction: meta.cast.factions };
      for (const k of Object.keys(src)) {
        for (const nm of src[k] || []) {
          if (placed[k].has(nm.toLowerCase())) continue;
          groups[k].appendChild(el('span', 'vel-chip is-plain', nm));
          groups[k].hidden = false;
        }
      }
    }
    box.hidden = !Object.values(groups).some((g) => !g.hidden);
    if (!box.hidden) prepLinks(box, meta, env);
  });
}

function placeHeader(root, meta) {
  const h1 = firstBefore(root, 'h1');
  const imgP = firstBefore(root, 'p:has(> img)');
  const infobox = firstBefore(root, 'blockquote:has(img), blockquote:has(table)');
  const lead = [...root.children].find((n, i, all) => {
    if (n.tagName !== 'BLOCKQUOTE' || n === infobox || n.querySelector('img, table')) return false;
    const stop = all.findIndex((x) => x.tagName === 'H2');
    return stop < 0 || i < stop;
  });
  // A faction note sometimes opens on one bold line instead of a quote.
  const boldLead = !lead ? firstBefore(root, 'p:has(> strong:only-child)') : null;
  if (!h1) return null;

  const head = headShell(meta.kind, 'gem');
  const img = (imgP && imgP.querySelector('img')) || (infobox && infobox.querySelector('img'));
  if (img) {
    const pic = el('img', 'vel-head-img vel-head-img--place');
    pic.src = img.getAttribute('src');
    pic.alt = '';
    head.appendChild(pic);
  }
  const body = el('div', 'vel-head-body');
  body.appendChild(el('div', 'vel-head-kicker', KIND_LABEL[meta.type] || (meta.kind === 'faction' ? 'Faction' : 'Place')));
  body.appendChild(el('div', 'vel-head-name', h1.textContent.trim()));
  const rows = tableRows(infobox && infobox.querySelector('table'));
  const facts = Object.entries(rows).filter(([, td]) => td.textContent.trim());
  if (facts.length) {
    const line = el('div', 'vel-head-meta');
    facts.slice(0, 4).forEach(([k, td], i) => {
      if (i) line.appendChild(el('span', 'vel-sep', '·'));
      const f = el('span', 'vel-fact');
      f.appendChild(el('span', 'vel-lbl', k));
      for (const n of td.childNodes) f.appendChild(n.cloneNode(true));
      line.appendChild(f);
    });
    body.appendChild(line);
  }
  const leadSrc = lead || boldLead;
  if (leadSrc) {
    const p = el('div', 'vel-head-lead');
    const paras = leadSrc.tagName === 'BLOCKQUOTE' ? leadSrc.querySelectorAll(':scope > p') : [leadSrc];
    for (const n of paras) p.appendChild(n.cloneNode(true));
    body.appendChild(p);
  }
  head.appendChild(body);
  for (const n of [h1, imgP, infobox, leadSrc]) if (n) n.hidden = true;
  root.prepend(head);
  return head;
}

// ── Jump links (card 6) ─────────────────────────────────────────────────────

function jumpLinks(root, tag, head) {
  const hs = [...root.querySelectorAll(tag.toLowerCase())].filter((h) => !h.closest('.vel-head') && !h.hidden);
  if (hs.length < 4) return;
  const nav = el('nav', 'vel-jump');
  nav.setAttribute('aria-label', 'Sections');
  for (const h of hs) {
    const b = el('button', 'vel-jump-link');
    b.type = 'button';
    if (h.closest('section.secret')) b.classList.add('is-secret');
    if (h.classList.contains('vel-known-h')) b.classList.add('is-known');
    b.textContent = h.textContent.trim().replace(/\s*\(.*\)\s*$/, '');
    // The boxed "What Players Know" hides its own heading; jump to the box.
    const target = h.classList.contains('vel-known-h') ? h.parentElement : h;
    b.addEventListener('click', () => target.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    nav.appendChild(b);
  }
  if (head) head.after(nav);
  else root.prepend(nav);
}

// ── Links: preview cards and same-window navigation (card 6) ───────────────

let card = null;
let cardTimer = null;

function prepLinks(scope, meta, env) {
  const root = scope.closest('.vel-sp') || scope;
  for (const a of scope.querySelectorAll('a.content-link[data-uuid]')) {
    if (a.dataset.velLink) continue;
    a.dataset.velLink = '1';
    const type = a.dataset.type || '';
    if (!/^(JournalEntry|JournalEntryPage)$/.test(type)) continue;
    // Foundry's own tooltip only says "Journal Entry"; the card replaces it.
    if (a.dataset.tooltip) {
      a.dataset.velTooltip = a.dataset.tooltip;
      delete a.dataset.tooltip;
    }
    if (env.preview) {
      a.addEventListener('mouseenter', () => {
        clearTimeout(cardTimer);
        cardTimer = setTimeout(() => showCard(a, root, env), 220);
      });
      a.addEventListener('mouseleave', () => {
        clearTimeout(cardTimer);
        cardTimer = setTimeout(hideCard, 120);
      });
    }
    if (env.openInPlace && !meta.inCell) {
      a.addEventListener(
        'click',
        (ev) => {
          if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.button !== 0) return;
          hideCard();
          if (env.openInPlace(a.dataset.uuid, root)) {
            ev.preventDefault();
            ev.stopImmediatePropagation();
          }
        },
        true
      );
    }
  }
}

async function showCard(anchor, root, env) {
  hideCard();
  const node = el('div', `vel-card ${root.classList.contains('vel-light') ? 'vel-light' : 'vel-dark'}`);
  const body = el('div', 'vel-card-body');
  body.appendChild(el('div', 'vel-card-name', anchor.textContent.trim()));
  const lead = el('div', 'vel-card-lead dim', '…');
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
    info = await env.preview(anchor.dataset.uuid);
  } catch {
    info = null;
  }
  if (card !== node) return;
  if (!info) {
    hideCard();
    return;
  }
  if (info.img) {
    const img = el('img', 'vel-card-img');
    img.src = info.img;
    img.alt = '';
    node.prepend(img);
  }
  body.firstChild.textContent = info.name || anchor.textContent.trim();
  if (info.kicker) body.insertBefore(el('div', 'vel-card-say', info.kicker), lead);
  lead.textContent = info.lead || '';
  lead.classList.remove('dim');
  body.appendChild(el('div', 'vel-card-hint', 'Click to open here · Shift-click for a new window'));
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

/**
 * What a preview card shows for a journal page's stored HTML: its first picture and
 * its lead (the first quote that is not an infobox, else the first paragraph of
 * "What Players Know", else the first paragraph with some length to it).
 */
export function previewFromHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const img = doc.querySelector('img');
  const clean = (s) =>
    String(s || '')
      .replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1')
      .replace(/@\w+\[[^\]]+\](\{[^}]*\})?/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  let lead = '';
  const quote = [...doc.querySelectorAll('body > blockquote')].find((b) => !b.querySelector('img, table'));
  if (quote) lead = clean(quote.textContent);
  if (!lead) {
    const h = [...doc.querySelectorAll('h2')].find((x) => /what players know/i.test(x.textContent));
    const p = h && h.nextElementSibling;
    if (p && p.tagName === 'P') lead = clean(p.textContent);
  }
  if (!lead) {
    const p = [...doc.querySelectorAll('p')].find((x) => !x.querySelector('img') && clean(x.textContent).length > 60 && !/^statblock/i.test(clean(x.textContent)));
    if (p) lead = clean(p.textContent);
  }
  if (lead.length > 240) {
    const cut = lead.slice(0, 240);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    lead = stop > 80 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
  }
  return { img: img ? img.getAttribute('src') : null, lead };
}

const TYPE_LABEL = {
  npc: 'NPC',
  pc: 'PC',
  settlement: 'Settlement',
  location: 'Location',
  region: 'Region',
  organization: 'Faction',
  lore: 'Lore',
  moc: 'Overview',
  quest: 'Quest',
  encounter: 'Encounter',
  reference: 'Reference',
};

/** vault `type:` → the word a preview card shows for it. */
export function typeLabel(type) {
  return TYPE_LABEL[type] || (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Journal');
}

/** vault `type:` → the kind of story page it is. */
export function kindOfType(type, isSessionPage) {
  if (isSessionPage) return 'session';
  if (type === 'npc') return 'npc';
  if (type === 'settlement' || type === 'location' || type === 'region') return 'place';
  if (type === 'organization') return 'faction';
  return 'other';
}
