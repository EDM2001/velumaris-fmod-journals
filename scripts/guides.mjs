/**
 * The GM guides (DM rulings 2026-09-26, vault `Ops/Tasks/encounter-and-eden-arc-guides.md`):
 * a run guide per fight and an arc guide per arc, both pushed by `foundry:run-guides`
 * (velumaris-utils) as GM-only pages wrapped in
 * `<div data-velumaris="run-guide|arc-guide" data-vel-meta="{…}">`.
 *
 * A run guide gets:
 *   - a toolbar: the fight's scene, the next scene, the monster's sheet, the full note
 *   - the monster's own counters (card 6): Legendary Resistance, legendary actions and
 *     every limited use, read off its sheet and spent ON the sheet, so the guide and the
 *     Stream Deck always show the same numbers
 *   - tickable triggers, with one tap to clear them for the next fight
 *   - turn templates as cards, and the spoken lines boxed like the Table Sheet's
 *
 * An arc guide gets:
 *   - the status strip, with Attention you can tap up or down (card 9)
 *   - each beat's status as a pill, and a "played tonight" tap per beat
 *   - rings already walked folded shut
 *   - the current Attention row lit
 * Taps live on the entry's flags. `foundry:run-guides -- --taps` reads them back at the
 * propagate step, where they are checked against the journal; nothing is written into
 * the vault from here.
 *
 * FRAMEWORK-FREE like table-sheet.mjs: main.mjs hands it a Foundry `env`, the review mock
 * a fake one, so the DM reviews this exact code.
 */

import { readMeta, textKey } from './table-sheet.mjs';

export const GUIDE_SELECTOR = '[data-velumaris="run-guide"], [data-velumaris="arc-guide"]';

const BEAT_RE = /^([PSO]\d+[a-d]?)\s*·\s*(.+)$/;
const STATUS_WORDS = ['Played', 'Next', 'Ready', 'Needs building', 'Open', 'Skipped', 'Cut'];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function setTheme(node, theme) {
  node.classList.toggle('vel-light', theme === 'light');
  node.classList.toggle('vel-dark', theme !== 'light');
}

function button(cls, label, onClick, title) {
  const b = el('button', cls, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick(ev);
  });
  return b;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function enhanceGuide(wrapper, env) {
  const meta = readMeta(wrapper);
  if (!wrapper.dataset.velDone) {
    wrapper.dataset.velDone = '1';
    const kind = meta.kind === 'arc-guide' ? 'ag' : 'rg';
    wrapper.classList.add('vel-ts', 'vel-guide', `vel-${kind}`);
    setTheme(wrapper, env.theme(wrapper));
    sectionize(wrapper);
    if (kind === 'rg') buildRunGuide(wrapper, meta, env);
    else buildArcGuide(wrapper, meta, env);
  }
  applyGuideState(wrapper, meta, env.getState(meta.entryId) || {}, env);
}

/** Re-apply state to every open guide of one entry. */
export function refreshGuides(entryId, env) {
  const state = env.getState(entryId) || {};
  for (const w of document.querySelectorAll(GUIDE_SELECTOR)) {
    const meta = readMeta(w);
    if (meta.entryId !== entryId || !w.dataset.velDone) continue;
    applyGuideState(w, meta, state, env);
  }
}

/** Redraw every open run guide's counters (an actor or one of its items changed). */
export function refreshCounters(env) {
  for (const w of document.querySelectorAll('.vel-rg .vel-counters')) drawCounters(w, env);
}

/**
 * One `section.vel-gsec--<slug>` per `## ` heading, so each part can be styled on its
 * own, all inside `div.vel-gbody`. The columns go on that inner div, not the wrapper:
 * the wrapper is the size container, and a container query cannot size the container.
 */
function sectionize(wrapper) {
  let current = el('section', 'vel-gsec vel-gsec--top');
  const sections = [current];
  for (const node of [...wrapper.children]) {
    if (node.tagName === 'H2') {
      current = el('section', `vel-gsec vel-gsec--${slug(node.textContent)}`);
      sections.push(current);
    }
    current.appendChild(node);
  }
  const body = el('div', 'vel-gbody');
  for (const s of sections) if (s.childNodes.length) body.appendChild(s);
  wrapper.appendChild(body);
}

