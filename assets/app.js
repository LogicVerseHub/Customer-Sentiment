/* ── config ── */
const DATA_URL = new URLSearchParams(location.search).get('data') || 'data/customers.json';
const MIN_N = 20; // minimum reviews before a ratio is used for comparison or insights
const SENT_NAMES = ['Positive', 'Neutral', 'Negative'];
// The JSON has no topic field, so topics are derived from keywords in the review text.
// Order is priority: the first match wins. The product name is removed before matching.
const TOPICS = [
  ['Customer service', /customer service|\bsupport\b|\bagent\b|complain|refund|exchange|replied|\bresponse\b/],
  ['Packaging', /packag|wrapped|parcel|mailer|\bbox\b/],
  ['Delivery', /deliver|shipping|arrived|courier|tracking|estimate/],
  ['Price & value', /price|worth|money|value|expensive|cheap|\bdeal\b|dollar|overpriced/],
  ['Fabric & quality', /fabric|material|cotton|fleece|nylon|denim|flannel|stitch|thick|\bthin|rough|soft|pilling|shrank|faded|breathable|durable|wash/],
  ['Size & fit', /\bsize|\bfit|sleeve|waist|shoulder|length|loose|tight|oversized|runs small|runs large|bigger/],
  ['Design & details', /colou?r|print|graphic|collar|button|pocket|design|zipper|detail|photos|logo/],
];

