/* Vergleich mit Buy & Hold 50/30/20 (Justus 26.09.2026): zeitgewichtete Rendite, Buy-&-Hold-Depot, Drawdown. Start: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ENG = require('../docs/js/engine.js');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + ' ≠ ' + b);
const W = { ftse: 0.5, btc: 0.3, gold: 0.2 };

test('Zeitgewichtet: ohne Zahlungen einfach Wert / Startwert', () => {
  const idx = ENG.twrIndex([200, 210, 189, 231], [0, 0, 0, 0]);
  [1, 1.05, 0.945, 1.155].forEach((v, i) => close(idx[i], v));
});

test('Zeitgewichtet: Ein- und Auszahlungen erscheinen nicht als Gewinn oder Verlust', () => {
  /* Tag 1 +10 %, Tag 2 Einzahlung 1.000 € bei gleichen Kursen, Tag 3 +10 % auf alles */
  const a = ENG.twrIndex([100, 110, 1110, 1221], [0, 0, 1000, 0]);
  close(a[1], 1.1); close(a[2], 1.1); close(a[3], 1.21);
  /* Tag 1 +20 %, Tag 2 Auszahlung 50 € bei gleichen Kursen, Tag 3 −10 % */
  const b = ENG.twrIndex([100, 120, 70, 63], [0, 0, -50, 0]);
  close(b[1], 1.2); close(b[2], 1.2); close(b[3], 1.08);
  /* Zahlung am Starttag steckt im Startwert */
  close(ENG.twrIndex([500, 550], [400, 0])[1], 1.1);
  /* Unstimmiger Tag (Zahlung größer als der Wert): Index bleibt stehen statt auf 0 zu fallen */
  const c = ENG.twrIndex([100, 50, 55], [0, 80, 0]);
  close(c[1], 1); close(c[2], 1.1);
});

test('Buy & Hold: kauft 50/30/20 zum Tagesschluss und lässt die Anteile laufen', () => {
  const px = { ftse: [100, 110, 121], btc: [1000, 800, 800], gold: [10, 10, 12] };
  const r = ENG.buyHold(px, W, 1000, [0, 0, 0], [false, false, false]);
  close(r.units.ftse, 5); close(r.units.btc, 0.3); close(r.units.gold, 20);
  close(r.vals[1], 550 + 240 + 200); close(r.idx[1], 0.99);
  close(r.vals[2], 605 + 240 + 240); close(r.idx[2], 1.085);
});

test('Buy & Hold: Rebalancing am Stichtag setzt auf 50/30/20 zurück, der Wert bleibt gleich', () => {
  const px = { ftse: [100, 120, 120, 132], btc: [1000, 1000, 1000, 1000], gold: [10, 10, 10, 10] };
  const r = ENG.buyHold(px, W, 1000, [0, 0, 0, 0], [false, false, true, false]);
  /* Tag 1: FTSE +20 % → 600 + 300 + 200 = 1.100; Tag 2 Rebalancing: 550 / 330 / 220 */
  close(r.vals[2], 1100);
  close(r.units.ftse * 132, 550 * 1.1); close(r.units.btc * 1000, 330); close(r.units.gold * 10, 220);
  close(r.vals[3], 605 + 330 + 220); close(r.idx[3], 1155 / 1000);
});

test('Buy & Hold: Einzahlung wird 50/30/20 gekauft, Auszahlung anteilig verkauft, der Index springt nicht', () => {
  const px = { ftse: [100, 100, 110, 110], btc: [1000, 1000, 1000, 1000], gold: [10, 10, 10, 10] };
  const r = ENG.buyHold(px, W, 1000, [0, 1000, 0, -525], [false, false, false, false]);
  close(r.vals[1], 2000); close(r.idx[1], 1);
  /* Tag 2: 10 FTSE-Anteile +10 % → 1.100 + 600 + 400 = 2.100 */
  close(r.vals[2], 2100); close(r.idx[2], 1.05);
  /* Tag 3: Auszahlung 525 € = 25 % aus jeder Anlage */
  close(r.vals[3], 1575); close(r.idx[3], 1.05);
  close(r.units.ftse, 7.5); close(r.units.btc, 0.45); close(r.units.gold, 30);
});

test('Drawdown: Abstand zum bisherigen Hoch, tiefster Rückgang mit Hoch und Tief, aktueller Rückgang', () => {
  const d = ENG.drawdown([1, 1.25, 1, 1.125, 1.5, 1.2]);
  [0, 0, -0.2, -0.1, 0, -0.2].forEach((v, i) => close(d.dd[i], v));
  close(d.max.v, -0.2); assert.equal(d.max.peak, 1); assert.equal(d.max.trough, 2);
  close(d.cur, -0.2);
  const up = ENG.drawdown([1, 1.01, 1.02]);
  assert.equal(up.max.v, 0); assert.equal(up.max.peak, -1); assert.equal(up.cur, 0);
});
