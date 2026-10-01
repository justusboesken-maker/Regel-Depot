/* Reine Regel im Vergleich und Gründe für den Abstand (Justus 28.09.2026). Start: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ENG = require('../docs/js/engine.js');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' ≠ ' + b);
const W = { ftse: 0.5, btc: 0.3, gold: 0.2 };
const K = ['ftse', 'btc', 'gold'];

test('Regel pur: Start 50/30/20 nach Regelstand, Verkauf und Kauf zum Schlusskurs des Signals', () => {
  const px = { ftse: [100, 110, 110, 121, 121], btc: [1000, 1000, 800, 800, 1000], gold: [10, 10, 10, 11, 11] };
  const r = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 1, gold: 0 }, sw: { btc: [{ i: 2, to: 0 }], gold: [{ i: 3, to: 1 }] }, flows: [0, 0, 0, 0, 0], reb: [], rc: [] });
  [1000, 1050, 990, 1045, 1045].forEach((v, i) => close(r.vals[i], v));
  [1, 1.05, 0.99, 1.045, 1.045].forEach((v, i) => close(r.idx[i], v));
  assert.deepEqual(r.b.btc.inv, [1, 1, 0, 0, 0]); assert.deepEqual(r.b.gold.inv, [0, 0, 0, 1, 1]);
  assert.equal(r.orders.length, 2);
  assert.deepEqual([r.orders[0].i, r.orders[0].a, r.orders[0].side, r.orders[0].why], [2, 'btc', -1, 'signal']); close(r.orders[0].eur, 240); close(r.orders[0].price, 800);
  assert.deepEqual([r.orders[1].i, r.orders[1].a, r.orders[1].side], [3, 'gold', 1]); close(r.orders[1].eur, 200); close(r.orders[1].price, 11);
  /* nach dem Verkauf wächst das Bitcoin-Cash nicht mit dem Kurs */
  close(r.b.btc.val[4], 240); close(r.b.gold.val[4], 200);
});

test('Regel pur: Einzahlung 50/30/20 (investiert nur, wo die Regel investiert ist), Zins, Rebalancing, Auszahlung anteilig', () => {
  const c = (v) => [v, v, v, v, v];
  const px = { ftse: c(100), btc: c(1000), gold: c(10) };
  const r = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 0, gold: 1 }, sw: {}, flows: [0, 1000, 0, -500, 0], reb: [false, false, true, false, false], rc: [0, 0.01, 0, 0, 0] });
  close(r.vals[1], 2003); close(r.idx[1], 1.003);          /* 300 € Bitcoin-Cash + 1 % Zins, dann 1.000 € Einzahlung */
  close(r.b.btc.val[1], 603); close(r.b.ftse.val[1], 1000); close(r.b.gold.val[1], 400);
  close(r.b.ftse.val[2], 1001.5); close(r.b.btc.val[2], 600.9); close(r.b.gold.val[2], 400.6);   /* Rebalancing auf 50/30/20 */
  close(r.vals[3], 1503); close(r.idx[3], 1.003); close(r.idx[4], 1.003);
  close(r.b.btc.val[3] / r.vals[3], 0.3);
  const why = r.orders.map((o) => o.why + ':' + o.a);
  assert.deepEqual(why, ['einzahlung:ftse', 'einzahlung:gold', 'rebalancing:ftse', 'rebalancing:gold', 'auszahlung:ftse', 'auszahlung:gold']);
  close(r.orders[2].eur, 1.5); close(r.orders[3].eur, 0.6);
});