/* ── util ── */
const $ = (s, r = document) => r.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fInt = n => Math.round(n).toLocaleString('en-US');
const fDec = (n, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fPct = (x, d = 1) => fDec(x * 100, d) + '%';
let moneyC, moneyF;
const fMoney = n => moneyC.format(n);      // compact: $12.3K
const fMoneyFull = n => moneyF.format(n);  // full: $64
const fDate = s => { const [y, m, d] = s.split('-'); return `${MN[+m - 1]} ${+d}, ${y}`; };
const div = (a, b) => b ? a / b : null;
const mShort = i => { const [y, m] = RAW.months[i].split('-'); return MN[+m - 1] + (m === '01' ? ' ’' + y.slice(2) : ''); };
const mLong = i => { const [y, m] = RAW.months[i].split('-'); return MN[+m - 1] + ' ' + y; };
const mRange = (a, b) => { const ya = RAW.months[a].slice(0, 4), yb = RAW.months[b].slice(0, 4); const sa = MN[+RAW.months[a].slice(5) - 1], sb = MN[+RAW.months[b].slice(5) - 1]; return ya === yb ? `${sa}–${sb} ${yb}` : `${sa} ${ya}–${sb} ${yb}`; };

/* ── data: JSON users → flat order rows ── */
let RAW, ROWS, NM, PERIODS;
const SENT = ['pos', 'neu', 'neg'];
const UTYPES = ['One-time buyer', 'Repeat buyer (2)', 'Loyal buyer (3+)'];

function sentimentIndex(review) {
  const s = String(review.sentiment || '').toLowerCase();
  if (s.startsWith('pos')) return 0;
  if (s.startsWith('neu')) return 1;
  if (s.startsWith('neg')) return 2;
  return review.rating >= 4 ? 0 : review.rating === 3 ? 1 : 2; // no label: derive from rating
}
function topicOf(text, product) {
  const t = text.split(product).join(' ').toLowerCase();
  const i = TOPICS.findIndex(([, re]) => re.test(t));
  return i < 0 ? TOPICS.length : i;
}
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function normalize(json, source) {
  const users = Array.isArray(json) ? json : json && json.users;
  if (!Array.isArray(users) || !users.length) throw new Error('Expected a "users" array (or a top-level array of users).');
  const orders = [];
  users.forEach((u, ui) => {
    if (!Array.isArray(u.orders)) throw new Error(`User #${ui + 1} (${u.user_id || 'no id'}) has no "orders" array.`);
    u.orders.forEach(o => orders.push({ u, o, n: u.orders.length }));
  });
  if (!orders.length) throw new Error('The file contains users but no orders.');
  for (const { o } of orders) if (!/^\d{4}-\d{2}-\d{2}/.test(o.order_date || '')) throw new Error(`Order ${o.order_id || '?'} has no valid "order_date" (YYYY-MM-DD…).`);

  const uniq = f => [...new Set(orders.map(f))].sort((a, b) => a.localeCompare(b));
  const city = uniq(x => x.u.city || 'Unknown'), channel = uniq(x => x.o.channel || 'Unknown'), pay = uniq(x => x.o.payment || 'Unknown');
  const pmap = new Map();
  for (const { o } of orders) { o.product = o.product || 'Unknown'; if (!pmap.has(o.product)) pmap.set(o.product, { name: o.product, sku: o.sku || '', price: num(o.unit_price) }); }
  const produk = [...pmap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const pIdx = new Map(produk.map((p, i) => [p.name, i]));

  // continuous month axis from first to last order month
  const ms = orders.map(x => x.o.order_date.slice(0, 7)).sort();
  const months = [];
  for (let [y, m] = ms[0].split('-').map(Number); ; m++) {
    if (m > 12) { m = 1; y++; }
    const k = `${y}-${String(m).padStart(2, '0')}`; months.push(k);
    if (k >= ms[ms.length - 1]) break;
  }
  const mIdx = new Map(months.map((k, i) => [k, i]));

  const rows = orders.map(({ u, o, n }) => {
    const rv = o.review && o.review.rating != null ? o.review : null;
    const qty = num(o.quantity, 1), price = num(o.unit_price), discAmt = num(o.discount_amount, price * qty * num(o.discount_pct) / 100);
    return {
      id: o.order_id || '', cust: u.user_id || u.name, name: u.name || u.user_id || '', date: o.order_date.slice(0, 10), m: mIdx.get(o.order_date.slice(0, 7)),
      city: city.indexOf(u.city || 'Unknown'), channel: channel.indexOf(o.channel || 'Unknown'), pay: pay.indexOf(o.payment || 'Unknown'),
      prod: pIdx.get(o.product), unit: qty, disk: num(o.discount_pct), total: num(o.total, price * qty - discAmt), disc: discAmt,
      est: num(o.est_delivery_days), akt: num(o.actual_delivery_days, num(o.est_delivery_days)),
      rating: rv ? Math.max(1, Math.min(5, Math.round(num(rv.rating, 3)))) : null, sent: rv ? sentimentIndex(rv) : -1,
      topik: rv ? topicOf(String(rv.text || ''), o.product || '') : -1, text: rv ? String(rv.text || '') : '', tglU: rv ? String(rv.date || o.order_date).slice(0, 10) : '',
      utype: Math.min(n, 3) - 1,
    };
  });
  const topik = TOPICS.map(t => t[0]);
  if (rows.some(r => r.topik === TOPICS.length)) topik.push('Other');
  const store = (!Array.isArray(json) && json.store) || {};
  return { source, store: { name: store.name || 'Store', currency: store.currency || 'USD' }, users: users.length, months, city, channel, pay, produk, sent: SENT_NAMES, topik, rows };
}

/* ── state ── */
const state = { period: 0, prod: -1, channel: -1, city: -1, metric: 'rev', dim: 'city', sort: { key: 'n', dir: -1 }, rvTab: -1, q: '', page: 0 };
let cur = null; // aggregates for the active filters

function agg(rows) {
  const a = { n: 0, rev: 0, units: 0, disc: 0, rv: 0, rsum: 0, rate: [0, 0, 0, 0, 0], s: [0, 0, 0], late: 0, lateRv: 0, lateSum: 0, onRv: 0, onSum: 0, cust: new Set() };
  for (const r of rows) {
    a.n++; a.rev += r.total; a.units += r.unit; a.disc += r.disc; a.cust.add(r.cust);
    const late = r.akt > r.est; if (late) a.late++;
    if (r.rating != null) {
      a.rv++; a.rsum += r.rating; a.rate[r.rating - 1]++; a.s[r.sent]++;
      if (late) { a.lateRv++; a.lateSum += r.rating; } else { a.onRv++; a.onSum += r.rating; }
    }
  }
  return a;
}
const rating = a => div(a.rsum, a.rv), negShare = a => div(a.s[2], a.rv), posShare = a => div(a.s[0], a.rv), onTime = a => a.n ? 1 - a.late / a.n : null;

function compute() {
  const P = PERIODS[state.period];
  const base = ROWS.filter(r => (state.prod < 0 || r.prod === state.prod) && (state.channel < 0 || r.channel === state.channel) && (state.city < 0 || r.city === state.city));
  const byMonth = Array.from({ length: NM }, () => []);
  for (const r of base) byMonth[r.m].push(r);
  const rows = base.filter(r => r.m >= P.a && r.m <= P.b);
  const span = (a, b) => agg(byMonth.slice(Math.max(0, a), b + 1).flat());
  cur = {
    P, rows, all: agg(rows), months: byMonth.map(agg),
    last3: span(P.b - 2, P.b), prev3: P.b - 5 >= 0 ? span(P.b - 5, P.b - 3) : null,
    first3: P.b - P.a >= 5 ? span(P.a, P.a + 2) : null,
  };
}

/* ── tooltip ── */
const tip = $('#tip');
function showTip(html, e) {
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY - r.height - 12;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y < 8) y = e.clientY + 18;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.hidden = true; };
function bindTip(el, html, onIn, onOut) {
  el.addEventListener('mousemove', e => { showTip(typeof html === 'function' ? html() : html, e); onIn && onIn(); });
  el.addEventListener('mouseleave', () => { hideTip(); onOut && onOut(); });
}
const tipRow = (k, v) => `<div class="r"><span>${k}</span><b>${v}</b></div>`;

/* ── chart primitives ── */
function nice(max, n = 4) {
  if (!(max > 0)) return { step: 1, max: 1 };
  const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  return { step, max: Math.ceil(max / step - 1e-9) * step };
}
function frame(box, o) {
  box.innerHTML = '';
  const W = Math.max(260, box.clientWidth), H = o.h, m = o.m;
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.aria || '' }, box);
  return { svg, W, H, m, iw: W - m.l - m.r, ih: H - m.t - m.b };
}
function yAxis(f, lo, hi, step, fmt) {
  const y = v => f.m.t + f.ih - (v - lo) / (hi - lo) * f.ih;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    S('line', { x1: f.m.l, x2: f.W - f.m.r, y1: y(v), y2: y(v), class: v === lo ? 'base' : 'gridl' }, f.svg);
    S('text', { x: f.m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, f.svg).textContent = fmt(v);
  }
  return y;
}
/* items: [{label, value, cls, tip, text}] */
function barChart(box, items, o) {
  const f = frame(box, { h: o.h || 240, m: Object.assign({ l: 44, r: 8, t: 24, b: 28 }, o.m), aria: o.aria });
  const nc = nice(Math.max(...items.map(d => d.value)), o.ticks || 4);
  const y = yAxis(f, 0, nc.max, nc.step, o.yfmt || fInt);
  const band = f.iw / items.length, bw = Math.min(o.bw || 24, band * 0.62), skip = band < 34 ? 2 : 1;
  const hi = o.highlightMax ? items.reduce((b, d, i) => d.value > items[b].value ? i : b, 0) : -1;
  items.forEach((d, i) => {
    const cx = f.m.l + band * i + band / 2, x = cx - bw / 2, y0 = y(0), yt = y(d.value), r = Math.min(4, bw / 2, y0 - yt);
    const bar = S('path', { d: `M${x},${y0}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${y0}Z`, class: 'bar ' + (d.cls || '') + (i === hi ? ' hi' : '') }, f.svg);
    if (i % skip === 0) S('text', { x: cx, y: f.m.t + f.ih + 18, 'text-anchor': 'middle', class: 'tick' }, f.svg).textContent = d.label;
    if (i === hi || d.text) S('text', { x: cx, y: yt - 7, 'text-anchor': 'middle', class: 'vlabel' }, f.svg).textContent = d.text || (o.yfmtFull || o.yfmt || fInt)(d.value);
    const hit = S('rect', { x: f.m.l + band * i, y: f.m.t, width: band, height: f.ih, fill: 'transparent' }, f.svg);
    bindTip(hit, d.tip, () => bar.classList.add('on'), () => bar.classList.remove('on'));
  });
  if (o.xTitle) S('text', { x: f.m.l + f.iw / 2, y: f.H - 4, 'text-anchor': 'middle', class: 'tick' }, f.svg).textContent = o.xTitle;
}
/* pts: [{label, value|null, tip}] */
function lineChart(box, pts, o) {
  const f = frame(box, { h: o.h || 240, m: { l: 44, r: 16, t: 24, b: 28 }, aria: o.aria });
  const vals = pts.map(p => p.value).filter(v => v != null);
  if (!vals.length) { box.innerHTML = '<div class="empty">No reviews for this selection yet.</div>'; return; }
  const y = yAxis(f, o.lo, o.hi, o.step, o.yfmt);
  const band = f.iw / pts.length, X = i => f.m.l + band * i + band / 2, skip = band < 34 ? 2 : 1;
  const live = pts.map((p, i) => ({ ...p, i })).filter(p => p.value != null);
  const path = live.map((p, k) => (k ? 'L' : 'M') + X(p.i) + ',' + y(p.value)).join('');
  if (live.length > 1) S('path', { d: `${path}L${X(live[live.length - 1].i)},${y(o.lo)}L${X(live[0].i)},${y(o.lo)}Z`, class: 'area' }, f.svg);
  S('path', { d: path, class: 'ln' }, f.svg);
  const cross = S('line', { y1: f.m.t, y2: f.m.t + f.ih, class: 'cross', visibility: 'hidden' }, f.svg);
  const hover = S('circle', { r: 5, class: 'dot', visibility: 'hidden' }, f.svg);
  // direct labels only on the last point and the maximum
  const last = live[live.length - 1], ext = live.reduce((b, p) => p.value > b.value ? p : b, live[0]);
  for (const p of new Set([last, ext])) {
    S('circle', { cx: X(p.i), cy: y(p.value), r: 4, class: 'dot' }, f.svg);
    S('text', { x: Math.min(X(p.i), f.W - 22), y: y(p.value) - 10, 'text-anchor': 'middle', class: 'vlabel' }, f.svg).textContent = o.yfmtFull(p.value);
  }
  pts.forEach((p, i) => {
    if (i % skip === 0) S('text', { x: X(i), y: f.m.t + f.ih + 18, 'text-anchor': 'middle', class: 'tick' }, f.svg).textContent = p.label;
    const hit = S('rect', { x: f.m.l + band * i, y: f.m.t, width: band, height: f.ih, fill: 'transparent' }, f.svg);
    bindTip(hit, p.tip, () => {
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      if (p.value != null) { hover.setAttribute('cx', X(i)); hover.setAttribute('cy', y(p.value)); hover.setAttribute('visibility', 'visible'); }
    }, () => { cross.setAttribute('visibility', 'hidden'); hover.setAttribute('visibility', 'hidden'); });
  });
}
function sparkline(vals) {
  const v = vals.filter(x => x != null);
  if (v.length < 2) return '';
  const W = 120, H = 44, lo = Math.min(...v), hi = Math.max(...v), rng = hi - lo || 1;
  const pts = vals.map((x, i) => x == null ? null : [4 + i * (W - 10) / (vals.length - 1), 6 + (1 - (x - lo) / rng) * (H - 12)]).filter(Boolean);
  const [ex, ey] = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('')}" fill="none" stroke="var(--axis)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/></svg>`;
}
/* last 3 months vs the 3 months before; kind: rel (%), pp (percentage points), pts (points) */
function delta(c, p, kind) {
  if (c == null || p == null || !cur.prev3) return '';
  const d = kind === 'rel' ? (p ? (c - p) / p : 0) : c - p;
  const txt = kind === 'rel' ? fDec(Math.abs(d) * 100, 1) + '%' : kind === 'pp' ? fDec(Math.abs(d) * 100, 1) + ' pp' : fDec(Math.abs(d), 2);
  const flat = Math.abs(d) < (kind === 'pts' ? 0.005 : 0.0005);
  return `<span class="delta ${flat ? 'flat' : d > 0 ? 'up' : 'down'}">${flat ? '■' : d > 0 ? '▲' : '▼'} ${txt}</span>`;
}
const DELTA_NOTE = 'last 3 mo vs prior 3 mo';

/* ── render: summary ── */
const ICON = {
  rev: '<svg viewBox="0 0 18 18"><rect x="2.5" y="4.5" width="13" height="10" rx="2"/><path d="M2.5 8h13M11.5 11.300h1.500"/></svg>',
  ord: '<svg viewBox="0 0 18 18"><path d="M4 6.500h10l-.8 8.500H4.800L4 6.500z"/><path d="M6.500 6.500V5a2.500 2.500 0 015 0v1.500"/></svg>',
  pos: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.500"/><path d="M6.300 10.500a3.200 3.200 0 005.400 0M6.800 7.300h.01M11.200 7.300h.01"/></svg>',
  ship: '<svg viewBox="0 0 18 18"><path d="M2.500 5h8.500v7.500h-8.500zM11 7.500h2.800l1.700 2.200v2.800H11"/><circle cx="5.500" cy="13.300" r="1.300"/><circle cx="12.800" cy="13.300" r="1.300"/></svg>',
};
function renderSummary() {
  const a = cur.all, P = cur.P, l = cur.last3, p = cur.prev3 || {};
  $('#h-rating').textContent = a.rv ? fDec(rating(a)) : '–';
  $('#h-meta').innerHTML = `<span>${fInt(a.rv)} reviews · ${a.rv === a.n ? 'every order reviewed' : fPct(div(a.rv, a.n) || 0, 0) + ' of orders reviewed'}</span>` + (cur.prev3 && l.rv && p.rv ? `<span class="chip">${rating(l) >= rating(p) ? '▲' : '▼'} ${fDec(Math.abs(rating(l) - rating(p)))} · last 3 mo</span>` : '');
  $('#h-stats').innerHTML = `<div><span>4–5 stars</span><b>${a.rv ? fPct((a.rate[3] + a.rate[4]) / a.rv, 0) : '–'}</b></div><div><span>1–2 stars</span><b>${a.rv ? fPct((a.rate[0] + a.rate[1]) / a.rv, 0) : '–'}</b></div>`;
  const mx = Math.max(1, ...a.rate);
  $('#h-dist').innerHTML = [5, 4, 3, 2, 1].map(s => `<div class="dist-row"><span>${s} ★</span><span class="track"><span class="fill" style="width:${a.rate[s - 1] / mx * 100}%"></span></span><span class="v">${fInt(a.rate[s - 1])} · ${a.rv ? fPct(a.rate[s - 1] / a.rv, 0) : '0%'}</span></div>`).join('');

  const ms = cur.months.slice(P.a, P.b + 1);
  const tiles = [
    { ico: 'rev', label: 'Net sales', val: fMoney(a.rev), sub: `${fInt(a.units)} units · ${fMoney(a.disc)} discounts`, d: delta(l.rev, p.rev, 'rel'), sp: ms.map(m => m.rev) },
    { ico: 'ord', label: 'Orders', val: fInt(a.n), sub: `${fInt(a.cust.size)} users · ${a.n ? fMoney(a.rev / a.n) : '–'} per order`, d: delta(l.n, p.n, 'rel'), sp: ms.map(m => m.n) },
    { ico: 'pos', label: 'Positive sentiment', val: a.rv ? fPct(posShare(a)) : '–', sub: `${fInt(a.s[0])} of ${fInt(a.rv)} reviews`, d: delta(posShare(l), p.rv ? posShare(p) : null, 'pp'), sp: ms.map(posShare) },
    { ico: 'ship', label: 'On-time delivery', val: a.n ? fPct(onTime(a)) : '–', sub: `${fInt(a.late)} orders past the estimate`, d: delta(onTime(l), p.n ? onTime(p) : null, 'pp'), sp: ms.map(onTime) },
  ];
  $('#kpis').innerHTML = tiles.map(t => `<div class="card kpi"><div class="kpi-top"><div class="kpi-ico">${ICON[t.ico]}</div><span>${t.label}</span></div><div><div class="kpi-val">${t.val}</div><div class="kpi-sub">${t.sub}</div>${t.d ? `<div class="kpi-row">${t.d}<span>${DELTA_NOTE}</span></div>` : ''}</div>${sparkline(t.sp)}</div>`).join('');
}

/* ── render: trend ── */
const METRICS = {
  rev: { label: 'Sales', get: m => m.rev, fmt: v => fMoney(v), axis: v => fMoney(v), big: c => fMoney(c.all.rev / (c.P.b - c.P.a + 1)), note: 'average net sales per month' },
  ord: { label: 'Orders', get: m => m.n, fmt: fInt, axis: fInt, big: c => fDec(c.all.n / (c.P.b - c.P.a + 1), 1), note: 'average orders per month' },
  rat: { label: 'Rating', line: true, get: rating, fmt: v => fDec(v), axis: v => fDec(v, 1), big: c => c.all.rv ? fDec(rating(c.all)) : '–', note: 'average rating this period (1–5 scale)' },
  neg: { label: 'Negative reviews', line: true, get: negShare, fmt: v => fPct(v), axis: v => fPct(v, 0), big: c => c.all.rv ? fPct(negShare(c.all)) : '–', note: 'share of reviews with negative sentiment' },
};
function renderTrend() {
  const M = METRICS[state.metric], P = cur.P, idx = []; for (let i = P.a; i <= P.b; i++) idx.push(i);
  $('#trend-sub').textContent = `By order month · ${mRange(P.a, P.b)}`;
  $('#trend-big').textContent = M.big(cur); $('#trend-note').textContent = M.note;
  const tipOf = i => { const m = cur.months[i]; return `<div class="t">${mLong(i)}</div>` + tipRow('Sales', fMoney(m.rev)) + tipRow('Orders', fInt(m.n)) + tipRow('Rating', m.rv ? fDec(rating(m)) : '–') + tipRow('Negative reviews', m.rv ? fPct(negShare(m)) : '–') + tipRow('Reviews', fInt(m.rv)); };
  const box = $('#trendChart');
  if (!cur.all.n) { box.innerHTML = '<div class="empty">No orders for this filter combination.</div>'; return; }
  if (!M.line) {
    barChart(box, idx.map(i => ({ label: mShort(i), value: M.get(cur.months[i]), tip: tipOf(i) })), { h: 244, ticks: 5, yfmt: M.axis, yfmtFull: M.fmt, highlightMax: true, bw: 24, m: { l: 52 }, aria: `${M.label} per month` });
  } else {
    const vals = idx.map(i => M.get(cur.months[i])), v = vals.filter(x => x != null);
    let lo = 0, hi, step;
    if (state.metric === 'rat') { lo = Math.max(1, Math.floor(Math.min(...v) * 2 - 0.5) / 2); hi = Math.min(5, Math.ceil(Math.max(...v) * 2 + 0.5) / 2); step = 0.5; if (hi <= lo) hi = lo + 0.5; }
    else { const nc = nice(Math.max(0.05, ...v), 4); hi = nc.max; step = nc.step; }
    lineChart(box, idx.map((i, k) => ({ label: mShort(i), value: vals[k], tip: tipOf(i) })), { h: 244, lo, hi, step, yfmt: M.axis, yfmtFull: M.fmt, aria: `${M.label} per month` });
  }
}

/* ── render: sentiment, purchase frequency, user-level sentiment ── */
function stackBar(barId, legendId, counts, names, cls) {
  const total = counts.reduce((s, n) => s + n, 0);
  $(barId).innerHTML = counts.map((n, i) => n ? `<span class="${cls[i]}" style="flex:${n}"></span>` : '').join('');
  $(legendId).innerHTML = counts.map((n, i) => `<span><i class="sw ${cls[i]}"></i>${names[i]}<b>${total ? fPct(n / total) : '–'}</b></span>`).join('');
}
function renderSentiment() {
  const a = cur.all, svg = $('#donut'); svg.innerHTML = '';
  $('#sent-sub').textContent = `From ${fInt(a.rv)} reviews received`;
  const r = 60, C = 2 * Math.PI * r, gap = 2; let off = 0;
  S('circle', { cx: 75, cy: 75, r, stroke: 'var(--surface-2)' }, svg);
  a.s.forEach((n, i) => {
    if (!n) return;
    const len = n / a.rv * C;
    const c = S('circle', { cx: 75, cy: 75, r, class: 's-' + SENT[i], 'stroke-dasharray': `${Math.max(0.5, len - gap)} ${C}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 75 75)' }, svg);
    bindTip(c, `<div class="t">${RAW.sent[i]}</div><div class="v">${fPct(n / a.rv)}</div>` + tipRow('Reviews', fInt(n)));
    off += len;
  });
  S('text', { x: 75, y: 76, 'text-anchor': 'middle', class: 'c1' }, svg).textContent = fInt(a.rv);
  S('text', { x: 75, y: 93, 'text-anchor': 'middle', class: 'c2' }, svg).textContent = 'reviews';
  $('#sent-legend').innerHTML = a.s.map((n, i) => `<div class="rowline"><span><i class="sw ${SENT[i]}"></i>${RAW.sent[i]}</span><span class="n">${fInt(n)}</span><b>${a.rv ? fPct(n / a.rv) : '–'}</b></div>`).join('');

  const cnt = new Map(), rsum = new Map();
  for (const r of cur.rows) {
    cnt.set(r.cust, (cnt.get(r.cust) || 0) + 1);
    if (r.rating != null) { const s = rsum.get(r.cust) || [0, 0]; s[0] += r.rating; s[1]++; rsum.set(r.cust, s); }
  }
  const fq = [0, 0, 0]; for (const v of cnt.values()) fq[Math.min(v, 3) - 1]++;
  $('#freq-n').textContent = `${fInt(cnt.size)} users`;
  stackBar('#freq-bar', '#freq-legend', fq, ['1 order', '2 orders', '3+ orders'], ['o1', 'o2', 'o3']);

  // a user's sentiment = their average rating across reviews in scope (≥3.5 positive, ≥2.5 neutral)
  const us = [0, 0, 0]; for (const [s, n] of rsum.values()) { const avg = s / n; us[avg >= 3.5 ? 0 : avg >= 2.5 ? 1 : 2]++; }
  $('#usent-n').textContent = `${fInt(rsum.size)} users with reviews`;
  stackBar('#usent-bar', '#usent-legend', us, RAW.sent, SENT);
}

