/* Regel-Depot – Charts (SVG ohne Bibliothek) und Formatierung */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function mk(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); } if (parent) parent.appendChild(e); return e; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function niceStep(raw) { var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  function linTicks(a, b, n) { var st = niceStep((b - a) / (n || 5)), out = []; for (var v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(Math.round(v / st) * st); return out; }
  function logTicks(a, b) { var out = [], lo = Math.pow(10, a), hi = Math.pow(10, b); for (var k = Math.floor(a); k <= Math.ceil(b); k++) { [1, 2, 5].forEach(function (f) { var v = f * Math.pow(10, k); if (v >= lo && v <= hi) out.push(v); }); } if (out.length < 3) return linTicks(lo, hi, 4).filter(function (v) { return v > 0; }); return out; }

  /* ---------- Formatierung ---------- */
  function de(v, d) { if (v == null || !isFinite(v)) return '–'; return (+v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function eur(v, d) { return de(v, d == null ? 0 : d) + ' €'; }
  function sgnEur(v, d) { if (v == null || !isFinite(v)) return '–'; return (v < -0.005 ? '−' : v > 0.005 ? '+' : '') + de(Math.abs(v), d == null ? 0 : d) + ' €'; }
  function pct(v, d) { if (v == null || !isFinite(v)) return '–'; var x = v * 100; return (x < -0.0001 ? '−' : x > 0.0001 ? '+' : '') + de(Math.abs(x), d == null ? 1 : d) + ' %'; }
  function pctPlain(v, d) { return de(v * 100, d == null ? 1 : d) + ' %'; }
  function dDE(s) { if (!s) return '–'; var p = s.slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function dShort(s) { if (!s) return '–'; var p = s.slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.'; }
  function dtDE(iso) { if (!iso) return '–'; var d = new Date(iso); if (isNaN(d)) return '–'; return d.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  var MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  /* Tooltip-Helfer */
  function tipRow(tip, key, val, label) { var r = el('div', 'r'), i = el('i'); if (key === 'dash') { i.className = 'dash'; i.style.borderTopColor = css('--ink-2'); } else if (key) i.style.borderTopColor = key; else i.className = 'none'; r.appendChild(i); r.appendChild(el('span', null, label)); r.appendChild(el('b', null, val)); tip.appendChild(r); }
  /* Zahl und Einheit in der Anzeige nicht trennen (kein „€“ allein in der nächsten Zeile) */
  function nb(t) { return String(t).replace(/ (€|%|Prozentpunkte)/g, '\u00a0$1'); }
  /* Zeile in der Anzeige: {color, dash, strong, label, val} */
  function lineRow(tip, r) { var d = el('div', 'r' + (r.strong ? ' strong' : '')), i = el('i'); i.style.borderTopColor = r.color; if (r.dash) i.className = 'dash'; if (r.strong) i.style.borderTopWidth = '3px'; d.appendChild(i); d.appendChild(el('span', null, r.label)); d.appendChild(el('b', null, r.val)); tip.appendChild(d); }
  /* ---------- Untereinanderstehende Charts gemeinsam (Justus 26.09.2026, Entwurf A „eine Anzeige“) ----------
     Fährt man über einen Chart der Gruppe, zeigen alle Charts denselben Tag (Linie und Punkte), und eine gemeinsame Anzeige listet die Werte
     aller Charts (Abschnitt je Chart) neben der Linie auf Höhe des Zeigers. box: gemeinsamer Container der Charts. */
  function syncGroup(box) {
    Array.prototype.forEach.call(box.querySelectorAll(':scope > .tip.sync'), function (t) { t.remove(); });
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    var tip = el('div', 'tip sync'), G = { charts: [], cur: null };
    tip.setAttribute('aria-hidden', 'true'); box.appendChild(tip);
    G.add = function (c) { G.charts.push(c); };
    G.show = function (i, src, clientY) {
      G.cur = i;
      G.charts.forEach(function (c) { c.mark(i); });
      var first = G.charts[0];
      tip.textContent = ''; tip.appendChild(el('div', 'd', first.head(i)));
      G.charts.forEach(function (c, k) { var rows = c.rows(i); if (!rows.length) return; if (k > 0) tip.appendChild(el('div', 'g', c.title || '')); rows.forEach(function (r) { lineRow(tip, r); }); });
      var sub = first.sub(i); if (sub) tip.appendChild(el('div', 's', nb(sub)));
      var bx = box.getBoundingClientRect(), hb = src.host.getBoundingClientRect(), x = hb.left - bx.left + src.xPx(i), tw = tip.offsetWidth, th = tip.offsetHeight, bw = box.clientWidth;
      var right = x + 16 + tw <= bw - 4, lft = x - 16 - tw >= 0, py = clientY != null ? clientY - bx.top : hb.top - bx.top + src.topPx() + th / 2;
      var left = right ? x + 16 : lft ? x - 16 - tw : Math.max(0, Math.min(bw - tw, x - tw / 2));
      /* Neben der Linie auf Höhe des Zeigers; passt sie nicht daneben (Handy), über oder unter den Finger statt darauf */
      var top = right || lft ? py - th / 2 : (py < box.clientHeight / 2 ? py + 28 : py - th - 28);
      top = Math.max(0, Math.min(top, box.clientHeight - th));
      tip.style.left = left + 'px'; tip.style.top = top + 'px'; tip.style.opacity = '1';
    };
    G.hide = function () { G.charts.forEach(function (c) { c.unmark(); }); tip.style.opacity = '0'; };
    return G;
  }
  function placeTip(tip, host, svgW, x, top) { var scale = host.clientWidth / svgW, px = x * scale, tw = tip.offsetWidth, left = px + 14; if (left + tw > host.clientWidth - 4) left = px - 14 - tw; if (left < 0) left = 0; tip.style.left = left + 'px'; tip.style.top = (top * scale) + 'px'; tip.style.opacity = '1'; }

  /* ---------- Regel-Chart: Wochenschlüsse, SMA50, Band, investierte Phasen, Signale, Abstandsstreifen ----------
     o: {S, E, rule, color (CSS-Variable), dec, range (Wochen, 0 = alles), name, usd(fn)} */
  function ruleChart(host, o) {
    host.textContent = '';
    var S = o.S, E = o.E, n = S.c.length, rule = o.rule, band = rule.type === 'band', p = band ? rule.p : 0;
    var i0 = o.range ? Math.max(49, n - o.range) : 49, N = n - i0, i;
    if (N < 2) { host.appendChild(el('p', 'small muted', 'Zu wenige Wochen.')); return; }
    var col = { line: css(o.color), sma: css('--ink-2'), grid: css('--grid'), axis: css('--axis'), muted: css('--muted'), ink: css('--ink'), surface: css('--surface'), band: css('--band'), buy: css('--sig-buy'), sell: css('--sig-sell'), neg: css('--neg') };
    var W = Math.max(240, host.clientWidth || 340), narrow = W < 380, ih = o.tall ? Math.max(300, Math.min(420, Math.round(W * 0.38))) : (narrow ? 170 : 200), sh = o.tall ? 72 : 54, gap = 8;
    var m = { t: 10, r: 58, b: 22, l: 4 }, iw = W - m.l - m.r, H = m.t + ih + gap + sh + m.b, st0 = m.t + ih + gap;
    var svg = mk('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, focusable: 'false' }, host);
    var lo = Infinity, hi = -Infinity;
    for (i = i0; i < n; i++) { var vs = [S.c[i], E.sma[i]]; if (band) vs.push(E.sma[i] * (1 + p), E.sma[i] * (1 - p)); vs.forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; }); }
    var useLog = hi / lo > 2.2, ya, yb, Y;
    if (useLog) { ya = Math.log10(lo) - 0.03; yb = Math.log10(hi) + 0.03; Y = function (v) { return m.t + (1 - (Math.log10(v) - ya) / (yb - ya)) * ih; }; }
    else { var pad = (hi - lo) * 0.07; ya = lo - pad; yb = hi + pad; Y = function (v) { return m.t + (1 - (v - ya) / (yb - ya)) * ih; }; }
    function X(k) { return m.l + (k - i0) / (N - 1) * iw; }
    var half = iw / (N - 1) / 2;
    /* investierte Phasen (Serienfarbe, 10 %) */
    var run = i0; for (i = i0 + 1; i <= n; i++) { if (i === n || E.st[i] !== E.st[run]) { if (E.st[run] === 1) { var x1 = Math.max(m.l, X(run) - half), x2 = Math.min(m.l + iw, X(i - 1) + half); mk('rect', { x: x1, y: m.t, width: Math.max(1, x2 - x1), height: ih, fill: col.line, 'fill-opacity': 0.1 }, svg); mk('rect', { x: x1, y: st0, width: Math.max(1, x2 - x1), height: sh, fill: col.line, 'fill-opacity': 0.06 }, svg); } run = i; } }
    var g = mk('g', {}, svg);
    (useLog ? logTicks(ya, yb) : linTicks(ya, yb, 4)).forEach(function (t) { var y = Y(t); if (y < m.t - 0.5 || y > m.t + ih + 0.5) return; mk('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: col.grid, 'stroke-width': 1 }, g); var tx = mk('text', { x: m.l + iw + 6, y: y + 4, 'font-size': 11, fill: col.muted }, g); tx.textContent = de(t, t < 10 ? 1 : 0); });
    mk('line', { x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih, stroke: col.axis, 'stroke-width': 1 }, g);
    /* Band */
    if (band) { var dB = ''; for (i = i0; i < n; i++) dB += (i === i0 ? 'M' : 'L') + X(i).toFixed(1) + ',' + Y(E.sma[i] * (1 + p)).toFixed(1); for (i = n - 1; i >= i0; i--) dB += 'L' + X(i).toFixed(1) + ',' + Y(E.sma[i] * (1 - p)).toFixed(1); mk('path', { d: dB + 'Z', fill: col.band, stroke: 'none' }, svg); }
    var dS = '', dC = ''; for (i = i0; i < n; i++) { dS += (i === i0 ? 'M' : 'L') + X(i).toFixed(1) + ',' + Y(E.sma[i]).toFixed(1); dC += (i === i0 ? 'M' : 'L') + X(i).toFixed(1) + ',' + Y(S.c[i]).toFixed(1); }
    mk('path', { d: dS, fill: 'none', stroke: col.sma, 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'stroke-linejoin': 'round' }, svg);
    mk('path', { d: dC, fill: 'none', stroke: col.line, 'stroke-width': o.thick ? 2.4 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    /* Signale */
    E.sw.forEach(function (s) { if (s.i < i0) return; var x = X(s.i), y = Y(S.c[s.i]), up = s.to === 1, yy = up ? y + 13 : y - 13; var d = up ? 'M' + x + ',' + (yy - 6) + ' L' + (x + 6) + ',' + (yy + 5) + ' L' + (x - 6) + ',' + (yy + 5) + 'Z' : 'M' + x + ',' + (yy + 6) + ' L' + (x + 6) + ',' + (yy - 5) + ' L' + (x - 6) + ',' + (yy - 5) + 'Z'; mk('path', { d: d, fill: up ? col.buy : col.sell, stroke: col.surface, 'stroke-width': 2, 'paint-order': 'stroke' }, svg); });
    mk('circle', { cx: X(n - 1), cy: Y(S.c[n - 1]), r: 4, fill: col.line, stroke: col.surface, 'stroke-width': 2 }, svg);
    if (useLog) { var lg = mk('text', { x: m.l + 4, y: m.t + 11, 'font-size': 10.5, fill: col.muted }, svg); lg.textContent = 'log. Skala'; }
    /* Abstandsstreifen: Abstand zum SMA50 in Prozent, mit Schwelle */
    var dmax = 0.02; for (i = i0; i < n; i++) dmax = Math.max(dmax, Math.abs(S.c[i] / E.sma[i] - 1));
    dmax = Math.min(Math.max(dmax * 1.1, band ? p * 1.6 : 0.03), 1.5);
    function YS(v) { return st0 + sh / 2 - (v / dmax) * (sh / 2); }
    var dA = 'M' + X(i0).toFixed(1) + ',' + YS(0).toFixed(1); for (i = i0; i < n; i++) dA += 'L' + X(i).toFixed(1) + ',' + YS(Math.max(-dmax, Math.min(dmax, S.c[i] / E.sma[i] - 1))).toFixed(1); dA += 'L' + X(n - 1).toFixed(1) + ',' + YS(0).toFixed(1) + 'Z';
    var clipId = 'cp' + Math.random().toString(36).slice(2, 8);
    var defs = mk('defs', {}, svg), cpP = mk('clipPath', { id: clipId + 'p' }, defs); mk('rect', { x: m.l, y: st0, width: iw, height: sh / 2 }, cpP); var cpN = mk('clipPath', { id: clipId + 'n' }, defs); mk('rect', { x: m.l, y: st0 + sh / 2, width: iw, height: sh / 2 }, cpN);
    mk('path', { d: dA, fill: col.line, 'fill-opacity': 0.35, 'clip-path': 'url(#' + clipId + 'p)' }, svg);
    mk('path', { d: dA, fill: col.neg, 'fill-opacity': 0.35, 'clip-path': 'url(#' + clipId + 'n)' }, svg);
    mk('line', { x1: m.l, x2: m.l + iw, y1: YS(0), y2: YS(0), stroke: col.axis, 'stroke-width': 1 }, svg);
    if (band) { [p, -p].forEach(function (v) { mk('line', { x1: m.l, x2: m.l + iw, y1: YS(v), y2: YS(v), stroke: col.sma, 'stroke-width': 1, 'stroke-dasharray': '3 3' }, svg); }); }
    var lv = band && (YS(0) - YS(p)) >= 11 ? p : dmax * 0.7;
    var l1 = mk('text', { x: m.l + iw + 6, y: YS(lv) + 4, 'font-size': 10.5, fill: col.muted }, svg); l1.textContent = '+' + de(lv * 100, 0) + ' %';
    var l2 = mk('text', { x: m.l + iw + 6, y: YS(-lv) + 4, 'font-size': 10.5, fill: col.muted }, svg); l2.textContent = '−' + de(lv * 100, 0) + ' %';
    var l0 = mk('text', { x: m.l + iw + 6, y: YS(0) + 4, 'font-size': 10.5, fill: col.muted }, svg); l0.textContent = 'SMA';
    /* x-Achse */
    var ticks = [], prev = null;
    for (i = i0; i < n; i++) { var d = S.d[i], yr = d.slice(0, 4), mo = +d.slice(5, 7);
      if (N > 110) { if (prev !== yr) { if (prev !== null) ticks.push({ i: i, l: yr }); prev = yr; } }
      else { var q = yr + '-' + Math.floor((mo - 1) / 3); if (prev !== q) { if (prev !== null) ticks.push({ i: i, l: ['Jan', 'Apr', 'Jul', 'Okt'][Math.floor((mo - 1) / 3)] + ' ' + yr.slice(2) }); prev = q; } } }
    var maxT = Math.max(2, Math.floor(iw / 58)); if (ticks.length > maxT) { var stp = Math.ceil(ticks.length / maxT); ticks = ticks.filter(function (t, k) { return k % stp === 0; }); }
    mk('line', { x1: m.l, x2: m.l + iw, y1: st0 + sh, y2: st0 + sh, stroke: col.axis, 'stroke-width': 1 }, g);
    ticks.forEach(function (t) { var x = X(t.i); mk('line', { x1: x, x2: x, y1: st0 + sh, y2: st0 + sh + 4, stroke: col.axis }, g); var tx = mk('text', { x: x, y: st0 + sh + 16, 'text-anchor': 'middle', 'font-size': 11, fill: col.muted }, g); tx.textContent = t.l; });
    host.setAttribute('aria-label', o.name + ': Wochenschlüsse und SMA50, zuletzt ' + o.usd(S.c[n - 1]) + ', SMA50 ' + o.usd(E.sma[n - 1]) + ', Regel ' + (E.st[n - 1] === 1 ? 'investiert' : 'in Cash'));
    /* Hover und Tastatur */
    var cross = mk('line', { y1: m.t, y2: st0 + sh, stroke: col.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
    var dotC = mk('circle', { r: 4, fill: col.line, stroke: col.surface, 'stroke-width': 2, visibility: 'hidden' }, svg);
    var dotS = mk('circle', { r: 3.5, fill: col.sma, stroke: col.surface, 'stroke-width': 2, visibility: 'hidden' }, svg);
    var tip = el('div', 'tip'); tip.setAttribute('aria-hidden', 'true'); host.appendChild(tip);
    var hit = mk('rect', { x: m.l, y: m.t, width: iw, height: st0 + sh - m.t, fill: 'transparent' }, svg), cur = n - 1;
    function show(k) {
      if (k < i0 || k >= n) return; cur = k; var x = X(k);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dotC.setAttribute('cx', x); dotC.setAttribute('cy', Y(S.c[k])); dotC.setAttribute('visibility', 'visible');
      dotS.setAttribute('cx', x); dotS.setAttribute('cy', Y(E.sma[k])); dotS.setAttribute('visibility', 'visible');
      tip.textContent = ''; tip.appendChild(el('div', 'd', 'Wochenschluss ' + dDE(S.d[k])));
      tipRow(tip, col.line, o.usd(S.c[k]), 'Kurs'); tipRow(tip, 'dash', o.usd(E.sma[k]), 'SMA50'); tipRow(tip, null, pct(S.c[k] / E.sma[k] - 1, 1), 'Abstand');
      if (band) { tipRow(tip, null, o.usd(E.sma[k] * (1 + p)), 'Einstieg über'); tipRow(tip, null, o.usd(E.sma[k] * (1 - p)), 'Ausstieg unter'); }
      var sEl = el('div', 's'); sEl.textContent = (E.st[k] === 1 ? 'Regel investiert' : 'Regel in Cash') + (rule.type === 'confirm' ? ' · ' + (E.up[k] > 0 ? E.up[k] + '. Schluss über SMA50' : E.dn[k] > 0 ? E.dn[k] + '. Schluss unter SMA50' : 'auf SMA50') : ''); tip.appendChild(sEl);
      var sw = E.sw.filter(function (s) { return s.i === k; })[0]; if (sw) { var sg = el('div', 's'); sg.style.fontWeight = '600'; sg.style.color = sw.to ? css('--good') : css('--bad'); sg.textContent = (sw.to ? '▲ Kaufsignal' : '▼ Verkaufssignal') + ', Handel am ' + dShort(ENG.addDays(S.k[k], 7)); tip.appendChild(sg); }
      placeTip(tip, host, W, x, m.t);
    }
    function hide() { [cross, dotC, dotS].forEach(function (e) { e.setAttribute('visibility', 'hidden'); }); tip.style.opacity = '0'; }
    function idx(evt) { var rc = svg.getBoundingClientRect(), sx = (evt.clientX - rc.left) * (W / rc.width); var t = Math.round((sx - m.l) / iw * (N - 1)); return Math.max(i0, Math.min(n - 1, i0 + t)); }
    hit.addEventListener('pointermove', function (e) { show(idx(e)); }); hit.addEventListener('pointerdown', function (e) { show(idx(e)); }); hit.addEventListener('pointerleave', hide);
    host.tabIndex = 0;
    host.onkeydown = function (e) { if (e.key === 'ArrowRight') { show(Math.min(n - 1, cur + 1)); e.preventDefault(); } else if (e.key === 'ArrowLeft') { show(Math.max(i0, cur - 1)); e.preventDefault(); } else if (e.key === 'Escape') hide(); };
    host.onfocus = function () { show(cur); }; host.onblur = hide;
  }

  /* ---------- Kreisdiagramm ---------- */
  function arcPath(cx, cy, r0, r1, a0, a1) {
    function pt(r, a) { return (cx + r * Math.sin(a)).toFixed(2) + ',' + (cy - r * Math.cos(a)).toFixed(2); }
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + pt(r1, a0) + ' A' + r1 + ',' + r1 + ' 0 ' + large + ' 1 ' + pt(r1, a1) + ' L' + pt(r0, a1) + ' A' + r0 + ',' + r0 + ' 0 ' + large + ' 0 ' + pt(r0, a0) + ' Z';
  }
  function donut(title, sub, parts, total) {
    var fig = el('figure', 'donut'), cx = 110, cy = 110, r1 = 82, r0 = 54;
    var tot = parts.reduce(function (s, q) { return s + q.v; }, 0);
    var shown = parts.filter(function (q) { return tot > 0 && q.v / tot >= 0.0005; });
    var svg = mk('svg', { viewBox: '0 0 220 220', role: 'img', 'aria-label': title + ': ' + shown.map(function (q) { return q.label + ' ' + pctPlain(q.v / tot, 1); }).join(', ') }, fig);
    var tip = el('div', 'tip'); tip.setAttribute('aria-hidden', 'true'); fig.appendChild(tip);
    function showTip(q, e) { tip.textContent = ''; tip.appendChild(el('div', 'd', title)); var r = el('div', 'r'), k = el('i'); k.style.borderTopColor = 'var(' + q.color + ')'; k.style.borderTopWidth = '8px'; r.appendChild(k); r.appendChild(el('span', null, q.label)); r.appendChild(el('b', null, eur(q.v) + ' · ' + pctPlain(q.v / tot, 1))); tip.appendChild(r); if (q.note) tip.appendChild(el('div', 's', q.note));
      tip.style.opacity = '1'; var bx = fig.getBoundingClientRect(), x = e.clientX - bx.left, y = e.clientY - bx.top, tw = tip.offsetWidth; var left = x + 12; if (left + tw > fig.clientWidth) left = Math.max(0, x - 12 - tw); tip.style.left = left + 'px'; tip.style.top = Math.max(0, y - 10) + 'px'; }
    function hideTip() { tip.style.opacity = '0'; }
    var surface = css('--surface');
    if (shown.length === 1) { var q0 = shown[0], ring = mk('circle', { cx: cx, cy: cy, r: (r0 + r1) / 2, fill: 'none', stroke: 'var(' + q0.color + ')', 'stroke-width': r1 - r0 }, svg); ring.addEventListener('pointermove', function (e) { showTip(q0, e); }); ring.addEventListener('pointerleave', hideTip); }
    else { var a = 0; shown.forEach(function (q) { var da = q.v / tot * 2 * Math.PI, a0 = a, a1 = a + da; a = a1;
      var path = mk('path', { d: arcPath(cx, cy, r0, r1, a0, a1), fill: 'var(' + q.color + ')', stroke: surface, 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
      path.addEventListener('pointermove', function (e) { showTip(q, e); }); path.addEventListener('pointerleave', hideTip);
      if (q.v / tot >= 0.05) { var mid = (a0 + a1) / 2, s = Math.sin(mid), c = Math.cos(mid), rr = r1 + 13, anchor = s > 0.35 ? 'start' : s < -0.35 ? 'end' : 'middle';
        var tx = mk('text', { x: (cx + rr * s).toFixed(1), y: (cy - rr * c + 4).toFixed(1), 'text-anchor': anchor, 'font-size': 14, fill: css('--ink-2') }, svg); tx.textContent = pctPlain(q.v / tot, 0); } }); }
    var t1 = mk('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', 'font-size': 14, fill: css('--muted') }, svg); t1.textContent = title;
    var t2 = mk('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 600, fill: css('--ink') }, svg); t2.textContent = eur(total);
    var cap = el('figcaption'); cap.appendChild(el('b', null, title)); if (sub) cap.appendChild(document.createTextNode(' · ' + sub)); fig.appendChild(cap);
    return fig;
  }

  /* ---------- Portfolio-Chart: Gesamtdepot und Bausteine je Woche ----------
     pts: [{k, d, total, gainTotal, parts:{a:{val, cash, interest, gain, cost}}}], mode 'wert'|'gewinn',
     series: [{key:'total'|a, label, colorVar}] */
  /* Depotverlauf in Euro. mode: 'gewinn' oder 'wert'. series: [{key, label, colorVar}], key 'total' = Gesamtdepot.
     opts: {height} (Höhe in px), {legend:false} (keine Legende schreiben) */
  function portfolioChart(host, leg, cap, pts, mode, series, capText, opts) {
    opts = opts || {};
    host.textContent = ''; if (leg && opts.legend !== false) leg.textContent = ''; if (cap) cap.textContent = '';
    if (!pts || pts.length < 2) { host.appendChild(el('p', 'small muted', 'Für einen Verlauf fehlen noch Wochen mit Positionen.')); return; }
    var n = pts.length;
    var col = { grid: css('--grid'), axis: css('--axis'), muted: css('--muted'), ink: css('--ink'), surface: css('--surface') };
    function val(s, q) { if (s.key === 'total') return mode === 'wert' ? q.total : q.gainTotal; var pt = q.parts[s.key]; if (!pt) return null; return mode === 'wert' ? pt.val + pt.cash : pt.gain; }
    if (leg && opts.legend !== false) series.forEach(function (s) { var sp = el('span'), i = el('i'); i.style.borderTopColor = s.colorVar ? 'var(' + s.colorVar + ')' : col.ink; if (s.key === 'total') i.style.borderTopWidth = '3px'; sp.appendChild(i); sp.appendChild(document.createTextNode(s.label)); leg.appendChild(sp); });
    var W = Math.max(300, host.clientWidth || 700), narrow = W < 560, H = opts.height || (narrow ? 240 : 300);
    var m = { t: 14, r: narrow ? 74 : 92, b: 30, l: narrow ? 66 : 80 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var svg = mk('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, focusable: 'false' }, host);
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (q) { series.forEach(function (s) { var v = val(s, q); if (v == null) return; if (v < lo) lo = v; if (v > hi) hi = v; }); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (mode === 'gewinn') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); } else lo = Math.min(lo, 0);
    var pad = (hi - lo) * 0.08 || Math.max(10, Math.abs(hi) * 0.05); lo -= (mode === 'gewinn' ? pad : 0); hi += pad;
    function X(i) { return m.l + (n <= 1 ? 0 : i / (n - 1)) * iw; }
    function Y(v) { return m.t + (1 - (v - lo) / (hi - lo)) * ih; }
    function money(v) { return (v < -0.5 ? '−' : (mode === 'gewinn' && v > 0.5 ? '+' : '')) + de(Math.abs(v), 0) + ' €'; }
    var g = mk('g', {}, svg);
    linTicks(lo, hi, 5).forEach(function (t) { var y = Y(t); if (y < m.t - 0.5 || y > m.t + ih + 0.5) return; mk('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: col.grid, 'stroke-width': 1 }, g); var tx = mk('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: col.muted }, g); tx.textContent = money(t); });
    mk('line', { x1: m.l, x2: m.l + iw, y1: Y(mode === 'gewinn' ? 0 : lo), y2: Y(mode === 'gewinn' ? 0 : lo), stroke: col.axis, 'stroke-width': 1 }, g);
    var daily = n > 1 && ENG.daysBetween(pts[0].k, pts[1].k) === 1, prevM = null, tks = [];
    if (daily) { var step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(iw / 70)))); pts.forEach(function (q, i) { if ((n - 1 - i) % step === 0) tks.push({ i: i, l: dShort(q.d) }); }); }
    else { pts.forEach(function (q, i) { var ymd = ENG.addDays(q.k, 4).slice(0, 7); if (prevM !== null && ymd !== prevM) tks.push({ i: i, l: MON[+ymd.slice(5) - 1] + (ymd.slice(5) === '01' ? ' ' + ymd.slice(2, 4) : '') }); prevM = ymd; }); if (tks.length > 8) { var st = Math.ceil(tks.length / 7); tks = tks.filter(function (t, k) { return k % st === 0; }); } }
    tks.forEach(function (t) { var x = X(t.i); mk('line', { x1: x, x2: x, y1: m.t + ih, y2: m.t + ih + 4, stroke: col.axis }, g); var tx = mk('text', { x: x, y: m.t + ih + 18, 'text-anchor': 'middle', 'font-size': 11, fill: col.muted }, g); tx.textContent = t.l; });
    var ends = [];
    /* Gesamtlinie zuerst zeichnen (liegt unten), damit ein Baustein sichtbar bleibt, wo er allein das Depot ausmacht */
    series.slice().sort(function (a, b) { return (a.key === 'total' ? 0 : 1) - (b.key === 'total' ? 0 : 1); }).forEach(function (s) {
      var d = '', started = false, last = null, color = s.colorVar ? css(s.colorVar) : col.ink;
      pts.forEach(function (q, i) { var v = val(s, q); if (v == null) { started = false; return; } d += (started ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); started = true; last = { i: i, v: v }; });
      if (!d) return;
      mk('path', { d: d, fill: 'none', stroke: color, 'stroke-width': s.key === 'total' ? 2.5 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: s.key === 'total' ? 1 : 0.95 }, svg);
      if (last) { mk('circle', { cx: X(last.i), cy: Y(last.v), r: s.key === 'total' ? 4.5 : 3.5, fill: color, stroke: col.surface, 'stroke-width': 2 }, svg); ends.push({ y: Y(last.v), v: last.v, s: s, color: color }); }
    });
    /* Endwerte beschriften, ohne Überlappung (mindestens 14 px Abstand, Gesamt zuerst) */
    ends.sort(function (a, b) { return (a.s.key === 'total' ? -1 : 1) - (b.s.key === 'total' ? -1 : 1); });
    var used = [];
    ends.forEach(function (e) { var y = e.y; if (used.some(function (u) { return Math.abs(u - y) < 14; })) return; used.push(y); var t = mk('text', { x: m.l + iw + 8, y: y + 4, 'font-size': e.s.key === 'total' ? 11.5 : 10.5, fill: e.s.key === 'total' ? col.ink : css('--ink-2'), 'font-weight': e.s.key === 'total' ? 600 : 400 }, svg); t.textContent = money(e.v); });
    /* Hover und Tastatur; mit opts.sync zeigen alle Charts der Gruppe denselben Tag, die Werte stehen in der gemeinsamen Anzeige */
    var cross = mk('line', { y1: m.t, y2: m.t + ih, stroke: col.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
    var dots = series.map(function (s) { return mk('circle', { r: 3.5, fill: s.colorVar ? css(s.colorVar) : col.ink, stroke: col.surface, 'stroke-width': 2, visibility: 'hidden' }, svg); });
    var tip = el('div', 'tip'); tip.setAttribute('aria-hidden', 'true'); host.appendChild(tip);
    var hit = mk('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg), cur = n - 1, S = opts.sync || null;
    function head(i) { return (i === n - 1 ? 'Stand ' : daily ? 'Tag ' : 'Wochenschluss ') + dDE(pts[i].d); }
    function mark(i) { var q = pts[i], x = X(i); cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible'); series.forEach(function (s, si) { var v = val(s, q); if (v == null) { dots[si].setAttribute('visibility', 'hidden'); return; } dots[si].setAttribute('cx', x); dots[si].setAttribute('cy', Y(v)); dots[si].setAttribute('visibility', 'visible'); }); }
    function unmark() { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); }
    function rows(i) { var q = pts[i]; return series.map(function (s) { var v = val(s, q); return v == null ? null : { color: s.colorVar ? css(s.colorVar) : col.ink, label: s.label, val: mode === 'gewinn' ? sgnEur(v) : eur(v), strong: s.key === 'total' }; }).filter(Boolean); }
    function sub(i) {
      var q = pts[i];
      if (series.length === 1 && series[0].key !== 'total') { var pt = q.parts[series[0].key]; return pt ? 'Position ' + eur(pt.val) + ' · Cash ' + eur(pt.cash) + (pt.interest > 0.5 ? ' · davon Zinsen ' + eur(pt.interest) : '') + (mode === 'wert' ? ' · Gewinn ' + sgnEur(pt.gain) : ' · Wert ' + eur(pt.val + pt.cash)) : ''; }
      var cashT = 0, intT = 0, valT = 0; Object.keys(q.parts).forEach(function (a) { cashT += q.parts[a].cash; intT += q.parts[a].interest; valT += q.parts[a].val; });
      return 'Positionen ' + eur(valT) + ' · Cash ' + eur(cashT) + (intT > 0.5 ? ' · davon Zinsen ' + eur(intT) : '') + (mode === 'wert' ? ' · Gewinn ' + sgnEur(q.gainTotal) : ' · Wert ' + eur(q.total));
    }
    function show(i) { if (i < 0 || i >= n) return; cur = i; mark(i); tip.textContent = ''; tip.appendChild(el('div', 'd', head(i))); rows(i).forEach(function (r) { lineRow(tip, r); }); var t = sub(i); if (t) tip.appendChild(el('div', 's', nb(t))); placeTip(tip, host, W, X(i), m.t); }
    function hide() { unmark(); tip.style.opacity = '0'; }
    var api = { host: host, title: opts.title || '', head: head, sub: sub, mark: mark, unmark: unmark, rows: rows, xPx: function (i) { return X(i) * host.clientWidth / W; }, topPx: function () { return m.t * host.clientWidth / W; } };
    if (S) S.add(api);
    function go(i, y) { if (i < 0 || i >= n) return; cur = i; if (S) S.show(i, api, y); else show(i); }
    function stop() { if (S) S.hide(); else hide(); }
    function at() { return S && S.cur != null ? S.cur : cur; }
    function idx(e) { var bx = svg.getBoundingClientRect(), x = (e.clientX - bx.left) * W / bx.width; return Math.max(0, Math.min(n - 1, Math.round((x - m.l) / (iw / Math.max(1, n - 1))))); }
    hit.addEventListener('pointermove', function (e) { go(idx(e), e.clientY); }); hit.addEventListener('pointerdown', function (e) { go(idx(e), e.clientY); }); hit.addEventListener('pointerleave', stop);
    host.tabIndex = 0; host.onkeydown = function (e) { if (e.key === 'ArrowRight') { go(Math.min(n - 1, at() + 1)); e.preventDefault(); } else if (e.key === 'ArrowLeft') { go(Math.max(0, at() - 1)); e.preventDefault(); } else if (e.key === 'Escape') stop(); }; host.onfocus = function () { go(at()); }; host.onblur = stop;
    var last = pts[n - 1];
    host.setAttribute('aria-label', (series.length === 1 ? series[0].label : 'Bausteine') + ': ' + (mode === 'wert' ? 'Wert, zuletzt ' + eur(val(series[0], last) || 0) : 'Gewinn, zuletzt ' + sgnEur(val(series[0], last) || 0)));
    if (cap) cap.textContent = capText || '';
  }
  /* Zwei Charts untereinander: oben das Gesamtdepot, darunter die drei Bausteine gemeinsam (eigene Euro-Skala, damit ihre Bewegung erkennbar bleibt) */
  function portfolioSplit(host, leg, cap, pts, mode, series, capText) {
    host.textContent = ''; if (leg) leg.textContent = ''; if (cap) cap.textContent = '';
    if (!pts || pts.length < 2) { host.appendChild(el('p', 'small muted', 'Für einen Verlauf fehlen noch Wochen mit Positionen.')); return; }
    var total = series.filter(function (s) { return s.key === 'total'; }), parts = series.filter(function (s) { return s.key !== 'total'; });
    var wrap = el('div', 'splitcharts'); host.appendChild(wrap);
    var G = syncGroup(wrap);
    function block(title, ser, height) { var b = el('div', 'splitbox'); b.appendChild(el('p', 'subhd', title)); var ch = el('div', 'chart'); b.appendChild(ch); wrap.appendChild(b); portfolioChart(ch, null, null, pts, mode, ser, '', { height: height, legend: false, sync: G, title: title }); }
    var narrow = (host.clientWidth || 700) < 560;
    block('Depot gesamt', total, narrow ? 200 : 230);
    block('Bausteine', parts, narrow ? 220 : 260);
    if (leg) series.forEach(function (s) { var sp = el('span'), i = el('i'); i.style.borderTopColor = s.colorVar ? 'var(' + s.colorVar + ')' : css('--ink'); if (s.key === 'total') i.style.borderTopWidth = '3px'; sp.appendChild(i); sp.appendChild(document.createTextNode(s.label)); leg.appendChild(sp); });
    if (cap) cap.textContent = capText || '';
  }
  /* ---------- Prozent-Linien über Tagen (Vergleich mit Buy & Hold, Drawdown) ----------
     dates: [ISO], lines: [{vals (Anteile, 0,05 = +5 %), color (CSS-Variable), dash, width, label, fill (CSS-Variable: Fläche bis 0)}],
     opts: {height, dd (Skala bis 0 %), ends (Endwerte rechts beschriften), sub(i) (Zeile unter den Werten im Tooltip), aria} */
  function pctChart(host, dates, lines, opts) {
    opts = opts || {}; host.textContent = '';
    var n = dates.length; if (n < 2) return;
    var col = { grid: css('--grid'), axis: css('--axis'), muted: css('--muted'), ink: css('--ink'), surface: css('--surface') };
    var W = Math.max(300, host.clientWidth || 700), narrow = W < 560, H = opts.height || (narrow ? 220 : 260);
    var m = { t: 12, r: opts.ends ? (narrow ? 62 : 74) : 14, b: 28, l: narrow ? 50 : 58 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var svg = mk('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, focusable: 'false' }, host);
    var lo = Infinity, hi = -Infinity;
    lines.forEach(function (L) { L.vals.forEach(function (v) { if (v == null || !isFinite(v)) return; if (v < lo) lo = v; if (v > hi) hi = v; }); });
    if (!isFinite(lo)) { lo = 0; hi = 0; }
    if (opts.dd) { lo = Math.min(lo, -0.01); lo -= -lo * 0.08; hi = -lo * 0.04; }
    else { lo = Math.min(lo, 0); hi = Math.max(hi, 0); if (hi - lo < 0.01) { var mid = (hi + lo) / 2; lo = Math.min(lo, mid - 0.005); hi = Math.max(hi, mid + 0.005); } var pad = (hi - lo) * 0.08; lo -= pad; hi += pad; }
    function X(i) { return m.l + i / (n - 1) * iw; }
    function Y(v) { return m.t + (1 - (v - lo) / (hi - lo)) * ih; }
    /* Nachkommastellen nach der Schrittweite: 2 % → „−2 %“, 2,5 % → „−2,5 %“, 0,25 % → „−0,25 %“ */
    var ticks = linTicks(lo, hi, opts.dd ? 3 : 5), stp = ticks.length > 1 ? ticks[1] - ticks[0] : 0.01, sp = stp * 100;
    var dec = Math.abs(sp - Math.round(sp)) < 1e-9 ? 0 : Math.abs(sp * 10 - Math.round(sp * 10)) < 1e-9 ? 1 : 2;
    function tl(v) { var x = Math.round(v * 1e6) / 1e6; return (x < 0 ? '−' : x > 0 ? '+' : '') + de(Math.abs(x) * 100, dec) + ' %'; }
    var g = mk('g', {}, svg);
    ticks.forEach(function (t) { var y = Y(t); if (y < m.t - 0.5 || y > m.t + ih + 0.5) return; mk('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: col.grid, 'stroke-width': 1 }, g); var tx = mk('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: col.muted }, g); tx.textContent = tl(t); });
    mk('line', { x1: m.l, x2: m.l + iw, y1: Y(0), y2: Y(0), stroke: col.axis, 'stroke-width': 1 }, g);
    /* x-Achse: bis gut drei Monate Tage (ab dem Start), danach Monatsanfänge */
    var tks = [];
    if (n <= 95) { var step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64)))); for (var i = 0; i < n; i += step) tks.push({ i: i, l: dShort(dates[i]) }); }
    else { var prevM = null; dates.forEach(function (d, k) { var ym = d.slice(0, 7); if (prevM !== null && ym !== prevM) tks.push({ i: k, l: MON[+d.slice(5, 7) - 1] + (d.slice(5, 7) === '01' ? ' ' + d.slice(2, 4) : '') }); prevM = ym; }); var maxT = Math.max(2, Math.floor(iw / 56)); if (tks.length > maxT) { var st = Math.ceil(tks.length / maxT); tks = tks.filter(function (t, k) { return k % st === 0; }); } }
    tks.forEach(function (t) { var x = X(t.i); mk('line', { x1: x, x2: x, y1: m.t + ih, y2: m.t + ih + 4, stroke: col.axis }, g); var tx = mk('text', { x: x, y: m.t + ih + 18, 'text-anchor': t.i === 0 && n > 2 ? 'start' : 'middle', 'font-size': 11, fill: col.muted }, g); tx.textContent = t.l; });
    /* Flächen zuerst, dann die Linien; die erste Linie liegt oben */
    lines.forEach(function (L) { if (!L.fill) return; var d = 'M' + X(0).toFixed(1) + ',' + Y(0).toFixed(1); L.vals.forEach(function (v, k) { d += 'L' + X(k).toFixed(1) + ',' + Y(v == null ? 0 : v).toFixed(1); }); d += 'L' + X(n - 1).toFixed(1) + ',' + Y(0).toFixed(1) + 'Z'; mk('path', { d: d, fill: css(L.fill), 'fill-opacity': 0.12, stroke: 'none' }, svg); });
    var ends = [];
    lines.slice().reverse().forEach(function (L) {
      var d = '', started = false, color = css(L.color);
      L.vals.forEach(function (v, k) { if (v == null || !isFinite(v)) { started = false; return; } d += (started ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(v).toFixed(1); started = true; });
      if (!d) return;
      mk('path', { d: d, fill: 'none', stroke: color, 'stroke-width': L.width || 2, 'stroke-dasharray': L.dash ? '6 4' : null, 'stroke-linejoin': 'round', 'stroke-linecap': L.dash ? 'butt' : 'round' }, svg);
      var lv = L.vals[n - 1]; if (lv != null && isFinite(lv)) { mk('circle', { cx: X(n - 1), cy: Y(lv), r: L.dash ? 3.5 : 4.5, fill: color, stroke: col.surface, 'stroke-width': 2 }, svg); ends.push({ y: Y(lv), v: lv, L: L, color: color }); }
    });
    if (opts.ends) {
      /* Endwerte ohne Überlappung (mindestens 14 px Abstand, erste Linie zuerst) */
      ends.reverse(); var used = [];
      ends.forEach(function (e) { var y = e.y; while (used.some(function (u) { return Math.abs(u - y) < 14; })) y += (e.y >= used[0] ? 14 : -14); used.push(y); var t = mk('text', { x: m.l + iw + 8, y: y + 4, 'font-size': 11.5, fill: e.color, 'font-weight': e.L.dash ? 400 : 600 }, svg); t.textContent = pct(e.v, 1); });
    }
    /* Hover und Tastatur; mit opts.sync zeigen alle Charts der Gruppe denselben Tag, die Werte stehen in der gemeinsamen Anzeige */
    var cross = mk('line', { y1: m.t, y2: m.t + ih, stroke: col.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
    var dots = lines.map(function (L) { return mk('circle', { r: 3.5, fill: css(L.color), stroke: col.surface, 'stroke-width': 2, visibility: 'hidden' }, svg); });
    var tip = el('div', 'tip'); tip.setAttribute('aria-hidden', 'true'); host.appendChild(tip);
    var hit = mk('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg), cur = n - 1, S = opts.sync || null;
    function head(k) { return (k === n - 1 ? 'Stand ' : 'Tag ') + dDE(dates[k]); }
    function sub(k) { return opts.sub ? opts.sub(k) : ''; }
    function mark(k) { var x = X(k); cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible'); lines.forEach(function (L, li) { var v = L.vals[k]; if (v == null || !isFinite(v)) { dots[li].setAttribute('visibility', 'hidden'); return; } dots[li].setAttribute('cx', x); dots[li].setAttribute('cy', Y(v)); dots[li].setAttribute('visibility', 'visible'); }); }
    function unmark() { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); }
    function rows(k) { return lines.map(function (L) { var v = L.vals[k]; return v == null || !isFinite(v) ? null : { color: css(L.color), dash: L.dash, label: L.label, val: pct(v, 1) }; }).filter(Boolean); }
    function show(k) { if (k < 0 || k >= n) return; cur = k; mark(k); tip.textContent = ''; tip.appendChild(el('div', 'd', head(k))); rows(k).forEach(function (r) { lineRow(tip, r); }); var t = sub(k); if (t) tip.appendChild(el('div', 's', nb(t))); placeTip(tip, host, W, X(k), m.t); }
    function hide() { unmark(); tip.style.opacity = '0'; }
    var api = { host: host, title: opts.title || '', head: head, sub: sub, mark: mark, unmark: unmark, rows: rows, xPx: function (k) { return X(k) * host.clientWidth / W; }, topPx: function () { return m.t * host.clientWidth / W; } };
    if (S) S.add(api);
    function go(k, y) { if (k < 0 || k >= n) return; cur = k; if (S) S.show(k, api, y); else show(k); }
    function stop() { if (S) S.hide(); else hide(); }
    function at() { return S && S.cur != null ? S.cur : cur; }
    function idx(e) { var bx = svg.getBoundingClientRect(), x = (e.clientX - bx.left) * W / bx.width; return Math.max(0, Math.min(n - 1, Math.round((x - m.l) / (iw / (n - 1))))); }
    hit.addEventListener('pointermove', function (e) { go(idx(e), e.clientY); }); hit.addEventListener('pointerdown', function (e) { go(idx(e), e.clientY); }); hit.addEventListener('pointerleave', stop);
    host.tabIndex = 0; host.onkeydown = function (e) { if (e.key === 'ArrowRight') { go(Math.min(n - 1, at() + 1)); e.preventDefault(); } else if (e.key === 'ArrowLeft') { go(Math.max(0, at() - 1)); e.preventDefault(); } else if (e.key === 'Escape') stop(); }; host.onfocus = function () { go(at()); }; host.onblur = stop;
    if (opts.aria) host.setAttribute('aria-label', opts.aria);
  }
  root.CH = { ruleChart: ruleChart, donut: donut, portfolioChart: portfolioChart, portfolioSplit: portfolioSplit, pctChart: pctChart, syncGroup: syncGroup, mk: mk, el: el, css: css };
  root.FMT = { de: de, eur: eur, sgnEur: sgnEur, pct: pct, pctPlain: pctPlain, dDE: dDE, dShort: dShort, dtDE: dtDE, MON: MON };
})(window);
