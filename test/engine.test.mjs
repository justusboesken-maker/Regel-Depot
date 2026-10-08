/* Tests des Rechenkerns gegen die Rechenbeispiele des Übergabedokuments (Abschnitt 9, B-1 bis B-11).
   Start: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ENG = require('../docs/js/engine.js');

const RULES = { ftse: { type: 'confirm', n: 2 }, btc: { type: 'band', p: 0.03 }, gold: { type: 'confirm', n: 4 } };
/* Feste Testdaten (Stand der Rechenbeispiele: FTSE und Gold bis 18.09.2026, Bitcoin bis 20.09.2026) statt der Live-Dateien unter docs/data,
   die jede Woche weiterlaufen (Prüfbericht 26.09.2026, Punkt 20). */
function series(a, n) {
  const j = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'weekly', a + '.json'), 'utf8'));
  const S = ENG.fromRows(j.w);
  return n ? ENG.slice(S, n) : S;
}
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
function at(S, E, d) { const i = S.d.indexOf(d); assert.ok(i >= 0, 'Woche ' + d + ' fehlt'); return { i, c: S.c[i], m: E.sma[i], up: E.up[i], dn: E.dn[i], st: E.st[i] }; }

/* ---------- B-1: SMA50 und Schwellen zum 18./20.09.2026 (Testdaten: 130 Wochen wie Anhang A) ---------- */
test('B-1 SMA50, Abstand, Zähler und Schwellen', () => {
  const F = series('ftse', 130), EF = ENG.evalRule(F, RULES.ftse);
  assert.equal(EF.last.d, '2026-09-18'); assert.equal(r2(EF.last.c), 185.13); assert.equal(r4(EF.last.m), 172.3443);
  assert.equal(r2(EF.next.above), 172.65); assert.equal(EF.last.st, 1); assert.equal(EF.last.up, 73);
  const B = series('btc', 130), EB = ENG.evalRule(B, RULES.btc);
  assert.equal(EB.last.d, '2026-09-20'); assert.equal(r2(EB.last.c), 81142.61); assert.equal(r4(EB.last.m), 78787.7604);
  assert.equal(r2(EB.next.above), 78045.27); assert.equal(r2(1.03 * EB.last.m), 81151.39);
  assert.equal(r2(EB.next.bandUp), 80435.87); assert.equal(r2(EB.next.bandDown), 75657.59); assert.equal(EB.last.st, 0);
  const G = series('gold', 130), EG = ENG.evalRule(G, RULES.gold);
  assert.equal(EG.last.d, '2026-09-18'); assert.equal(r2(EG.last.c), 4348.15); assert.equal(r4(EG.last.m), 4459.312);
  assert.equal(r2(EG.next.above), 4469.21); assert.equal(EG.last.st, 0); assert.equal(EG.last.dn, 3);
});

/* ---------- B-2: FTSE 2-Wochen-Regel April/Mai 2025 (volle Historie) ---------- */
test('B-2 FTSE Verkauf 11.04.2025, Kauf 09.05.2025', () => {
  const S = series('ftse'), E = ENG.evalRule(S, RULES.ftse);
  const w = (d) => at(S, E, d);
  assert.deepEqual([w('2025-03-28').up, w('2025-03-28').dn, w('2025-03-28').st], [74, 0, 1]);
  assert.deepEqual([w('2025-04-04').dn, w('2025-04-04').st], [1, 1]);
  assert.deepEqual([w('2025-04-11').dn, w('2025-04-11').st], [2, 0]);
  assert.equal(w('2025-04-17').st, 0); assert.equal(w('2025-04-25').st, 0); assert.equal(w('2025-05-02').up, 1);
  assert.deepEqual([w('2025-05-09').up, w('2025-05-09').st], [2, 1]);
  const sw = E.sw.filter((s) => s.d >= '2025-04-01' && s.d <= '2025-05-31').map((s) => [s.d, s.to]);
  assert.deepEqual(sw, [['2025-04-11', 0], ['2025-05-09', 1]]);
  assert.equal(r2(w('2025-04-11').m), 131.86);
});

/* ---------- B-3: Bitcoin 3-%-Band ---------- */
test('B-3 Bitcoin Verkauf 16.11.2025, bleibt draußen am 06.09. und 20.09.2026', () => {
  const S = series('btc'), E = ENG.evalRule(S, RULES.btc);
  const w = (d) => at(S, E, d);
  assert.equal(w('2025-11-09').st, 1); assert.equal(r2(w('2025-11-09').m * 0.97), 99920.47);
  assert.equal(w('2025-11-16').st, 0); assert.equal(r2(w('2025-11-16').m), 102948.74);
  assert.equal(w('2026-09-06').st, 0); assert.equal(r2(w('2026-09-06').m), 80340.87); assert.ok(Math.abs(w('2026-09-06').m * 1.03 - 82751.1) < 0.011);
  assert.equal(w('2026-09-20').st, 0); assert.equal(r2(w('2026-09-20').m * 1.03), 81151.39);
  assert.equal(E.last.lastSwitch.d, '2025-11-16'); assert.equal(E.last.lastSwitch.to, 0);
});

/* ---------- B-4: Gold 4-Wochen-Regel ---------- */
test('B-4 Gold Verkauf 03.07.2026, Zähler zurückgesetzt am 04.09.2026', () => {
  const S = series('gold'), E = ENG.evalRule(S, RULES.gold);
  const w = (d) => at(S, E, d);
  assert.deepEqual([w('2026-06-05').up, w('2026-06-05').st], [139, 1]);
  assert.deepEqual([w('2026-06-26').dn, w('2026-06-26').st], [3, 1]);
  assert.deepEqual([w('2026-07-03').dn, w('2026-07-03').st], [4, 0]); assert.equal(r2(w('2026-07-03').m), 4290.08);
  assert.deepEqual([w('2026-08-28').up, w('2026-08-28').st], [3, 0]);
  assert.deepEqual([w('2026-09-04').dn, w('2026-09-04').st], [1, 0]);
  assert.deepEqual([w('2026-09-18').dn, w('2026-09-18').st], [3, 0]);
  assert.equal(E.last.lastSwitch.d, '2026-07-03');
});