// ── Run guides ──────────────────────────────────────────────────────────────

function buildRunGuide(wrapper, meta, env) {
  const bar = el('div', 'vel-gbar');
  if (meta.scene) {
    const info = env.sceneInfo(meta.scene);
    if (info.exists) bar.appendChild(button('vel-gbtn', 'Scene', () => env.viewScene(meta.scene), `View ${meta.scene} (only you see it)`));
  }
  if (meta.nextScene) {
    const info = env.sceneInfo(meta.nextScene);
    if (info.exists) bar.appendChild(button('vel-gbtn', 'Next scene', () => env.viewScene(meta.nextScene), `View ${meta.nextScene} (only you see it)`));
  }
  for (const a of meta.actors || []) {
    bar.appendChild(button('vel-gbtn', `${a.name}’s sheet`, () => env.openUuid(a.uuid)));
  }
  if (meta.record && meta.record.uuid) {
    bar.appendChild(button('vel-gbtn vel-gbtn--quiet', 'Full note', () => env.openUuid(meta.record.uuid), meta.record.name));
  }
  bar.appendChild(
    button('vel-gbtn vel-gbtn--quiet vel-gbtn--end', 'Clear ticks', () => env.setState(meta.entryId, { triggers: null }), 'Untick every trigger, for the next time this fight runs')
  );
  wrapper.prepend(bar);

  // The counters sit at the top of the glance, under its heading.
  const glance = wrapper.querySelector('.vel-gsec--the-monster-at-a-glance');
  if (glance && (meta.actors || []).length) {
    const box = el('div', 'vel-counters');
    box.dataset.velActors = JSON.stringify(meta.actors);
    const h = glance.querySelector('h2');
    if (h) h.after(box);
    else glance.prepend(box);
    drawCounters(box, env);
  }

  // Turn templates: each ### under "How it fights" becomes a card.
  const fights = wrapper.querySelector('.vel-gsec--how-it-fights');
  if (fights) {
    let card = null;
    for (const node of [...fights.children]) {
      if (node.tagName === 'H3') {
        card = el('div', 'vel-turn');
        node.before(card);
        card.appendChild(node);
      } else if (card && node.tagName !== 'H2') {
        card.appendChild(node);
      }
    }
    const cards = fights.querySelectorAll('.vel-turn');
    if (cards.length) {
      const grid = el('div', 'vel-turns');
      cards[0].before(grid);
      for (const c of cards) grid.appendChild(c);
    }
  }

  // Triggers become ticks.
  const trig = wrapper.querySelector('.vel-gsec--triggers-and-phases ul');
  if (trig) {
    for (const li of trig.children) {
      li.dataset.velKey = textKey(li.textContent);
      const box = el('button', 'vel-tick');
      box.type = 'button';
      box.setAttribute('aria-label', 'Happened');
      li.prepend(box);
      li.classList.add('vel-tickable');
      li.addEventListener('click', (ev) => {
        if (ev.target.closest('a')) return;
        env.setState(meta.entryId, { triggers: { [li.dataset.velKey]: !li.classList.contains('is-done') } });
      });
    }
  }

  // Spoken lines: stage directions small, the words boxed.
  const spoken = wrapper.querySelector('.vel-gsec--spoken-lines');
  if (spoken) {
    for (const node of spoken.children) {
      if (node.tagName === 'BLOCKQUOTE') node.classList.add('vel-box');
      else if (node.tagName === 'P') node.classList.add('vel-stage');
    }
  }
}

function pips(value, max, onSet, label) {
  const wrap = el('span', 'vel-pips');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', label);
  for (let i = 0; i < max; i += 1) {
    const on = i < value;
    const p = button(`vel-pip${on ? ' is-on' : ''}`, '', () => onSet(on ? i : i + 1), on ? `Spend (leaves ${i})` : `Restore to ${i + 1}`);
    p.setAttribute('aria-pressed', on ? 'true' : 'false');
    wrap.appendChild(p);
  }
  return wrap;
}