/* ── render: products ── */
function productStats() {
  return RAW.produk.map((p, i) => {
    const rows = cur.rows.filter(r => r.prod === i), a = agg(rows), t = new Map();
    for (const r of rows) if (r.sent === 2) t.set(r.topik, (t.get(r.topik) || 0) + 1);
    const top = [...t].sort((x, y) => y[1] - x[1])[0];
    return { ...p, a, n: a.n, rev: a.rev, rating: rating(a), neg: negShare(a), top: top && a.s[2] >= 5 ? { name: RAW.topik[top[0]], n: top[1], of: a.s[2] } : null };
  }).filter(d => d.n);
}
function renderProducts() {
  const list = productStats().sort((x, y) => y.rev - x.rev), box = $('#prod');
  if (!list.length) { box.innerHTML = '<div class="empty">No orders for this selection.</div>'; return; }
  const mx = Math.max(...list.map(d => d.rev));
  box.innerHTML = '<div class="prod-row asp-h"><span>Product</span><span>Net sales</span><span>Rating</span><span>Top complaint</span></div>' +
    list.map((d, k) => `<div class="prod-row" data-k="${k}"><div class="prod-name"><b>${esc(d.name)}</b><span>${fMoneyFull(d.price)} · ${fInt(d.n)} orders</span></div><div class="prod-bar"><i style="width:${d.rev / mx * 100}%"></i><span>${fMoney(d.rev)}</span></div><span class="num${d.a.rv < MIN_N ? ' low-n' : ''}">${d.a.rv ? fDec(d.rating) : '–'}</span><div class="prod-top">${d.top ? `<b>${esc(d.top.name)}</b><span>${fInt(d.top.n)} of ${fInt(d.top.of)} negative reviews</span>` : '<span>Too few negative reviews</span>'}</div></div>`).join('');
  box.querySelectorAll('.prod-row[data-k]').forEach(row => {
    const d = list[+row.dataset.k];
    bindTip(row, `<div class="t">${esc(d.name)}${d.sku ? ' · ' + esc(d.sku) : ''}</div><div class="v">${fMoney(d.rev)}</div>` + tipRow('Orders', fInt(d.n)) + tipRow('Units', fInt(d.a.units)) + tipRow('Rating', d.a.rv ? fDec(d.rating) : '–') + tipRow('Positive', d.a.rv ? fPct(posShare(d.a)) : '–') + tipRow('Negative', d.a.rv ? fPct(d.neg) : '–') + tipRow('Late', fPct(d.a.late / d.n)));
  });
}