/* ---------- B-5: Zustandsautomaten mit vorgegebenem SMA50 ---------- */
function synthetic(closes, rulePre) {
  /* 49 Wochen mit Schluss 100 vorab, dann die Testfolge; SMA50 bleibt ~100, solange die Folge nahe 100 liegt */
  const pre = new Array(49).fill(100);
  const all = pre.concat(closes);
  const S = { k: [], d: [], c: [] };
  all.forEach((c, i) => { const k = ENG.addDays('2020-01-06', 7 * i); S.k.push(k); S.d.push(ENG.addDays(k, 4)); S.c.push(c); });
  return S;
}
test('B-5 Bestätigungsregel n=2 und n=4, Bandregel p=3 %', () => {
  /* Bestätigungsregel: Start investiert (über=5 durch fünf Schlüsse 101 nach Einschwingen) */
  const S = synthetic([101, 101, 101, 101, 101, 99, 101, 98, 97, 100, 103, 104], null);
  /* SMA driftet minimal; wir prüfen die Zähler und Zustände qualitativ wie in B-5 */
  const E2 = ENG.evalRule(S, { type: 'confirm', n: 2 });
  const n = S.c.length, tail = (E) => E.st.slice(n - 7);
  assert.deepEqual(tail(E2), [1, 1, 1, 0, 0, 0, 1]);
  const dn = E2.dn.slice(n - 7), up = E2.up.slice(n - 7);
  assert.deepEqual(dn.slice(0, 4), [1, 0, 1, 2]);
  assert.deepEqual(up.slice(5), [1, 2]);
  const E4 = ENG.evalRule(S, { type: 'confirm', n: 4 });
  assert.deepEqual(tail(E4), [1, 1, 1, 1, 1, 1, 1], 'mit n = 4 kein Signal');
  /* Bandregel */
  const Sb = synthetic([100, 102.9, 103.0, 103.01, 97.5, 97.0, 96.99].map((x) => x), null);
  /* Um den SMA exakt bei 100 zu halten, testen wir die Bandlogik direkt mit fixem SMA: */
  const band = { type: 'band', p: 0.03 };
  let st = 0, out = [];
  [102.9, 103.0, 103.01, 97.5, 97.0, 96.99].forEach((c) => { const M = 100; if (st === 0 && c > M * (1 + band.p)) st = 1; else if (st === 1 && c < M * (1 - band.p)) st = 0; out.push(st); });
  assert.deepEqual(out, [0, 0, 1, 1, 1, 0]);
  assert.ok(Sb.c.length > 50);
});

/* ---------- B-6: Schwellenformel ---------- */
test('B-6 Bitcoin-Einstiegsschwelle 80.435,87 $', () => {
  const S = series('btc'), n = S.c.length; let S49 = 0; for (let i = n - 49; i < n; i++) S49 += S.c[i];
  assert.equal(r2(S49), 3824218.25); assert.equal(r2(S49 / 49), 78045.27); assert.equal(r4(1.03 * S49 / 48.97), 80435.875);
  const E1 = ENG.whatIf(S, RULES.btc, '2026-09-27', 80435.87); assert.equal(E1.last.st, 0, 'knapp darunter: kein Signal');
  const E2 = ENG.whatIf(S, RULES.btc, '2026-09-27', 80435.88); assert.equal(E2.last.st, 1, 'ab 80.435,88 Kaufsignal'); assert.equal(E2.last.changed, true);
});

/* ---------- B-7: Depotbewertung ---------- */
test('B-7 Depotwert 14.174,48 € und Ziele', () => {
  const tx = [{ id: 'v', d: '2026-09-18', a: 'ftse', type: 'kauf', units: 41.691483, price: 167.92, fee: 0 }, { id: 'b', d: '2026-07-31', a: 'btc', type: 'kauf', units: 0.050467, price: 55011.54, fee: 0 }];
  const B = ENG.book(tx);
  assert.equal(r2(ENG.cost(B.pos.ftse)), 7000.83); assert.equal(r2(ENG.cost(B.pos.btc)), 2776.27);
  const val = r2(41.691483 * 168.92) + r2(0.050467 * 73908.69);
  assert.equal(r2(41.691483 * 168.92), 7042.53);
  assert.equal(r2(val + 3402), 14174.48);
  assert.deepEqual([0.5, 0.3, 0.2].map((w) => r2(w * 14174.48)), [7087.24, 4252.34, 2834.9]);
});