function drawCounters(box, env) {
  let actors = [];
  try {
    actors = JSON.parse(box.dataset.velActors || '[]');
  } catch {
    actors = [];
  }
  box.replaceChildren();
  for (const a of actors) {
    const c = env.actorCounters(a.uuid);
    if (!c) continue;
    const row = el('div', 'vel-crow');
    if (actors.length > 1) row.appendChild(el('span', 'vel-cname', c.name));
    const add = (label, node) => {
      const cell = el('span', 'vel-ccell');
      cell.appendChild(el('span', 'vel-clabel', label));
      cell.appendChild(node);
      row.appendChild(cell);
    };
    if (c.legres && c.legres.max) {
      add('Leg. Resistance', pips(c.legres.value, c.legres.max, (v) => env.setCounter(a.uuid, 'legres', v), 'Legendary Resistance left'));
    }
    if (c.legact && c.legact.max) {
      add('Leg. actions', pips(c.legact.value, c.legact.max, (v) => env.setCounter(a.uuid, 'legact', v), 'Legendary actions left'));
    }
    for (const u of c.uses || []) {
      if (u.recharge) {
        const ready = u.value > 0;
        const chip = button(`vel-recharge${ready ? ' is-ready' : ''}`, `${u.name} · ${ready ? 'ready' : `recharge ${u.recharge}`}`, () =>
          env.setCounter(a.uuid, u.key, ready ? 0 : u.max)
        );
        chip.setAttribute('aria-pressed', ready ? 'true' : 'false');
        chip.title = ready ? 'Tap when it is used' : 'Tap when it recharges';
        row.appendChild(chip);
      } else {
        add(u.name, pips(u.value, u.max, (v) => env.setCounter(a.uuid, u.key, v), `${u.name} left`));
      }
    }
    box.appendChild(row);
  }
  box.hidden = !box.childNodes.length;
}

// ── Arc guides ──────────────────────────────────────────────────────────────

function statusOf(text) {
  const m = /^\s*·\s*([A-Za-z ]+?)\s*(?:·|$)/.exec(text);
  if (!m) return null;
  const word = m[1].trim();
  return STATUS_WORDS.find((w) => w.toLowerCase() === word.toLowerCase()) || null;
}

function buildArcGuide(wrapper, meta, env) {
  // The strip: "Where the party stands" as chips, Attention with − and +.
  const where = wrapper.querySelector('.vel-gsec--where-the-party-stands ul');
  if (where) {
    where.classList.add('vel-strip');
    for (const li of where.children) {
      const b = li.querySelector('strong');
      const key = b ? slug(b.textContent.replace(/:$/, '')) : '';
      li.classList.add('vel-schip', `vel-schip--${key}`);
      if (key === 'attention') {
        li.dataset.velAttention = '1';
        const val = el('span', 'vel-att-live');
        const minus = button('vel-att-btn', '−', () => bumpAttention(meta, env, -1), 'Attention down one');
        const plus = button('vel-att-btn', '+', () => bumpAttention(meta, env, 1), 'Attention up one');
        const ctl = el('span', 'vel-att');
        ctl.append(minus, val, plus);
        li.appendChild(ctl);
      }
    }
  }

  // The route: pills, a played tap per beat, walked rings folded.
  const route = wrapper.querySelector('.vel-gsec--the-route-inward');
  if (route) {
    for (const h3 of [...route.querySelectorAll('h3')]) {
      const list = h3.nextElementSibling && h3.nextElementSibling.tagName === 'UL' ? h3.nextElementSibling : null;
      const det = el('details', 'vel-ring');
      det.open = true;
      const sum = el('summary', 'vel-ring-head');
      while (h3.firstChild) sum.appendChild(h3.firstChild);
      h3.replaceWith(det);
      det.appendChild(sum);
      if (!list) continue;
      det.appendChild(list);
      let beats = 0;
      let walked = 0;
      for (const li of list.querySelectorAll(':scope > li')) {
        const b = li.firstElementChild && li.firstElementChild.tagName === 'STRONG' ? li.firstElementChild : null;
        const m = b ? BEAT_RE.exec(b.textContent.trim()) : null;
        if (!m) continue;
        const code = m[1];
        li.dataset.velBeat = code;
        li.classList.add('vel-beat', `vel-beat--${code[0].toLowerCase()}`);
        const after = b.nextSibling && b.nextSibling.nodeType === 3 ? b.nextSibling : null;
        const status = after ? statusOf(after.textContent) : null;
        if (status) {
          li.dataset.velStatus = slug(status);
          // Lift the status word out of the text into a pill beside the name.
          after.textContent = after.textContent.replace(/^\s*·\s*[A-Za-z ]+?\s*(·|$)/, ' $1');
          b.after(el('span', `vel-pill vel-pill--${slug(status)}`, status));
          beats += 1;
          if (/played|skipped|cut/i.test(status)) walked += 1;
        }
        const tap = button('vel-played', 'played', () => {
          const cur = (env.getState(meta.entryId) || {}).beats || {};
          env.setState(meta.entryId, { beats: { [code]: !cur[code] } });
        }, 'Mark played tonight; it goes into the vault after the session');
        li.appendChild(tap);
      }
      if (beats && walked === beats) det.open = false;
    }
  }

  // The Attention table: which row is now.
  const att = wrapper.querySelector('.vel-gsec--attention table');
  if (att) att.classList.add('vel-att-table');
}