/* ── render: topics ── */
function topicStats() {
  return RAW.topik.map((name, i) => { const a = agg(cur.rows.filter(r => r.topik === i)); return { name, a, n: a.rv, neg: negShare(a), pos: posShare(a), rating: rating(a) }; }).filter(d => d.n);
}
function renderTopics() {
  const list = topicStats().sort((x, y) => y.neg - x.neg), box = $('#asp');
  if (!list.length) { box.innerHTML = '<div class="empty">No reviews for this selection yet.</div>'; return; }
  box.innerHTML = '<div class="asp-row asp-h"><span>Topic</span><span>Sentiment mix</span><span>Negative</span><span>Rating</span><span>Reviews</span></div>' +
    list.map((d, k) => `<div class="asp-row" data-k="${k}"><span class="asp-name">${esc(d.name)}</span><div class="asp-bar">${d.a.s.map((n, i) => n ? `<span class="${SENT[i]}" style="flex:${n}" data-i="${i}"><em>${fPct(n / d.n, 0)}</em></span>` : '').join('')}</div><span class="num"><b>${fPct(d.neg)}</b></span><span class="num">${fDec(d.rating)}</span><span class="num${d.n < MIN_N ? ' low-n' : ''}">${fInt(d.n)}</span></div>`).join('');
  box.querySelectorAll('.asp-bar span').forEach(seg => {
    const d = list[+seg.closest('.asp-row').dataset.k], i = +seg.dataset.i, em = seg.firstChild;
    if (em.scrollWidth + 10 > seg.clientWidth) em.remove(); // label only when it fits
    bindTip(seg, `<div class="t">${esc(d.name)} · ${RAW.sent[i]}</div><div class="v">${fPct(d.a.s[i] / d.n)}</div>` + tipRow('Reviews', `${fInt(d.a.s[i])} of ${fInt(d.n)}`));
  });
}