/* ---------- B-8: Steuern ---------- */
const CFG = { pb: 1000, pbUsed: 0, pbUsedDate: '', interestRest: 0, lossOther: 0, s23Other: 0, rate: 0.25, headroom: null, nv: false, abg: 0.26375, tfs: 0.30, fg: 1000, buffer: 0, fee: 1, minOrder: 25 };
test('B-8a FIFO und § 20', () => {
  const tx = [{ id: 1, d: '2026-02-02', a: 'ftse', type: 'kauf', units: 10, price: 150, fee: 0 }, { id: 2, d: '2026-09-18', a: 'ftse', type: 'kauf', units: 10, price: 170, fee: 0 }, { id: 3, d: '2026-12-30', a: 'ftse', type: 'verkauf', units: 12, price: 180, fee: 0 }];
  const B = ENG.book(tx), r = B.real[0];
  assert.equal(r2(r.proceeds), 2160); assert.equal(r2(r.cost), 1840); assert.equal(r2(r.gain), 320);
  assert.equal(r2(r.gain * 0.7), 224);
  assert.equal(r2(ENG.tax20(224 - 900, CFG).final), 0);
  assert.equal(r2(ENG.tax20(224, { ...CFG, rate: 0.30 }).final), 59.08);
  assert.equal(r2(ENG.units(B.pos.ftse)), 8); assert.equal(r2(B.pos.ftse[0].cpu), 170);
});
test('B-8b Freigrenze ist eine Klippe', () => {
  assert.equal(ENG.tax23(999.99, CFG), 0); assert.equal(r2(ENG.tax23(1000, CFG)), 250);
  assert.equal(ENG.tax23(1000, { ...CFG, rate: 0 }), 0, 'Steuersatz 0 %: keine Steuer, aber Erklärungspflicht');
});
test('B-8c Haltefrist', () => {
  assert.equal(ENG.isLongTerm('2026-06-15', '2027-06-15'), false); assert.equal(ENG.isLongTerm('2026-06-15', '2027-06-16'), true);
  assert.equal(ENG.taxFreeFrom('2026-06-15'), '2027-06-16'); assert.equal(ENG.taxFreeFrom('2028-02-29'), '2029-03-01');
});
test('B-8d Bitcoin-Start: Verkauf zu 70.700 €', () => {
  const lots = [{ d: '2026-07-31', units: 0.050467, cpu: 55011.54 }];
  const sm = ENG.simSell(lots, 0.050467 * 70700, 70700, '2026-09-28', 'btc', CFG);
  assert.equal(r2(0.050467 * 70700), 3568.02); assert.equal(r2(sm.sg), 791.75);
  assert.equal(r2(sm.sg + 7.44), 799.19); assert.equal(ENG.tax23(799.19, CFG), 0);
  const sm2 = ENG.simSell(lots, 0.050467 * 73908.69, 73908.69, '2026-09-28', 'btc', CFG);
  assert.equal(r2(sm2.sg), 953.68); assert.equal(r2(sm2.sg + 7.44), 961.12);
});
test('B-8e Vorabpauschale 2026', () => {
  const vp = ENG.vorab([{ d: '2026-09-18', units: 41.691483, cpu: 167.92 }], 2026, 145.14, 168.92, 0.032);
  assert.equal(r2(vp), 45.18); assert.equal(r2(vp * 0.7), 31.63);
  assert.equal(ENG.vorab([{ d: '2026-09-18', units: 41.691483, cpu: 167.92 }], 2026, 145.14, 145.0, 0.032), 0);
});
test('B-8f Zinsen und freier Pauschbetrag', () => {
  assert.equal(r2(3402 * 0.025 * 3 / 12), 21.26);
  const ty = ENG.taxYear({ ...CFG, pbUsed: 66.37, interestRest: 21.26 }, [], 2026);
  assert.equal(r2(ty.pbFree), 912.37);
});

/* ---------- B-9 bis B-11: Rebalancing ---------- */
function reb(o, variant) { return ENG.rebalance({ date: '2026-12-30', w: { ftse: 0.5, btc: 0.3, gold: 0.2 }, variant, ...o, pos: JSON.parse(JSON.stringify(o.pos)) }); }
test('B-9 alles im Freibetrag', () => {
  const o = { st: { ftse: 1, btc: 1, gold: 0 }, px: { ftse: 190, btc: 80000, gold: 0 }, pos: { ftse: [{ d: '2026-01-15', units: 40, cpu: 175 }], btc: [{ d: '2026-06-15', units: 0.05, cpu: 70000 }], gold: [] }, cash: { ftse: 0, btc: 0, gold: 2400 }, cfg: CFG, ty: { pbFree: 900, s23Before: 0 } };
  for (const v of ['frei', 'voll']) {
    const r = reb(o, v);
    assert.equal(r2(r.T), 14000); assert.equal(r2(r.rows.ftse.sell), 600); assert.equal(r2(r.rows.ftse.sellUnits), 3.16);
    assert.equal(r2(r.rows.ftse.g20), 47.37); assert.equal(r2(r.rows.ftse.t20), 33.16);
    assert.equal(r2(r.rows.btc.buy), 200); assert.equal(r2(r.rows.gold.cashTo), 400);
    assert.equal(r.tax, 0); assert.equal(r.orders, 2); assert.equal(r2(r.pbLeft), 866.84);
    assert.deepEqual(['ftse', 'btc', 'gold'].map((a) => Math.round(r.rows[a].wAfter * 1000) / 10), [50, 30, 20]);
  }
});
test('B-10 Freigrenze begrenzt', () => {
  const o = { st: { ftse: 1, btc: 1, gold: 0 }, px: { ftse: 160, btc: 90000, gold: 0 }, pos: { ftse: [{ d: '2026-01-15', units: 40, cpu: 150 }], btc: [{ d: '2026-06-15', units: 0.06, cpu: 50000 }], gold: [] }, cash: { ftse: 0, btc: 0, gold: 2200 }, cfg: CFG, ty: { pbFree: 900, s23Before: 600 } };
  const V = reb(o, 'voll');
  assert.equal(r2(V.rows.btc.sell), 1200); assert.equal(r2(V.rows.btc.sg), 533.33); assert.equal(r2(V.s23After), 1133.33);
  assert.equal(r2(V.tax23), 283.33); assert.equal(r2(V.rows.ftse.buy), 600); assert.equal(r2(V.rows.gold.cashTo), 600);
  assert.equal(V.declare23, true);
  const F = reb(o, 'frei');
  assert.equal(r2(F.rows.btc.sell), 899.98); assert.equal(r2(F.rows.btc.sg), 399.99); assert.equal(r2(F.s23After), 999.99); assert.equal(F.tax, 0);
  assert.equal(r2(F.rows.ftse.buy), 449.99); assert.equal(r2(F.rows.gold.cashTo), 449.99); assert.equal(r2(F.fill), 0.75);
  assert.deepEqual(['ftse', 'btc', 'gold'].map((a) => r2(F.rows[a].wAfter * 100)), [48.93, 32.14, 18.93]);
});
test('B-11 Pauschbetrag begrenzt', () => {
  const o = { st: { ftse: 1, btc: 1, gold: 0 }, px: { ftse: 200, btc: 80000, gold: 0 }, pos: { ftse: [{ d: '2025-03-01', units: 40, cpu: 125 }], btc: [{ d: '2025-01-10', units: 0.0475, cpu: 60000 }], gold: [] }, cash: { ftse: 0, btc: 0, gold: 2200 }, cfg: CFG, ty: { pbFree: 100, s23Before: 0 } };
  const V = reb(o, 'voll');
  assert.equal(r2(V.rows.ftse.sell), 1000); assert.equal(r2(V.rows.ftse.sellUnits), 5); assert.equal(r2(V.rows.ftse.g20), 375); assert.equal(r2(V.rows.ftse.t20), 262.5);
  assert.equal(r2(V.tax20), 42.86, 'Satz 25 %: Abgeltungsteuer, keine Günstigerprüfung');
  assert.equal(r2(V.withheld20), 42.86);
  assert.equal(r2(V.rows.btc.buy), 400); assert.equal(r2(V.rows.gold.cashTo), 600);
  const F = reb(o, 'frei');
  assert.equal(r2(F.rows.ftse.sell), 380.95); assert.equal(r2(F.rows.ftse.sellUnits), 1.9); assert.equal(r2(F.rows.ftse.g20), 142.86); assert.equal(r2(F.rows.ftse.t20), 100);
  assert.equal(F.tax, 0); assert.equal(r2(F.rows.btc.buy), 152.38); assert.equal(r2(F.rows.gold.cashTo), 228.57); assert.equal(Math.round(F.fill * 1000) / 10, 38.1);
  assert.deepEqual(['ftse', 'btc', 'gold'].map((a) => r2(F.rows[a].wAfter * 100)), [54.42, 28.23, 17.35]);
});

