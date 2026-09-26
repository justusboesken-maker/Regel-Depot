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
function freshStore(mem = {}, failKey = null) {
  const fails = (k) => (typeof failKey === 'function' ? failKey(k) : failKey && k === failKey);
  const ctx = { ENG, localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { if (fails(k)) throw new Error('QuotaExceededError'); mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } }, JSON, Date, Math, String, Number, Array, Object, Error, isFinite, isNaN };
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

/* Schutz der Depotdaten (Prüfbericht Punkt 17, mit Justus am 26.09.2026 festgelegt) */
const KEY = 'regelDepot.v1', BKEY = KEY + '.backups', CKEY = KEY + '.corrupt';
const one = (id, units) => ({ ...base, tx: [{ id, d: '2026-06-01', a: 'btc', type: 'kauf', units, price: 50000 }] });
test('Vor Import und „Alles löschen“ bleibt der alte Stand erhalten (die letzten 3), Wiederherstellen holt ihn zurück', () => {
  const mem = {}, S = freshStore(mem);
  S.importJson(JSON.stringify(one('a', 0.01)));
  assert.equal(S.backupList().length, 0, 'vorher gab es nichts zu sichern');
  S.importJson(JSON.stringify(one('b', 0.02)));
  S.importJson(JSON.stringify(one('c', 0.03)));
  S.reset();
  assert.equal(S.has(), false);
  S.importJson(JSON.stringify(one('d', 0.04)));
  const list = S.backupList();
  assert.equal(list.length, 3, 'höchstens drei frühere Stände');
  assert.deepEqual(list.map((b) => b.reason), ['vor dem Löschen', 'vor dem Import', 'vor dem Import']);
  assert.deepEqual(list.map((b) => b.tx), [1, 1, 1]);
  const n = S.restore(0);
  assert.equal(n.tx[0].id, 'c', 'Stand vor dem Löschen');
  assert.equal(S.load().tx[0].id, 'c');
  assert.equal(S.backupList()[0].reason, 'vor dem Wiederherstellen', 'der ersetzte Stand ist selbst gesichert');
  assert.equal(JSON.parse(mem[BKEY])[0].raw.includes('"d"'), true);
});
test('Lässt sich der alte Stand nicht ablegen, ändern Import und Löschen nichts', () => {
  const mem = {};
  freshStore(mem).importJson(JSON.stringify(one('a', 0.01)));
  const S = freshStore(mem, BKEY);
  assert.throws(() => S.importJson(JSON.stringify(one('b', 0.02))), /nichts geändert/);
  assert.throws(() => S.reset(), /nichts geändert/);
  assert.equal(S.load().tx[0].id, 'a');
  S.exportJson();
  S.importJson(JSON.stringify(one('b', 0.02)));
  assert.equal(S.load().tx[0].id, 'b', 'nach „Als Datei sichern“ geht es weiter');
  assert.equal(S.lastBackup(), 'file');
});
test('Ein unlesbarer Stand verdrängt keine lesbaren früheren Stände', () => {
  const mem = {}, S = freshStore(mem);
  S.importJson(JSON.stringify(one('a', 0.01)));
  S.importJson(JSON.stringify(one('b', 0.02)));
  mem[KEY] = 'kaputt';
  const T = freshStore(mem);
  T.importJson(JSON.stringify(one('c', 0.03)));
  assert.deepEqual(T.backupList().map((b) => b.ok), [true], 'nur der lesbare Stand „a“ liegt in der Liste');
  assert.equal(T.lastBackup(), 'none');
  assert.equal(JSON.parse(mem[CKEY])[0].raw, 'kaputt');
});
test('Nach einem gescheiterten Schreiben gilt der nächste gelungene Stand', () => {
  const mem = {}; let full = true;
  const S = freshStore(mem, (k) => full && k === KEY);
  S.save(one('eins', 0.01));
  assert.equal(S.load().tx[0].id, 'eins'); assert.equal(S.memOnly(), true);
  full = false;
  S.save(one('zwei', 0.02));
  assert.equal(S.load().tx[0].id, 'zwei'); assert.equal(S.memOnly(), false);
  assert.equal(JSON.parse(mem[KEY]).tx[0].id, 'zwei');
});
test('Unlesbarer Speicher wird erkannt, aufgehoben und nie still überschrieben', () => {
  const mem = { [KEY]: '{"version":1,"tx":[{"id":"a"' };
  const S = freshStore(mem);
  assert.equal(S.has(), false, 'zeigt ein leeres Depot');
  const c = S.corruptInfo();
  assert.ok(c && c.kept, 'erkannt und aufgehoben');
  assert.equal(JSON.parse(mem[CKEY])[0].raw, '{"version":1,"tx":[{"id":"a"');
  S.importJson(JSON.stringify(one('neu', 0.01)));
  assert.equal(S.load().tx[0].id, 'neu');
  assert.equal(JSON.parse(mem[CKEY])[0].raw, '{"version":1,"tx":[{"id":"a"', 'Rohdaten bleiben nach dem Import erhalten');
  assert.ok(freshStore(mem).corruptInfo(), 'Hinweis bleibt nach dem Neuladen');
  S.dropCorrupt();
  assert.equal(S.corruptInfo(), null);
  assert.equal(mem[CKEY], undefined);
  assert.equal(S.load().tx[0].id, 'neu', 'der gültige Stand bleibt');
});
test('Unlesbarer Speicher, der sich nicht aufheben lässt: Speichern wird verweigert, bis die Rohdaten heruntergeladen sind', () => {
  const mem = { [KEY]: 'kaputt' };
  const S = freshStore(mem, CKEY);
  assert.equal(S.corruptInfo().kept, false);
  assert.throws(() => S.save(one('x', 0.01)), /Rohdaten/);
  assert.throws(() => S.reset(), /Rohdaten/);
  assert.equal(mem[KEY], 'kaputt');
  assert.equal(S.corruptRaw()[0].raw, 'kaputt');
  S.rawSaved();
  assert.equal(S.corruptInfo().kept, false); assert.equal(S.corruptInfo().downloaded, true);
  S.save(one('x', 0.01));
  assert.equal(S.load().tx[0].id, 'x');
});
test('Import: Buchungen mit Datum in der Zukunft werden abgelehnt', () => {
  const S = freshStore();
  const t = new Date(Date.now() + 3 * 86400000), d = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  assert.throws(() => S.importJson(JSON.stringify({ ...base, tx: [{ id: 'z', d, a: 'btc', type: 'kauf', units: 0.01, price: 50000 }] })), /Zukunft/);
});