/* ── render: insights ── */
function renderInsights() {
  const a = cur.all, out = [], tp = topicStats().filter(d => d.n >= MIN_N);
  if (tp.length > 1) {
    const worst = tp.reduce((b, d) => d.neg > b.neg ? d : b), best = tp.reduce((b, d) => d.rating > b.rating ? d : b);
    out.push([`${worst.name} draws the most complaints`, `${fPct(worst.neg, 0)} of ${fInt(worst.n)} reviews on this topic are negative (rating ${fDec(worst.rating)}), the highest of any topic.`]);
    if (best !== worst) out.push([`${best.name} satisfies customers most`, `Rating ${fDec(best.rating)} with ${fPct(best.neg, 0)} negative reviews out of ${fInt(best.n)}.`]);
  }
  if (a.lateRv >= 10 && a.onRv >= 10) {
    const gap = a.onSum / a.onRv - a.lateSum / a.lateRv;
    out.push([`Late delivery ${gap > 0 ? 'lowers' : 'does not lower'} ratings`, `${fPct(a.late / a.n)} of orders arrived after the estimate. They average ${fDec(a.lateSum / a.lateRv)}, versus ${fDec(a.onSum / a.onRv)} for on-time orders (a ${fDec(Math.abs(gap))}-point gap).`]);
  }
  if (state.prod < 0) {
    const pr = productStats().filter(d => d.a.rv >= MIN_N);
    if (pr.length > 1) {
      const lo = pr.reduce((b, d) => d.rating < b.rating ? d : b), hi = pr.reduce((b, d) => d.rating > b.rating ? d : b), gap = hi.rating - lo.rating;
      out.push(gap < 0.3
        ? ['Satisfaction is even across products', `Ratings for ${fInt(pr.length)} products only range from ${fDec(lo.rating)} (${lo.name}) to ${fDec(hi.rating)} (${hi.name}). Issues are tied more to topics and process than to one product.`]
        : [`${lo.name} has the lowest rating`, `Rating ${fDec(lo.rating)} with ${fPct(lo.neg, 0)} negative reviews, ${fDec(gap)} points behind ${hi.name} (${fDec(hi.rating)}).`]);
    }
  }
  if (state.channel < 0) {
    const ch = RAW.channel.map((name, i) => ({ name, a: agg(cur.rows.filter(r => r.channel === i)) })).filter(d => d.a.rv >= MIN_N);
    if (ch.length > 1) {
      const w = ch.reduce((b, d) => rating(d.a) < rating(b.a) ? d : b), t = ch.reduce((b, d) => rating(d.a) > rating(b.a) ? d : b);
      out.push([`${w.name} has the lowest-rated channel experience`, `Rating ${fDec(rating(w.a))} and ${fPct(negShare(w.a), 0)} negative out of ${fInt(w.a.rv)} reviews. Highest is ${t.name} at ${fDec(rating(t.a))}.`]);
    }
  }
  if (cur.first3 && cur.first3.rv >= MIN_N && cur.last3.rv >= MIN_N) {
    const f = negShare(cur.first3), l = negShare(cur.last3), P = cur.P, d = Math.abs(l - f) < 0.01 ? 'held steady' : l < f ? 'fell' : 'rose';
    out.push([`Negative reviews ${d} over the period`, `From ${fPct(f, 0)} in ${mRange(P.a, P.a + 2)} to ${fPct(l, 0)} in ${mRange(P.b - 2, P.b)}; rating moved from ${fDec(rating(cur.first3))} to ${fDec(rating(cur.last3))}.`]);
  }
  $('#ins').innerHTML = out.length ? out.slice(0, 5).map((o, i) => `<li><span class="k">${i + 1}</span><div><b>${esc(o[0])}</b><p>${esc(o[1])}</p></div></li>`).join('') : `<li class="empty" style="grid-template-columns:1fr">Review sample too small (under ${MIN_N}) to draw reliable insights.</li>`;
}