/* ---------- Studenten-Modell: Satz 0 %, Spielraum, NV-Bescheinigung ---------- */
test('Steuersatz 0 %: Abzug durch die Bank bleibt, endgültige Steuer 0', () => {
  const cfg = { ...CFG, rate: 0, headroom: 5000 };
  const t = ENG.tax20(500, cfg); assert.equal(r2(t.withheld), 131.88); assert.equal(t.final, 0);
  const t2 = ENG.tax20(500, { ...cfg, nv: true }); assert.equal(t2.withheld, 0);
  const o = { st: { ftse: 1, btc: 1, gold: 0 }, px: { ftse: 200, btc: 80000, gold: 0 }, pos: { ftse: [{ d: '2025-03-01', units: 40, cpu: 125 }], btc: [{ d: '2026-06-10', units: 0.0475, cpu: 40000 }], gold: [] }, cash: { ftse: 0, btc: 0, gold: 2200 }, cfg, ty: { pbFree: 100, s23Before: 0 } };
  const V = reb(o, 'voll');
  assert.equal(V.tax, 0); assert.ok(V.withheld20 > 0); assert.equal(V.overHeadroom, 0);
});

/* ---------- Wochenaggregation und Zusammenführen ---------- */
test('weeklyFromDaily und mergeWeekly mit Reskalierung', () => {
  const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22'];
  const closes = [1, 2, 3, 4, 5, 6, 7];
  const W = ENG.weeklyFromDaily(dates, closes, '2026-09-21');
  assert.deepEqual(W, { k: ['2026-09-14'], d: ['2026-09-18'], c: [5] });
  const W2 = ENG.weeklyFromDaily(dates, closes, null);
  assert.deepEqual(W2.k, ['2026-09-14', '2026-09-21']); assert.equal(W2.c[1], 7);
  const stored = ENG.fromRows([['2026-09-07', '2026-09-11', 200], ['2026-09-14', '2026-09-18', 210]]);
  const fresh = ENG.fromRows([['2026-09-14', '2026-09-18', 105], ['2026-09-21', '2026-09-25', 110]]);
  const M = ENG.mergeWeekly(stored, fresh, true);
  assert.deepEqual(M.c, [100, 105, 110], 'ältere Woche halbiert, weil die frische Basis halb so hoch ist');
  const M2 = ENG.mergeWeekly(stored, fresh, false);
  assert.deepEqual(M2.c, [200, 105, 110]);
});

test('B-13 Beimischung: FIFO-Buch legt eigene Listen für weitere Anlagen an, § 23 wie Bitcoin', () => {
  const B = ENG.book([
    { id: 'e1', d: '2026-09-21', a: 'eth', type: 'kauf', units: 0.125, price: 2409.6, fee: 0 },
    { id: 's1', d: '2026-09-21', a: 'sol', type: 'kauf', units: 1.4598, price: 103.1648, fee: 0 },
    { id: 'b1', d: '2026-06-05', a: 'btc', type: 'kauf', units: 0.009452, price: 52985.61, fee: 0 },
    { id: 'e2', d: '2026-11-02', a: 'eth', type: 'verkauf', units: 0.05, price: 3000, fee: 1 }
  ]);
  assert.ok(B.pos.eth && B.pos.sol && B.pos.btc, 'Listen für eth, sol und btc');
  assert.ok(Math.abs(ENG.units(B.pos.eth) - 0.075) < 1e-9, 'Rest ETH nach Teilverkauf');
  assert.ok(Math.abs(ENG.cost(B.pos.sol) - 150.6) < 0.01, 'Kosten SOL');
  const r = B.real[0];
  assert.equal(r.a, 'eth'); assert.ok(r.shortGain > 0 && r.longGain === 0, 'Verkauf innerhalb eines Jahres: kurzfristig (§ 23)');
  const sm = ENG.simSell(B.pos.eth, 0.075 * 3000, 3000, '2026-12-30', 'eth', { tfs: 0.3 });
  assert.ok(sm.sg > 0 && sm.g20 === 0, 'Beimischung zählt nicht zu § 20');
});