/* Kleines Depot nach Buchungen, wie es die Seite aus deinen Buchungen rechnet (Werte je Baustein, Zahlungen, Orders mit Kurs und Gebühr) */
function mine(px, alt, o) {
  const n = px.ftse.length, st = {}, m = {}, VM = [], F = Array(n).fill(0);
  K.forEach((a) => { st[a] = { u: o.start[a].u || 0, cash: o.start[a].cash || 0, alt: Object.assign({}, o.start[a].alt || {}) }; m[a] = { val: [], flow: Array(n).fill(0), units: [], fee: Array(n).fill(0), tpx: Array(n).fill(0), pend: Array(n).fill(0) }; });
  m.btc.alt = []; m.btc.altGain = Array(n).fill(0);
  const altVal = (t) => Object.keys(st.btc.alt).reduce((s, x) => s + st.btc.alt[x] * alt[x][t], 0);
  for (let t = 0; t < n; t++) {
    if (t > 0) {
      K.forEach((a) => { st[a].cash *= 1 + ((o.rc && o.rc[t]) || 0); });
      m.btc.altGain[t] = Object.keys(st.btc.alt).reduce((s, x) => s + st.btc.alt[x] * (alt[x][t] - alt[x][t - 1]), 0);
      (o.flows || []).filter((f) => f.t === t).forEach((f) => { st[f.a].cash += f.f; m[f.a].flow[t] += f.f; F[t] += f.f; });
      (o.moves || []).filter((f) => f.t === t).forEach((f) => { st[f.from].cash -= f.v; st[f.to].cash += f.v; m[f.from].flow[t] -= f.v; m[f.to].flow[t] += f.v; });
      (o.trades || []).filter((x) => x.t === t).forEach((x) => {
        const p = x.x === 'main' ? px[x.a][t] : alt[x.x][t];
        if (x.x === 'main') st[x.a].u += x.du; else st[x.a].alt[x.x] = (st[x.a].alt[x.x] || 0) + x.du;
        st[x.a].cash -= x.du * x.q + (x.fee || 0); m[x.a].tpx[t] += x.du * (p - x.q); m[x.a].fee[t] += x.fee || 0;
      });
    }
    let tot = 0;
    K.forEach((a) => { const v = st[a].u * px[a][t] + st[a].cash + (a === 'btc' ? altVal(t) : 0); m[a].val.push(v); m[a].units.push(st[a].u); tot += v; });
    m.btc.alt.push(altVal(t)); VM.push(tot);
  }
  (o.pend || []).forEach((p) => { m[p.a].pend[p.t] += p.q; });
  return { m, VM, F };
}
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

test('Gründe: gleiches Depot wie die Regel ergibt überall 0', () => {
  const px = { ftse: [100, 101, 99, 103], btc: [1000, 1050, 980, 1020], gold: [10, 10.2, 10.1, 10.4] }, rc = [0, 0.0001, 0.0001, 0.0001];
  const R = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 1, gold: 0 }, sw: {}, flows: [0, 0, 0, 0], reb: [], rc });
  const M = mine(px, {}, { start: { ftse: { u: 5 }, btc: { u: 0.3 }, gold: { cash: 200 } }, rc });
  const A = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b });
  Object.values(A.pp).forEach((v) => close(v, 0, 1e-12)); close(A.iM, A.iR, 1e-12);
});

test('Gründe: Aufteilung, Zeitpunkt, Cash, Gebühren und Beimischung gehen genau im Abstand auf', () => {
  const px = { ftse: [100, 101, 99, 103, 104, 102], btc: [1000, 1050, 980, 1020, 990, 1100], gold: [10, 10.2, 10.1, 10.4, 10.3, 10.6] };
  const alt = { eth: [50, 55, 48, 52, 49, 56] }, rc = [0, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4], flows = [0, 0, 0, 0, 200, 0];
  const R = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 1, gold: 0 }, sw: { btc: [{ i: 2, to: 0 }], gold: [{ i: 3, to: 1 }] }, flows, reb: [], rc });
  /* Dein Depot 58/30/12 mit ETH im Krypto-Baustein; Bitcoin und ETH am Tag nach dem Signal verkauft, Gold am Tag nach dem Signal gekauft,
     Einzahlung bleibt als Cash liegen */
  const M = mine(px, alt, {
    start: { ftse: { u: 5.5, cash: 30 }, btc: { u: 0.25, alt: { eth: 1 } }, gold: { cash: 120 } }, rc,
    trades: [{ t: 3, a: 'btc', x: 'main', du: -0.25, q: 1010, fee: 1 }, { t: 3, a: 'btc', x: 'eth', du: -1, q: 51, fee: 1 }, { t: 4, a: 'gold', x: 'main', du: 12.1, q: 10.35, fee: 1 }],
    flows: [{ t: 4, a: 'ftse', f: 200 }], pend: [{ a: 'btc', t: 3, q: -294 }, { a: 'gold', t: 4, q: 200 }, { a: 'ftse', t: 5, q: 100 }]
  });
  close(M.VM[0], 1000);
  const A = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b });
  const tw = ENG.twrIndex(M.VM, M.F);
  close(A.iM, tw[tw.length - 1], 1e-12); close(A.iR, R.idx[R.idx.length - 1], 1e-12);
  close(sum(A.pp), A.iM - A.iR, 1e-12);                                  /* Prozentpunkte: Summe = Abstand der Linien */
  close(sum(A.eur), M.VM[5] - R.vals[5], 1e-9);                          /* Euro: Summe = Abstand der Werte (gleicher Start, gleiche Zahlungen) */
  /* Gebühren: 2 € an Tag 3, 1 € an Tag 4, danach mit der Rendite der Regel gewachsen */
  const rR = (t) => (R.vals[t] - M.F[t]) / R.vals[t - 1] - 1;
  close(A.eur.gebuehren, -(2 * (1 + rR(4)) * (1 + rR(5)) + 1 * (1 + rR(5))), 1e-9);
  assert.ok(Math.abs(A.eur.beimischung) > 0.5, 'Beimischung ' + A.eur.beimischung);
  assert.ok(Math.abs(A.eur.aufteilung) > 0.5 && Math.abs(A.eur.zeitpunkt) > 0.5 && Math.abs(A.eur.cash) > 0.01);
});