/* ── render: segment table ── */
const DIMS = {
  city: { label: 'City', key: r => r.city, name: i => RAW.city[i] },
  channel: { label: 'Channel', key: r => r.channel, name: i => RAW.channel[i] },
  prod: { label: 'Product', key: r => r.prod, name: i => RAW.produk[i].name },
  pay: { label: 'Payment', key: r => r.pay, name: i => RAW.pay[i] },
  disk: { label: 'Discount', key: r => r.disk, name: i => +i ? `${i}% off` : 'No discount' },
  utype: { label: 'Customer type', key: r => r.utype, name: i => UTYPES[i] },
};
const COLS = [['n', 'Orders'], ['rev', 'Sales'], ['aov', 'Per order'], ['late', 'Late'], ['rv', 'Reviews'], ['rating', 'Rating'], ['pos', 'Positive'], ['neg', 'Negative']];
function renderDim() {
  const D = DIMS[state.dim], g = new Map();
  for (const r of cur.rows) { const k = D.key(r); (g.get(k) || g.set(k, []).get(k)).push(r); }
  const list = [...g].map(([k, rows]) => { const a = agg(rows); return { name: D.name(k), n: a.n, rev: a.rev, aov: a.rev / a.n, late: a.late / a.n, rv: a.rv, rating: rating(a), neg: negShare(a), pos: posShare(a) }; });
  const { key, dir } = state.sort;
  list.sort((x, y) => key === 'name' ? dir * x.name.localeCompare(y.name) : dir * ((x[key] ?? -1) - (y[key] ?? -1)));
  const mx = Math.max(1, ...list.map(d => d.n));
  const th = (k, t, r) => `<th${r ? ' class="r"' : ''}${key === k ? ` aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-k="${k}">${t}${key === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`;
  $('#dim-table').innerHTML = `<thead><tr>${th('name', D.label)}${COLS.map((c, i) => th(c[0], c[1], i > 0)).join('')}</tr></thead><tbody>` +
    (list.length ? list.map(d => { const low = d.rv < MIN_N ? ' low-n' : ''; return `<tr><td><b style="font-weight:600">${esc(d.name)}</b></td><td><div class="cellbar"><span>${fInt(d.n)}</span><i style="width:${d.n / mx * 100}%"></i></div></td><td class="r">${fMoney(d.rev)}</td><td class="r">${fMoneyFull(d.aov)}</td><td class="r">${fPct(d.late)}</td><td class="r${low}">${fInt(d.rv)}</td><td class="r${low}">${d.rv ? fDec(d.rating) : '–'}</td><td class="r${low}">${d.rv ? fPct(d.pos) : '–'}</td><td class="r${low}">${d.rv ? fPct(d.neg) : '–'}</td></tr>`; }).join('') : '<tr><td colspan="9" class="empty">No data.</td></tr>') + '</tbody>';
  $('#dim-note').textContent = list.some(d => d.rv < MIN_N) ? `Greyed figures come from fewer than ${MIN_N} reviews; read with care.` : 'Rating, Positive, and Negative are computed from reviewed orders.';
}

/* ── render: delivery ── */
function renderShip() {
  const a = cur.all, g = new Map();
  for (const r of cur.rows) { const d = r.akt - r.est; g.set(d, (g.get(d) || 0) + 1); }
  $('#ship-stats').innerHTML =
    `<div class="stat"><span>Late</span><b>${a.n ? fPct(a.late / a.n) : '–'}</b><small>${fInt(a.late)} of ${fInt(a.n)} orders</small></div>` +
    `<div class="stat"><span>Rating when on time</span><b>${a.onRv ? fDec(a.onSum / a.onRv) : '–'}</b><small>${fInt(a.onRv)} reviews</small></div>` +
    `<div class="stat"><span>Rating when late</span><b>${a.lateRv ? fDec(a.lateSum / a.lateRv) : '–'}</b><small>${fInt(a.lateRv)} reviews</small></div>`;
  const box = $('#shipChart');
  if (!g.size) { box.innerHTML = '<div class="empty">No data.</div>'; return; }
  const ks = [...g.keys()], lo = Math.min(...ks), hi = Math.max(...ks), items = [];
  for (let d = lo; d <= hi; d++) { const n = g.get(d) || 0; items.push({ label: d > 0 ? '+' + d : d < 0 ? '−' + -d : '0', value: n, cls: d > 0 ? 'neg' : 'pos', tip: `<div class="t">${d > 0 ? `${d} day${d > 1 ? 's' : ''} late` : d < 0 ? `${-d} day${d < -1 ? 's' : ''} early` : 'Exactly on estimate'}</div><div class="v">${fInt(n)} orders</div>` + tipRow('Share', fPct(n / a.n)) }); }
  barChart(box, items, { h: 250, bw: 22, m: { b: 46 }, xTitle: 'days vs estimate (− early, + late)', aria: 'Distribution of delivery day difference' });
}

/* ── render: reviews ── */
const PAGE = 8;
function renderReviews() {
  const q = state.q.trim().toLowerCase();
  const list = cur.rows.filter(r => r.rating != null && (state.rvTab < 0 || r.sent === state.rvTab) && (!q || (r.text + ' ' + r.name + ' ' + r.cust + ' ' + RAW.produk[r.prod].name + ' ' + RAW.city[r.city] + ' ' + RAW.channel[r.channel] + ' ' + RAW.topik[r.topik] + ' ' + r.id).toLowerCase().includes(q))).sort((x, y) => y.tglU.localeCompare(x.tglU) || y.id.localeCompare(x.id));
  const pages = Math.max(1, Math.ceil(list.length / PAGE)); state.page = Math.min(state.page, pages - 1);
  const view = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
  $('#rv-sub').textContent = 'Newest first · by review date';
  $('#rv-table').innerHTML = '<thead><tr><th>Date</th><th>User</th><th>Product</th><th>Rating</th><th>Topic</th><th>Sentiment</th><th>Review</th></tr></thead><tbody>' +
    (view.length ? view.map(r => `<tr><td style="white-space:nowrap">${fDate(r.tglU)}</td><td><div class="rv-id">${esc(r.name)}</div><div class="rv-sub">${esc(r.cust)} · ${esc(RAW.city[r.city])} · ${esc(RAW.channel[r.channel])}</div></td><td><div class="rv-id" style="font-weight:500">${esc(RAW.produk[r.prod].name)}</div><div class="rv-sub">${esc(r.id)}</div></td><td><span class="stars" title="${r.rating} of 5"><b>${'★'.repeat(r.rating)}</b>${'★'.repeat(5 - r.rating)}</span></td><td style="white-space:nowrap">${esc(RAW.topik[r.topik])}</td><td><span class="pill ${SENT[r.sent]}">${RAW.sent[r.sent]}</span></td><td><div class="rv-text" title="${esc(r.text)}">${esc(r.text)}</div></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No matching reviews.</td></tr>') + '</tbody>';
  $('#rv-info').textContent = list.length ? `${fInt(state.page * PAGE + 1)}–${fInt(state.page * PAGE + view.length)} of ${fInt(list.length)} reviews` : '0 reviews';
  $('#rv-prev').disabled = state.page === 0; $('#rv-next').disabled = state.page >= pages - 1;
}

/* ── controls ── */
function segmented(id, opts, get, set) {
  const box = $(id);
  box.innerHTML = opts.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('');
  const sync = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v) === String(get())));
  box.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); sync(); });
  sync();
}
const FILTERS = [['#f-period', 'period'], ['#f-prod', 'prod'], ['#f-channel', 'channel'], ['#f-city', 'city']];
const fillSelect = (id, opts) => { $(id).innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join(''); };
function renderAll() {
  compute();
  const a = cur.all;
  $('#scope').innerHTML = `Showing <b>${fInt(a.n)}</b> orders · <b>${fInt(a.cust.size)}</b> users · <b>${fInt(a.rv)}</b> reviews`;
  $('#f-reset').hidden = !(state.period || state.prod >= 0 || state.channel >= 0 || state.city >= 0);
  renderSummary(); renderTrend(); renderSentiment(); renderProducts(); renderInsights(); renderTopics(); renderShip(); renderDim(); renderReviews();
}