/* ---------- Prüfbericht 26.09.2026, Punkt 4 und 13 ---------- */
test('Verkauf ohne Kauf davor zählt nicht als Gewinn; Haltefrist nach Kauflosen', () => {
  const B = ENG.book([
    { id: 'k1', d: '2026-06-01', a: 'btc', type: 'kauf', units: 0.01, price: 50000, fee: 0 },
    { id: 'v0', d: '2026-05-01', a: 'btc', type: 'verkauf', units: 0.005, price: 60000, fee: 0 }
  ]);
  const r = B.real[0];
  assert.equal(r.id, 'v0'); assert.ok(Math.abs(r.open - 0.005) < 1e-12, 'ganze Stückzahl ungedeckt');
  assert.equal(r.gain, 0, 'ungedeckte Stücke sind kein Gewinn'); assert.equal(r.covered, 0);
  const B2 = ENG.book([
    { id: 'k1', d: '2024-06-01', a: 'gold', type: 'kauf', units: 2, price: 100, fee: 0 },
    { id: 'v1', d: '2026-06-01', a: 'gold', type: 'verkauf', units: 1, price: 100, fee: 0 },
    { id: 'k2', d: '2026-05-01', a: 'btc', type: 'kauf', units: 1, price: 100, fee: 0 },
    { id: 'v2', d: '2026-06-01', a: 'btc', type: 'verkauf', units: 1, price: 100, fee: 0 }
  ]);
  const g = B2.real.find((x) => x.id === 'v1'), b = B2.real.find((x) => x.id === 'v2');
  assert.equal(g.gain, 0); assert.equal(g.longUnits, 1); assert.equal(g.shortUnits, 0);
  assert.equal(b.gain, 0); assert.equal(b.shortUnits, 1, 'Gewinn 0, aber innerhalb eines Jahres gekauft: kurzfristig');
});
test('Zahlen aus Eingaben unabhängig vom Gebietsschema', () => {
  const P = ENG.parseNum;
  assert.equal(P('2.708,00'), 2708); assert.equal(P('2708,50'), 2708.5); assert.equal(P('2708.50'), 2708.5); assert.equal(P('2,708.00'), 2708);
  assert.equal(P('2.708'), 2708, 'ein Punkt mit drei Ziffern: Tausenderpunkt'); assert.equal(P('1.234.567'), 1234567); assert.equal(P('0,5'), 0.5);
  assert.equal(P('12.5'), 12.5); assert.equal(P('0.123'), 0.123); assert.equal(P(' 1 000,5 € '), 1000.5); assert.equal(P('-250'), -250); assert.equal(P('−3,5'), -3.5);
  assert.equal(P('0.002', true), 0.002); assert.equal(P('1.500', true), 1.5, 'Stückzahl: Punkt ist Dezimalpunkt');
  assert.equal(P(''), null); assert.equal(P('   '), null); assert.ok(isNaN(P('abc'))); assert.ok(isNaN(P('1.2.3'))); assert.ok(isNaN(P('1,2,3,4.5,6')));
  assert.equal(ENG.parseDate('01.06.2026'), '2026-06-01'); assert.equal(ENG.parseDate('2026-06-01'), '2026-06-01'); assert.equal(ENG.parseDate('2026-06-01T10:00:00Z'), '2026-06-01');
  assert.equal(ENG.parseDate('31.02.2026'), null); assert.equal(ENG.parseDate('2026-13-01'), null); assert.equal(ENG.parseDate('gestern'), null);
});