test('Gründe: nur Gebühren und nur Zeitpunkt', () => {
  const px = { ftse: [100, 100, 100, 100], btc: [1000, 1000, 1100, 1210], gold: [10, 10, 10, 10] }, rc = [0, 0, 0, 0];
  /* Regel kauft Bitcoin zum Schluss an Tag 1 (1.000 €), du kaufst an Tag 2 zu 1.050 € mit 1 € Gebühr */
  const R = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 0, gold: 0 }, sw: { btc: [{ i: 1, to: 1 }] }, flows: [0, 0, 0, 0], reb: [], rc });
  const M = mine(px, {}, { start: { ftse: { u: 5 }, btc: { cash: 300 }, gold: { cash: 200 } }, rc, trades: [{ t: 2, a: 'btc', x: 'main', du: 299 / 1050, q: 1050, fee: 1 }], pend: [{ a: 'btc', t: 2, q: 300 }] });
  const A = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b });
  close(A.eur.beimischung, 0, 1e-9); close(A.eur.cash, 0, 1e-9);
  assert.ok(Math.abs(A.eur.aufteilung) < 2, 'Aufteilung ' + A.eur.aufteilung);  /* danach ist dein Bitcoin-Anteil etwas kleiner */
  close(A.eur.gebuehren, -1 * (R.vals[3] / R.vals[2]), 1e-9);              /* 1 € Gebühr, danach mit der Regel gewachsen */
  close(sum(A.eur), M.VM[3] - R.vals[3], 1e-9);
  assert.ok(A.eur.zeitpunkt < -10, 'später und teurer gekauft: ' + A.eur.zeitpunkt);
  /* ohne offene Regel-Order zählt dieselbe Abweichung zu „Cash“ */
  M.m.btc.pend[2] = 0;
  const B = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b });
  assert.ok(B.eur.cash < -10 && B.eur.zeitpunkt > -10, B.eur.cash + ' / ' + B.eur.zeitpunkt);
  close(sum(B.eur), sum(A.eur), 1e-9);
});

test('Gründe: Zeitraum ab k0 startet bei 0 und rechnet nur ab dort', () => {
  const px = { ftse: [100, 110, 121, 121], btc: [1000, 900, 900, 990], gold: [10, 10, 11, 11] }, rc = [0, 0, 0, 0];
  const R = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 1, gold: 1 }, sw: {}, flows: [0, 0, 0, 0], reb: [], rc });
  const M = mine(px, {}, { start: { ftse: { u: 6 }, btc: { u: 0.2 }, gold: { u: 20 } }, rc });
  const A = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b, k0: 2 });
  close(A.iM, M.VM[3] / M.VM[2], 1e-12); close(A.iR, R.vals[3] / R.vals[2], 1e-12);
  close(sum(A.pp), A.iM - A.iR, 1e-12);
  close(sum(A.eur), (M.VM[3] - R.vals[3]) - (M.VM[2] - R.vals[2]), 1e-9);  /* Euro: wie sich der Abstand im Zeitraum verändert hat */
  close(A.eur.aufteilung, sum(A.eur), 1e-9);                              /* nur die Gewichte unterscheiden sich */
});

