// Arc 8 (Eden) corner-motif candidates, in the archives' OrnateFrame house style.
// Authored upright in the local frame every motif uses (local -y points into the
// corner), placed with translate(11.6 11.6) rotate(-45) scale(1.12).
// Writes motifs.json + motif-preview.html into the folder given as the first argument
// (default: next to this file; don't commit them, they rebuild in a second).
// The sketches went on the P2 round-1 decision page (2026-09-25); the picked one gets drawn properly.
//   node dev/story-pages/arc8-motif-sketches.js <scratch dir>
const fs = require('fs');
const path = require('path');

const r = (n) => Math.round(n * 100) / 100;
const P = (x, y) => `${r(x)} ${r(y)}`;
const rad = (d) => (d * Math.PI) / 180;

// Point on a circle, angle measured from +y (the side facing away from the corner).
function onCircle(cx, cy, R, deg) {
  const a = rad(deg);
  return [cx + R * Math.sin(a), cy + R * Math.cos(a)];
}

// An open ring: the gap ("mouth") is centred on +y, half-angle `gap` degrees.
function openRing(cx, cy, R, gap) {
  const [x1, y1] = onCircle(cx, cy, R, gap);
  const [x2, y2] = onCircle(cx, cy, R, 360 - gap);
  // From the right lip, the long way round over the top, to the left lip.
  return `M ${P(x1, y1)} A ${r(R)} ${r(R)} 0 1 0 ${P(x2, y2)}`;
}

function sparkle(cx, cy, R, pinch) {
  const p = pinch;
  return `M ${P(cx, cy - R)} Q ${P(cx + p, cy - p)} ${P(cx + R, cy)} Q ${P(cx + p, cy + p)} ${P(cx, cy + R)} Q ${P(cx - p, cy + p)} ${P(cx - R, cy)} Q ${P(cx - p, cy - p)} ${P(cx, cy - R)} Z`;
}

const wrap = (inner) => `<g transform="translate(11.6 11.6) rotate(-45) scale(1.12)">${inner}</g>`;

// ── 1. The rings of Eden ────────────────────────────────────────────────────
// Four open rings stand for seven (seven will not read at 56px). Each mouth faces
// away from the corner and widens outward, as the canon has it (ruled 2026-08-20),
// so the frame's diamond trail runs out through the mouths. The Crown's cold star
// sits on the central island.
function rings() {
  const cx = 0, cy = 1.2;
  const spec = [
    [2.35, 24, 0.85, 0.95],
    [3.75, 34, 0.9, 0.85],
    [5.15, 46, 0.9, 0.72],
    [6.55, 60, 0.85, 0.6],
  ];
  let s = '';
  for (const [R, gap, w, op] of spec) {
    // The outer rings break into islands (Eden is fifty islands, not solid rings).
    const dash = R > 4.5 ? ` stroke-dasharray="${r(R * 0.95)} ${r(R * 0.28)}"` : '';
    s += `<path d="${openRing(cx, cy, R, gap)}" stroke="currentColor" stroke-width="${w}" stroke-linecap="butt"${dash} fill="none" opacity="${op}"/>`;
  }
  // Lip gems on the outer ring: the bridges at the mouth.
  const [lx, ly] = onCircle(cx, cy, 6.55, 44);
  const gem = (x, y, g) => `M ${P(x, y - g)} L ${P(x + g, y)} L ${P(x, y + g)} L ${P(x - g, y)} Z`;
  s += `<path d="${gem(lx, ly, 0.55)} ${gem(-lx, ly, 0.55)}" fill="currentColor" opacity="0.7"/>`;
  s += `<path d="${sparkle(cx, cy, 1.55, 0.32)}" fill="currentColor" opacity="1"/>`;
  return wrap(s);
}

