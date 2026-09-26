/* Depotdaten: Prüfung beim Import (Prüfbericht 26.09.2026, Punkt 8) und Cash-Vermerke. Start: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ENG = require('../docs/js/engine.js');
function freshStore() {
  const mem = {};
  const ctx = { ENG, localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } }, JSON, Date, Math, String, Number, Array, Object, Error, isFinite, isNaN };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(here, '..', 'docs', 'js', 'store.js'), 'utf8'), ctx);
  ctx.STORE.setAssets(['ftse', 'btc', 'gold', 'eth', 'sol']);
  return ctx.STORE;
}
const base = { version: 1, cash: { ftse: 0, btc: 0, gold: 2708 }, cashDate: '2026-09-25', tax: {} };

test('Import: Art in Großbuchstaben, deutsches Datum und Zahlen mit Komma werden richtig gelesen', () => {
  const S = freshStore();
  const n = S.importJson(JSON.stringify({ ...base, cash: { ftse: '0', btc: '0', gold: '2.708,00' }, tx: [
    { id: 'k', d: '01.06.2026', a: 'BTC', type: 'Kauf', units: '0,01', price: '50.000', fee: '1' },
    { id: 'v', d: '2026-07-01', a: 'btc', type: 'Verkauf', units: 0.005, price: 60000, fee: 1 }
  ] }));
  assert.equal(n.tx.length, 2);
  const k = n.tx.find((t) => t.id === 'k'), v = n.tx.find((t) => t.id === 'v');
  assert.equal(k.type, 'kauf'); assert.equal(k.d, '2026-06-01'); assert.equal(k.a, 'btc'); assert.equal(k.units, 0.01); assert.equal(k.price, 50000);
  assert.equal(v.type, 'verkauf', 'Verkauf bleibt Verkauf');
  assert.equal(n.cash.gold, 2708);
});
test('Import: unlesbare Einträge und ungedeckte Verkäufe lehnen den ganzen Import ab', () => {
  const S = freshStore();
  S.importJson(JSON.stringify({ ...base, tx: [{ id: 'a', d: '2026-06-01', a: 'btc', type: 'kauf', units: 0.01, price: 50000 }] }));
  assert.throws(() => S.importJson(JSON.stringify({ ...base, tx: [{ id: 'x', d: '32.13.2026', a: 'btc', type: 'kauf', units: 1, price: 1 }] })), /Datum/);
  assert.throws(() => S.importJson(JSON.stringify({ ...base, tx: [{ id: 'x', d: '2026-06-01', a: 'btc', type: 'tausch', units: 1, price: 1 }] })), /Art/);
  assert.throws(() => S.importJson(JSON.stringify({ ...base, tx: [{ id: 'x', d: '2026-06-01', a: 'btc', type: 'kauf', units: 'viel', price: 1 }] })), /Stückzahl/);
  assert.throws(() => S.importJson(JSON.stringify({ ...base, tx: [{ id: 'x', d: '2026-06-01', a: 'doge', type: 'kauf', units: 1, price: 1 }] })), /Position/);
  assert.throws(() => S.importJson(JSON.stringify({ ...base, tx: [{ id: 'v', d: '2026-05-01', a: 'btc', type: 'verkauf', units: 1, price: 1 }] })), /ohne passenden Kauf/);
  assert.throws(() => S.importJson('{kaputt'), /kein gültiges JSON/);
  assert.equal(S.load().tx.length, 1, 'der vorherige Stand bleibt');
});
test('Cash-Vermerk und Nachtragen bleiben beim Speichern erhalten', () => {
  const S = freshStore();
  S.save({ ...base, tx: [{ id: 'e', d: '2026-09-26', a: 'gold', type: 'einzahlung', amount: 100, cash: 0, hist: true, note: 'x' }, { id: 'k', d: '2026-09-26', a: 'gold', type: 'kauf', units: 1, price: 100, cash: -60 }] });
  const d = S.load();
  assert.equal(d.tx[0].hist, true); assert.equal(d.tx[0].cash, 0); assert.equal(d.tx[1].cash, -60);
});