/* ── loading ── */
function notice(html) { const n = $('#notice'); n.innerHTML = html; n.hidden = !html; }
function load(json, source) {
  RAW = normalize(json, source);
  ROWS = RAW.rows; NM = RAW.months.length;
  const C = RAW.store.currency;
  try { moneyC = new Intl.NumberFormat('en-US', { style: 'currency', currency: C, notation: 'compact', maximumFractionDigits: 1 }); moneyF = new Intl.NumberFormat('en-US', { style: 'currency', currency: C, maximumFractionDigits: 0 }); }
  catch { moneyC = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }); moneyF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }); }

  PERIODS = [{ label: `${NM} month${NM > 1 ? 's' : ''} · ${mRange(0, NM - 1)}`, a: 0, b: NM - 1 }];
  if (NM > 6) PERIODS.push({ label: `Last 6 months · ${mRange(NM - 6, NM - 1)}`, a: NM - 6, b: NM - 1 });
  if (NM > 3) for (let a = 0; a + 2 < NM; a += 3) PERIODS.push({ label: mRange(a, a + 2), a, b: a + 2 });
  Object.assign(state, { period: 0, prod: -1, channel: -1, city: -1, page: 0, q: '' });
  $('#rv-q').value = '';

  fillSelect('#f-period', PERIODS.map((p, i) => [i, p.label]));
  fillSelect('#f-prod', [[-1, 'All products'], ...RAW.produk.map((p, i) => [i, p.name])]);
  fillSelect('#f-channel', [[-1, 'All channels'], ...RAW.channel.map((k, i) => [i, k])]);
  fillSelect('#f-city', [[-1, 'All cities'], ...RAW.city.map((k, i) => [i, k])]);

  const name = RAW.store.name;
  document.title = `Customer Sentiment · ${name}`;
  $('#brand-name').textContent = name; $('#crumb').textContent = `${name} / Dashboard`; $('#title').textContent = `Customer Sentiment · ${name}`;
  $('#ds-f').textContent = source; $('#ds-u').textContent = fInt(RAW.users); $('#ds-n').textContent = fInt(ROWS.length);
  $('#ds-p').textContent = mRange(0, NM - 1); $('#ds-s').textContent = fInt(RAW.produk.length);
  notice(''); $('#dash').hidden = false;
  renderAll();
}
function loadFile(file) {
  if (!file) return;
  file.text().then(t => load(JSON.parse(t), file.name)).catch(err => notice(`<b>Could not load ${esc(file.name)}.</b> ${esc(err.message)}`));
}