// ── 2. The Crown on the spire ───────────────────────────────────────────────
// The tiered massif that stands out of the central island, setbacks stepping in
// toward the corner, fluted piers cut as slits, the Crown's star at the peak and
// a band of cloud under the base. Symmetric about its axis, so it mirrors clean.
function spire() {
  // Tiers from the base (y large) up toward the corner (y small).
  const tiers = [
    [4.3, 7.4, 3.6],
    [3.2, 3.6, 0.4],
    [2.2, 0.4, -2.2],
    [1.25, -2.2, -4.2],
  ];
  let body = '';
  // One outline, stepping in at each setback.
  const pts = [];
  pts.push([-tiers[0][0], tiers[0][1]]);
  for (let i = 0; i < tiers.length; i++) {
    const [hw, , top] = tiers[i];
    pts.push([-hw, top]);
    if (i + 1 < tiers.length) pts.push([-tiers[i + 1][0], top]);
  }
  pts.push([-0.35, tiers[tiers.length - 1][2]]);
  pts.push([0, -6.3]);
  pts.push([0.35, tiers[tiers.length - 1][2]]);
  for (let i = tiers.length - 1; i >= 0; i--) {
    const [hw, , top] = tiers[i];
    if (i + 1 < tiers.length) pts.push([tiers[i + 1][0], top]);
    pts.push([hw, top]);
  }
  pts.push([tiers[0][0], tiers[0][1]]);
  body += 'M ' + pts.map(([x, y]) => P(x, y)).join(' L ') + ' Z';
  // Fluted piers: slits (cutouts) running the height of each tier.
  const slit = (x, y0, y1, w) => ` M ${P(x - w, y0)} L ${P(x + w, y0)} L ${P(x + w, y1)} L ${P(x - w, y1)} Z`;
  for (const [hw, base, top] of tiers.slice(0, 3)) {
    const n = hw > 4 ? 3 : hw > 3 ? 2 : 1;
    const inset = 0.55;
    const ys = [base - inset, top + inset];
    if (n === 1) body += slit(0, ys[0], ys[1], 0.22);
    else {
      const span = hw - 1.1;
      for (let k = 0; k < n; k++) {
        const x = n === 2 ? (k === 0 ? -span / 2 : span / 2) : -span + (k * span);
        body += slit(x, ys[0], ys[1], 0.22);
      }
    }
  }
  let s = `<path fill-rule="evenodd" d="${body}" fill="currentColor" opacity="0.9"/>`;
  // The Crown: a cold four-point star at the peak.
  s += `<path d="${sparkle(0, -7.4, 1.7, 0.3)}" fill="currentColor" opacity="1"/>`;
  // Cloud under the base: two soft banks.
  s += `<path d="M -5.6 8.4 C -4.4 7.5 -2.6 7.6 -1.6 8.6 C -0.8 7.9 0.8 7.9 1.6 8.6 C 2.6 7.6 4.4 7.5 5.6 8.4" stroke="currentColor" stroke-width="0.6" stroke-linecap="round" fill="none" opacity="0.6"/>`;
  s += `<path d="M -3.4 9.7 C -2.2 9.1 -0.9 9.2 0 9.8 C 0.9 9.2 2.2 9.1 3.4 9.7" stroke="currentColor" stroke-width="0.5" stroke-linecap="round" fill="none" opacity="0.4"/>`;
  return wrap(s);
}