test('Gründe: offene Regel-Order zählt nur in ihre Richtung und höchstens mit ihrem Betrag', () => {
  const px = { ftse: [100, 100, 110], btc: [1000, 1000, 1000], gold: [10, 10, 10] }, rc = [0, 0, 0];
  const R = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 1, gold: 1 }, sw: {}, flows: [0, 0, 0], reb: [], rc });
  /* 100 € Cash im FTSE-Baustein (Regel voll investiert); offene Kauf-Order über 30 €: nur 30 € davon zählen zu „Zeitpunkt“ */
  const M = mine(px, {}, { start: { ftse: { u: 4, cash: 100 }, btc: { u: 0.3 }, gold: { u: 20 } }, rc, pend: [{ a: 'ftse', t: 2, q: 30 }] });
  const A = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b });
  close(A.eur.zeitpunkt, -30 * 0.1, 1e-9); close(A.eur.cash, -70 * 0.1, 1e-9);
  /* offene Verkaufs-Order zeigt in die andere Richtung: alles bleibt „Cash“ */
  M.m.ftse.pend[2] = -30;
  const B = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b });
  close(B.eur.zeitpunkt, 0, 1e-9); close(B.eur.cash, -10, 1e-9);
});

test('Gründe: nach einem Rebalancing auf gleiche Gewichte bleibt die Aufteilung 0 (Prüfung 01.10.2026)', () => {
  const px = { ftse: [100, 100, 100, 100, 100], btc: [1000, 1000, 1100, 1100, 1650], gold: [10, 10, 10, 10, 10] }, rc = [0, 0, 0, 0, 0];
  const reb = [false, false, false, true, false];
  /* Regel kauft Bitcoin zum Schluss an Tag 1, du erst am Schluss von Tag 2 (10 % teurer); an Tag 3 gehen beide genau auf 50/30/20 */
  const R = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 0, gold: 1 }, sw: { btc: [{ i: 1, to: 1 }] }, flows: [0, 0, 0, 0, 0], reb, rc });
  const V3 = 500 + 300 + 200;  /* dein Wert an Tag 3: Bitcoin zum Tagesschluss von Tag 2 gekauft, Kurs danach gleich */
  const T = { ftse: 0.5 * V3, btc: 0.3 * V3, gold: 0.2 * V3 };
  const M = mine(px, {}, {
    start: { ftse: { u: 5 }, btc: { cash: 300 }, gold: { u: 20 } }, rc, pend: [{ a: 'btc', t: 2, q: 300 }],
    trades: [{ t: 2, a: 'btc', x: 'main', du: 300 / 1100, q: 1100, fee: 0 }]
  });
  assert.equal(R.vals[3].toFixed(6), (500 + 330 + 200).toFixed(6));
  close(M.VM[3], V3, 1e-9); close(T.btc / 1100, 300 / 1100, 1e-12);  /* dein Depot steht schon auf 50/30/20 */
  const A = ENG.attribution({ VM: M.VM, F: M.F, VR: R.vals, px, rc, m: M.m, r: R.b });
  close(A.eur.aufteilung, 0, 1e-9);
  close(A.eur.zeitpunkt, M.VM[4] - R.vals[4], 1e-9);                       /* der ganze Abstand ist der späte Kauf */
  close(sum(A.pp), A.iM - A.iR, 1e-12);
});

test('Gründe: Sonderfall (Regel-Depot leer) führt den Abstand weiter', () => {
  const px = { ftse: [100, 100, 100], btc: [1000, 1000, 1000], gold: [10, 10, 10] }, rc = [0, 0, 0];
  const R = ENG.rulePure({ px, w: W, v0: 1000, st0: { ftse: 1, btc: 1, gold: 1 }, sw: {}, flows: [0, -1000, 0], reb: [], rc });
  const M = mine(px, {}, { start: { ftse: { u: 5 }, btc: { u: 0.3 }, gold: { u: 20 } }, rc });
  const A = ENG.attribution({ VM: M.VM, F: [0, -1000, 0], VR: R.vals, px, rc, m: M.m, r: R.b });
  close(sum(A.eur), M.VM[2] - R.vals[2], 1e-9);
});