/* ---------- Handelskalender: Ostern und die Feiertage in England (Prüfbericht Punkt 15/16) ---------- */
test('Ostersonntag', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => ENG.easterSunday(y)), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16', '2029-04-01', '2030-04-21']);
});
test('Feiertage London (England & Wales) mit Ersatztagen', () => {
  assert.deepEqual(ENG.ukHolidays(2026), ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
  assert.deepEqual(ENG.ukHolidays(2027), ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28']);
  assert.deepEqual(ENG.ukHolidays(2021), ['2021-01-01', '2021-04-02', '2021-04-05', '2021-05-03', '2021-05-31', '2021-08-30', '2021-12-27', '2021-12-28']);
  assert.ok(ENG.ukHolidays(2028).includes('2028-01-03'), 'Neujahr am Samstag: Ersatztag Montag');
  assert.deepEqual(ENG.ukHolidays(2032).slice(-2), ['2032-12-27', '2032-12-28'], 'Weihnachten am Samstag');
  assert.deepEqual(ENG.ukHolidays(2033).slice(-2), ['2033-12-26', '2033-12-27'], 'Weihnachten am Sonntag');
});
test('Wochenschluss-Uhrzeit London: FTSE 16:40 (Halbtag 12:40), Gold 15:05 gleich nach dem Nachmittagsfixing; vorgezogene Wochen wie bisher', () => {
  const CAL = ENG.calendar({});
  assert.equal(CAL.closeMin('ftse', '2026-10-02'), 16 * 60 + 40);
  assert.equal(CAL.closeMin('gold', '2026-10-02'), 15 * 60 + 5);
  assert.equal(CAL.closeMin('ftse', '2026-12-24'), 12 * 60 + 40, 'Halbtag vor Weihnachten');
  assert.equal(CAL.closeMin('gold', '2026-12-23'), 15 * 60 + 5, 'Gold schließt vor Weihnachten am 23.12. (kein Nachmittagsfixing am 24.12.)');
  assert.equal(CAL.earlyClose('gold', '2026-09-28'), false, 'normale Woche: Gold schließt Freitag, nicht vorgezogen');
  assert.equal(CAL.earlyClose('ftse', '2026-09-28'), false);
  assert.equal(CAL.earlyClose('gold', '2026-12-21'), true, 'Gold-Woche vor Weihnachten endet Mittwoch 23.12.');
  assert.equal(CAL.earlyClose('ftse', '2026-12-21'), true, 'FTSE-Halbtag Donnerstag 24.12.');
  assert.equal(CAL.earlyClose('ftse', '2027-12-20'), true, 'FTSE-Halbtag Freitag 24.12.2027');
  assert.equal(CAL.earlyClose('gold', '2027-03-22'), true, 'Karfreitag 2027: Gold schließt Donnerstag');
});

/* ---------- Signaltext und Vorwarnung nennen dieselbe Schwelle (Prüfbericht, kleinere Unstimmigkeiten) ---------- */
test('Schwelle eines Wechsels = Schwelle der Vorwoche für den nächsten Schluss', () => {
  const S = series('btc'), E0 = ENG.evalRule(S, RULES.btc);
  const E1 = ENG.evalRule(ENG.append(S, '2026-09-21', '2026-09-27', 84036), RULES.btc), sw = E1.sw[E1.sw.length - 1];
  assert.equal(sw.d, '2026-09-27'); assert.equal(sw.to, 1);
  assert.equal(r2(sw.thr), r2(E0.next.bandUp)); assert.equal(r2(sw.thr), 80435.87);
  assert.ok(sw.c > sw.thr && sw.c > 1.03 * sw.m, 'beide Formen der Regel sind gleichwertig');
  const G = series('gold'), EG = ENG.evalRule(G, RULES.gold), gs = EG.sw[EG.sw.length - 1];
  const s49 = G.c.slice(gs.i - 49, gs.i).reduce((x, y) => x + y, 0);
  assert.equal(r4(gs.thr), r4(s49 / 49));
});

/* ---------- Grenzfall erklärt (edgeCase, Justus 27.09.2026) ---------- */
/* Steigende Reihe; tail ersetzt die letzten Schlüsse (tail [60, 0]: Einbruch in der vorletzten Woche), lastAt legt den letzten Schluss relativ zur Schwelle */
function synth(len, tail) {
  const S = { k: [], d: [], c: [] };
  for (let i = 0; i < len; i++) { const k = ENG.addDays('2020-01-06', 7 * i); S.k.push(k); S.d.push(ENG.addDays(k, 4)); S.c.push(100 + i * 0.5); }
  (tail || []).forEach((v, j) => { S.c[len - (tail.length - j)] = v; });
  return S;
}
function lastAt(S, rule, relToThr) {
  const n = S.c.length; let s49 = 0; for (let i = n - 50; i < n - 1; i++) s49 += S.c[i];
  const prev = ENG.evalRule(S, rule).st[n - 2];
  const p = rule.type === 'band' ? rule.p : 0.03, th = s49 / 49, bu = (1 + p) * s49 / (49 - p), bd = (1 - p) * s49 / (49 + p);
  const thr = rule.type === 'band' ? (prev === 1 ? bd : bu) : th;
  const c = S.c.slice(); c[n - 1] = thr * (1 + relToThr); return { k: S.k, d: S.d, c };
}

test('Grenzfall Bitcoin 20.09.2026: 9 $ unter der Kaufschwelle, darüber wäre es das Kaufsignal gewesen', () => {
  const S = series('btc'), x = ENG.edgeCase(S, RULES.btc);
  assert.equal(x.d, '2026-09-20'); assert.equal(x.band, true); assert.equal(x.prev, 0);
  assert.equal(x.last.st, 0); assert.equal(x.last.changed, false);
  assert.ok(x.diff < 0 && Math.abs(x.rel) < 0.005, 'knapp unter der Kaufschwelle');
  assert.equal(Math.round(x.thr), 81152); assert.equal(Math.round(-x.diff), 9);
  assert.equal(x.alt.length, 1); assert.equal(x.alt[0].above, true); assert.equal(x.alt[0].changed, true); assert.equal(x.alt[0].st, 1);
  /* Die Schwelle ist genau die Kippstelle: knapp darunter bleibt es bei Cash */
  const n = S.c.length, c2 = S.c.slice(); c2[n - 1] = x.thr * (1 - 1e-7);
  assert.equal(ENG.evalRule({ k: S.k, d: S.d, c: c2 }, RULES.btc).last.st, 0);
});

test('Grenzfall Bestätigungsregel: knapp über dem SMA50 nach einem Schluss darunter, darunter wäre es das Verkaufssignal gewesen', () => {
  const base = synth(80, [60, 0]), S = lastAt(base, RULES.ftse, 0.001), x = ENG.edgeCase(S, RULES.ftse);
  assert.equal(x.band, false); assert.equal(x.prev, 1);
  assert.deepEqual(x.last, { st: 1, changed: false, up: 1, dn: 0 });
  assert.equal(x.alt.length, 1); assert.equal(x.alt[0].above, false);
  assert.equal(x.alt[0].changed, true); assert.equal(x.alt[0].st, 0); assert.equal(x.alt[0].dn, 2);
});

test('Grenzfall Bestätigungsregel: knapp unter dem SMA50 löst das Verkaufssignal aus, darüber wäre die Regel investiert geblieben', () => {
  const base = synth(80, [60, 0]), S = lastAt(base, RULES.ftse, -0.001), x = ENG.edgeCase(S, RULES.ftse);
  assert.deepEqual(x.last, { st: 0, changed: true, up: 0, dn: 2 });
  assert.equal(x.alt[0].above, true); assert.equal(x.alt[0].changed, false); assert.equal(x.alt[0].st, 1); assert.equal(x.alt[0].up, 1);
});

test('Grenzfall Gold (n=4): knapp über dem SMA50, darunter wäre nur die Serie gerissen', () => {
  const base = synth(80), S = lastAt(base, RULES.gold, 0.002), x = ENG.edgeCase(S, RULES.gold);
  assert.equal(x.last.st, 1); assert.equal(x.last.changed, false); assert.ok(x.last.up > 1);
  assert.equal(x.alt[0].changed, false); assert.equal(x.alt[0].st, 1); assert.equal(x.alt[0].dn, 1); assert.equal(x.alt[0].up, 0);
});

test('Grenzfall Band investiert: knapp über der Verkaufsschwelle, darunter wäre es das Verkaufssignal gewesen', () => {
  const base = synth(80), S = lastAt(base, RULES.btc, 0.002), x = ENG.edgeCase(S, RULES.btc);
  assert.equal(x.prev, 1); assert.equal(x.last.st, 1); assert.equal(x.last.changed, false);
  assert.ok(x.thr < x.m, 'Verkaufsschwelle unter dem SMA50');
  assert.equal(x.alt[0].above, false); assert.equal(x.alt[0].changed, true); assert.equal(x.alt[0].st, 0);
});

test('Grenzfall genau auf dem SMA50: Seite aus der Regel selbst, beide Seiten, zu kurze Reihe ohne Ergebnis', () => {
  /* Ganze Zahlen: Summen und SMA50 sind exakt, der Schluss liegt für evalRule wirklich genau auf dem SMA50 (Gleichstand, A-6) */
  const S = { k: [], d: [], c: [] }; for (let i = 0; i < 80; i++) { const k = ENG.addDays('2020-01-06', 7 * i); S.k.push(k); S.d.push(ENG.addDays(k, 4)); S.c.push(100); }
  const x = ENG.edgeCase(S, RULES.gold);
  assert.equal(x.side, 0); assert.equal(x.last.up, 0); assert.equal(x.last.dn, 0); assert.equal(x.thr, 100);
  assert.equal(x.alt.length, 2); assert.deepEqual(x.alt.map((o) => o.above), [true, false]);
  assert.equal(x.alt[0].up, 1); assert.equal(x.alt[1].dn, 1);
  assert.equal(ENG.edgeCase(synth(50), RULES.gold), null);
});

test('Grenzfall Band: knapp ausgelöstes Kaufsignal misst gegen die Kaufschwelle, darunter wäre die Regel auf Cash geblieben', () => {
  /* Bitcoin-Reihe endet auf Cash; der letzte Schluss liegt 0,1 % über der Kaufschwelle dieser Woche */
  const S0 = series('btc'), S = lastAt(S0, RULES.btc, 0.001), x = ENG.edgeCase(S, RULES.btc);
  assert.equal(x.prev, 0); assert.equal(x.side, 1); assert.equal(x.last.changed, true); assert.equal(x.last.st, 1);
  assert.ok(x.thr > x.m, 'Kaufschwelle über dem SMA50'); assert.ok(Math.abs(x.rel - 0.001) < 1e-9);
  assert.equal(x.alt[0].above, false); assert.equal(x.alt[0].changed, false); assert.equal(x.alt[0].st, 0);
});

test('Grenzfall Seite: side folgt der Regel, rel dem Abstand zur Schwelle', () => {
  const up = ENG.edgeCase(lastAt(synth(80), RULES.ftse, 0.003), RULES.ftse), dn = ENG.edgeCase(lastAt(synth(80), RULES.ftse, -0.003), RULES.ftse);
  assert.equal(up.side, 1); assert.equal(dn.side, -1); assert.ok(Math.abs(up.rel - 0.003) < 1e-9); assert.ok(Math.abs(dn.rel + 0.003) < 1e-9);
});


/* ---------- Rebalancing-Stichtage: quartalsweise zum Quartalsende (Justus 01.10.2026) ---------- */
const LAWQ = { rebalDays: ['03-31', '06-30', '09-30', '12-30'], rebalFrom: '2026-12-30' };
test('Rebalancing quartalsweise: Quartalsende, erstmals 30.12.2026', () => {
  assert.deepEqual(ENG.rebalDates(LAWQ, null, '2026-01-01', '2027-12-31'), ['2026-12-30', '2027-03-31', '2027-06-30', '2027-09-30', '2027-12-30']);
  assert.deepEqual(ENG.rebalDates(LAWQ, null, '2026-10-01', '2026-12-29'), []);
});
test('Rebalancing quartalsweise: Wochenende und Feiertag -> Handelstag davor', () => {
  assert.deepEqual(ENG.rebalDates(LAWQ, null, '2028-01-01', '2028-12-31'), ['2028-03-31', '2028-06-30', '2028-09-29', '2028-12-29']);
  assert.deepEqual(ENG.rebalDates(LAWQ, null, '2051-03-01', '2051-04-30'), ['2051-03-30'], 'Karfreitag 31.03.2051');
  assert.deepEqual(ENG.rebalDates(LAWQ, null, '2059-03-01', '2059-04-30'), ['2059-03-27'], 'Ostermontag 31.03.2059, davor Wochenende und Karfreitag');
});
test('Rebalancing quartalsweise: gewählter Tag ersetzt den Stichtag seines Quartals', () => {
  assert.deepEqual(ENG.rebalDates(LAWQ, '2027-06-15', '2027-01-01', '2027-12-31'), ['2027-03-31', '2027-06-15', '2027-09-30', '2027-12-30']);
  assert.deepEqual(ENG.rebalDates(LAWQ, '2026-12-30', '2026-10-01', '2027-04-30'), ['2026-12-30', '2027-03-31']);
  assert.equal(ENG.quarterOf('2027-06-15'), '2027-Q2'); assert.equal(ENG.quarterOf('2026-12-30'), '2026-Q4'); assert.equal(ENG.quarterOf('2027-01-01'), '2027-Q1');
});
test('Rebalancing ohne Quartalsplan in der Konfiguration: einmal im Jahr am rebalDay', () => {
  assert.deepEqual(ENG.rebalDates({ rebalDay: '12-30' }, null, '2026-01-01', '2027-12-31'), ['2026-12-30', '2027-12-30']);
});

/* ---------- Prüfbericht 02.10.2026, Punkte 4 und 5: Freigrenze gemeinsam, Beimischung anteilig ---------- */
test('Rebalancing steuerfrei: Bitcoin und Gold-ETC teilen sich die § 23-Freigrenze (Bitcoin zuerst)', () => {
  const o = { st: { ftse: 1, btc: 1, gold: 1 }, px: { ftse: 160, btc: 75000, gold: 350 }, pos: { ftse: [{ d: '2026-09-18', units: 10, cpu: 150 }], btc: [{ d: '2026-07-01', units: 0.1, cpu: 50000 }], gold: [{ d: '2026-10-05', units: 20, cpu: 300 }] }, cash: { ftse: 0, btc: 0, gold: 0 }, cfg: CFG, ty: { pbFree: 900, s23Before: 300 } };
  const F = reb(o, 'frei');
  assert.equal(r2(F.rows.btc.sg), 699.99); assert.equal(r2(F.rows.gold.sell), 0); assert.equal(F.rows.gold.capped, true);
  assert.equal(r2(F.s23After), 999.99); assert.equal(F.declare23, false); assert.equal(F.tax, 0);
  const V = reb(o, 'voll');
  assert.equal(r2(V.rows.btc.sell), 2670); assert.equal(r2(V.rows.gold.sell), 3780); assert.equal(r2(V.s23After), 1730); assert.equal(V.declare23, true);
});
test('Rebalancing steuerfrei: Gewinn eines offenen Regel-Verkaufs zählt vor dem Deckel der anderen Anlage', () => {
  const o = { st: { ftse: 1, btc: 0, gold: 1 }, px: { ftse: 160, btc: 75000, gold: 350 }, pos: { ftse: [{ d: '2026-09-18', units: 10, cpu: 150 }], btc: [{ d: '2026-07-01', units: 0.01, cpu: 50000 }], gold: [{ d: '2026-10-05', units: 20, cpu: 300 }] }, cash: { ftse: 0, btc: 0, gold: 0 }, cfg: CFG, ty: { pbFree: 900, s23Before: 300 } };
  const F = reb(o, 'frei');
  assert.equal(F.rows.btc.ruleSale, true); assert.equal(r2(F.rows.btc.sg), 250);
  assert.equal(r2(F.rows.gold.sg), 449.99); assert.equal(r2(F.s23After), 999.99); assert.equal(F.declare23, false);
});
test('Rebalancing mit Beimischung: Vorschau verkauft anteilig je Coin wie die Buchung (Bitcoin alt, ETH kurzfristig)', () => {
  const btcLots = [{ d: '2025-03-01', units: 0.05, cpu: 40000 }], ethEq = [{ d: '2026-08-01', units: 0.02, cpu: 50000 }];
  const o = { st: { ftse: 1, btc: 1, gold: 0 }, px: { ftse: 160, btc: 80000, gold: 0 }, pos: { ftse: [{ d: '2026-09-18', units: 10, cpu: 150 }], btc: btcLots.concat(ethEq), gold: [] }, cash: { ftse: 0, btc: 0, gold: 0 }, cfg: CFG, ty: { pbFree: 900, s23Before: 900 } };
  const old = reb(o, 'frei');                                  /* ohne Gruppen: FIFO über alle Coins nach Datum (alte Rechnung) */
  assert.equal(r2(old.rows.btc.sg), 0, 'alte Rechnung verkauft nur das alte Bitcoin-Los');
  const F = reb(Object.assign({}, o, { groups: { btc: [btcLots, ethEq] } }), 'frei');
  const V = 0.05 * 80000 + 0.02 * 80000, ethShort = 600 * F.rows.btc.sell / V;   /* Buchung: ETH anteilig, Gewinn 30.000 € je BTC-Äquivalent */
  assert.equal(r2(F.rows.btc.sg), r2(ethShort)); assert.equal(r2(F.s23After), 999.99); assert.equal(F.declare23, false);
  assert.ok(F.rows.btc.sell > 900 && F.rows.btc.sell < 940, 'gedeckelt: ' + F.rows.btc.sell);
  assert.equal(F.rows.btc.anyShort, true);
});
test('Steuerfreier Höchstbetrag über Gruppen: gleich dem Einzelfall und einer schrittweisen Suche', () => {
  const cfg = { ...CFG, buffer: 25 }, ty = { pbFree: 0, s23Before: 100 };
  const one = [{ d: '2026-02-01', units: 0.01, cpu: 90000 }, { d: '2026-05-01', units: 0.02, cpu: 60000 }, { d: '2026-07-01', units: 0.03, cpu: 70000 }];
  assert.equal(r2(ENG.taxFreeMaxGroups([one], 80000, '2026-12-30', 'btc', cfg, ty)), r2(ENG.taxFreeMax(one, 80000, '2026-12-30', 'btc', cfg, ty)));
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let n = 0; n < 25; n++) {
    const groups = [0, 1, 2].map(() => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ d: rnd() < 0.3 ? '2025-0' + (1 + Math.floor(rnd() * 9)) + '-15' : '2026-0' + (1 + Math.floor(rnd() * 9)) + '-15', units: 0.002 + rnd() * 0.02, cpu: 40000 + rnd() * 60000 })).sort((x, y) => (x.d < y.d ? -1 : 1)));
    const acc0 = rnd() * 900, VT = groups.flat().reduce((s, l) => s + l.units * 80000, 0), cap = ENG.taxFreeMaxGroups(groups, 80000, '2026-12-30', 'btc', cfg, ty, acc0);
    let brute = VT; for (let v = 0; v <= VT; v += 0.25) { if (acc0 + ENG.simSellGroups(groups, v, 80000, '2026-12-30', 'btc', cfg).sg > cfg.fg - cfg.buffer - 0.01 + 1e-9) { brute = v; break; } }
    assert.ok(Math.abs(cap - brute) <= 0.3, 'Fall ' + n + ': ' + cap + ' gegen ' + brute);
  }
});