// ── 3. The Emp helm ─────────────────────────────────────────────────────────
// The patrol chassis' helm, face on: big glowing eyes and a mouth that is a line
// and does not move (S142). Dome toward the corner, a gold ridge down its centre,
// cheek plates flaring. Eyes and mouth are cutouts.
function helm() {
  const outline =
    'M 0 -6.4 C 3.3 -6.4 5.3 -4.1 5.3 -0.9 L 5.3 2.2 L 4.2 4.9 L 2.1 6.6 L -2.1 6.6 L -4.2 4.9 L -5.3 2.2 L -5.3 -0.9 C -5.3 -4.1 -3.3 -6.4 0 -6.4 Z';
  // Eyes: two big rounded slots, canted slightly down toward the nose.
  const eye = (sx) => {
    const x0 = sx * 0.9, x1 = sx * 4.1;
    return ` M ${P(x0, -0.2)} C ${P(x0, -1.9)} ${P(x1, -2.3)} ${P(x1, -0.9)} C ${P(x1, 0.5)} ${P(x0, 1.4)} ${P(x0, -0.2)} Z`;
  };
  const mouth = ' M -2.1 3.7 L 2.1 3.7 L 2.1 4.2 L -2.1 4.2 Z';
  let s = `<path fill-rule="evenodd" d="${outline}${eye(1)}${eye(-1)}${mouth}" fill="currentColor" opacity="0.88"/>`;
  // Ridge crest (the gold accent line) and a brow plate seam.
  s += `<path d="M 0 -8.2 L 0 -3.2" stroke="currentColor" stroke-width="0.7" stroke-linecap="round" fill="none" opacity="0.95"/>`;
  s += `<path d="M -0.55 -8.2 L 0 -9.1 L 0.55 -8.2 Z" fill="currentColor" opacity="0.95"/>`;
  s += `<path d="M -6.3 -1.4 C -6.9 1.2 -6.6 3.6 -5.3 5.4 M 6.3 -1.4 C 6.9 1.2 6.6 3.6 5.3 5.4" stroke="currentColor" stroke-width="0.45" stroke-linecap="round" fill="none" opacity="0.5"/>`;
  return wrap(s);
}

// Frame furniture + the Arc 7 butterfly, copied from OrnateFrame.astro (the only source).
const astro = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'velumaris-archives', 'src', 'components', 'ui', 'OrnateFrame.astro'), 'utf8').split('\n');
let frameDefs = astro.slice(85, 212).join('\n');
frameDefs = frameDefs.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
if (!/id="vel-of-frame"/.test(frameDefs) || !/id="vel-of-butterfly"/.test(frameDefs)) throw new Error('frame defs not found');
const open = (frameDefs.match(/<g\b/g) || []).length;
const close = (frameDefs.match(/<\/g>/g) || []).length;
if (open !== close) throw new Error(`unbalanced <g>: ${open} vs ${close}`);

const motifs = { rings: rings(), spire: spire(), helm: helm(), butterfly: '<use href="#vel-of-butterfly"/>' };
fs.writeFileSync(path.join(process.argv[2] || __dirname, 'motifs.json'), JSON.stringify({ frameDefs, motifs }, null, 1));

// Preview: big single corner + a small card with four mirrored corners.
const corner = (id, cls) => `<svg class="c ${cls}" viewBox="0 0 64 64"><use href="#vel-of-frame"/>${motifs[id]}</svg>`;
let html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0f172a;color:#e6e9ef;font:14px system-ui;display:flex;flex-wrap:wrap;gap:24px;padding:24px}
.big{width:260px;height:260px;color:#5b9dff;background:#141e35}
.card{position:relative;width:300px;height:150px;background:#141e35;color:#5b9dff;border-radius:10px;overflow:hidden}
.card .c{position:absolute;width:48px;height:48px;opacity:.8}
.tl{top:0;left:0}.tr{top:0;right:0;transform:scaleX(-1)}.bl{bottom:0;left:0;transform:scaleY(-1)}.br{bottom:0;right:0;transform:scale(-1,-1)}
.col{display:flex;flex-direction:column;gap:10px}
.light .card,.light .big{background:#fbfaf7;color:#1d4fb8}
</style><svg width="0" height="0" style="position:absolute"><defs>${frameDefs}</defs></svg>`;
for (const theme of ['', 'light']) {
  for (const id of Object.keys(motifs)) {
    html += `<div class="col ${theme}"><b>${id}</b><svg class="big" viewBox="0 0 64 64"><use href="#vel-of-frame"/>${motifs[id]}</svg><div class="card">${corner(id, 'tl')}${corner(id, 'tr')}${corner(id, 'bl')}${corner(id, 'br')}</div></div>`;
  }
}
fs.writeFileSync(path.join(process.argv[2] || __dirname, 'motif-preview.html'), html);
console.log('ok', Object.keys(motifs).join(' '));
