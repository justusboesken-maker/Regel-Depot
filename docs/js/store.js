/* Regel-Depot – Depotdaten im Browser (localStorage), Import und Export.
   Schema: {version:1, tx:[{id,d,a,type,units,price,amount,fee,est,note,ts,cash?,hist?}], cash:{ftse,btc,gold}, cashDate:'JJJJ-MM-TT' (seit wann das Cash so feststeht), tax:{…}, meta:{…}}
   tx.cash: Betrag, um den die Buchung beim Eintragen das Cash des Bausteins tatsächlich verändert hat (Löschen bucht genau das zurück; fehlt er, z. B. bei importierten Buchungen, ändert Löschen das Cash nicht).
   tx.hist: nur nachgetragen (die Bewegung ist im heutigen Cash schon enthalten). */
(function (root) {
  'use strict';
  var KEY = 'regelDepot.v1';
  var EMPTY = { version: 1, tx: [], cash: { ftse: 0, btc: 0, gold: 0 }, cashDate: '', tax: {}, meta: {} };
  var TYPES = ['kauf', 'verkauf', 'einzahlung', 'auszahlung'];
  var TAX_NUM = ['pbUsed', 'interestRest', 'lossOther', 's23Other', 'rate', 'headroom', 'buffer', 'minOrder', 'cashRate'];
  var ASSETS = null; /* bekannte Positionen laut Konfiguration (setAssets), für die Prüfung beim Import */
  var listeners = [];
  var mem = null; /* Fallback, wenn localStorage nicht geht */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function safeGet() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function safeSet(v) { try { localStorage.setItem(KEY, v); return true; } catch (e) { return false; } }
  function E() { return root.ENG; }
  function dfmt(d) { return d && d.length >= 10 ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : String(d); }
  function show(v) { return v == null ? '(leer)' : '„' + String(v).slice(0, 24) + '“'; }
  /* Zahl aus Datei oder Speicher: Zahlen direkt, Text auch mit Komma („0,5“, „2.708,00“). null = leer, NaN = unlesbar */
  function num(v, units) { if (typeof v === 'number') return isFinite(v) ? v : NaN; if (v == null || v === '') return null; return E() && E().parseNum ? E().parseNum(v, units) : NaN; }

  /* Eine Buchung lesen: {tx} oder {err}. Art ohne Rücksicht auf Groß-/Kleinschreibung, Datum auch als TT.MM.JJJJ, Zahlen auch mit Komma. */
  function readTx(t, i, strict) {
    var where = 'Buchung ' + (i + 1);
    if (!t || typeof t !== 'object') return { err: where + ': kein Eintrag' };
    var type = String(t.type == null ? '' : t.type).trim().toLowerCase(), d = E().parseDate(t.d), a = String(t.a == null ? '' : t.a).trim().toLowerCase();
    if (d) where += ' vom ' + dfmt(d);
    if (TYPES.indexOf(type) < 0) return { err: where + ': Art ' + show(t.type) + ' unbekannt (erlaubt: Kauf, Verkauf, Einzahlung, Auszahlung)' };
    if (!d) return { err: where + ': Datum ' + show(t.d) + ' ungültig (erwartet JJJJ-MM-TT oder TT.MM.JJJJ)' };
    if (!a || (strict && ASSETS && ASSETS.indexOf(a) < 0)) return { err: where + ': Position ' + show(t.a) + ' unbekannt' + (ASSETS ? ' (erlaubt: ' + ASSETS.join(', ') + ')' : '') };
    var cashMove = type === 'einzahlung' || type === 'auszahlung';
    var out = { id: String(t.id || ('tx' + Date.now() + '-' + i)), d: d, a: a, type: type, units: 0, price: 0, amount: 0, fee: 0, est: !!t.est, note: t.note ? String(t.note).slice(0, 300) : '', ts: +t.ts || 0 };
    if (cashMove) { var am = num(t.amount); if (!(am > 0)) return { err: where + ': Betrag ' + show(t.amount) + ' ungültig' }; out.amount = am; }
    else {
      var u = num(t.units, true), p = num(t.price);
      if (!(u > 0)) return { err: where + ': Stückzahl ' + show(t.units) + ' ungültig' };
      if (!(p > 0)) return { err: where + ': Kurs ' + show(t.price) + ' ungültig' };
      out.units = u; out.price = p;
    }
    var fee = num(t.fee); if (fee != null && !(fee >= 0)) return { err: where + ': Gebühr ' + show(t.fee) + ' ungültig' }; out.fee = fee || 0;
    var ca = num(t.cash); if (ca != null && isFinite(ca)) out.cash = ca;
    if (t.hist === true || t.hist === 'true' || (cashMove && t.cash == null && /\(nachgetragen[,)]/.test(out.note))) out.hist = true;
    return { tx: out };
  }
  /* strict (Import): jeder Fehler bricht ab, mit Liste; sonst (Speicher) werden unlesbare Einträge wie bisher übergangen */
  function normalize(o, strict) {
    var d = clone(EMPTY), errs = [];
    if (!o || typeof o !== 'object' || Array.isArray(o)) { if (strict) throw new Error('Kein gültiges Depot-JSON'); return d; }
    if (o.tx != null && !Array.isArray(o.tx)) errs.push('„tx“ ist keine Liste');
    if (Array.isArray(o.tx)) { var seen = {}; o.tx.forEach(function (t, i) { var r = readTx(t, i, strict); if (r.err) { errs.push(r.err); return; } if (seen[r.tx.id]) r.tx.id += '-' + i; seen[r.tx.id] = 1; d.tx.push(r.tx); }); }
    if (o.cash && typeof o.cash === 'object') ['ftse', 'btc', 'gold'].forEach(function (a) { var v = num(o.cash[a]); if (v == null) return; if (!(v >= 0)) { errs.push('Cash ' + a + ' ' + show(o.cash[a]) + ' ungültig'); return; } d.cash[a] = v; });
    if (o.cashDate) { var cd = E().parseDate(o.cashDate); if (cd) d.cashDate = cd; else errs.push('Cash-Datum ' + show(o.cashDate) + ' ungültig'); }
    if (o.tax && typeof o.tax === 'object') {
      d.tax = clone(o.tax);
      TAX_NUM.forEach(function (k) { var v = d.tax[k]; if (v == null || v === '' || typeof v === 'number') return; var x = num(v); if (x == null) { d.tax[k] = null; return; } if (isNaN(x)) { errs.push('Steuerangabe ' + k + ' ' + show(v) + ' ungültig'); delete d.tax[k]; return; } d.tax[k] = x; });
      ['pbUsedDate', 'rebalDate'].forEach(function (k) { var v = d.tax[k]; if (!v) return; var x = E().parseDate(v); if (x) d.tax[k] = x; else { errs.push('Steuerangabe ' + k + ' ' + show(v) + ' ungültig'); d.tax[k] = ''; } });
    }
    if (o.meta && typeof o.meta === 'object') d.meta = clone(o.meta);
    if (strict) {
      /* Jeder Verkauf braucht einen Kauf davor (FIFO); sonst zählte der Erlös als Gewinn */
      if (!errs.length) E().book(d.tx.filter(function (t) { return t.type === 'kauf' || t.type === 'verkauf'; })).real.forEach(function (r) { if (r.open > 1e-9) errs.push('Verkauf vom ' + dfmt(r.d) + ' (' + r.a + '): ' + String(Math.round(r.open * 1e6) / 1e6).replace('.', ',') + ' Stück ohne passenden Kauf davor'); });
      if (errs.length) throw new Error('Import abgelehnt, nichts wurde geändert. ' + errs.slice(0, 6).join('; ') + (errs.length > 6 ? '; … und ' + (errs.length - 6) + ' weitere' : '') + '.');
    }
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
    var o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('Das ist kein gültiges JSON (' + e.message + ')'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Kein gültiges Depot-JSON');
    if (!Array.isArray(o.tx) && !o.cash && !o.tax) throw new Error('Die Datei enthält keine Depotdaten (tx, cash, tax)');
    var n = normalize(o, true); n.meta = n.meta || {}; n.meta.imported = new Date().toISOString();
    return save(n);
  }
  function setAssets(list) { ASSETS = (list || []).map(function (x) { return String(x).toLowerCase(); }); }
  function onChange(fn) { listeners.push(fn); }

  root.STORE = { load: load, save: save, update: update, reset: reset, has: has, exportJson: exportJson, importJson: importJson, setAssets: setAssets, onChange: onChange, KEY: KEY };
})(window);