(function init() {
  FILTERS.forEach(([id, key]) => $(id).addEventListener('change', e => { state[key] = +e.target.value; state.page = 0; renderAll(); }));
  $('#f-reset').addEventListener('click', () => { Object.assign(state, { period: 0, prod: -1, channel: -1, city: -1, page: 0 }); $('#f-period').value = 0; $('#f-prod').value = $('#f-channel').value = $('#f-city').value = -1; renderAll(); });

  segmented('#metric-seg', Object.entries(METRICS).map(([k, m]) => [k, m.label]), () => state.metric, v => { state.metric = v; renderTrend(); });
  segmented('#dim-seg', Object.entries(DIMS).map(([k, d]) => [k, d.label]), () => state.dim, v => { state.dim = v; state.sort = { key: 'n', dir: -1 }; renderDim(); });
  segmented('#rv-seg', [[-1, 'All'], [2, 'Negative'], [1, 'Neutral'], [0, 'Positive']], () => state.rvTab, v => { state.rvTab = +v; state.page = 0; renderReviews(); });
  $('#dim-table').addEventListener('click', e => { const b = e.target.closest('th button'); if (!b) return; const k = b.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'name' ? 1 : -1) }; renderDim(); });
  $('#rv-q').addEventListener('input', e => { state.q = e.target.value; state.page = 0; renderReviews(); });
  $('#rv-prev').addEventListener('click', () => { state.page--; renderReviews(); });
  $('#rv-next').addEventListener('click', () => { state.page++; renderReviews(); });
  $('#btn-print').addEventListener('click', () => print());
  $('#btn-theme').addEventListener('click', () => { const d = document.documentElement, dark = d.dataset.theme !== 'dark'; d.dataset.theme = dark ? 'dark' : 'light'; $('#btn-theme span').textContent = dark ? 'Light' : 'Dark'; });
  if (location.hash === '#dark' || (matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)) $('#btn-theme').click();

  // load your own JSON: button or drag & drop anywhere
  $('#btn-load').addEventListener('click', () => $('#file-in').click());
  $('#file-in').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('#drop');
  addEventListener('dragover', e => { e.preventDefault(); drop.hidden = false; });
  drop.addEventListener('dragleave', () => { drop.hidden = true; });
  addEventListener('drop', e => { e.preventDefault(); drop.hidden = true; loadFile(e.dataTransfer.files[0]); });

  const links = [...document.querySelectorAll('.nav a')];
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(l => l.classList.toggle('on', l.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-20% 0px -65% 0px' });
  document.querySelectorAll('main section[id]').forEach(s => io.observe(s));

  let t; addEventListener('resize', () => { if (!cur) return; clearTimeout(t); t = setTimeout(() => { renderTrend(); renderTopics(); renderShip(); }, 120); });

  notice('Loading data…');
  fetch(DATA_URL).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(json => { load(json, DATA_URL.split('/').pop()); if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderTopics); })
    .catch(err => notice(`<b>Could not load <code>${esc(DATA_URL)}</code></b> (${esc(err.message)}). If you opened this page straight from disk, browsers block reading local files: serve the folder (e.g. <code>python -m http.server</code>) or click <b>Load JSON</b> / drop a file here.`));
})();
