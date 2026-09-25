/* Regel-Depot – Depotdaten im Browser (localStorage), Import und Export.
   Schema: {version:1, tx:[{id,d,a,type,units,price,fee,est,note,ts}], cash:{ftse,btc,gold}, tax:{…}, meta:{…}} */
(function (root) {
  'use strict';
  var KEY = 'regelDepot.v1';
  var EMPTY = { version: 1, tx: [], cash: { ftse: 0, btc: 0, gold: 0 }, tax: {}, meta: {} };
  var listeners = [];
  var mem = null; /* Fallback, wenn localStorage nicht geht */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function safeGet() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function safeSet(v) { try { localStorage.setItem(KEY, v); return true; } catch (e) { return false; } }
  function normalize(o) {
    var d = clone(EMPTY);
    if (!o || typeof o !== 'object') return d;
    if (Array.isArray(o.tx)) d.tx = o.tx.filter(function (t) { if (!t || !t.d || !t.a || !t.type) return false; if (t.type === 'einzahlung' || t.type === 'auszahlung') return +t.amount > 0; return +t.units > 0 && +t.price > 0; }).map(function (t, i) {
      var cashMove = t.type === 'einzahlung' || t.type === 'auszahlung';
      return { id: String(t.id || ('tx' + Date.now() + '-' + i)), d: String(t.d).slice(0, 10), a: t.a, type: cashMove ? t.type : (t.type === 'verkauf' ? 'verkauf' : 'kauf'), units: cashMove ? 0 : +t.units, price: cashMove ? 0 : +t.price, amount: cashMove ? +t.amount : 0, fee: +t.fee || 0, est: !!t.est, note: t.note ? String(t.note).slice(0, 300) : '', ts: +t.ts || 0 };
    });
    if (o.cash && typeof o.cash === 'object') ['ftse', 'btc', 'gold'].forEach(function (a) { d.cash[a] = Math.max(0, +o.cash[a] || 0); });
    if (o.tax && typeof o.tax === 'object') d.tax = clone(o.tax);
    if (o.meta && typeof o.meta === 'object') d.meta = clone(o.meta);
    return d;
  }
  function load() {
    if (mem) return clone(mem);
    var raw = safeGet();
    if (!raw) return clone(EMPTY);
    try { return normalize(JSON.parse(raw)); } catch (e) { return clone(EMPTY); }
  }
  function save(d) {
    var n = normalize(d); ['ftse', 'btc', 'gold'].forEach(function (a) { n.cash[a] = Math.round(n.cash[a] * 100) / 100; }); n.meta = n.meta || {}; n.meta.saved = new Date().toISOString();
    if (!safeSet(JSON.stringify(n))) mem = n;
    listeners.forEach(function (fn) { try { fn(n); } catch (e) { /* still */ } });
    return n;
  }
  function has() { var d = load(); return d.tx.length > 0 || Object.keys(d.tax).length > 0 || (d.cash.ftse + d.cash.btc + d.cash.gold) > 0; }
  function update(fn) { var d = load(); fn(d); return save(d); }
  function reset() { try { localStorage.removeItem(KEY); } catch (e) { /* still */ } mem = null; listeners.forEach(function (fn) { fn(clone(EMPTY)); }); }
  function exportJson() { var d = load(); d.meta = d.meta || {}; d.meta.exported = new Date().toISOString(); return JSON.stringify(d, null, 1); }
  function importJson(text) {
    var o = JSON.parse(text);
    if (!o || typeof o !== 'object') throw new Error('Kein gültiges Depot-JSON');
    if (!Array.isArray(o.tx) && !o.cash && !o.tax) throw new Error('Die Datei enthält keine Depotdaten (tx, cash, tax)');
    var n = normalize(o); n.meta = n.meta || {}; n.meta.imported = new Date().toISOString();
    return save(n);
  }
  function onChange(fn) { listeners.push(fn); }

  root.STORE = { load: load, save: save, update: update, reset: reset, has: has, exportJson: exportJson, importJson: importJson, onChange: onChange, KEY: KEY };
})(window);