function currentAttention(meta, state) {
  if (typeof state.attention === 'number') return state.attention;
  return typeof meta.attention === 'number' ? meta.attention : 0;
}

function bumpAttention(meta, env, delta) {
  const state = env.getState(meta.entryId) || {};
  const from = currentAttention(meta, state);
  const to = Math.max(0, Math.min(6, from + delta));
  if (to === from) return;
  const log = Array.isArray(state.attentionLog) ? state.attentionLog.slice() : [];
  log.push({ from, to, at: new Date().toISOString() });
  env.setState(meta.entryId, { attention: to, attentionLog: log });
}

// ── State ───────────────────────────────────────────────────────────────────

function applyGuideState(wrapper, meta, state, env) {
  if (wrapper.classList.contains('vel-rg')) {
    const t = state.triggers || {};
    for (const li of wrapper.querySelectorAll('.vel-tickable')) {
      const done = !!t[li.dataset.velKey];
      li.classList.toggle('is-done', done);
      const box = li.querySelector('.vel-tick');
      if (box) box.setAttribute('aria-pressed', done ? 'true' : 'false');
    }
    for (const box of wrapper.querySelectorAll('.vel-counters')) drawCounters(box, env);
    return;
  }

  const now = currentAttention(meta, state);
  const changed = typeof state.attention === 'number' && state.attention !== meta.attention;
  for (const li of wrapper.querySelectorAll('[data-vel-attention]')) {
    const v = li.querySelector('.vel-att-live');
    if (v) v.textContent = String(now);
    li.classList.toggle('is-changed', changed);
    li.title = changed ? `Tonight: ${meta.attention ?? 0} → ${now}. Goes into the vault after the session.` : '';
  }
  const table = wrapper.querySelector('.vel-att-table');
  if (table) {
    for (const tr of table.querySelectorAll('tbody tr')) {
      const first = tr.cells[0] ? tr.cells[0].textContent.trim() : '';
      tr.classList.toggle('is-now', first === String(now));
    }
  }
  const beats = state.beats || {};
  for (const li of wrapper.querySelectorAll('.vel-beat')) {
    const on = !!beats[li.dataset.velBeat];
    li.classList.toggle('is-played-live', on);
    const tap = li.querySelector('.vel-played');
    if (tap) {
      tap.setAttribute('aria-pressed', on ? 'true' : 'false');
      tap.textContent = on ? 'played tonight' : 'played';
    }
  }
}
