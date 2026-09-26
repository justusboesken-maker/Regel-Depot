/* Regel-Depot 50/30/20 – Rechenkern
   Läuft im Browser (window.ENG) und in Node (module.exports).
   Serien, SMA50, Regeln, Schwellen, Depot (FIFO), Steuern, Rebalancing, Vorabpauschale.
   Fachliche Grundlage: Übergabedokument, Abschnitt 8. Annahmen A-1, A-2, A-6, A-7, A-9 sind markiert. */
(function (root) {
  'use strict';
  var DAY = 864e5;

  /* ---------- Datum ---------- */
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(d, n) { return iso(new Date(d + 'T00:00:00Z').getTime() + n * DAY); }
  function mondayOf(d) { var dt = new Date(d + 'T00:00:00Z'); var dow = (dt.getUTCDay() + 6) % 7; return iso(dt.getTime() - dow * DAY); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY); }
  /* Ende der Jahresfrist (§ 23): gleicher Kalendertag im Folgejahr; 29.02. -> 28.02. */
  function oneYearAfter(d) { var y = +d.slice(0, 4) + 1, md = d.slice(5); if (md === '02-29') md = '02-28'; return y + '-' + md; }
  function isLongTerm(buy, sell) { return sell > oneYearAfter(buy); }
  function taxFreeFrom(buy) { return addDays(oneYearAfter(buy), 1); }

  /* ---------- Wochenserien ----------
     Serie S = {k:[Montag der Woche], d:[Datum des Wochenschlusses], c:[Schluss]} */
  function fromRows(rows) {
    var S = { k: [], d: [], c: [] };
    (rows || []).forEach(function (r) { if (r && r[0] && r[2] > 0) { S.k.push(r[0]); S.d.push(r[1] || addDays(r[0], 4)); S.c.push(+r[2]); } });
    return S;
  }
  function toRows(S, dec) {
    var out = [], f = Math.pow(10, dec == null ? 4 : dec);
    for (var i = 0; i < S.k.length; i++) out.push([S.k[i], S.d[i], Math.round(S.c[i] * f) / f]);
    return out;
  }
  /* Tagesdaten -> Wochenpunkte. cutoffKey: Wochen ab diesem Montag werden weggelassen (laufende Woche). */
  function weeklyFromDaily(dates, closes, cutoffKey) {
    var S = { k: [], d: [], c: [] }, cur = null;
    for (var i = 0; i < dates.length; i++) {
      var c = closes[i];
      if (c == null || !isFinite(c) || c <= 0) continue;
      var k = mondayOf(dates[i]);
      if (cutoffKey && k >= cutoffKey) continue;
      if (!cur || cur.k !== k) { if (cur) { S.k.push(cur.k); S.d.push(cur.d); S.c.push(cur.c); } cur = { k: k, d: dates[i], c: c }; }
      else if (dates[i] >= cur.d) { cur.d = dates[i]; cur.c = c; }
    }
    if (cur) { S.k.push(cur.k); S.d.push(cur.d); S.c.push(cur.c); }
    return S;
  }
  /* Gespeicherte Serie mit frisch geladener zusammenführen. Die frische Serie gewinnt in der Überlappung.
     rescale (bereinigte Kurse, FTSE): ältere gespeicherte Wochen werden mit dem Verhältnis frisch/alt der ersten Überlappungswoche skaliert. */
  function mergeWeekly(stored, fresh, rescale) {
    if (!fresh || !fresh.k.length) return stored;
    if (!stored || !stored.k.length) return fresh;
    var map = {}, i, r = null;
    for (i = 0; i < stored.k.length; i++) map[stored.k[i]] = { d: stored.d[i], c: stored.c[i] };
    for (i = 0; i < fresh.k.length; i++) { var m = map[fresh.k[i]]; if (m && m.c > 0 && fresh.c[i] > 0) { r = fresh.c[i] / m.c; break; } }
    if (rescale && r != null && Math.abs(r - 1) > 1e-9) { for (var key in map) if (key < fresh.k[0]) map[key].c *= r; }
    for (i = 0; i < fresh.k.length; i++) map[fresh.k[i]] = { d: fresh.d[i], c: fresh.c[i] };
    var ks = Object.keys(map).sort();
    return { k: ks, d: ks.map(function (x) { return map[x].d; }), c: ks.map(function (x) { return map[x].c; }) };
  }
  function slice(S, n) { var i0 = Math.max(0, S.k.length - n); return { k: S.k.slice(i0), d: S.d.slice(i0), c: S.c.slice(i0) }; }
  function append(S, k, d, c) { return { k: S.k.concat([k]), d: S.d.concat([d]), c: S.c.concat([c]) }; }

  /* ---------- Regel über die ganze Serie ----------
     rule: {type:'confirm', n} (FTSE n=2, Gold n=4) oder {type:'band', p} (Bitcoin p=0,03)
     Gleichstand setzt beide Zähler zurück (A-6). Startzustand beim ersten SMA50: investiert, wenn Schluss darüber (A-7). */
  function evalRule(S, rule) {
    var n = S.c.length, sma = new Array(n), st = new Array(n), up = new Array(n), dn = new Array(n), sum = 0, i;
    for (i = 0; i < n; i++) { sum += S.c[i]; if (i >= 50) sum -= S.c[i - 50]; sma[i] = i >= 49 ? sum / 50 : null; }
    var s = null, u = 0, dw = 0, sw = [];
    for (i = 0; i < n; i++) {
      if (sma[i] == null) { st[i] = null; up[i] = 0; dn[i] = 0; continue; }
      var c = S.c[i], M = sma[i];
      if (c > M) { u++; dw = 0; } else if (c < M) { dw++; u = 0; } else { u = 0; dw = 0; }
      var prev = s;
      if (rule.type === 'band') { if (s === null) s = c > M ? 1 : 0; else if (s === 0 && c > M * (1 + rule.p)) s = 1; else if (s === 1 && c < M * (1 - rule.p)) s = 0; }
      else { if (s === null) s = c > M ? 1 : 0; else if (s === 0 && u >= rule.n) s = 1; else if (s === 1 && dw >= rule.n) s = 0; }
      st[i] = s; up[i] = u; dn[i] = dw;
      if (prev !== null && prev !== s) sw.push({ i: i, k: S.k[i], d: S.d[i], to: s, c: c, m: M });
    }
    var L = n - 1, S49 = 0; for (i = Math.max(0, n - 49); i < n; i++) S49 += S.c[i];
    var p = rule.type === 'band' ? rule.p : 0.03;
    var lastSw = sw.length ? sw[sw.length - 1] : null;
    var last = n ? {
      i: L, k: S.k[L], d: S.d[L], c: S.c[L], m: sma[L], dist: sma[L] ? S.c[L] / sma[L] - 1 : null, st: st[L], up: up[L], dn: dn[L],
      changed: L > 0 && st[L - 1] != null && st[L - 1] !== st[L], lastSwitch: lastSw
    } : null;
    /* Schwellen für den nächsten Wochenschluss (Abschnitt 8.2) */
    return { sma: sma, st: st, up: up, dn: dn, sw: sw, last: last, next: { above: S49 / 49, bandUp: (1 + p) * S49 / (49 - p), bandDown: (1 - p) * S49 / (49 + p) } };
  }
  /* Die Schwelle, an der die Regel beim nächsten Schluss kippt (nur wenn ein einzelner Schluss reicht), sonst die SMA-Grenze */
  function flipThreshold(E, rule) {
    var L = E.last, nx = E.next;
    if (rule.type === 'band') return { thr: L.st === 1 ? nx.bandDown : nx.bandUp, can: true, dir: L.st === 1 ? 'below' : 'above' };
    var need = L.st === 1 ? rule.n - L.dn : rule.n - L.up;
    return { thr: nx.above, can: need <= 1, need: need, dir: L.st === 1 ? 'below' : 'above' };
  }
  /* Was wäre, wenn die laufende Woche mit price schließt */
  function whatIf(S, rule, closeDate, price) {
    var k = mondayOf(closeDate), S2 = S.k.length && S.k[S.k.length - 1] === k ? S : append(S, k, closeDate, price);
    if (S2 === S) { S2 = { k: S.k.slice(), d: S.d.slice(), c: S.c.slice() }; S2.d[S2.d.length - 1] = closeDate; S2.c[S2.c.length - 1] = price; }
    return evalRule(S2, rule);
  }

  /* ---------- Depot: Buchungen -> FIFO-Bestände und realisierte Gewinne ----------
     tx: {id, d, a, type:'kauf'|'verkauf', units, price (EUR je Stück), fee, est, note} */
  function book(tx) {
    var pos = { ftse: [], btc: [], gold: [] }, real = [];
    (tx || []).slice().sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : ((a.ts || 0) - (b.ts || 0)); }).forEach(function (t) {
      if (!t.a || !(t.units > 0)) return;
      if (!pos[t.a]) pos[t.a] = []; /* Beimischungen (z. B. eth, sol) bekommen ihre eigene FIFO-Liste */
      if (t.type === 'kauf') { pos[t.a].push({ d: t.d, units: t.units, cpu: (t.units * t.price + (t.fee || 0)) / t.units, id: t.id, est: !!t.est }); }
      else if (t.type === 'verkauf') {
        var left = t.units, per = (t.units * t.price - (t.fee || 0)) / t.units, cost = 0, sg = 0, lg = 0, su = 0, lu = 0;
        while (left > 1e-12 && pos[t.a].length) {
          var lot = pos[t.a][0], q = Math.min(left, lot.units), g = q * (per - lot.cpu);
          cost += q * lot.cpu; if (isLongTerm(lot.d, t.d)) { lg += g; lu += q; } else { sg += g; su += q; }
          lot.units -= q; left -= q; if (lot.units <= 1e-12) pos[t.a].shift();
        }
        /* Stücke ohne passenden Kauf davor (open) zählen nicht als Gewinn; die Seite lässt solche Verkäufe nicht mehr zu und meldet sie */
        var covered = t.units - (left > 1e-12 ? left : 0);
        real.push({ a: t.a, d: t.d, units: t.units, covered: covered, proceeds: covered * per, cost: cost, gain: covered * per - cost, shortGain: sg, longGain: lg, shortUnits: su, longUnits: lu, open: left > 1e-9 ? left : 0, id: t.id });
      }
    });
    return { pos: pos, real: real };
  }
  function units(lots) { return lots.reduce(function (s, l) { return s + l.units; }, 0); }
  function cost(lots) { return lots.reduce(function (s, l) { return s + l.units * l.cpu; }, 0); }

  /* ---------- Steuern ----------
     cfg: pb, pbUsed, pbUsedDate, interestRest, lossOther, s23Other, rate (persönlicher Satz), headroom (Spielraum bis Grundfreibetrag),
          nv (NV-Bescheinigung), abg 0,26375, tfs 0,30, fg 1000, buffer */
  function taxYear(cfg, real, year) {
    var r20 = 0, r23 = 0;
    (real || []).forEach(function (r) {
      if (r.d.slice(0, 4) !== String(year)) return;
      if (r.a === 'ftse') { if (!cfg.pbUsedDate || r.d > cfg.pbUsedDate) r20 += r.gain * (1 - cfg.tfs); }
      else r23 += r.shortGain;
    });
    var pbFree = (cfg.pb || 0) - (cfg.pbUsed || 0) - (cfg.interestRest || 0) - r20 + (cfg.lossOther || 0);
    var s23Before = (cfg.s23Other || 0) + r23;
    return { pbFree: pbFree, r20: r20, r23: r23, s23Before: s23Before };
  }
  /* § 23: Freigrenze ist eine Klippe. Ab fg ist der ganze Betrag mit dem persönlichen Satz steuerpflichtig. */
  function tax23(x, cfg) { return x >= cfg.fg ? x * (cfg.rate || 0) : 0; }
  /* § 20 auf den Teil über dem freien Pauschbetrag: Abzug durch die Bank (abg = 25 % plus Soli) und endgültige Steuer.
     Günstigerprüfung: Liegt der persönliche Satz unter 25 %, gilt er (plus Soli) statt der Abgeltungsteuer; die Bank behält trotzdem ab (Erstattung über die Steuererklärung), außer mit NV-Bescheinigung. */
  function effRate20(cfg) { return (cfg.rate != null && cfg.rate < 0.25) ? cfg.rate * 1.055 : cfg.abg; }
  function tax20(excess, cfg) { var e = Math.max(0, excess); return { withheld: cfg.nv ? 0 : e * cfg.abg, final: e * effRate20(cfg) }; }

  /* FIFO-Verkauf simulieren: Wert v (EUR) zum Kurs px, Datum date */
  function simSell(lots, v, px, date, a, cfg) {
    var q = v / px, left = q, g20 = 0, sg = 0, lg = 0, parts = [];
    for (var i = 0; i < lots.length && left > 1e-12; i++) {
      var l = lots[i], take = Math.min(left, l.units), g = take * (px - l.cpu);
      parts.push({ d: l.d, q: take, g: g, long: a !== 'ftse' && isLongTerm(l.d, date) });
      if (a === 'ftse') g20 += g; else if (isLongTerm(l.d, date)) lg += g; else sg += g;
      left -= take;
    }
    return { q: q, g20: g20, taxable20: g20 * (1 - cfg.tfs), sg: sg, lg: lg, parts: parts };
  }
  /* Größter Verkaufswert ohne Steuer und ohne Abzug (FIFO, ohne Lose zu überspringen) */
  function taxFreeMax(lots, px, date, a, cfg, ty) {
    var val = 0;
    if (a === 'ftse') {
      var room = Math.max(0, ty.pbFree);
      for (var i = 0; i < lots.length; i++) {
        var l = lots[i], gpu = (px - l.cpu) * (1 - cfg.tfs);
        if (gpu <= 0) { val += l.units * px; room += -gpu * l.units; continue; }
        var q = Math.min(l.units, room / gpu); val += q * px; room -= q * gpu; if (q < l.units - 1e-12) break;
      }
      return val;
    }
    var limit = cfg.fg - (cfg.buffer || 0) - 0.01, acc = ty.s23Before; /* Summe muss unter 1.000 € bleiben */
    for (var j = 0; j < lots.length; j++) {
      var L = lots[j];
      if (isLongTerm(L.d, date)) { val += L.units * px; continue; }
      var g = px - L.cpu;
      if (g <= 0) { val += L.units * px; acc += g * L.units; continue; }
      var roomS = limit - acc; if (roomS <= 0) break;
      var qq = Math.min(L.units, roomS / g); val += qq * px; acc += qq * g; if (qq < L.units - 1e-12) break;
    }
    return val;
  }

  /* ---------- Rebalancing (A-1, A-2, O-15) ----------
     o: {date, w:{ftse,btc,gold}, st:{}, px:{} (EUR), pos:{} (FIFO-Lose), cash:{}, cfg, ty, variant:'frei'|'voll'} */
  function rebalance(o) {
    var A = ['ftse', 'btc', 'gold'], cfg = o.cfg, ty = o.ty, rows = {}, T = 0;
    A.forEach(function (a) {
      var lots = o.pos[a] || [], u = units(lots), V = u * (o.px[a] || 0), C = o.cash[a] || 0;
      rows[a] = { a: a, st: o.st[a], units: u, V: V, C: C, S: V + C, sell: 0, buy: 0, cashTo: 0, ruleSale: false, g20: 0, t20: 0, sg: 0, lg: 0 };
      T += V + C;
    });
    A.forEach(function (a) { rows[a].G = T * o.w[a]; });
    /* Regel-Verkauf: Regel draußen, Position aber noch da */
    A.forEach(function (a) { var r = rows[a]; if (r.st === 0 && r.V > 0) { r.ruleSale = true; r.sell = r.V; } });
    var supply = 0, demand = 0;
    A.forEach(function (a) {
      var r = rows[a], desired = r.S - r.G;
      if (desired > 0) {
        var fromCash = Math.min(desired, r.C + (r.ruleSale ? r.V : 0));
        var rest = desired - fromCash;
        if (r.st === 1 && rest > 0) {
          var cap = o.variant === 'frei' ? taxFreeMax(o.pos[a], o.px[a], o.date, a, cfg, ty) : Infinity;
          r.sellWanted = rest; r.sell = Math.min(rest, cap); r.capped = r.sell < rest - 0.5;
        }
        r.give = fromCash + (r.st === 1 ? r.sell : 0);
        supply += r.give;
        if (r.st === 1) r.buyOwn = Math.max(0, r.C - fromCash);
      } else {
        r.want = -desired; demand += r.want;
        if (r.st === 1) r.buyOwn = r.C;
      }
    });
    var f = demand > 0 ? Math.min(1, supply / demand) : 0;
    A.forEach(function (a) {
      var r = rows[a];
      if (r.want) { r.get = r.want * f; if (r.st === 1) r.buy = (r.buyOwn || 0) + r.get; else r.cashTo = r.get; }
      else if (r.st === 1 && r.buyOwn) r.buy = r.buyOwn;
      if (r.st === 0 && !r.want) { r.cashTo = -(r.give || 0) + (r.ruleSale ? r.V : 0); }
      if (r.sell > 0) { var sm = simSell(o.pos[a], r.sell, o.px[a], o.date, a, cfg); r.sellUnits = sm.q; r.g20 = sm.g20; r.t20 = sm.taxable20; r.sg = sm.sg; r.lg = sm.lg; r.anyShort = sm.parts.some(function (x) { return !x.long; }); }
      if (r.buy > 0) r.buyUnits = r.buy / (o.px[a] || 1);
      r.after = r.st === 1 ? (r.V - r.sell + r.buy) : (r.C + (r.ruleSale ? r.V : 0) + (r.want ? r.get : -(r.give || 0)));
    });
    /* Steuern */
    var new20 = A.reduce(function (s, a) { return s + rows[a].t20; }, 0);
    var free20 = Math.max(0, ty.pbFree);
    var excess20 = Math.max(0, new20 - free20), t20 = tax20(excess20, cfg);
    var sgNew = A.reduce(function (s, a) { return s + (a === 'ftse' ? 0 : rows[a].sg); }, 0);
    var s23After = ty.s23Before + sgNew;
    var tax23v = tax23(s23After, cfg) - tax23(ty.s23Before, cfg);
    var orders = A.reduce(function (s, a) { return s + (rows[a].sell > 0.5 ? 1 : 0) + (rows[a].buy > 0.5 ? 1 : 0); }, 0);
    var afterT = A.reduce(function (s, a) { return s + rows[a].after; }, 0);
    A.forEach(function (a) { rows[a].wAfter = afterT > 0 ? rows[a].after / afterT : 0; });
    var declare23 = s23After >= cfg.fg && s23After > ty.s23Before + 1e-9 ? true : s23After >= cfg.fg;
    var incomeAdd = excess20 + (s23After >= cfg.fg ? s23After : 0);
    return {
      rows: rows, T: T, tax20: t20.final, withheld20: t20.withheld, tax23: tax23v, tax: t20.final + tax23v, new20: new20, free20: free20, excess20: excess20,
      s23After: s23After, declare23: declare23, incomeAdd: incomeAdd, overHeadroom: cfg.headroom != null ? Math.max(0, incomeAdd - cfg.headroom) : 0,
      orders: orders, fees: orders * (cfg.fee || 0), fill: f, pbLeft: Math.max(0, free20 - new20)
    };
  }

  /* ---------- Vorabpauschale (A-9) ---------- */
  function vorab(lots, year, p0, pEnd, basiszins) {
    if (!(p0 > 0) || !(pEnd > p0)) return 0;
    var vp = 0;
    lots.forEach(function (l) {
      var y = +l.d.slice(0, 4), m = +l.d.slice(5, 7);
      var f = y < year ? 1 : (y === year ? (13 - m) / 12 : 0);
      var base = l.units * p0 * basiszins * 0.7 * f;
      vp += Math.min(base, l.units * (pEnd - p0));
    });
    return vp;
  }

  /* ---------- Eingaben ----------
     Zahl aus einem Eingabefeld, unabhängig vom Gebietsschema des Browsers. Deutsch zuerst: „2.708,00“ = 2708, „0,5“ = 0,5, „1.234.567“ = 1234567.
     Punkt und Komma zusammen: das letzte Zeichen trennt die Nachkommastellen („2,708.00“ = 2708). Genau ein Punkt mit drei Ziffern danach
     („2.708“) gilt als Tausenderpunkt, sonst als Dezimalpunkt („12.5“, „0.123“). units: Stückzahlen, dort ist ein einzelner Punkt immer
     Dezimalpunkt („0.002“, „1.500“ = 1,5). Leer -> null, unlesbar -> NaN. */
  function groupsOk(s, sep) { var g = s.split(sep); if (!/^\d{1,3}$/.test(g[0])) return false; for (var i = 1; i < g.length; i++) if (!/^\d{3}$/.test(g[i])) return false; return true; }
  function parseNum(s, units) {
    if (s == null) return null;
    if (typeof s === 'number') return isFinite(s) ? s : NaN;
    var t = String(s).replace(/[\s  €%]/g, '').replace(/[’']/g, '');
    if (t === '') return null;
    var neg = false;
    if (/^[−–-]/.test(t)) { neg = true; t = t.slice(1); } else if (t.charAt(0) === '+') t = t.slice(1);
    if (!/^[0-9.,]+$/.test(t) || !/[0-9]/.test(t)) return NaN;
    var dot = t.lastIndexOf('.'), comma = t.lastIndexOf(',');
    if (dot >= 0 && comma >= 0) {
      var dec = dot > comma ? '.' : ',', th = dec === '.' ? ',' : '.', parts = t.split(dec);
      if (parts.length !== 2 || !groupsOk(parts[0], th)) return NaN;
      t = parts[0].split(th).join('') + '.' + parts[1];
    } else if (comma >= 0) {
      var cs = t.split(',');
      if (cs.length === 2) t = cs[0] + '.' + cs[1];
      else { if (!groupsOk(t, ',')) return NaN; t = cs.join(''); }
    } else if (dot >= 0) {
      var ds = t.split('.');
      if (ds.length > 2) { if (!groupsOk(t, '.')) return NaN; t = ds.join(''); }
      else if (!units && /^[1-9]\d{0,2}$/.test(ds[0]) && /^\d{3}$/.test(ds[1])) t = ds.join('');
    }
    var v = Number(t);
    if (!isFinite(v)) return NaN;
    return neg ? -v : v;
  }
  /* Datum aus einer Eingabe oder Datei: JJJJ-MM-TT (auch mit Uhrzeit) oder TT.MM.JJJJ; nur echte Kalendertage. Sonst null. */
  function parseDate(s) {
    if (s == null) return null;
    var t = String(s).trim(), m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else { m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t); if (!m) return null; d = +m[1]; mo = +m[2]; y = +m[3]; }
    if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return iso(dt.getTime());
  }

  var ENG = {
    parseNum: parseNum, parseDate: parseDate,
    iso: iso, addDays: addDays, mondayOf: mondayOf, daysBetween: daysBetween, oneYearAfter: oneYearAfter, isLongTerm: isLongTerm, taxFreeFrom: taxFreeFrom,
    fromRows: fromRows, toRows: toRows, weeklyFromDaily: weeklyFromDaily, mergeWeekly: mergeWeekly, slice: slice, append: append,
    evalRule: evalRule, flipThreshold: flipThreshold, whatIf: whatIf,
    book: book, units: units, cost: cost, taxYear: taxYear, tax23: tax23, tax20: tax20, simSell: simSell, taxFreeMax: taxFreeMax, rebalance: rebalance, vorab: vorab
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ENG;
  else root.ENG = ENG;
})(typeof window !== 'undefined' ? window : this);
