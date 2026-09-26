/* Regel-Depot 50/30/20 – Anwendung */
(function () {
  'use strict';
  var A = ['ftse', 'btc', 'gold'];
  var COLOR = { ftse: '--ftse', btc: '--btc', gold: '--gold' };
  var CAT = [{ k: 'btc', label: 'Bitcoin', color: '--btc' }, { k: 'ftse', label: 'FTSE All-World', color: '--ftse' }, { k: 'gold', label: 'Gold', color: '--gold' }, { k: 'cash', label: 'Cash', color: '--cash' }];
  var BAR_ORDER = ['btc', 'ftse', 'gold'];
  var CFG = null, D = { weekly: {}, eur: null, state: null, events: [], runs: [], errors: [] }, C = {}, VIEW = { range: 156 }, PERF = { mode: 'gewinn', range: 'alles' };
  var F = window.FMT, de = F.de, eur = F.eur, sgnEur = F.sgnEur, pct = F.pct, pctPlain = F.pctPlain, dDE = F.dDE, dShort = F.dShort, dtDE = F.dtDE;
  var el = CH.el, css = CH.css;
  function $(id) { return document.getElementById(id); }
  function todayISO() { var t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  function usd(a, v) { return de(v, CFG.assets[a].dec) + ' $'; }
  /* Krypto-Beimischung (ETH, SOL): kein eigenes Signal, folgt der Bitcoin-Regel und zählt zum Krypto-Baustein */
  var ALTS = [], ALT = {};
  function initAlts() { ALTS = (CFG.alts && CFG.alts.list) || []; ALT = {}; ALTS.forEach(function (x) { ALT[x.id] = x; COLOR[x.id] = '--alt'; }); }
  function INFO(a) { return CFG.assets[a] || ALT[a] || { name: a, short: a, inst: a }; }
  function bucketOf(a) { if (ALT[a]) return (CFG.alts && CFG.alts.bucket) || 'btc'; return A.indexOf(a) >= 0 ? a : 'btc'; /* Beimischung, auch ohne geladene Konfiguration */ }
  function posOf(Mo, a) { return Mo.pos[a] || (Mo.altPos && Mo.altPos[a]) || null; }
  function hasAlts(Mo) { var P = Mo.pos.btc; return !!(P && P.alts && P.alts.some(function (x) { return x.u > 1e-12; })); }
  function units(a, u) { if (ALT[a]) return de(u, ALT[a].dec == null ? 4 : ALT[a].dec) + ' ' + (ALT[a].unit || ALT[a].short); return a === 'btc' ? de(u, 6) + ' BTC' : de(u, u < 10 ? 3 : 2) + ' Stück'; }
  /* Bestand eines Bausteins als Text: Bitcoin plus Beimischungen */
  function holdingText(a, P) { if (a !== 'btc' || !P.alts || !P.alts.some(function (x) { return x.u > 1e-12; })) return units(a, P.uBtc != null ? P.uBtc : P.u); var parts = []; if (P.uBtc > 1e-9) parts.push(units('btc', P.uBtc)); P.alts.forEach(function (x) { if (x.u > 1e-12) parts.push(units(x.id, x.u)); }); return parts.join(' + '); }
  function kv(dl, k, v) { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); }
  var ICON = {
    buy: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3l5 8H3z" fill="currentColor"/></svg>',
    sell: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13L3 5h10z" fill="currentColor"/></svg>',
    warn: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.6 11.6H1.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.2v3.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.6" r="0.95" fill="currentColor"/></svg>',
    info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7.2v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="4.9" r="0.95" fill="currentColor"/></svg>'
  };
  function chip(kind, text) { var c = el('span', 'chip c-' + kind); c.innerHTML = ICON[kind === 'buy' ? 'buy' : kind === 'sell' ? 'sell' : kind === 'warn' ? 'warn' : 'info']; c.appendChild(document.createTextNode(text)); return c; }
  function nextMonday(d) { return ENG.addDays(ENG.mondayOf(d), 7); }

  /* ---------- Daten laden ---------- */
  function getJson(p) { return fetch('data/' + p + '?v=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(p + ': HTTP ' + r.status); return r.json(); }); }
  /* Alle Datendateien in ein neues Objekt laden; übernommen wird erst, wenn alles da ist (applyLoaded). So bleibt beim Nachladen der alte Stand
     stehen, falls eine Datei gerade nicht kommt. Die Live-Kurse im Browser kommen danach (refreshBrowserLive) und bremsen die erste Anzeige nicht. */
  function loadAll() {
    var N = { weekly: {}, errors: [] };
    return getJson('config.json').then(function (cfg) {
      N.cfg = cfg;
      var jobs = A.map(function (a) { return getJson('weekly/' + a + '.json').then(function (j) { N.weekly[a] = j; }); });
      jobs.push(getJson('eur.json').then(function (j) { N.eur = j; }).catch(function (e) { N.errors.push(e.message); N.eur = { weekly: {}, latest: {} }; }));
      jobs.push(getJson('state.json').then(function (j) { N.state = j; }).catch(function (e) { N.errors.push(e.message); N.state = { assets: {}, warn: {}, cross: {} }; }));
      /* Ohne Verlauf, Laufprotokoll oder Ticker geht die Seite weiter (soft); beim Nachladen bleiben dann die bisherigen Daten stehen */
      N.soft = [];
      jobs.push(getJson('events.json').then(function (j) { N.events = j; }).catch(function () { N.soft.push('events'); N.events = []; }));
      jobs.push(getJson('runs.json').then(function (j) { N.runs = j; }).catch(function () { N.soft.push('runs'); N.runs = []; }));
      jobs.push(getJson('live.json').then(function (j) { N.live = j; }).catch(function () { N.soft.push('live'); N.live = null; }));
      return Promise.all(jobs);
    }).then(function () { return N; });
  }
  var LOADED_AT = 0;
  function applyLoaded(N, keepSoft) {
    CFG = N.cfg; initAlts();
    D.weekly = N.weekly; D.eur = N.eur; D.state = N.state; D.errors = N.errors;
    ['events', 'runs', 'live'].forEach(function (k) { if (!(keepSoft && N.soft && N.soft.indexOf(k) >= 0)) D[k] = N[k]; });
    A.forEach(function (a) { var S = ENG.fromRows(D.weekly[a].w); C[a] = { S: S, E: ENG.evalRule(S, CFG.assets[a].rule) }; });
    applyBrowserLiveToEur();
    LOADED_AT = Date.now();
  }
  function refreshBrowserLive() { return fetchBrowserLive().then(function () { applyBrowserLiveToEur(); schedule(); }); }

  /* ---------- Live-Kurse im Browser (Coinbase, gold-api), still bei Fehlern ---------- */
  D.browserLive = {};
  function fetchTimeout(url, ms) { var ctl = 'AbortController' in window ? new AbortController() : null; var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 5000); return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; }); }
  function fetchBrowserLive() {
    var now = new Date().toISOString();
    var p1 = Promise.all([fetchTimeout('https://api.coinbase.com/v2/prices/BTC-USD/spot'), fetchTimeout('https://api.coinbase.com/v2/prices/BTC-EUR/spot')]).then(function (r) { var u = +r[0].data.amount, e = +r[1].data.amount; if (u > 0 && e > 0) D.browserLive.btc = { usd: u, eur: e, t: now, src: 'Coinbase (live im Browser)' }; }).catch(function () { /* still */ });
    var p2 = fetchTimeout('https://api.gold-api.com/price/XAU').then(function (j) { if (+j.price > 0) D.browserLive.gold = { usd: +j.price, t: j.updatedAt || now, src: 'gold-api.com (live im Browser)' }; }).catch(function () { /* still */ });
    var p3 = fetchTimeout('https://api.coinbase.com/v2/exchange-rates?currency=EUR').then(function (j) { var r = j && j.data && j.data.rates && +j.data.rates.USD; if (r > 0) D.browserLive.eurusd = { rate: r, t: now }; }).catch(function () { /* still */ });
    var p4 = Promise.all(ALTS.map(function (x) { return fetchTimeout('https://api.coinbase.com/v2/prices/' + x.eur.sym + '/spot').then(function (j) { var e = +j.data.amount; if (e > 0) D.browserLive[x.id] = { eur: e, t: now, src: 'Coinbase (live im Browser)' }; }).catch(function () { /* still */ }); }));
    return Promise.all([p1, p2, p3, p4]);
  }
  function utcToday() { return new Date().toISOString().slice(0, 10); }
  /* Aktueller Kurs je Anlage: Browser-Live vor Ticker (live.json) vor Tagesschluss */
  function livePrice(a) {
    var b = D.browserLive[a], l = D.live && D.live.prices && D.live.prices[a];
    if (b && b.usd > 0 && (!l || !l.t || b.t >= l.t)) return { usd: b.usd, eur: b.eur || null, t: b.t, src: b.src, live: true };
    if (l && l.usd > 0) return { usd: l.usd, eur: l.eur || null, t: l.t || (D.live && D.live.t), src: l.src, eod: !!l.eod, d: l.d || null, spot: !!l.spot };
    return null;
  }
  /* Offene Woche wie im Update-Skript: FTSE und Gold ab dem Londoner Freitagsschluss (16:40 Uhr Ortszeit) und am Wochenende die nächste Woche,
     Bitcoin bis Sonntag 24 Uhr UTC. Fehlt die zuletzt geschlossene Woche noch in der Reihe (Buchung steht aus), bleibt sie die offene Woche;
     der aktuelle Kurs steht dann für ihren Schluss. Vorher rechnete der Live-Block am Wochenende mit der schon geschlossenen Woche. */
  function londonNow() { var p = {}; try { new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; }); } catch (e) { return null; } return { dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), hour: ((+p.hour) % 24) + (+p.minute) / 60 }; }
  function openWeek(a) {
    var S0 = C[a].S, mon = ENG.mondayOf(utcToday()), cal = mon;
    if (CFG.assets[a].week !== 'sun') { var dow = (new Date().getUTCDay() + 6) % 7, L = londonNow(); if (dow >= 5 || (dow === 4 && L && (L.dow !== 4 || L.hour >= 16.67))) cal = ENG.addDays(mon, 7); }
    var last = S0.k.length ? S0.k[S0.k.length - 1] : null, next = last ? ENG.addDays(last, 7) : cal;
    return next < cal ? next : cal;
  }
  function ruleNow(a, price) {
    var S0 = C[a].S, rule = CFG.assets[a].rule, wk = openWeek(a), S = { k: [], d: [], c: [] };
    for (var i = 0; i < S0.k.length; i++) { if (S0.k[i] < wk) { S.k.push(S0.k[i]); S.d.push(S0.d[i]); S.c.push(S0.c[i]); } }
    if (S.k.length < 60 || !(price > 0)) return null;
    var E = ENG.evalRule(S, rule), ft = ENG.flipThreshold(E, rule), E2 = ENG.whatIf(S, rule, ENG.addDays(wk, CFG.assets[a].week === 'sun' ? 6 : 4), price);
    return { thr: ft.thr, dist: price / ft.thr - 1, can: ft.can, need: ft.need, st: E.last.st, would: E2.last.changed, wouldSt: E2.last.st, up: E2.last.up, dn: E2.last.dn, week: wk };
  }
  function applyBrowserLiveToEur() {
    if (!D.eur || !D.eur.latest) return;
    var b = D.browserLive.btc; if (b && b.eur > 0) D.eur.latest.btc = { d: utcToday(), p: b.eur, sym: 'BTC-EUR', src: b.src, t: b.t, live: true };
    var g = D.browserLive.gold, fx = D.browserLive.eurusd && D.browserLive.eurusd.rate, cb = D.eur.calib && D.eur.calib.gold, cg = D.eur.latest.gold;
    /* Gold-ETC: mit Lang & Schwarz als Quelle nie eine Schätzung aus dem Spotpreis (auch nicht am Wochenende). Ohne L&S nur, wenn es seit einer Woche keinen echten Kurs gibt. */
    var haveReal = cg && !cg.estimate && cg.p > 0 && cg.d && cg.d >= ENG.addDays(utcToday(), -7), goldLs = CFG.assets.gold.eur && CFG.assets.gold.eur.src === 'ls';
    if (!goldLs && g && fx > 0 && cb && cb.ratio > 0 && !haveReal) D.eur.latest.gold = { d: utcToday(), p: g.usd / fx * cb.ratio, sym: 'SGBS.MI', src: 'geschätzt aus Spot ' + de(g.usd, 2) + ' $ / EURUSD ' + de(fx, 4) + ' × Kalibrierfaktor (live im Browser)', t: g.t, live: true, fallback: true, estimate: true };
    if (fx > 0) D.eur.latest.eurusd = { d: utcToday(), p: fx, sym: 'EURUSD=X', src: 'Coinbase (live im Browser)', t: D.browserLive.eurusd.t, live: true };
    ALTS.forEach(function (x) { var v = D.browserLive[x.id]; if (v && v.eur > 0) D.eur.latest[x.id] = { d: utcToday(), p: v.eur, sym: x.eur.sym, src: v.src, t: v.t, live: true }; });
  }

  /* ---------- Modell ---------- */
  /* Steuerjahr = Kalenderjahr von heute (vorher fest 2026 aus der Konfiguration). Die eigenen Angaben gelten für das Jahr, in dem sie gespeichert
     wurden (tax.year): Pauschbetrag genutzt samt Stand, weitere Zinsen, andere Veräußerungen und Spielraum gelten nur in diesem Jahr; Steuersatz,
     NV-Bescheinigung, Verlusttopf, Puffer, Mindestorder, Cash-Zins und Stichtag gelten weiter. Gesetzeswerte (Pauschbetrag, Sätze, Freigrenze,
     Orderkosten) kommen immer aus der Konfiguration, Basiszins und VWCE-Kurs zu Jahresbeginn je Jahr (taxLaw.years). */
  var TAX_PER_YEAR = ['pbUsed', 'pbUsedDate', 'interestRest', 's23Other', 'headroom'], TAX_USER = TAX_PER_YEAR.concat(['lossOther', 'rate', 'nv', 'buffer', 'minOrder', 'cashRate', 'note']);
  function storedTaxYear(t) { if (t && +t.year > 2000) return +t.year; return t && t.pbUsedDate ? +String(t.pbUsedDate).slice(0, 4) : 2026; }
  /* Rebalancing jedes Jahr am selben Tag (Justus: 30.12.): ein gewählter künftiger Tag gilt, ein vergangener rückt ins laufende oder nächste Jahr */
  function nextRebal(stored, day) { var today = todayISO(), md = stored ? String(stored).slice(5, 10) : (day || '12-30'), d = today.slice(0, 4) + '-' + md; if (stored && stored >= today) return stored; return d >= today ? d : (+today.slice(0, 4) + 1) + '-' + md; }
  function taxCfg() {
    var law = CFG.taxLaw, t = STORE.load().tax || {}, year = +todayISO().slice(0, 4), yl = (law.years || {})[year] || null, cfg = {};
    ['pb', 'abg', 'tfs', 'fg', 'buffer', 'minOrder', 'fee'].forEach(function (k) { cfg[k] = law[k]; });
    cfg.year = year; cfg.basiszins = yl ? yl.basiszins : null; cfg.vwceStart = yl ? yl.vwceStart : null; cfg.lawYearKnown = !!yl;
    cfg.pbUsed = 0; cfg.pbUsedDate = ''; cfg.interestRest = 0; cfg.lossOther = 0; cfg.s23Other = 0; cfg.rate = 0.25; cfg.headroom = null; cfg.nv = false;
    var ty = storedTaxYear(t), same = ty === year;
    cfg.taxYearStored = ty;
    cfg.taxStale = !same && TAX_PER_YEAR.some(function (k) { return t[k] != null && t[k] !== '' && t[k] !== 0; });
    TAX_USER.forEach(function (k) { if (!same && TAX_PER_YEAR.indexOf(k) >= 0) return; var v = t[k]; if (v !== null && v !== '' && v !== undefined) cfg[k] = v; });
    cfg.pbKnown = same && t.pbUsed !== undefined && t.pbUsed !== null && t.pbUsed !== '';
    cfg.rateKnown = t.rate !== undefined && t.rate !== null && t.rate !== '';
    cfg.rate = +cfg.rate; cfg.headroom = cfg.headroom == null || cfg.headroom === '' ? null : +cfg.headroom;
    cfg.cashRate = t.cashRate == null || t.cashRate === '' ? 0.025 : +t.cashRate;
    cfg.rebalDate = nextRebal(t.rebalDate || null, law.rebalDay || (law.rebalDate ? String(law.rebalDate).slice(5) : '12-30'));
    return cfg;
  }
  function pxOf(a) { var p = D.eur && D.eur.latest && D.eur.latest[a]; return p && p.p > 0 ? p : null; }
  /* Dollar-Schwelle der Regel als Euro-Kurs des gehaltenen Wertpapiers: Bitcoin direkt über EUR/USD; ETF und Gold-ETC zusätzlich mit dem
     Kalibrierfaktor (Verhältnis L&S-Kurs zur Dollar-Referenz VWRD bzw. LBMA), sonst passt die Größenordnung nicht */
  function thrEur(a, thr) { var fx = D.eur && D.eur.latest && D.eur.latest.eurusd && D.eur.latest.eurusd.p; if (!(fx > 0) || !(thr > 0)) return null; if (a === 'btc') return thr / fx; var cb = D.eur && D.eur.calib && D.eur.calib[a]; return cb && cb.ratio > 0 ? thr / fx * cb.ratio : null; }
  function model() {
    var dep = STORE.load(), B = ENG.book(dep.tx), cfg = taxCfg(), ty = ENG.taxYear(cfg, B.real, cfg.year), pos = {};
    /* missing: Bestand ohne Euro-Kurs. Dann ist der Wert unbekannt (nicht 0): Summen, Aufteilung und Rebalancing warten auf den Kurs. */
    A.forEach(function (a) { var lots = B.pos[a] || [], u = ENG.units(lots), cost = ENG.cost(lots), p = pxOf(a); pos[a] = { lots: lots, u: u, cost: cost, px: p ? p.p : null, pxd: p ? p.d : null, val: p ? u * p.p : (u > 1e-12 ? null : 0), missing: u > 1e-12 && !p, cash: dep.cash[a] || 0 }; });
    /* Beimischungen: eigene Bewertung, im Krypto-Baustein als Bitcoin-Äquivalent (gleicher Wert, gleiche Kosten, gleiches Kaufdatum) für Regel, Steuer und Rebalancing */
    var altPos = {}, bucket = (CFG.alts && CFG.alts.bucket) || 'btc', PB = pos[bucket];
    ALTS.forEach(function (x) { var lots = B.pos[x.id] || [], u = ENG.units(lots), cost = ENG.cost(lots), p = pxOf(x.id); altPos[x.id] = { lots: lots, u: u, cost: cost, px: p ? p.p : null, pxd: p ? p.d : null, val: p ? u * p.p : (u > 0 ? null : 0), live: !!(p && p.live) }; });
    PB.uBtc = PB.u; PB.alts = ALTS.map(function (x) { return Object.assign({ id: x.id, name: x.name, short: x.short }, altPos[x.id]); }); PB.altMissing = false;
    var eq = [];
    ALTS.forEach(function (x) { var ap = altPos[x.id]; if (!(ap.u > 1e-12)) return; if (!(ap.px > 0) || !(PB.px > 0)) { PB.altMissing = true; return; } ap.lots.forEach(function (l) { var ue = l.units * ap.px / PB.px; eq.push({ d: l.d, units: ue, cpu: l.cpu * l.units / ue, id: l.id, est: l.est, alt: x.id, altUnits: l.units }); }); });
    if (eq.length) { PB.lots = PB.lots.concat(eq).sort(function (m, n) { return m.d < n.d ? -1 : m.d > n.d ? 1 : 0; }); PB.u = ENG.units(PB.lots); PB.cost = ENG.cost(PB.lots); PB.val = PB.u * PB.px; }
    if (PB.altMissing) { PB.missing = true; PB.val = null; }
    return { ready: STORE.has(), dep: dep, B: B, cfg: cfg, ty: ty, pos: pos, altPos: altPos, cash: dep.cash, est: dep.tx.some(function (t) { return t.est; }) };
  }

  /* ---------- Steuer beim Verkauf einer Position ---------- */
  function saleTax(a, Mo, pxUse) {
    var P = Mo.pos[a], px = pxUse || P.px; if (!(P.u > 0) || !(px > 0)) return null;
    var date = todayISO(), sm = ENG.simSell(P.lots, P.u * px, px, date, a, Mo.cfg), cfg = Mo.cfg;
    var pre = pxUse ? 'Bei einem Verkauf knapp unter der Schwelle (ca. ' + eur(px, a === 'btc' ? 0 : 2) + ' je ' + (a === 'btc' ? 'BTC' : 'Stück') + '): ' : '';
    if (a === 'ftse') {
      var taxable = sm.taxable20, free = Math.max(0, Mo.ty.pbFree), ex = Math.max(0, taxable - free), t20 = ENG.tax20(ex, cfg);
      if (ex <= 0) return { level: 'ok', text: pre + 'Gewinn ca. ' + sgnEur(sm.g20) + ', steuerpflichtig nach Teilfreistellung ' + eur(Math.max(0, taxable)) + '. Liegt im freien Pauschbetrag (' + eur(free) + '): kein Steuerabzug.' };
      return { level: 'warn', text: pre + 'Gewinn ca. ' + sgnEur(sm.g20) + ', steuerpflichtig nach Teilfreistellung ' + eur(taxable) + '. Das übersteigt den freien Pauschbetrag (' + eur(free) + ') um ' + eur(ex) + ': ' + (cfg.nv ? 'kein Abzug dank NV-Bescheinigung' : 'Trade Republic behält ca. ' + eur(t20.withheld) + ' ein') + (t20.final < t20.withheld - 0.5 ? ', endgültig bei deinem Steuersatz ' + eur(t20.final) + ' (Rest über die Steuererklärung zurück)' : '') + '.' };
    }
    var total = Mo.ty.s23Before + sm.sg, tax = ENG.tax23(total, cfg) - ENG.tax23(Mo.ty.s23Before, cfg);
    var t = pre + 'Gewinn ca. ' + sgnEur(sm.sg + sm.lg) + '. ';
    /* Nach der Haltefrist richtet sich das nach den Kaufdaten, nicht nach dem Gewinn (ein Gewinn von 0 ist nicht „Haltefrist vorbei“) */
    if (sm.parts.length && sm.parts.every(function (x) { return x.long; })) return { level: 'ok', text: t + 'Haltefrist abgelaufen: steuerfrei.' };
    t += 'Innerhalb eines Jahres gekauft, zählt zur Freigrenze: ' + cfg.year + ' zusammen ' + eur(total) + '. ';
    if (total >= cfg.fg) return { level: 'warn', text: t + 'Das ist nicht mehr unter der Freigrenze von 1.000 €, dann ist der ganze Betrag steuerpflichtig' + (cfg.rate > 0 ? ': ca. ' + eur(tax) + ' bei ' + pctPlain(cfg.rate, 0) : ' und muss in die Steuererklärung (Anlage SO); bei deinem Steuersatz 0 % fällt keine Steuer an, solange du unter dem Grundfreibetrag bleibst') + '.' };
    if (total > cfg.fg - cfg.buffer) return { level: 'warn', text: t + 'Knapp unter der Freigrenze von 1.000 €: steuerfrei, solange es darunter bleibt.' };
    return { level: 'ok', text: t + 'Unter der Freigrenze von 1.000 €: steuerfrei, nichts zu erklären.' };
  }

  /* ---------- Aktion je Position (Regel × Bestand) ---------- */
  function flipInfo(a) { return ENG.flipThreshold(C[a].E, CFG.assets[a].rule); }
  function dueText(due) { var t = todayISO(); if (t < due) return 'zur Eröffnung am Montag, ' + dShort(due); if (t === due) return 'heute zur Eröffnung (' + dShort(due) + ')'; return 'seit Montag, ' + dShort(due) + ' (überfällig)'; }
  function actionFor(a, Mo) {
    var L = C[a].E.last, st = L.st, due = nextMonday(L.d), today = todayISO(), fresh = today <= due;
    var nc = ENG.addDays(L.d, 7), due2 = nextMonday(nc), fi = flipInfo(a), P = Mo.pos[a];
    if (!Mo.ready) return { cls: '', title: st === 1 ? 'Regel investiert' : 'Regel nicht investiert', text: 'Importiere deine Depotdaten (Einstellungen), dann steht hier, was für dich zu tun ist.' };
    var holding = P.u > 1e-9, ls = L.lastSwitch;
    if (st === 1 && holding) return { cls: '', title: 'Halten', text: (L.changed && fresh ? 'Neues Kaufsignal zum Wochenschluss, du bist schon investiert.' : 'Regel investiert, Position im Depot.') + (P.cash >= Mo.cfg.minOrder ? ' Das Cash dieser Position (' + eur(P.cash, 2) + ') gehört laut Regel mit angelegt.' : '') };
    if (st === 0 && !holding) return { cls: '', title: 'Nichts tun', text: 'Das Geld bleibt als Cash' + (P.cash > 0 ? ' (' + eur(P.cash) + ')' : '') + '.' };
    if (st === 1) {
      return { cls: 'buy', title: 'Kaufen', text: (L.changed && fresh ? 'Kaufsignal: ' : 'Laut Regel investiert, die Position fehlt noch: ') + 'kaufen ' + dueText(due) + (P.cash > 0 ? '. Betrag: Cash der Position, ' + eur(P.cash) : '') + '.', todo: true,
        next: !fresh && fi.can ? 'Nächster Wochenschluss am ' + dShort(nc) + ': Unter ' + usd(a, fi.thr) + ' wäre die Regel wieder draußen.' : '' };
    }
    var val = P.val ? ' (ca. ' + eur(P.val) + ')' : '';
    if (L.changed && fresh) return { cls: 'sell', title: 'Verkaufen', text: 'Verkaufssignal: alle ' + holdingText(a, P) + val + ' verkaufen ' + dueText(due) + '.', tax: saleTax(a, Mo), todo: true };
    var te = fi.can ? thrEur(a, fi.thr) : null, pxThr = (te && P.px) ? Math.min(P.px, te) : null;
    return { cls: 'sell', title: 'Verkaufen', text: 'Laut Regel' + (ls ? ' seit ' + dDE(ls.d) : '') + ' nicht investiert, du hältst noch ' + holdingText(a, P) + val + '.', todo: true,
      next: fi.can ? 'Verkaufen zur Eröffnung am Montag, ' + dShort(due2) + ' – außer der Wochenschluss am ' + dShort(nc) + ' liegt über ' + usd(a, fi.thr) + ', dann gibt es ein Kaufsignal und du behältst die Position.' : 'Verkaufen, sobald es passt.',
      tax: saleTax(a, Mo, pxThr) };
  }
  function streakText(L) { if (L.up > 0) return L.up + '× über SMA50'; if (L.dn > 0) return L.dn + '× unter SMA50'; return 'auf dem SMA50'; }
  function thresholdInfo(a) {
    var E = C[a].E, L = E.last, r = CFG.assets[a].rule, nx = E.next, t = {}, edgePct = (CFG.edge && CFG.edge.pct) || 0.005;
    if (r.type === 'band') {
      var thr = L.st === 1 ? L.m * (1 - r.p) : L.m * (1 + r.p);
      t.edge = Math.abs(L.c / thr - 1) < edgePct;
      t.text = L.st === 1 ? ['Verkaufssignal, wenn ein Wochenschluss unter ', usd(a, nx.bandDown), ' fällt (3 % unter dem SMA50).'] : ['Kaufsignal, wenn ein Wochenschluss über ', usd(a, nx.bandUp), ' liegt (3 % über dem SMA50).'];
      return t;
    }
    t.edge = Math.abs(L.dist) < edgePct;
    var need = L.st === 1 ? r.n - L.dn : r.n - L.up;
    if (L.st === 1) t.text = need <= 1 ? ['Ein Wochenschluss unter ', usd(a, nx.above), ' löst das Verkaufssignal aus.'] : ['Verkaufssignal erst nach ' + need + ' Schlüssen in Folge unter dem SMA50. Nächste Woche liegt die Grenze bei ', usd(a, nx.above), '.'];
    else t.text = need <= 1 ? ['Ein Wochenschluss über ', usd(a, nx.above), ' löst das Kaufsignal aus.'] : ['Kaufsignal nach ' + need + ' Schlüssen in Folge über dem SMA50. Nächste Woche liegt die Grenze bei ', usd(a, nx.above), '.'];
    return t;
  }
  function currentWarn(a) {
    var w = D.state && D.state.warn && D.state.warn[a]; if (!w || !w.t) return null;
    var L = C[a].E.last; if (w.forWeek && w.forWeek <= L.k) return null; /* Woche ist schon geschlossen */
    if (ENG.daysBetween(w.t.slice(0, 10), todayISO()) > 6) return null;
    return w;
  }

  /* ---------- Kopf, Banner, Zu tun ---------- */
  function lastRun() { return D.runs && D.runs.length ? D.runs[0] : null; }
  function renderTop(Mo) {
    var h = $('topMeta'); h.textContent = '';
    function s(label, val, cls) { var e = el('span', cls || null); e.appendChild(el('b', null, label + ' ')); e.appendChild(document.createTextNode(val)); h.appendChild(e); }
    s('Wochenschluss', 'FTSE ' + dShort(C.ftse.E.last.d) + ' · Gold ' + dShort(C.gold.E.last.d) + ' · Bitcoin ' + dShort(C.btc.E.last.d));
    var p = pxOf('ftse') || pxOf('btc'); if (p) s('Euro-Kurse', dShort(p.d));
    if (D.live && D.live.t) s('Live-Kurse', dtDE(D.live.t) + (D.browserLive.btc ? ' · Bitcoin im Browser live' : ''));
    var r = lastRun(); if (r && !r.ok) s('Letzter Lauf', dtDE(r.t) + ' · mit Fehlern', 'bad');
    s('Depot', Mo.ready ? 'in diesem Browser' : 'noch nicht importiert');
  }
  function renderGlobal(Mo) {
    var g = $('globalBanner'); g.textContent = '';
    var r = lastRun(), age = r ? ENG.daysBetween(r.t.slice(0, 10), todayISO()) : null;
    if (D.errors.length) { var b0 = el('div', 'banner bad'); b0.appendChild(el('b', null, 'Ein Teil der Daten konnte nicht geladen werden')); b0.appendChild(el('span', null, D.errors.join(' · '))); g.appendChild(b0); }
    if (age != null && age > 8) { var b1 = el('div', 'banner'); b1.appendChild(el('b', null, 'Die automatischen Läufe sind seit ' + age + ' Tagen ausgeblieben')); b1.appendChild(el('span', null, 'Die Kurse und Signale sind möglicherweise veraltet. Prüfe bei GitHub unter „Actions“, ob der Workflow „Regel-Depot Update“ läuft.')); g.appendChild(b1); }
    if (!Mo.ready && !STORE.corruptInfo()) { var b2 = el('div', 'banner info'); b2.appendChild(el('b', null, 'Depotdaten fehlen in diesem Browser')); b2.appendChild(el('span', null, 'Importiere deine Depot-Datei unter „Einstellungen“ (oder trage Käufe von Hand ein). Kurse und Signale funktionieren auch ohne Depot.'));
      var acts = el('div', 'actions'); var btn = el('a', 'btn sm', 'Zu den Einstellungen'); btn.href = '#einstellungen'; acts.appendChild(btn); b2.appendChild(acts); g.appendChild(b2); }
  }

  /* ---------- Status-Karten ---------- */
  function renderChartLegend() {
    var h = $('chLegend'); h.textContent = '';
    var items = [{ t: 'Wochenschluss', c: 'var(--ink-2)' }, { t: 'SMA50', c: 'var(--ink-2)', dash: true }, { t: 'Regel investiert', box: 'color-mix(in srgb, var(--ink-2) 16%, transparent)' }, { t: 'Band ±3 % (Bitcoin)', box: 'var(--band)' }, { t: 'Kaufsignal', tri: 'up' }, { t: 'Verkaufssignal', tri: 'dn' }, { t: 'Abstand zum SMA50 (unten)', box: 'color-mix(in srgb, var(--ink-2) 35%, transparent)' }];
    items.forEach(function (it) { var s = el('span'), i = el('i'); if (it.box) { i.className = 'box'; i.style.background = it.box; } else if (it.tri) { i.className = 'tri' + (it.tri === 'dn' ? ' dn' : ''); if (it.tri === 'up') i.style.borderBottomColor = 'var(--sig-buy)'; else i.style.borderTopColor = 'var(--sig-sell)'; } else { if (it.dash) i.className = 'dash'; i.style.borderTopColor = it.c; } s.appendChild(i); s.appendChild(document.createTextNode(it.t)); h.appendChild(s); });
  }
  function weeksTable(a, rows) {
    var S = C[a].S, E = C[a].E, n = S.c.length, t = el('table'), th = el('thead'), tr = el('tr'), cnt = rows || 12;
    ['Wochenschluss', 'Schluss', 'SMA50', 'Abstand', 'Regel'].forEach(function (h, k) { var c = el('th', k > 0 && k < 4 ? 'n' : null, h); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody'); for (var i = n - 1; i >= Math.max(49, n - cnt); i--) { var r = el('tr'); r.appendChild(el('td', null, dDE(S.d[i]))); r.appendChild(el('td', 'n', usd(a, S.c[i]))); r.appendChild(el('td', 'n', usd(a, E.sma[i]))); r.appendChild(el('td', 'n', pct(S.c[i] / E.sma[i] - 1, 1))); r.appendChild(el('td', null, (E.st[i] === 1 ? 'investiert' : 'Cash') + (CFG.assets[a].rule.type === 'confirm' ? ' · ' + (E.up[i] > 0 ? E.up[i] + '↑' : E.dn[i] > 0 ? E.dn[i] + '↓' : '=') : ''))); tb.appendChild(r); }
    t.appendChild(tb); return t;
  }
  function renderStatus(Mo) {
    renderChartLegend();
    var host = $('statusCards'); host.textContent = '';
    A.forEach(function (a) {
      var m = CFG.assets[a], E = C[a].E, L = E.last, ls = L.lastSwitch, st = D.state && D.state.assets && D.state.assets[a];
      var card = el('article', 'card scard'); card.id = 'card-' + a; card.style.setProperty('--acol', 'var(' + COLOR[a] + ')');
      var top = el('div', 'top1'), hd = el('div', 'hd'), left = el('div'), h = el('h3');
      h.appendChild(el('i', 'sw')); h.appendChild(document.createTextNode(m.name)); left.appendChild(h); left.appendChild(el('p', 'sub', m.ruleName + ' · Signal ' + (m.signal.sym || 'LBMA') + ' (USD) · Depot ' + (a === 'btc' ? 'Bitcoin' + (hasAlts(Mo) ? ' + ' + Mo.pos.btc.alts.filter(function (x) { return x.u > 1e-12; }).map(function (x) { return x.short; }).join(', ') : '') : a === 'ftse' ? 'VWCE' : 'WisdomTree Gold'))); hd.appendChild(left);
      var right = el('div', 'stbox'), stp = el('span', 'state ' + (L.st === 1 ? 'in' : 'out')); stp.appendChild(el('i')); stp.appendChild(document.createTextNode(L.st === 1 ? 'Investiert' : 'Cash')); right.appendChild(stp); if (ls) right.appendChild(el('span', 'since', 'seit ' + dDE(ls.d)));
      var bigBtn = el('button', 'btn sm ghost bigbtn', 'Groß anzeigen'); bigBtn.type = 'button'; bigBtn.setAttribute('aria-label', m.name + ' in Großansicht öffnen'); bigBtn.setAttribute('data-big', a); bigBtn.addEventListener('click', function () { openBig(a); }); right.appendChild(bigBtn); hd.appendChild(right);
      top.appendChild(hd);
      var fig = el('div', 'fig'); fig.appendChild(el('span', 'fl', 'Wochenschluss ' + dDE(L.d))); fig.appendChild(el('b', 'fv', usd(a, L.c))); fig.appendChild(el('span', 'fd', pct(L.dist, 1) + ' zum SMA50')); top.appendChild(fig);
      var lp = livePrice(a), rn = lp ? ruleNow(a, lp.usd) : null;
      if (lp && rn) {
        var lv = el('div', 'live' + (rn.would ? ' would' : ''));
        var head = el('div', 'lh'); head.appendChild(el('span', 'll', lp.eod ? 'Letzter Schluss ' + (lp.d ? dShort(lp.d) : '') : 'Aktuell ' + (lp.t ? new Date(lp.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr' : ''))); head.appendChild(el('b', 'lv', usd(a, lp.usd))); lv.appendChild(head);
        var what = rn.would ? ('Schließt die Woche so: ' + (rn.wouldSt ? 'Kaufsignal' : 'Verkaufssignal')) : (CFG.assets[a].rule.type === 'confirm' && ((rn.st === 1 && lp.usd < rn.thr) || (rn.st === 0 && lp.usd > rn.thr)) ? 'So wäre das der ' + (lp.usd > rn.thr ? rn.up : rn.dn) + '. Schluss ' + (lp.usd > rn.thr ? 'über' : 'unter') + ' dem SMA50, Signal erst nach ' + CFG.assets[a].rule.n : 'Schließt die Woche so, bleibt die Regel ' + (rn.wouldSt ? 'investiert' : 'auf Cash'));
        lv.appendChild(el('p', 'ld', pct(rn.dist, 1) + ' zur Schwelle ' + usd(a, rn.thr) + ' · ' + what + '.'));
        var ls1 = el('p', 'ls', lp.live ? 'Live im Browser' : lp.spot ? 'Spotpreis, stündlich aktualisiert' : lp.eod ? 'Tagesschluss (für den ETF gibt es keinen Live-Kurs)' : 'stündlich aktualisiert'); if (lp.src) ls1.title = 'Quelle: ' + lp.src; lv.appendChild(ls1);
        top.appendChild(lv);
      }
      var row = el('div', 'row'), ti = thresholdInfo(a);
      if (L.changed) row.appendChild(chip(L.st === 1 ? 'buy' : 'sell', L.st === 1 ? 'Neues Kaufsignal' : 'Neues Verkaufssignal'));
      if (ti.edge) row.appendChild(chip('warn', 'Grenzfall'));
      if (a === 'gold' && D.state && D.state.cross && D.state.cross.goldf && D.state.cross.goldf.st != null && D.state.cross.goldf.st !== L.st) row.appendChild(chip('info', 'COMEX-Future: ' + (D.state.cross.goldf.st === 1 ? 'investiert' : 'Cash')));
      if (st && st.fallback) row.appendChild(chip('warn', 'Ersatzquelle'));
      if (st && st.pending) row.appendChild(chip('info', 'Schluss fehlt noch'));
      if (row.childNodes.length) top.appendChild(row);
      card.appendChild(top);
      var mid = el('div', 'mid'), act = actionFor(a, Mo), ab = el('div', 'act ' + act.cls); ab.appendChild(el('b', null, act.title)); ab.appendChild(el('span', null, act.text + (act.next ? ' ' + act.next : ''))); mid.appendChild(ab);
      card.appendChild(mid);
      var cw = el('div', 'cchart'), ch = el('div', 'chart'); ch.id = 'ch-' + a; ch.setAttribute('role', 'img'); cw.appendChild(ch); card.appendChild(cw);
      var bot = el('div', 'bot');
      var w = currentWarn(a); if (w && w.level !== 'none') { var wb = el('div', 'warnbox'); wb.innerHTML = ICON.warn; wb.appendChild(el('span', null, 'Vorwarnung ' + dtDE(w.t) + ': ' + (w.text || ''))); bot.appendChild(wb); }
      if (act.tax) { var tb = el('div', act.tax.level === 'warn' ? 'warnbox' : 'infobox'); if (act.tax.level === 'warn') tb.innerHTML = ICON.warn; tb.appendChild(el('span', null, act.tax.text)); bot.appendChild(tb); }
      if (st && st.fallback && st.src && !st.preliminary) bot.appendChild(el('p', 'small muted', 'Ersatzquelle: ' + st.src.replace(/ adjclose/, ' bereinigt') + ' (Hauptquelle nicht erreichbar)'));
      if (st && st.preliminary) bot.appendChild(el('p', 'small muted', 'Vorläufiger Wochenschluss (' + (st.prelimLabel || 'aus dem aktuellen Kurs vom ' + dDE(st.preliminary)) + '); der endgültige Schluss folgt mit einem der nächsten Läufe und wird gemeldet, wenn sich die Regel dadurch ändert.'));
      if (bot.childNodes.length) card.appendChild(bot); /* SMA50, Serie, Schwellen und Wochentabelle stehen in der Großansicht */
      host.appendChild(card);
    });
    drawCharts();
  }
  /* ---------- Großansicht ---------- */
  var BIG = { a: null, range: null };
  /* Schließen gibt den Fokus an den Knopf zurück, der die Großansicht geöffnet hat (auch wenn die Karte inzwischen neu gezeichnet wurde) */
  function closeBig() {
    var mo = $('bigModal'); if (!mo) return; var a = BIG.a;
    mo.hidden = true; document.body.style.overflow = ''; BIG.a = null;
    var back = a && document.querySelector('[data-big="' + a + '"]'); if (back) { try { back.focus(); } catch (e) { /* still */ } }
  }
  /* Fokus bleibt in der Großansicht: Tab und Umschalt+Tab laufen im Kreis */
  function trapFocus(e) {
    if (e.key !== 'Tab' || !BIG.a) return;
    var box = $('bigBox'); if (!box) return;
    var f = Array.prototype.filter.call(box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if (!box.contains(cur)) { e.preventDefault(); first.focus(); return; }
    if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', trapFocus);
  function openBig(a) {
    var Mo = model(), mo = $('bigModal'), box = $('bigBox'); if (!mo) return;
    BIG.a = a; if (BIG.range == null) BIG.range = VIEW.range;
    box.textContent = '';
    var m = CFG.assets[a], E = C[a].E, L = E.last, ls = L.lastSwitch;
    var hd = el('div', 'bighd'); var tl = el('div'); var h = el('h2'); h.appendChild(el('i', 'sw')); h.appendChild(document.createTextNode(m.name)); h.style.setProperty('--acol', 'var(' + COLOR[a] + ')'); tl.appendChild(h); tl.appendChild(el('p', 'sub muted', m.ruleName + ' · ' + m.signal.label + ' · ' + pctPlain(m.w, 0) + ' des Depots')); hd.appendChild(tl);
    var right = el('div', 'row'); var stp = el('span', 'state ' + (L.st === 1 ? 'in' : 'out')); stp.appendChild(el('i')); stp.appendChild(document.createTextNode(L.st === 1 ? 'Investiert' : 'Cash' + (ls ? ' seit ' + dDE(ls.d) : ''))); right.appendChild(stp);
    var cb = el('button', 'btn ghost', 'Schließen'); cb.type = 'button'; cb.addEventListener('click', closeBig); right.appendChild(cb); hd.appendChild(right); box.appendChild(hd);
    var tools = el('div', 'toolbar');
    var facts = el('div', 'bigfacts');
    function fact(l, v, cls) { var f = el('div', 'bf ' + (cls || '')); f.appendChild(el('span', 'k', l)); f.appendChild(el('b', 'v', v)); facts.appendChild(f); }
    fact('Wochenschluss ' + dShort(L.d), usd(a, L.c)); fact('SMA50', usd(a, L.m)); fact('Abstand', pct(L.dist, 1)); fact('Serie', streakText(L));
    var lp = livePrice(a), rn = lp ? ruleNow(a, lp.usd) : null; if (lp && rn) fact(lp.eod ? 'Letzter Schluss' : 'Aktuell', usd(a, lp.usd) + ' (' + pct(rn.dist, 1) + ' zur Schwelle)', rn.would ? 'hot' : '');
    tools.appendChild(facts);
    var seg = el('div', 'seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Zeitraum');
    [[52, '1 J'], [156, '3 J'], [260, '5 J'], [520, '10 J'], [0, 'Max']].forEach(function (r) { var b = el('button', null, r[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(BIG.range === r[0])); b.addEventListener('click', function () { BIG.range = r[0]; Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawBig(a); }); seg.appendChild(b); });
    tools.appendChild(seg); box.appendChild(tools);
    var ch = el('div', 'chart bigchart'); ch.id = 'bigChart'; ch.setAttribute('role', 'img'); box.appendChild(ch);
    var act = actionFor(a, Mo), ab = el('div', 'act ' + act.cls); ab.appendChild(el('b', null, act.title)); ab.appendChild(el('span', null, act.text + (act.next ? ' ' + act.next : ''))); box.appendChild(ab);
    var ti = thresholdInfo(a), nx = el('p', 'next'); nx.appendChild(document.createTextNode(ti.text[0])); nx.appendChild(el('b', null, ti.text[1])); nx.appendChild(document.createTextNode(ti.text[2])); box.appendChild(nx);
    var w = currentWarn(a); if (w && w.level !== 'none') { var wb = el('div', 'warnbox'); wb.innerHTML = ICON.warn; wb.appendChild(el('span', null, 'Vorwarnung ' + dtDE(w.t) + ': ' + (w.text || ''))); box.appendChild(wb); }
    var swl = el('div', 'bigsw'); swl.appendChild(el('p', 'subhd', 'Signale der letzten Jahre'));
    var sws = E.sw.slice(-8).reverse(); if (!sws.length) swl.appendChild(el('p', 'small muted', 'Noch keine Signale.'));
    sws.forEach(function (sw) { var r = el('div', 'swrow'); r.appendChild(chip(sw.to ? 'buy' : 'sell', sw.to ? 'Kauf' : 'Verkauf')); r.appendChild(el('span', null, dDE(sw.d) + ' · Schluss ' + usd(a, sw.c) + ' · SMA50 ' + usd(a, sw.m) + ' · Handel ' + dShort(nextMonday(sw.d)))); swl.appendChild(r); });
    box.appendChild(swl);
    var tw = el('div', 'tablewrap'); tw.appendChild(weeksTable(a, 26)); box.appendChild(el('p', 'subhd', 'Letzte 26 Wochen')); box.appendChild(tw);
    mo.hidden = false; document.body.style.overflow = 'hidden';
    drawBig(a); cb.focus();
  }
  function drawBig(a) { var host = $('bigChart'); if (!host || BIG.a !== a) return; CH.ruleChart(host, { S: C[a].S, E: C[a].E, rule: CFG.assets[a].rule, color: COLOR[a], range: BIG.range, name: CFG.assets[a].name, usd: function (v) { return usd(a, v); }, thick: a === 'gold', tall: true }); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && BIG.a) closeBig(); });
  function drawCharts() { A.forEach(function (a) { var host = $('ch-' + a); if (!host) return; CH.ruleChart(host, { S: C[a].S, E: C[a].E, rule: CFG.assets[a].rule, color: COLOR[a], range: VIEW.range, name: CFG.assets[a].name, usd: function (v) { return usd(a, v); }, thick: a === 'gold' }); }); }

  /* ---------- Depot ---------- */
  function renderDepot(Mo) {
    var ban = $('depotBanner'); ban.textContent = '';
    if (Mo.ready && Mo.cfg.taxStale) { var bt = el('div', 'banner'); bt.appendChild(el('b', null, 'Steuerangaben für ' + Mo.cfg.year + ' fehlen')); bt.appendChild(el('span', null, 'Die gespeicherten Angaben (Pauschbetrag genutzt, weitere Zinsen, andere Veräußerungen, Spielraum) gelten für ' + Mo.cfg.taxYearStored + '. Bis du unter Einstellungen die Werte für ' + Mo.cfg.year + ' einträgst, rechnet die Seite mit dem vollen Pauschbetrag und ohne andere Veräußerungen; Steuersatz und NV-Bescheinigung gelten weiter.')); ban.appendChild(bt); }
    if (Mo.ready && (Mo.est || (!Mo.cfg.pbKnown && !Mo.cfg.taxStale))) { var b1 = el('div', 'banner'), txt = []; b1.appendChild(el('b', null, Mo.est ? 'Teilweise geschätzt' : 'Pauschbetrag fehlt'));
      Mo.dep.tx.forEach(function (t) { if (t.est) txt.push(INFO(t.a).inst + ': ' + (t.note || 'Werte geschätzt.')); });
      if (!Mo.cfg.pbKnown && !Mo.cfg.taxStale) txt.push('Der schon genutzte Pauschbetrag fehlt noch, gerechnet wird mit den vollen 1.000 €.');
      b1.appendChild(el('span', null, txt.join(' '))); ban.appendChild(b1); }
    /* Fehlt ein Euro-Kurs, ist der Wert der Position unbekannt: keine Summen, Anteile und Abweichungen, statt mit 0 € zu rechnen */
    var miss = A.filter(function (a) { return Mo.pos[a].missing; });
    if (miss.length) { var bm = el('div', 'banner bad'); bm.appendChild(el('b', null, 'Euro-Kurs fehlt für ' + miss.map(function (a) { return CFG.assets[a].inst; }).join(', '))); bm.appendChild(el('span', null, 'Ohne Kurs ist der Wert dieser Position unbekannt. Summen, Aufteilung und Rebalancing-Vorschau erscheinen erst wieder, wenn der Kurs da ist (mit dem nächsten Lauf oder beim Neuladen).')); ban.appendChild(bm); }
    var tot = 0, inv = 0, cashT = 0;
    A.forEach(function (a) { var P = Mo.pos[a]; inv += P.val || 0; cashT += P.cash; });
    tot = inv + cashT;
    var full = !miss.length;
    renderAlloc(Mo, tot, cashT, miss);
    var pt = $('posTable'); pt.textContent = ''; var t = el('table'), th = el('thead'), tr = el('tr');
    ['Position', 'Regel', 'Bestand', 'Kurs', 'Wert', 'Cash', 'Summe', 'Anteil mit Cash', 'Zielgewicht', 'Abweichung'].forEach(function (h, i) { var c = el('th', i > 1 ? 'n' : null, h); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    A.forEach(function (a) { var P = Mo.pos[a], r = el('tr'), c0 = el('td'), sw = el('span', 'sw'); sw.style.background = 'var(' + COLOR[a] + ')'; c0.appendChild(sw); c0.appendChild(document.createTextNode(CFG.assets[a].inst)); r.appendChild(c0);
      var st = C[a].E.last.st; var c1 = el('td'); c1.appendChild(el('span', 'tag ' + (st === 1 ? 'ok' : ''), st === 1 ? 'investiert' : 'Cash')); r.appendChild(c1);
      var bc = el('td', 'n', P.u > 0 ? units(a, P.uBtc != null ? P.uBtc : P.u) : '–'); var withAlts = a === 'btc' && P.alts && P.alts.some(function (x) { return x.u > 1e-12; }); if (withAlts) bc.appendChild(el('span', 'sub', '+ Beimischung (davon-Zeilen)')); r.appendChild(bc); var pxc = el('td', 'n', P.px ? eur(P.px, a === 'btc' ? 0 : 2) + ' ' : '–'); var pxo = pxOf(a); if (pxo && pxo.estimate) { var et = el('span', 'tag est', 'geschätzt'); et.title = pxo.src || ''; pxc.appendChild(et); } else if (pxo && pxo.stale) { var sg = el('span', 'tag', 'Stand ' + dShort(pxo.d)); sg.title = 'Lang & Schwarz war beim letzten Lauf nicht erreichbar; das ist der letzte L&S-Kurs'; pxc.appendChild(sg); } else if (pxo && pxo.fallback) { var ft = el('span', 'tag', 'Ersatzquelle'); ft.title = pxo.src || ''; pxc.appendChild(ft); } if (P.missing) { pxc.textContent = ''; var mt = el('span', 'tag bad', 'Kurs fehlt'); mt.title = 'Für diese Position liegt noch kein Euro-Kurs vor'; pxc.appendChild(mt); } r.appendChild(pxc); var vc = el('td', 'n', P.val == null ? '–' : eur(P.val)); if (withAlts && P.val != null) vc.appendChild(el('span', 'sub', 'inkl. Beimischung')); r.appendChild(vc); r.appendChild(el('td', 'n', eur(P.cash)));
      var sum = P.val == null ? null : P.val + P.cash; r.appendChild(el('td', 'n', sum == null ? '–' : eur(sum))); r.appendChild(el('td', 'n', full && tot > 0 ? pctPlain(sum / tot, 1) : '–')); r.appendChild(el('td', 'n', pctPlain(CFG.assets[a].w, 0))); r.appendChild(el('td', 'n', full ? sgnEur(sum - tot * CFG.assets[a].w) : '–')); tb.appendChild(r);
      /* Beimischung: steckt schon im Wert und in der Summe der Bitcoin-Zeile, deshalb hier nur „davon“ ohne eigene Summe und eigenen Anteil */
      if (a === 'btc' && P.alts) P.alts.forEach(function (x) { if (!(x.u > 1e-12)) return; var ar = el('tr', 'altrow'), a0 = el('td'); a0.appendChild(el('span', 'sw')); a0.appendChild(document.createTextNode('davon ' + x.name + ' (Beimischung, folgt der Bitcoin-Regel)')); ar.appendChild(a0); ar.appendChild(el('td', null, ''));
        ar.appendChild(el('td', 'n', units(x.id, x.u))); var apx = el('td', 'n', x.px ? eur(x.px, 2) + ' ' : 'Kurs fehlt noch'); if (x.px && x.live) apx.appendChild(el('span', 'tag', 'live')); ar.appendChild(apx); ar.appendChild(el('td', 'n', x.val != null ? 'davon ' + eur(x.val) : '–')); for (var ci = 0; ci < 5; ci++) ar.appendChild(el('td', 'n', '')); tb.appendChild(ar); }); });
    t.appendChild(tb); var tf = el('tfoot'), fr = el('tr'); fr.appendChild(el('td', null, 'Summe')); fr.appendChild(el('td')); fr.appendChild(el('td')); fr.appendChild(el('td')); fr.appendChild(el('td', 'n', full ? eur(inv) : '–')); fr.appendChild(el('td', 'n', eur(cashT))); fr.appendChild(el('td', 'n', full ? eur(tot) : '–')); fr.appendChild(el('td', 'n', full ? '100 %' : '–')); fr.appendChild(el('td', 'n', '100 %')); fr.appendChild(el('td')); tf.appendChild(fr); t.appendChild(tf);
    pt.appendChild(t);
    renderTx(Mo);
  }
  function renderAlloc(Mo, tot, cashT, miss) {
    var al = $('alloc'); al.textContent = ''; al.appendChild(el('p', 'subhd', 'Aufteilung: Ist und Ziel'));
    if (miss && miss.length) { al.appendChild(el('p', 'small muted', 'Keine Aufteilung, solange der Euro-Kurs für ' + miss.map(function (a) { return CFG.assets[a].name; }).join(' und ') + ' fehlt: Der Wert ' + (miss.length > 1 ? 'dieser Positionen' : 'dieser Position') + ' ist unbekannt.')); return; }
    if (!(tot > 0)) { al.appendChild(el('p', 'small muted', 'Noch keine Werte.')); return; }
    var ist = { btc: Mo.pos.btc.val || 0, ftse: Mo.pos.ftse.val || 0, gold: Mo.pos.gold.val || 0, cash: cashT };
    var ziel = { btc: 0, ftse: 0, gold: 0, cash: 0 }, outs = [];
    A.forEach(function (a) { var w = CFG.assets[a].w * tot; if (C[a].E.last.st === 1) ziel[a] += w; else { ziel.cash += w; outs.push(CFG.assets[a].name); } });
    var withAlts = hasAlts(Mo);
    function parts(o, which) { return CAT.map(function (c) { var note = null; var label = c.k === 'btc' && withAlts ? 'Krypto (Bitcoin + ' + Mo.pos.btc.alts.filter(function (x) { return x.u > 1e-12; }).map(function (x) { return x.short; }).join(', ') + ')' : c.label; if (which === 'ziel' && c.k === 'cash' && outs.length) note = 'Anteil von ' + outs.join(' und ') + ', Regel auf Cash'; if (which === 'ist' && c.k === 'cash') { var bits = A.filter(function (a) { return Mo.pos[a].cash > 0.5; }).map(function (a) { return CFG.assets[a].name + ' ' + eur(Mo.pos[a].cash); }); if (bits.length) note = 'davon ' + bits.join(', '); } return { k: c.k, label: label, color: c.color, v: o[c.k], note: note }; }); }
    var wrap = el('div', 'donuts');
    function legend(ps) { var lg = el('div', 'dlegend'); ps.forEach(function (q) { if (!(q.v > 0.5)) return; var it = el('span'), sw = el('i', 'sw'); sw.style.background = 'var(' + q.color + ')'; it.appendChild(sw); it.appendChild(document.createTextNode(q.label + ' ' + pctPlain(q.v / tot, 0) + ' · ' + eur(q.v))); lg.appendChild(it); }); return lg; }
    var pi = parts(ist, 'ist'), pz = parts(ziel, 'ziel'), d1 = el('div'), d2 = el('div');
    d1.appendChild(CH.donut('Ist', 'was gerade im Depot liegt', pi, tot)); d1.appendChild(legend(pi));
    d2.appendChild(CH.donut('Ziel', 'laut Regeln', pz, tot)); d2.appendChild(legend(pz));
    wrap.appendChild(d1); wrap.appendChild(d2);
    al.appendChild(wrap);
    al.appendChild(el('p', 'small muted', 'Ziel 50 / 30 / 20 (FTSE / Bitcoin / Gold). ' + (outs.length ? outs.join(' und ') + (outs.length > 1 ? ' stehen' : ' steht') + ' laut Regel auf Cash, deshalb zählt ' + (outs.length > 1 ? 'ihr Anteil' : 'sein Anteil') + ' im Ziel als Cash. Abweichungen je Position stehen in der Tabelle unten.' : 'Alle drei Regeln sind investiert.')));
  }
  var pendingDelete = null;
  /* Buchungen und Kauflose in einer Tabelle: jede Buchung mit dem, was heute daraus geworden ist (Restbestand nach FIFO, Wert, Gewinn, steuerliche Lage) */
  var SHOW_NOTES = false; try { SHOW_NOTES = localStorage.getItem('regelDepot.notes') === '1'; } catch (e) { /* still */ }
  function renderTx(Mo) {
    var h = $('txTable'); h.textContent = '';
    if (TXMSG) { var tm = el('p', 'formmsg' + (TXMSG.err ? ' err' : ''), TXMSG.text); tm.setAttribute('role', 'status'); tm.style.padding = '0 16px'; h.appendChild(tm); }
    var nb = $('btnNotes'); if (nb) { nb.setAttribute('aria-pressed', SHOW_NOTES ? 'true' : 'false'); nb.textContent = SHOW_NOTES ? 'Notizen ausblenden' : 'Notizen'; }
    var rest = {}; A.forEach(function (a) { (a === 'btc' ? Mo.B.pos.btc : Mo.pos[a].lots).forEach(function (l) { if (l.id) rest[l.id] = l; }); }); ALTS.forEach(function (x) { Mo.altPos[x.id].lots.forEach(function (l) { if (l.id) rest[l.id] = l; }); });
    var realBy = {}; Mo.B.real.forEach(function (r) { if (r.id) realBy[r.id] = r; });
    var t = el('table'), th = el('thead'), tr = el('tr'); ['Datum', 'Position', 'Art', 'Stück', 'Kurs', 'Betrag', 'Wert heute', 'Gewinn', 'Steuerlich', ''].forEach(function (x, i) { var c = el('th', i >= 3 && i <= 7 ? 'n' : null, x); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody'), list = Mo.dep.tx.slice().sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : (b.ts || 0) - (a.ts || 0); }), today = todayISO();
    if (!list.length) { var er = el('tr'), ec = el('td', null, Mo.ready ? 'Noch keine Buchungen.' : 'Depotdaten noch nicht importiert.'); ec.colSpan = 10; er.appendChild(ec); tb.appendChild(er); }
    list.forEach(function (x) {
      var r = el('tr'), a = x.a, P = posOf(Mo, a) || { px: null }, cashMove = x.type === 'einzahlung' || x.type === 'auszahlung';
      r.appendChild(el('td', null, dDE(x.d)));
      var c1 = el('td'), sw = el('span', 'sw'); sw.style.background = 'var(' + (COLOR[a] || '--alt') + ')'; c1.appendChild(sw); c1.appendChild(document.createTextNode(INFO(a).short + ' ')); if (ALT[a]) c1.appendChild(el('span', 'tag', 'Beimischung')); if (x.est) c1.appendChild(el('span', 'tag est', 'geschätzt'));
      if (x.note) { if (SHOW_NOTES) { var nt = el('span', 'sub small muted', x.note); nt.style.display = 'block'; c1.appendChild(nt); } else { c1.title = x.note; var ni = el('span', 'noteic', 'i'); ni.setAttribute('aria-label', 'Notiz: ' + x.note); c1.appendChild(ni); } }
      r.appendChild(c1);
      r.appendChild(el('td', null, x.type === 'kauf' ? 'Kauf' : x.type === 'verkauf' ? 'Verkauf' : x.type === 'einzahlung' ? 'Einzahlung' : 'Auszahlung'));
      if (cashMove) { r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'n', (x.type === 'einzahlung' ? '+' : '−') + eur(x.amount, 2))); r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'small muted', 'Cash des Bausteins')); }
      else if (x.type === 'kauf') {
        var lot = rest[x.id], left = lot ? lot.units : 0, cpu = (x.units * x.price + (x.fee || 0)) / x.units;
        var cs = el('td', 'n', units(a, x.units)); if (left > 1e-9 && left < x.units - 1e-9) cs.appendChild(el('span', 'sub', 'noch ' + units(a, left))); else if (!(left > 1e-9)) cs.appendChild(el('span', 'sub', 'verkauft')); r.appendChild(cs);
        var cp = el('td', 'n', eur(x.price, a === 'btc' ? 0 : 2)); if ((x.fee || 0) > 0) cp.appendChild(el('span', 'sub', '+ ' + eur(x.fee, 2) + ' Gebühr')); r.appendChild(cp);
        r.appendChild(el('td', 'n', eur(x.units * x.price + (x.fee || 0), 2)));
        if (left > 1e-9 && P.px) { var val = left * P.px, g = val - left * cpu; r.appendChild(el('td', 'n', eur(val))); r.appendChild(el('td', 'n ' + (g >= 0 ? 'up' : 'down'), sgnEur(g) + ' (' + pct(g / (left * cpu), 1) + ')')); }
        else { r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'n', '–')); }
        var tax = !(left > 1e-9) ? 'im Bestand nicht mehr enthalten' : a === 'ftse' ? '§ 20: Abgeltungsteuer, 30 % Teilfreistellung' : (ENG.isLongTerm(x.d, today) ? '§ 23: Haltefrist vorbei, steuerfrei' : '§ 23: steuerfrei ' + (x.est ? 'spätestens ' : '') + 'ab ' + dDE(ENG.taxFreeFrom(x.d)));
        r.appendChild(el('td', 'small', tax));
      } else {
        var rl = realBy[x.id];
        r.appendChild(el('td', 'n', units(a, x.units))); var sp = el('td', 'n', eur(x.price, a === 'btc' ? 0 : 2)); if ((x.fee || 0) > 0) sp.appendChild(el('span', 'sub', '− ' + eur(x.fee, 2) + ' Gebühr')); r.appendChild(sp);
        r.appendChild(el('td', 'n', eur(x.units * x.price - (x.fee || 0), 2))); r.appendChild(el('td', 'n', '–'));
        if (rl) {
          r.appendChild(el('td', 'n ' + (rl.gain >= 0 ? 'up' : 'down'), sgnEur(rl.gain) + ' realisiert'));
          /* Kurz- oder langfristig nach den verkauften Kauflosen, nicht nach dem Gewinn (ein Gewinn von 0 heißt nicht „Haltefrist vorbei“) */
          var tt = a === 'ftse' ? '§ 20: ' + eur(Math.max(0, rl.gain) * (1 - Mo.cfg.tfs)) + ' steuerpflichtig nach Teilfreistellung'
            : rl.shortUnits > 1e-12 ? '§ 23: kurzfristig ' + sgnEur(rl.shortGain) + (rl.longUnits > 1e-12 ? ', steuerfrei ' + sgnEur(rl.longGain) : '') : rl.longUnits > 1e-12 ? '§ 23: Haltefrist vorbei, steuerfrei' : '–';
          var tcell = el('td', 'small', tt);
          if (rl.open > 1e-9) { var ow = el('span', 'tag bad', units(a, rl.open) + ' ohne Kauf davor'); ow.title = 'Für diese Stücke gibt es keinen früheren Kauf; sie zählen nicht als Gewinn. Trag den fehlenden Kauf nach oder korrigiere das Datum.'; tcell.appendChild(document.createTextNode(' ')); tcell.appendChild(ow); }
          r.appendChild(tcell);
        }
        else { r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'small muted', 'kein passender Kauf davor')); }
      }
      var c = el('td', 'n'); var b = el('button', pendingDelete === x.id ? 'btn sm danger' : 'link del', pendingDelete === x.id ? 'Wirklich löschen' : 'Löschen'); b.type = 'button'; b.addEventListener('click', function () { if (pendingDelete !== x.id) { pendingDelete = x.id; renderTx(model()); return; } pendingDelete = null; deleteTx(x); }); c.appendChild(b); if (pendingDelete === x.id) { var cn = el('button', 'btn sm ghost', 'Abbrechen'); cn.type = 'button'; cn.style.marginLeft = '6px'; cn.addEventListener('click', function () { pendingDelete = null; renderTx(model()); }); c.appendChild(cn); } r.appendChild(c); tb.appendChild(r);
    });
    t.appendChild(tb); h.appendChild(t);
  }
  /* Löschen: genau die Cash-Änderung zurückbuchen, die die Buchung beim Eintragen gemacht hat (tx.cash). Buchungen ohne diesen Vermerk
     (importiert oder mit einer älteren Version eingetragen) und nachgetragene Bewegungen ändern das Cash nicht; die Meldung sagt das.
     Ein Kauf, den ein späterer Verkauf braucht, bleibt stehen (sonst wäre der Verkauf ungedeckt). */
  var TXMSG = null;
  function deleteTx(x) {
    var dep = STORE.load(), rest = dep.tx.filter(function (t) { return t.id !== x.id; });
    if (x.type === 'kauf') {
      var openBefore = ENG.book(dep.tx).real.filter(function (r) { return r.open > 1e-9; }).map(function (r) { return r.id; });
      var bad = ENG.book(rest).real.filter(function (r) { return r.open > 1e-9 && openBefore.indexOf(r.id) < 0; });
      if (bad.length) { TXMSG = { text: 'Nicht gelöscht: Dieser Kauf deckt den Verkauf vom ' + dDE(bad[0].d) + '. Lösch zuerst den Verkauf oder trag vorher den richtigen Kauf ein.', err: true }; schedule(); return; }
    }
    var b = bucketOf(x.a), applied = typeof x.cash === 'number' && isFinite(x.cash) ? x.cash : null, text = '';
    if (!saveOr(null, function (d) {
      d.tx = d.tx.filter(function (t) { return t.id !== x.id; });
      var cur = d.cash[b] || 0;
      if (x.hist) { text = 'Buchung gelöscht. Sie war nur nachgetragen, das Cash bleibt ' + eur(cur, 2) + '.'; return; }
      if (applied == null) { text = 'Buchung gelöscht. Das Cash bleibt ' + eur(cur, 2) + ', weil die Buchung keinen Cash-Vermerk hat (importiert oder mit einer älteren Version der Seite eingetragen). Prüfe das Cash unter Einstellungen.'; return; }
      var target = cur - applied;
      if (target < -0.005) { d.cash[b] = 0; text = 'Buchung gelöscht. Cash ' + bname(b) + ' ' + eur(cur, 2) + ' → 0,00 €; ' + eur(-target, 2) + ' ließen sich nicht zurückbuchen, weil das Cash dafür nicht reicht.'; }
      else { d.cash[b] = Math.max(0, target); text = 'Buchung gelöscht. Cash ' + bname(b) + ' ' + eur(cur, 2) + ' → ' + eur(d.cash[b], 2) + '.'; }
    })) { TXMSG = { text: SAVE_ERR, err: true }; schedule(); return; }
    TXMSG = { text: text, err: false }; msg('fMsg', text); schedule();
  }
  /* Speichern mit Fehlermeldung statt stiller Ausnahme (z. B. solange ein unlesbarer Stand nicht gesichert ist) */
  var SAVE_ERR = '';
  function saveOr(msgId, fn) { try { return STORE.update(fn); } catch (e) { SAVE_ERR = 'Nicht gespeichert: ' + e.message; if (msgId) msg(msgId, SAVE_ERR, true); return null; } }

  /* ---------- Performance ---------- */
  function eurSeries() {
    var out = {};
    A.forEach(function (a) { var map = {}; ((D.eur && D.eur.weekly && D.eur.weekly[a]) || []).forEach(function (x) { map[x[0]] = { d: x[1], c: x[2] }; }); var l = pxOf(a); if (l) { var k = ENG.mondayOf(l.d); if (!map[k] || l.d >= map[k].d) map[k] = { d: l.d, c: l.p }; } out[a] = map; });
    return out;
  }
  /* Depotverlauf je Woche: Positionen zu Euro-Wochenkursen, Cash je Baustein rückwärts aus den Buchungen abgeleitet,
     Zinsen auf Cash (cashRate p. a.) wöchentlich aufgelaufen. Einzahlungen/Auszahlungen als Buchungen vom Typ einzahlung/auszahlung. */
  function cashDelta(t) { if (t.type === 'kauf') return -(t.units * t.price + (t.fee || 0)); if (t.type === 'verkauf') return t.units * t.price - (t.fee || 0); if (t.type === 'einzahlung') return +t.amount || 0; if (t.type === 'auszahlung') return -(+t.amount || 0); return 0; }
  /* Wirkung auf das echte Cash des Bausteins (für den Verlauf): nachgetragene Bewegungen voll (sie stecken im heutigen Cash), sonst der beim
     Eintragen vermerkte Betrag (ein Kauf über das Cash hinaus war zum Teil von außen bezahlt), ohne Vermerk die Buchung selbst */
  function econDelta(t) { if (t.hist) return cashDelta(t); if (typeof t.cash === 'number' && isFinite(t.cash)) return t.cash; return cashDelta(t); }
  /* Kursreihen in Euro je Anlage als sortierte [Datum, Kurs]-Listen: täglich (eur.json daily + aktueller Kurs) oder wöchentlich */
  function eurPoints(a, daily) {
    /* Wochenschlüsse sind immer die Grundlage (Datum = letzter Handelstag der Woche); im Tagesraster überschreiben Tageskurse sie,
       fehlende Tage (z. B. bevor die Tagesreihe begann) laufen mit dem letzten Wochenschluss weiter statt als 0 zu erscheinen. */
    var seen = {}, rows = [];
    ((D.eur && D.eur.weekly && D.eur.weekly[a]) || []).forEach(function (r) { if (r[2] > 0) seen[r[1]] = r[2]; });
    if (daily) ((D.eur && D.eur.daily && D.eur.daily[a]) || []).forEach(function (r) { if (r[1] > 0) seen[r[0]] = r[1]; });
    var keys = Object.keys(seen).sort(), last = keys.length ? keys[keys.length - 1] : '';
    var l = pxOf(a); if (l && l.d && l.p > 0 && l.d >= last) seen[l.d] = l.p;
    Object.keys(seen).sort().forEach(function (d) { rows.push([d, seen[d]]); });
    return rows;
  }
  function hasDaily() { return !!(D.eur && D.eur.daily && D.eur.daily.btc && D.eur.daily.btc.length > 5); }
  /* Depotverlauf: Positionen zu Euro-Kursen (letzter bekannter Kurs am Stichtag), Cash je Baustein rückwärts aus den Buchungen,
     Zinsen auf Cash (cashRate p. a.) über die Zeit aufgelaufen. grid: 'tag' oder 'woche'; from: erster Stichtag (ISO) oder null */
  function perfSeries(Mo, grid, from) {
    var tx = Mo.dep.tx.filter(function (t) { return t && t.d && (CFG.assets[t.a] || ALT[t.a]); });
    if (!tx.length) return null;
    var daily = grid === 'tag', P = {}, idx = {}, first = tx.reduce(function (mn, t) { return t.d < mn ? t.d : mn; }, '9999-12-31');
    A.forEach(function (a) { P[a] = eurPoints(a, daily); idx[a] = 0; }); ALTS.forEach(function (x) { P[x.id] = eurPoints(x.id, daily); });
    var today = todayISO(), start = daily ? first : ENG.mondayOf(first), lastDate = today;
    if (from && from > start) start = daily ? from : ENG.mondayOf(from);
    var stamps = [], d = start;
    if (daily) { while (d <= lastDate) { stamps.push(d); d = ENG.addDays(d, 1); } }
    else { while (d <= lastDate) { stamps.push(d); d = ENG.addDays(d, 7); } }
    if (!stamps.length) return null;
    function priceAt(a, date) { var rows = P[a], v = null; for (var i = 0; i < rows.length && rows[i][0] <= date; i++) v = rows[i]; return v; }
    /* Cash-Modell: Das heutige Cash je Baustein ist der Anker (es enthält alle bisher gutgeschriebenen Zinsen).
       Ab dem Regelstart (config trading.start) bewegen Käufe, Verkäufe, Ein- und Auszahlungen das Cash, und es wird täglich mit cashRate verzinst (geschätzt).
       Käufe vor dem Regelstart gelten als von außen bezahlt (Kraken, Überweisungen); davor ist das Cash so hoch wie heute, ohne Zinsen.
       Ein Baustein zählt erst ab seiner ersten Buchung; Bausteine ohne Buchungen (nur Cash) zählen ab dem Beginn der Reihe. */
    var START = (CFG.trading && CFG.trading.start) || '2026-09-28', rate = Mo.cfg.cashRate || 0;
    /* Das eingetragene Cash gilt ab „Stand vom“ (cashDate); ohne Datum erst ab dem Regelstart. Davor nimmt die Seite kein Cash an. */
    var CASH_FROM = Mo.dep.cashDate || START;
    var cashTx = tx.filter(function (t) { return t.d >= START; });
    function principalAt(a, date) { var c = Mo.cash[a] || 0; cashTx.forEach(function (t) { if (bucketOf(t.a) === a && t.d > date) c -= econDelta(t); }); return c; }
    var cum = {}, totalI = {};
    A.forEach(function (a) { cum[a] = {}; var acc = 0, dd = START; while (dd <= today) { acc += Math.max(0, principalAt(a, dd)) * rate / 365; cum[a][dd] = acc; dd = ENG.addDays(dd, 1); } totalI[a] = acc; });
    function interestAt(a, date) { return date < START ? 0 : (cum[a][date] || 0); }
    function cashAt(a, date) { if (date < CASH_FROM) return 0; var Pr = principalAt(a, date); return Math.max(0, Pr - (totalI[a] - interestAt(a, date))); }
    var firstTx = {}; tx.forEach(function (t) { var b = bucketOf(t.a); if (!firstTx[b] || t.d < firstTx[b]) firstTx[b] = t.d; });
    function exists(a, date) { return firstTx[a] ? date >= firstTx[a] : date >= CASH_FROM; }
    var pts = [];
    stamps.forEach(function (k) {
      var end = daily ? k : ENG.addDays(k, 6); if (end > today) end = today;
      var upTo = tx.filter(function (t) { return t.d <= end; }), B = ENG.book(upTo.filter(function (t) { return t.type === 'kauf' || t.type === 'verkauf'; }));
      var parts = {}, total = 0, gainTotal = 0, dmax = '';
      A.forEach(function (a) {
        if (!exists(a, end)) return; /* Baustein gibt es zu diesem Zeitpunkt noch nicht */
        var u = ENG.units(B.pos[a] || []), val = 0, cost = ENG.cost(B.pos[a] || []), pr = priceAt(a, end), missing = u > 1e-12 && !pr;
        if (u > 1e-12 && pr) { val = u * pr[1]; if (pr[0] > dmax) dmax = pr[0]; }
        if (a === 'btc') ALTS.forEach(function (x) { var ua = ENG.units(B.pos[x.id] || []); cost += ENG.cost(B.pos[x.id] || []); if (ua > 1e-12) { var pa = priceAt(x.id, end); if (pa) { val += ua * pa[1]; if (pa[0] > dmax) dmax = pa[0]; } else missing = true; } });
        var cash = cashAt(a, end), interest = interestAt(a, end);
        var real = B.real.filter(function (r) { return bucketOf(r.a) === a; }).reduce(function (sx, r) { return sx + (r.gain || 0); }, 0);
        var gain = val - cost + real + interest;
        parts[a] = { val: val, cash: cash, interest: interest, gain: gain, cost: cost, units: u, missing: missing };
        total += val + cash; gainTotal += gain;
      });
      pts.push({ k: k, d: end, total: total, gainTotal: gainTotal, parts: parts });
    });
    return pts;
  }
  var PERF_RANGES = [['tage', '1 M · Tage'], ['wochen', '1 J · Wochen'], ['jahr', 'Jahr ' + new Date().getFullYear()], ['alles', 'Alles']];
  function drawPerf(Mo) {
    var host = $('chPerf'), leg = $('perfLegend'), cap = $('perfCap');
    var series = [{ key: 'total', label: 'Depot gesamt' }, { key: 'ftse', label: 'FTSE-Baustein', colorVar: '--ftse' }, { key: 'btc', label: 'Bitcoin-Baustein', colorVar: '--btc' }, { key: 'gold', label: 'Gold-Baustein', colorVar: '--gold' }];
    var est = Mo.dep.tx.filter(function (t) { return t.est; }).map(function (t) { return (({ btc: 'Bitcoin', ftse: 'VWCE', gold: 'Gold-ETC' })[t.a] || INFO(t.a).short) + ' ' + dDE(t.d); });
    var r = PERF.range, today = todayISO(), grid = 'woche', from = null, note = '';
    if (r === 'tage') { if (hasDaily()) { grid = 'tag'; from = ENG.addDays(today, -31); } else { note = 'Tageswerte liegen noch nicht vor (kommen mit den nächsten Läufen); gezeigt werden Wochenwerte. '; } }
    else if (r === 'wochen') from = ENG.addDays(today, -364);
    else if (r === 'jahr') from = today.slice(0, 4) + '-01-01';
    var startD = (CFG.trading && CFG.trading.start) || '2026-09-28';
    var capText = note + 'Baustein = Position plus Cash, ' + (grid === 'tag' ? 'Tages' : 'Wochen') + 'kurse in Euro, letzter Punkt aktuell. Cash ab dem Regelstart ' + dDE(startD) + ' aus den Buchungen zurückgerechnet und mit ' + pctPlain(Mo.cfg.cashRate || 0, 2) + ' p. a. verzinst (geschätzt); Käufe davor gelten als von außen bezahlt. Cash zählt ab dem Stand-Datum aus den Einstellungen' + (Mo.dep.cashDate ? ' (' + dDE(Mo.dep.cashDate) + ')' : '') + ', davor nimmt die Seite kein Cash an. Ein Baustein beginnt mit seiner ersten Buchung.' + (est.length ? ' Kaufdatum geschätzt: ' + est.join(', ') + '.' : '');
    /* Punkte, an denen für eine gehaltene Position noch kein Euro-Kurs vorliegt (z. B. vor Beginn einer Kursreihe), auslassen statt die
       Position mit 0 € zu zeigen; die Bildunterschrift nennt sie */
    var pts = Mo.ready ? perfSeries(Mo, grid, from) : null, skipped = [];
    if (pts) pts = pts.filter(function (p) { var m = Object.keys(p.parts).some(function (a) { return p.parts[a].missing; }); if (m) skipped.push(p.d); return !m; });
    if (skipped.length) capText += ' Ausgelassen, weil für eine gehaltene Position noch kein Euro-Kurs vorliegt: ' + (skipped.length === 1 ? 'der Punkt vom ' + dDE(skipped[0]) : skipped.length + ' Punkte vom ' + dDE(skipped[0]) + ' bis ' + dDE(skipped[skipped.length - 1])) + '.';
    CH.portfolioSplit(host, leg, cap, pts && pts.length ? pts : null, PERF.mode, series, capText);
    if (!(pts && pts.length >= 2) && skipped.length && cap) cap.textContent = capText;
  }

  /* ---------- Signale: Verlauf, Push, Zeitplan, Läufe ---------- */
  var feedAll = false;
  function switchText(a, s) {
    var r = CFG.assets[a].rule;
    /* Dieselbe Schwelle wie Vorwarnung und Statuskarte (aus den 49 Schlüssen davor) */
    if (r.type === 'band') return 'Schluss ' + usd(a, s.c) + (s.to ? ' über der Kaufschwelle ' : ' unter der Verkaufsschwelle ') + usd(a, s.thr) + ' (' + pctPlain(r.p, 0) + (s.to ? ' über' : ' unter') + ' dem SMA50). Handel am ' + dShort(nextMonday(s.d));
    return r.n + '. Wochenschluss in Folge ' + (s.to ? 'über' : 'unter') + ' dem SMA50 (Schluss ' + usd(a, s.c) + ', Schwelle ' + usd(a, s.thr) + '). Handel am ' + dShort(nextMonday(s.d));
  }
  function renderFeed() {
    var items = [], host = $('feed'); host.textContent = '';
    var since = ENG.addDays(todayISO(), -730);
    A.forEach(function (a) { C[a].E.sw.forEach(function (s) { if (s.d >= since) items.push({ a: a, kind: s.to ? 'buy' : 'sell', d: s.d, t: s.d + 'T23:59:59Z', title: CFG.assets[a].name + ': ' + (s.to ? 'Kaufsignal' : 'Verkaufssignal'), text: switchText(a, s), key: 'sig:' + a + ':' + s.d }); }); });
    (D.events || []).forEach(function (ev) { if (!ev) return; var kind = ev.kind === 'kauf' ? 'buy' : ev.kind === 'verkauf' ? 'sell' : ev.kind === 'vorwarnung' ? 'warn' : ev.kind === 'fehler' ? 'bad' : 'info'; var key = 'sig:' + ev.a + ':' + ev.d; if ((kind === 'buy' || kind === 'sell') && items.some(function (i) { return i.key === key; })) return; items.push({ a: ev.a, kind: kind, d: ev.d || (ev.t || '').slice(0, 10), t: ev.t, title: ev.title || (ev.a ? CFG.assets[ev.a].name : ''), text: ev.text || '', key: ev.id }); });
    items.sort(function (x, y) { return x.t < y.t ? 1 : x.t > y.t ? -1 : 0; });
    var recent = items.filter(function (i) { return ENG.daysBetween(i.d, todayISO()) <= 7 && (i.kind === 'buy' || i.kind === 'sell' || i.kind === 'warn'); }).length;
    var cnt = $('navCnt'); if (recent) { cnt.textContent = String(recent); cnt.hidden = false; } else cnt.hidden = true;
    if (!items.length) { host.appendChild(el('div', 'it', 'Noch keine Signale.')); return; }
    var show = feedAll ? items : items.slice(0, 10);
    show.forEach(function (it) {
      var row = el('div', 'it'); row.appendChild(chip(it.kind === 'bad' ? 'warn' : it.kind, it.kind === 'buy' ? 'Kauf' : it.kind === 'sell' ? 'Verkauf' : it.kind === 'warn' ? 'Vorwarnung' : it.kind === 'bad' ? 'Fehler' : 'Info'));
      var b = el('div'); b.appendChild(el('h4', null, it.title)); b.appendChild(el('p', null, it.text)); row.appendChild(b);
      var t = el('time', null, dDE(it.d)); t.setAttribute('datetime', it.d); row.appendChild(t); host.appendChild(row);
    });
    if (items.length > 10) { var more = el('div', 'more'); var btn = el('button', 'link', feedAll ? 'Weniger anzeigen' : 'Alle ' + items.length + ' Einträge anzeigen'); btn.type = 'button'; btn.addEventListener('click', function () { feedAll = !feedAll; renderFeed(); }); more.appendChild(btn); host.appendChild(more); }
  }
  /* Abstand Berlin zu UTC in Stunden zu einem Zeitpunkt (Sommerzeit 2, Winterzeit 1) */
  function berlinOffsetH(d) { var p = {}; try { new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; }); } catch (e) { return 1; } return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute) - Math.floor(d.getTime() / 60000) * 60000) / 3600000); }
  function seasonOf(d) { return berlinOffsetH(d) === 2 ? 'summer' : 'winter'; }
  /* Berliner Uhrzeit des Bitcoin-Wochenschlusses (Montag 0:07 UTC): 2:07 im Sommer, 1:07 im Winter */
  function btcCloseTime() { var now = new Date(), d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 7)); return (berlinOffsetH(d)) + ':07'; }
  /* Cron ("m h * * dow", UTC) -> nächster Zeitpunkt; season: nur Zeitpunkte in Berliner Sommer- bzw. Winterzeit (der Workflow lässt die anderen aus) */
  function nextCron(cron, now, season) {
    var p = cron.split(/\s+/), mi = +p[0], h = +p[1], dows = [];
    p[4].split(',').forEach(function (x) { var r = x.split('-'); if (r.length === 2) { for (var d = +r[0]; d <= +r[1]; d++) dows.push(d); } else if (x === '*') { for (var q = 0; q < 7; q++) dows.push(q); } else dows.push(+x); });
    for (var add = 0; add < 15; add++) { var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, h, mi)); if (dows.indexOf(d.getUTCDay()) >= 0 && d > now && (!season || seasonOf(d) === season)) return d; }
    return null;
  }
  function renderSched() {
    var host = $('sched'); host.textContent = ''; var now = new Date(), seen = {};
    var rn = $('runNote'); if (rn) rn.textContent = 'Die Läufe laufen automatisch bei GitHub und können sich um einige Minuten verschieben. Freitags wird der Wochenschluss ab 18:47 Uhr mehrfach versucht (zuletzt nachts um 1:37 Uhr und Samstag 9:23 Uhr), bis Alpha Vantage und LBMA die Schlusskurse veröffentlicht haben; Bitcoin schließt Montag ' + btcCloseTime() + ' Uhr, die Push-Nachrichten dazu kommen Montag um ' + ((CFG.push && CFG.push.mondayAt) || '07:53').replace(/^0/, '') + ' Uhr. Alle Zeiten Berliner Zeit, im Sommer wie im Winter. Der stündliche Kurs-Ticker erscheint hier nicht.';
    (CFG.schedule || []).filter(function (s) { return !s.retry && !s.quiet; }).map(function (s) { return { d: nextCron(s.cron, now, s.season), label: s.label, id: s.id }; })
      /* erst nach Datum sortieren, dann Doppelte (Sommer-/Winterzeile desselben Laufs) entfernen: so bleibt immer der nächste Termin */
      .filter(function (o) { return !!o.d; }).sort(function (x, y) { return x.d - y.d; }).filter(function (o) { return !seen[o.id + o.label] && (seen[o.id + o.label] = 1); }).slice(0, 6).forEach(function (o) { var r = el('div'); r.appendChild(el('span', null, o.label)); r.appendChild(el('b', null, o.d.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr')); host.appendChild(r); });
  }
  var STEPS = { 'fr-warn': 'Vorwarnung FTSE und Gold', 'fr-close': 'Wochenschluss FTSE und Gold', 'sa-close': 'Samstag: fehlende Schlüsse', 'so-warn': 'Vorwarnung Bitcoin', 'mo-close': 'Wochenschluss Bitcoin', 'mo-notify': 'Benachrichtigungen', 'eod': 'Euro-Kurse', 'live': 'Kurs-Ticker', 'all': 'Alles (manuell)', 'init': 'Startdaten', 'test-push': 'Test-Push', 'test-sources': 'Quellen-Test' };
  /* Ein- und ausklappbare Karten (Käufe/Verkäufe, Push, Letzte Läufe); der Zustand wird je Browser gemerkt */
  var FOLD_KEY = 'regelDepot.fold';
  function foldState() { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function applyFold(btn) {
    var key = btn.getAttribute('data-fold'), s = foldState(), open = s[key] == null ? btn.getAttribute('data-open') !== '0' : !!s[key];
    var body = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', open ? 'true' : 'false'); btn.textContent = open ? 'Einklappen' : 'Ausklappen';
    if (body) body.hidden = !open;
    var card = btn.parentNode; while (card && !(card.classList && card.classList.contains('card'))) card = card.parentNode;
    if (card) card.classList.toggle('folded', !open);
  }
  function wireFolds(root) {
    var list = (root || document).querySelectorAll('button[data-fold]');
    for (var i = 0; i < list.length; i++) { (function (btn) {
      if (btn.getAttribute('data-wired')) return; btn.setAttribute('data-wired', '1');
      btn.addEventListener('click', function () { var s = foldState(); s[btn.getAttribute('data-fold')] = btn.getAttribute('aria-expanded') === 'true' ? 0 : 1; try { localStorage.setItem(FOLD_KEY, JSON.stringify(s)); } catch (e) { /* still */ } applyFold(btn); });
      applyFold(btn);
    })(list[i]); }
  }
  function renderRunLog() {
    var host = $('runlog'); host.textContent = '';
    var rows = (D.runs || []).filter(function (r) { return !r.ok || (r.step !== 'live' && r.step !== 'test-sources' && r.step !== 'test-push'); }).slice(0, 6);
    if (!rows.length) { host.appendChild(el('div', 'empty', 'Noch kein automatischer Lauf.')); return; }
    rows.forEach(function (r) { var d = el('div'), left = el('span'); left.appendChild(el('b', null, (STEPS[r.step] || r.step) + ' ')); var bad = !r.ok; left.appendChild(el('span', bad ? 'bad' : 'muted', bad ? 'Fehler' : 'ok' + (r.notified ? ', ' + r.notified + ' Push' : ''))); d.appendChild(left);
      var t = el('time', null, dtDE(r.t)); t.setAttribute('datetime', r.t); d.appendChild(t);
      var detail = bad || /close|notify|init/.test(r.step), txt = bad ? ((r.errors && r.errors.length ? r.errors.join(' · ') : '') || r.summary || '') : (detail ? (r.summary || '') : '');
      if (txt) d.appendChild(el('p', null, txt.length > 180 ? txt.slice(0, 177) + '…' : txt)); host.appendChild(d); });
  }

  /* ---------- Push ---------- */
  var PUSH = { reg: null, sub: null, supported: false, standalone: false, ios: false };
  function b64ToU8(s) { var pad = '='.repeat((4 - s.length % 4) % 4), b = (s + pad).replace(/-/g, '+').replace(/_/g, '/'), raw = atob(b), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
  function pushInit() {
    PUSH.ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    PUSH.standalone = !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    PUSH.supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) { PUSH.reg = reg; return reg.pushManager ? reg.pushManager.getSubscription() : null; }).then(function (sub) { PUSH.sub = sub || null; }).catch(function (e) { PUSH.err = e.message; });
  }
  function renderPush() {
    var card = $('pushCard'); card.textContent = '';
    var head = el('div', 'cardhead'); head.appendChild(el('p', 'subhd', 'Push-Nachrichten auf diesem Gerät'));
    var fb = el('button', 'fold', 'Einklappen'); fb.type = 'button'; fb.setAttribute('data-fold', 'push'); fb.setAttribute('aria-controls', 'pushBody'); head.appendChild(fb); card.appendChild(head);
    var host = el('div'); host.id = 'pushBody'; card.appendChild(host); wireFolds(card);
    var state = el('div', 'pushstate'), perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    var saved = null; try { saved = localStorage.getItem('regelDepot.pushSub'); } catch (e) { /* still */ }
    if (!PUSH.supported) {
      state.appendChild(el('span', 'tag', 'nicht verfügbar')); host.appendChild(state);
      host.appendChild(el('p', 'small', PUSH.ios && !PUSH.standalone ? 'Auf dem iPhone oder iPad gehen Push-Nachrichten nur, wenn die Seite auf dem Home-Bildschirm liegt: In Safari „Teilen“ → „Zum Home-Bildschirm“, dann die Seite von dort öffnen und hier Push einrichten (ab iOS 16.4).' : 'Dieser Browser unterstützt keine Web-Push-Nachrichten. Auf dem Mac geht es mit Safari, Chrome oder Firefox; auf dem iPhone über den Home-Bildschirm.'));
      return;
    }
    if (perm === 'denied') { state.appendChild(el('span', 'tag bad', 'blockiert')); host.appendChild(state); host.appendChild(el('p', 'small', 'Mitteilungen sind für diese Seite im Browser blockiert. Erlaube sie in den Website-Einstellungen des Browsers und lade die Seite neu.')); return; }
    if (PUSH.sub) {
      state.appendChild(el('span', 'tag ok', 'eingerichtet')); host.appendChild(state);
      var json = JSON.stringify(PUSH.sub.toJSON ? PUSH.sub.toJSON() : PUSH.sub);
      var known = saved && saved.indexOf('"registered":true') >= 0;
      host.appendChild(el('p', 'small', known ? 'Dieses Gerät ist angemeldet. Damit die Nachrichten ankommen, muss die Anmeldung unten als Secret im GitHub-Repo hinterlegt sein.' : 'Damit die Läufe dieses Gerät erreichen, muss die Anmeldung einmalig als Secret im GitHub-Repo hinterlegt sein:'));
      var ol = el('ol', 'steps');
      [['„Anmeldung kopieren“ drücken.'], ['Auf github.com das Repo öffnen → Settings → Secrets and variables → Actions → „New repository secret“.'], ['Name: ', 'PUSH_SUB_1', ' (für ein zweites Gerät PUSH_SUB_2 usw., bis 5). Secret: die kopierte Anmeldung einfügen → „Add secret“.'], ['Test: Actions → „Regel-Depot Update“ → „Run workflow“ → Schritt ', 'test-push', '. Kurz danach kommt eine Testnachricht.']].forEach(function (parts) { var li = el('li'); parts.forEach(function (p, i) { if (i % 2 === 1) li.appendChild(Object.assign(el('code', null, p))); else li.appendChild(document.createTextNode(p)); }); ol.appendChild(li); });
      host.appendChild(ol);
      var ta = el('textarea'); ta.readOnly = true; ta.value = json; ta.setAttribute('aria-label', 'Push-Anmeldung'); ta.rows = 3; host.appendChild(ta);
      var row = el('div', 'btnrow');
      var bc = el('button', 'btn', 'Anmeldung kopieren'); bc.type = 'button'; bc.addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(json) : Promise.reject()).then(function () { msg('pMsg', 'Kopiert. Jetzt als Secret PUSH_SUB_… im Repo eintragen.'); try { localStorage.setItem('regelDepot.pushSub', JSON.stringify({ registered: true, at: new Date().toISOString() })); } catch (e) { /* still */ } }, function () { ta.select(); msg('pMsg', 'Bitte den Text markieren und kopieren.'); }); }); row.appendChild(bc);
      var bt = el('button', 'btn ghost', 'Testnachricht hier anzeigen'); bt.type = 'button'; bt.addEventListener('click', function () { if (PUSH.reg) PUSH.reg.showNotification('Regel-Depot: Test', { body: 'So sehen die Nachrichten aus. Der echte Test läuft über GitHub (Schritt test-push).', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'test-local' }); }); row.appendChild(bt);
      var bo = el('button', 'btn ghost', 'Push auf diesem Gerät abschalten'); bo.type = 'button'; bo.addEventListener('click', function () { PUSH.sub.unsubscribe().then(function () { PUSH.sub = null; try { localStorage.removeItem('regelDepot.pushSub'); } catch (e) { /* still */ } renderPush(); msg('pMsg', 'Abgeschaltet. Lösche auch das Secret im Repo, sonst meldet der Lauf eine abgelaufene Anmeldung.'); }); }); row.appendChild(bo);
      host.appendChild(row);
    } else {
      state.appendChild(el('span', 'tag', perm === 'granted' ? 'noch nicht angemeldet' : 'aus')); host.appendChild(state);
      host.appendChild(el('p', 'small', 'Richte Push ein, dann bekommst du Kauf- und Verkaufssignale, Vorwarnungen und die Wochenübersicht auf dieses Gerät, auch wenn die Seite geschlossen ist.' + (PUSH.ios && !PUSH.standalone ? ' Auf dem iPhone zuerst die Seite über „Teilen“ → „Zum Home-Bildschirm“ ablegen und von dort öffnen.' : '')));
      var b = el('button', 'btn', 'Push auf diesem Gerät einrichten'); b.type = 'button';
      b.addEventListener('click', function () {
        b.disabled = true;
        Notification.requestPermission().then(function (p) {
          if (p !== 'granted') { msg('pMsg', 'Ohne Erlaubnis geht es nicht.', true); b.disabled = false; return; }
          return PUSH.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CFG.push.vapidPublicKey) }).then(function (sub) { PUSH.sub = sub; renderPush(); msg('pMsg', 'Angemeldet. Jetzt Schritt 1 bis 3 unten.'); });
        }).catch(function (e) { msg('pMsg', 'Anmeldung fehlgeschlagen: ' + e.message, true); b.disabled = false; });
      });
      host.appendChild(b);
    }
    var pm = el('p', 'formmsg'); pm.id = 'pMsg'; pm.setAttribute('role', 'status'); host.appendChild(pm);
    host.appendChild(el('p', 'small muted', 'Die Nachrichten verschickt der GitHub-Lauf direkt an den Push-Dienst deines Browsers (Apple, Google oder Mozilla). Der Inhalt ist verschlüsselt; Depotdaten werden nie mitgeschickt.'));
  }

  /* ---------- Rebalancing ---------- */
  function renderReb(Mo) {
    var cards = $('rebCards'), notes = $('rebNotes'), ban = $('rebBanner'); cards.textContent = ''; notes.textContent = ''; ban.textContent = '';
    var cfg = Mo.cfg, date = cfg.rebalDate, days = ENG.daysBetween(todayISO(), date);
    $('rebDate').textContent = dDE(date) + (days > 0 ? ' · noch ' + days + ' Tage' : ' · heute');
    if (!Mo.ready) { cards.appendChild(el('div', 'card pad muted', 'Ohne Depotdaten keine Vorschau. Importiere dein Depot unter Einstellungen.')); return; }
    if (!cfg.pbKnown) { var b = el('div', 'banner'); b.appendChild(el('b', null, 'Pauschbetrag noch ohne Angabe von Trade Republic')); b.appendChild(el('span', null, 'Gerechnet wird, als wären die vollen 1.000 € frei, abzüglich der geschätzten Zinsen. Trag den genutzten Betrag unter Einstellungen ein.')); ban.appendChild(b); }
    var st = {}, px = {}, pos = {}, cash = {}, ty = { pbFree: Mo.ty.pbFree, s23Before: Mo.ty.s23Before }, open = [], noPx = [];
    A.forEach(function (a) { st[a] = C[a].E.last.st; px[a] = Mo.pos[a].px || 0; cash[a] = Mo.cash[a] || 0; pos[a] = Mo.pos[a].lots.map(function (l) { return { d: l.d, units: l.units, cpu: l.cpu }; }); if (Mo.pos[a].missing) noPx.push(CFG.assets[a].name);
      if (st[a] === 0 && Mo.pos[a].u > 1e-9 && px[a] > 0) { var fi = flipInfo(a), te = fi.can ? thrEur(a, fi.thr) : null, ps = te ? Math.min(px[a], te) : px[a];
        var sm = ENG.simSell(pos[a], Mo.pos[a].u * ps, ps, todayISO(), a, cfg); if (a === 'ftse') ty.pbFree -= sm.taxable20; else ty.s23Before += sm.sg; cash[a] += Mo.pos[a].u * ps; pos[a] = []; open.push(a); } });
    /* Ohne Euro-Kurs ist der Wert einer Position unbekannt; mit 0 € gerechnet, schlüge die Vorschau Käufe vor. Deshalb keine Vorschau. */
    if (noPx.length) { var nb = el('div', 'banner bad'); nb.appendChild(el('b', null, 'Euro-Kurs fehlt für ' + noPx.join(', '))); nb.appendChild(el('span', null, 'Ohne Kurs ist der Wert dieser Position unbekannt. Die Vorschau erscheint wieder, sobald der Kurs da ist (nächster Lauf oder Neuladen der Seite).')); ban.appendChild(nb); cards.classList.add('one'); cards.appendChild(el('div', 'card pad muted', 'Keine Rebalancing-Vorschau ohne Euro-Kurs.')); return; }
    if (open.length) { var ob = el('div', 'banner info'); ob.appendChild(el('b', null, 'Offene Regel-Aktion: ' + open.map(function (a) { return CFG.assets[a].name + ' verkaufen'; }).join(', '))); ob.appendChild(el('span', null, 'Die Vorschau geht davon aus, dass du das vorher erledigst (siehe Status); der Gewinn daraus ist in Freigrenze und Pauschbetrag schon eingerechnet.')); ban.appendChild(ob); }
    var base = { date: date, w: { ftse: 0.5, btc: 0.3, gold: 0.2 }, st: st, px: px, cash: cash, cfg: cfg, ty: ty };
    function run(v) { var o = {}; for (var k in base) o[k] = base[k]; o.variant = v; o.pos = JSON.parse(JSON.stringify(pos)); return ENG.rebalance(o); }
    var R = { frei: run('frei'), voll: run('voll') }, withAlts = hasAlts(Mo);
    var same = Math.abs(R.frei.tax - R.voll.tax) < 0.5 && A.every(function (a) { var x = R.frei.rows[a], y = R.voll.rows[a]; return Math.abs((x.sell || 0) - (y.sell || 0)) < 0.5 && Math.abs((x.buy || 0) - (y.buy || 0)) < 0.5 && Math.abs((x.after || 0) - (y.after || 0)) < 0.5; });
    cards.classList.toggle('one', same);
    var variants = same ? [['frei', 'Vorschlag zum Stichtag', 'Steuerfrei und ohne Steuererklärung; die exakte Rückkehr auf 50/30/20 ergibt hier dieselben Orders.']] : [['frei', 'Ohne Steuer und ohne Steuererklärung', 'Nur Umschichtungen im Pauschbetrag, unter der Freigrenze oder nach der Haltefrist. Kein Abzug bei Trade Republic, nichts zu erklären.'], ['voll', 'Voll auf 50/30/20', 'Exakte Zielgewichte, mit dem, was das steuerlich bedeutet.']];
    variants.forEach(function (v) {
      var r = R[v[0]], card = el('div', 'card rv'), hd = el('div', 'hd'); hd.appendChild(el('h3', null, v[1])); hd.appendChild(el('p', 'small muted', v[2]));
      var tot = el('div', 'tot'); function tt(l, val) { var s = el('span'); s.appendChild(document.createTextNode(l + ' ')); s.appendChild(el('b', null, val)); tot.appendChild(s); }
      tt('Steuer', eur(r.tax)); if (r.withheld20 > 0.5) tt('Abzug bei TR', eur(r.withheld20)); tt('Orders', String(r.orders)); tt('Ergebnis', BAR_ORDER.map(function (a) { return pctPlain(r.rows[a].wAfter, 0); }).join(' / ') + ' (BTC/FTSE/Gold)');
      hd.appendChild(tot); card.appendChild(hd);
      var tw = el('div', 'tablewrap'), t = el('table'), th = el('thead'), tr = el('tr'); ['Position', 'Aktion', 'Betrag', 'Gewinn', 'Steuerlich'].forEach(function (h, i) { var c = el('th', i === 2 || i === 3 ? 'n' : null, h); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
      var tb = el('tbody');
      A.forEach(function (a) { var x = r.rows[a], row = el('tr'), c0 = el('td'), sw = el('span', 'sw'); sw.style.background = 'var(' + COLOR[a] + ')'; c0.appendChild(sw); c0.appendChild(document.createTextNode(CFG.assets[a].inst)); row.appendChild(c0);
        var act = 'Nichts', amt = '–', gain = '–', note = '–', small = false;
        function qty(q) { return a === 'btc' && withAlts ? pctPlain(Math.min(1, q / (Mo.pos.btc.u || 1)), 0) + ' des Krypto-Bausteins' : units(a, q); }
        if (x.sell > 0.5) { act = x.ruleSale ? 'Regel-Verkauf (alles)' : 'Verkaufen'; amt = eur(x.sell) + ' · ' + (x.ruleSale && a === 'btc' && withAlts ? holdingText('btc', Mo.pos.btc) : qty(x.sellUnits)); var g = a === 'ftse' ? x.g20 : x.sg + x.lg; gain = sgnEur(g); note = a === 'ftse' ? eur(Math.max(0, x.t20)) + ' steuerpflichtig' : (x.anyShort ? 'kurzfristig ' + sgnEur(x.sg) + (x.lg !== 0 ? ', steuerfrei ' + sgnEur(x.lg) : '') : 'Haltefrist vorbei, steuerfrei'); small = !x.ruleSale && x.sell < cfg.minOrder; if (x.capped) note += ' · gedeckelt'; }
        if (x.buy > 0.5) { act = x.sell > 0.5 ? act + ', dann kaufen' : 'Kaufen'; amt = (x.sell > 0.5 ? amt + ' · ' : '') + eur(x.buy) + ' · ' + (a === 'btc' && withAlts ? 'Bitcoin und Beimischung im bisherigen Verhältnis' : units(a, x.buyUnits)); small = small || x.buy < cfg.minOrder; }
        if (x.st === 0 && x.sell <= 0.5) { var ch = x.after - x.C; if (Math.abs(ch) > 0.5) { act = 'Cash anpassen'; amt = sgnEur(ch) + ' auf ' + eur(x.after); note = 'keine Order'; } }
        var ca = el('td', null, act + ' '); if (small) ca.appendChild(el('span', 'tag', 'optional')); row.appendChild(ca); row.appendChild(el('td', 'n', amt)); row.appendChild(el('td', 'n', gain)); var nc = el('td', null, note); if (a === 'ftse' && x.sell > 0.5) { var sb = el('span', 'small muted', 'nach 30 % Teilfreistellung'); sb.style.display = 'block'; nc.appendChild(sb); } row.appendChild(nc); tb.appendChild(row); });
      t.appendChild(tb); tw.appendChild(t); card.appendChild(tw);
      var ft = el('div', 'ft small');
      ft.appendChild(el('p', null, 'Kurzfristige Gewinne ' + cfg.year + ' danach: ' + eur(r.s23After) + ' von 1.000 € Freigrenze. Pauschbetrag danach frei: ' + eur(r.pbLeft) + '.'));
      if (r.withheld20 > 0.5) { var f2 = el('p'); f2.textContent = 'Trade Republic würde ca. ' + eur(r.withheld20) + ' Abgeltungsteuer einbehalten' + (r.tax20 < r.withheld20 - 0.5 ? ', endgültig fällig wären bei deinem Steuersatz ' + eur(r.tax20) + '; die Differenz holst du über die Steuererklärung zurück (Günstigerprüfung) oder vermeidest den Abzug mit einer NV-Bescheinigung.' : '.'); ft.appendChild(f2); }
      if (r.declare23) { var f3 = el('p'); f3.style.color = css('--warn'); f3.textContent = 'Die kurzfristigen Gewinne erreichen die Freigrenze: Dann ist der ganze Betrag steuerpflichtig und gehört in die Steuererklärung (Anlage SO)' + (r.tax23 > 0.5 ? ', Steuer ca. ' + eur(r.tax23) : '; bei deinem Steuersatz 0 % fällt keine Steuer an, solange dein Einkommen unter dem Grundfreibetrag bleibt') + '.'; ft.appendChild(f3); }
      if (r.overHeadroom > 0.5) { var f4 = el('p'); f4.style.color = css('--bad'); f4.textContent = 'Die zusätzlichen Einkünfte (' + eur(r.incomeAdd) + ') übersteigen deinen Spielraum bis zum Grundfreibetrag um ' + eur(r.overHeadroom) + ': Auf den Teil darüber fällt Einkommensteuer an.'; ft.appendChild(f4); }
      if (v[0] === 'frei' && r.fill < 0.995) ft.appendChild(el('p', null, 'Die Ziele werden nur zu ' + pctPlain(r.fill, 0) + ' erreicht; der Rest würde Abzug oder Steuererklärung auslösen.'));
      card.appendChild(ft); cards.appendChild(card);
    });
    function note(t) { notes.appendChild(el('p', null, t)); }
    note('Handelstage: Lang & Schwarz handelt am 24.12. und 31.12. nicht, am 30.12. nur bis 14 Uhr. Bitcoin kannst du bei Trade Republic auch am 31.12. handeln.');
    note('Verkauft wird immer der älteste Kauf zuerst (FIFO). Einzelne Kauflose kannst du nicht auswählen.');
    note('Freigrenze: Liegen alle kurzfristigen Gewinne aus Bitcoin und Gold ' + cfg.year + ' zusammen bei 1.000 € oder mehr, ist der ganze Betrag steuerpflichtig, nicht nur der Teil darüber. Die Seite hält ' + eur(cfg.buffer) + ' Abstand.');
    note('Steuersatz ' + pctPlain(cfg.rate, 0) + (cfg.headroom != null ? ' (' + eur(cfg.headroom) + ' Spielraum bis zum Grundfreibetrag)' : '') + ': ' + (cfg.rate > 0 ? 'Über der Freigrenze wird der ganze kurzfristige Gewinn mit deinem Satz besteuert (Anlage SO). ' : 'Über der Freigrenze fällt keine Steuer an, aber eine Steuererklärung mit Anlage SO. ') + 'ETF-Gewinne über dem Pauschbetrag kürzt Trade Republic um 26,375 %' + (cfg.nv ? '; mit deiner NV-Bescheinigung entfällt der Abzug.' : '; zurück über die Anlage KAP (Günstigerprüfung) oder vermeidbar mit einer NV-Bescheinigung.'));
    var shortLots = Mo.pos.btc.lots.filter(function (l) { return !ENG.isLongTerm(l.d, date); });
    if (shortLots.length) { var d0 = shortLots[0].d, d1 = shortLots[shortLots.length - 1].d, anyEst = shortLots.some(function (l) { return l.est; }); note((withAlts ? 'Krypto (Bitcoin und Beimischung): ' : 'Bitcoin: ') + (shortLots.length === 1 ? 'Der Kauf vom ' + dDE(d0) : shortLots.length + ' Käufe vom ' + dShort(d0) + ' bis ' + dDE(d1)) + ' ' + (shortLots.length === 1 ? 'ist' : 'sind') + ' am ' + dDE(date) + ' noch in der Haltefrist, Gewinne daraus zählen zur Freigrenze. Steuerfrei ' + (anyEst ? 'spätestens ' : '') + 'ab ' + dShort(ENG.taxFreeFrom(d0)) + (shortLots.length > 1 ? ' bis ' + dDE(ENG.taxFreeFrom(d1)) : '') + ' (je Kauf in der Buchungstabelle).'); }
    var vp = cfg.lawYearKnown ? ENG.vorab(Mo.pos.ftse.lots, cfg.year, cfg.vwceStart, Mo.pos.ftse.px || 0, cfg.basiszins) : 0;
    if (!cfg.lawYearKnown && Mo.pos.ftse.u > 0) note('Vorabpauschale für ' + cfg.year + ': Basiszins und VWCE-Kurs zu Jahresbeginn ' + cfg.year + ' sind noch nicht eingetragen (das BMF veröffentlicht den Basiszins im Januar); die Schätzung erscheint, sobald sie in der Konfiguration stehen.');
    if (vp > 0.5) note('Vorabpauschale für ' + cfg.year + ' auf VWCE: ca. ' + eur(vp) + ', davon nach Teilfreistellung ' + eur(vp * (1 - cfg.tfs)) + ' steuerpflichtig. Sie wird Anfang Januar ' + (cfg.year + 1) + ' abgerechnet und zählt zum Pauschbetrag ' + (cfg.year + 1) + ', nicht ' + cfg.year + '.');
    note('Krypto-Neuregelung (Referentenentwurf, noch kein Gesetz): Bitcoin-Käufe ab 01.01.2027 sollen unabhängig von der Haltedauer mit 26,375 % besteuert werden. Käufe bis zum 31.12.2026, auch beim Rebalancing, behalten die Haltefrist-Regel.');
    var left = R.frei.pbLeft;
    if (left >= 50 && Mo.pos.ftse.lots.length && Mo.pos.ftse.px) { var gpu = 0, q = 0, room = left; for (var i = 0; i < Mo.pos.ftse.lots.length && room > 0; i++) { var l = Mo.pos.ftse.lots[i], g = (Mo.pos.ftse.px - l.cpu) * (1 - cfg.tfs); if (g <= 0) continue; var take = Math.min(l.units, room / g); q += take; room -= take * g; gpu += take * g; }
      if (gpu >= 100) note('Pauschbetrag nutzen: Verkaufst du am ' + dDE(date) + ' ' + de(q, 2) + ' Stück VWCE und kaufst sie sofort zurück, realisierst du ' + eur(gpu) + ' steuerpflichtigen Gewinn ohne Abzug. Dein Einstand steigt, das spart später bis zu ' + eur(gpu * cfg.abg) + ' Abgeltungsteuer. Nur ein Hinweis, keine Automatik; kostet zwei Orders.'); }
  }

  /* ---------- Einstellungen ---------- */
  var formDirty = { tax: false, cash: false };
  /* Zahlen in Eingabefeldern deutsch und ohne Tausenderpunkte (2708,50), damit sie beim Speichern genauso gelesen werden, egal welche Sprache der Browser hat */
  function deIn(v, dmax, dmin) { if (v == null || v === '' || !isFinite(v)) return ''; return (+v).toLocaleString('de-DE', { useGrouping: false, minimumFractionDigits: dmin || 0, maximumFractionDigits: dmax == null ? 2 : dmax }); }
  function fillCash(c, cashDate) { $('cFtse').value = deIn(c.ftse || 0, 2, 2); $('cBtc').value = deIn(c.btc || 0, 2, 2); $('cGold').value = deIn(c.gold || 0, 2, 2); if ($('cDate')) $('cDate').value = cashDate || ''; }
  function nBuch(n) { return n + (n === 1 ? ' Buchung' : ' Buchungen'); }
  function dataInfoText(dep, ready) { var c = dep.cash, m = dep.meta || {}; return ready ? (nBuch(dep.tx.length) + ', Cash ' + eur((c.ftse || 0) + (c.btc || 0) + (c.gold || 0), 2) + (m.imported ? ' · importiert ' + dtDE(m.imported) : '') + (m.saved ? ' · zuletzt gespeichert ' + dtDE(m.saved) : '') + (m.source ? ' · Quelle: ' + m.source : '')) : 'Noch keine Depotdaten in diesem Browser.'; }
  function fillForms(Mo) {
    var t = Mo.cfg, c = Mo.cash;
    if (!formDirty.tax) { $('tPbUsed').value = t.pbKnown ? deIn(t.pbUsed, 2) : ''; $('tPbDate').value = t.pbUsedDate || ''; $('tInt').value = deIn(t.interestRest || 0, 2); $('tLoss').value = deIn(t.lossOther || 0, 2); $('tS23').value = deIn(t.s23Other || 0, 2); $('tRate').value = t.rateKnown ? deIn(t.rate * 100, 1) : ''; $('tHead').value = t.headroom == null ? '' : deIn(t.headroom, 2); $('tNv').checked = !!t.nv; $('tBuf').value = deIn(t.buffer, 2); $('tMin').value = deIn(t.minOrder, 2); $('tReb').value = t.rebalDate || ''; $('tCashRate').value = deIn((t.cashRate || 0) * 100, 2); }
    if (!formDirty.cash) fillCash(c, Mo.dep.cashDate);
    $('taxYearLbl').textContent = String(t.year);
    var tn = $('taxNote'); tn.textContent = (Mo.dep.tax && Mo.dep.tax.note) || '';
    $('dataInfo').textContent = dataInfoText(Mo.dep, Mo.ready);
    var an = $('assumeNotes'); an.textContent = '';
    [['A-1', 'Cash gehört je Position; Kauf- und Verkaufssignale bewegen nur dieses Cash. Umgeschichtet wird nur beim Rebalancing.'], ['A-2', 'Beim Rebalancing bekommt eine nicht investierte Position ihr Zielgewicht als Cash.'], ['A-5', 'Gold-Signal aus dem LBMA-Nachmittagsfixing (PM), wie in den Backtests; von dir am 26.09.2026 bestätigt. Gegenprobe mit dem COMEX-Future.'], ['A-6', 'Ein Schluss genau auf dem SMA50 setzt beide Zähler zurück; alle Vergleiche sind streng.'], ['A-7', 'Startzustand einer Regel: investiert, wenn der erste Schluss mit SMA50 darüber liegt.'], ['A-9', 'Vorabpauschale: Kurs zu Jahresbeginn × Basiszins × 70 %, im Kaufjahr anteilig, höchstens der Wertzuwachs; 30 % steuerfrei.'], ['A-12', 'Von dir am 26.09.2026 festgelegt: Vorwarnung, wenn der aktuelle Kurs zum Wochenschluss ein Signal auslösen würde oder weniger als ' + pctPlain((CFG.warn && CFG.warn.pct) || 0.015, 1) + ' von der Schwelle entfernt ist (Freitag 15:17 Uhr für FTSE und Gold, Sonntag 21:17 Uhr für Bitcoin, Berliner Zeit im Sommer wie im Winter), Wochenübersicht per Push montags ' + ((CFG.push && CFG.push.mondayAt) || '07:53').replace(/^0/, '') + ' Uhr, alle anderen Nachrichten sofort. Grenzfall unter ' + pctPlain((CFG.edge && CFG.edge.pct) || 0.005, 1) + ' Abstand. Puffer zur Freigrenze und Mindestbetrag je Order stehen oben (' + eur(t.buffer, 0) + ' / ' + eur(t.minOrder, 0) + '). Rebalancing aller drei Bausteine jedes Jahr am ' + dShort(t.rebalDate) + ', Bruchstück-Orders bei Trade Republic möglich.'], ['Fest', 'Abgeltungsteuer ' + pctPlain(CFG.taxLaw.abg, 3) + ', Sparer-Pauschbetrag ' + eur(CFG.taxLaw.pb) + ', Teilfreistellung ' + pctPlain(CFG.taxLaw.tfs, 0) + ', Freigrenze ' + eur(CFG.taxLaw.fg) + ' (§ 23), Basiszins ' + t.year + ' ' + (t.lawYearKnown ? pctPlain(t.basiszins, 2) : 'noch nicht eingetragen') + ', VWCE-Kurs zu Jahresbeginn ' + (t.lawYearKnown ? eur(t.vwceStart, 2) : 'noch nicht eingetragen') + ', Orderkosten ' + eur(CFG.taxLaw.fee) + '.']].concat(CFG.taxLaw.krypto ? [['Krypto ab 2027', CFG.taxLaw.krypto]] : []).forEach(function (x) { var p = el('p'); p.appendChild(el('b', null, x[0] + ' · ')); p.appendChild(document.createTextNode(x[1])); an.appendChild(p); });
  }
  /* Zahlenfelder lesen (deutsches und englisches Format, unabhängig vom Browser); Unlesbares wird gemeldet statt still als 0 zu gelten */
  function readNums(spec, msgId) {
    var out = {}, bad = [];
    spec.forEach(function (x) { var raw = $(x[0]).value, v = ENG.parseNum(raw, x[2]); if (v !== null && isNaN(v)) bad.push(x[1] + ' („' + raw + '“)'); out[x[0]] = v; });
    if (bad.length) { msg(msgId, 'Nicht lesbar: ' + bad.join(', ') + '. Bitte so eingeben: 2708,50 oder 2.708,50.', true); return null; }
    return out;
  }
  function msg(id, text, err) { var m = $(id); if (!m) return; m.textContent = text; m.className = 'formmsg' + (err ? ' err' : ''); }
  function download(name, text, type) { var blob = new Blob([text], { type: type || 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function bname(a) { return CFG && CFG.assets[a] ? CFG.assets[a].short : ({ ftse: 'FTSE', btc: 'Bitcoin', gold: 'Gold' })[a] || a; }
  /* Depotdaten sichern, importieren, zurücksetzen: funktioniert auch, wenn die Kursdaten nicht geladen werden konnten */
  /* Was mit dem bisherigen Stand passiert ist (nur behaupten, was wirklich geschah) */
  function backupNote(lead) { var r = STORE.lastBackup(); if (r === 'ok') return lead + ' liegt unten unter „Frühere Stände“ und lässt sich wiederherstellen.'; if (r === 'file') return lead + ' ist nur in deiner Datei gesichert (im Browser war dafür kein Platz).'; return ''; }
  function wireData() {
    function importText(n, name, had) { var est = n.tx.filter(function (t) { return t.est; }).length, cash = (n.cash.ftse || 0) + (n.cash.btc || 0) + (n.cash.gold || 0); return 'Importiert aus ' + name + ': ' + nBuch(n.tx.length) + ', Cash ' + eur(cash, 2) + ', ' + (est ? est + ' Eintrag' + (est > 1 ? 'e' : '') + ' als geschätzt markiert' : 'nichts als geschätzt markiert') + (n.meta && n.meta.source ? ' · Quelle laut Datei: ' + n.meta.source : '') + '. Die Daten ersetzen den vorherigen Stand in diesem Browser.' + (had ? ' ' + backupNote('Der vorherige Stand') : ''); }
    function doImport(text, name) { var had = STORE.has(); try { var n = STORE.importJson(text); formDirty.tax = formDirty.cash = false; msg('dMsg', importText(n, name, had)); schedule(); return true; } catch (e) { msg('dMsg', 'Import fehlgeschlagen: ' + e.message, true); return false; } finally { renderStore(); } }
    $('btnExport').addEventListener('click', function () { if (STORE.corruptInfo() && !STORE.has()) { msg('dMsg', 'Die gespeicherten Depotdaten sind nicht lesbar, die Datei wäre leer. Nutze oben „Rohdaten herunterladen“.', true); return; } download('regel-depot-' + todayISO() + '.json', STORE.exportJson()); msg('dMsg', 'Datei gespeichert. Bewahre sie sicher auf; sie enthält deine Depotdaten.'); });
    $('fileImport').addEventListener('change', function () { var f = this.files && this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { doImport(String(r.result), f.name); }; r.readAsText(f); this.value = ''; });
    $('btnPaste').addEventListener('click', function () { var b = $('pasteBox'); b.hidden = !b.hidden; if (!b.hidden) $('pasteArea').focus(); });
    $('btnPasteImport').addEventListener('click', function () { if (doImport($('pasteArea').value, 'eingefügter Text')) { $('pasteArea').value = ''; $('pasteBox').hidden = true; } });
    var resetArmed = false;
    $('btnReset').addEventListener('click', function () {
      if (!resetArmed) { resetArmed = true; this.textContent = 'Wirklich alles löschen?'; setTimeout(function () { resetArmed = false; $('btnReset').textContent = 'Alles löschen'; }, 4000); return; }
      resetArmed = false; this.textContent = 'Alles löschen';
      var had = STORE.has();
      try { STORE.reset(); formDirty.tax = formDirty.cash = false; msg('dMsg', 'Depotdaten in diesem Browser gelöscht.' + (had ? ' ' + backupNote('Der Stand davor') : '')); } catch (e) { msg('dMsg', 'Nicht gelöscht: ' + e.message, true); }
      renderStore(); schedule();
    });
    $('btnRestore').addEventListener('click', function () {
      var v = $('bkSel').value, i = +v, b = STORE.backupList()[i]; if (v === '' || !b) return;
      if (!restoreArmed) { restoreArmed = true; this.textContent = 'Wirklich den Stand vom ' + dtDE(b.t) + ' zurückholen?'; setTimeout(function () { restoreArmed = false; renderStore(); }, 5000); return; }
      restoreArmed = false;
      var had = STORE.has();
      try { var n = STORE.restore(i); formDirty.tax = formDirty.cash = false; msg('dMsg', 'Stand vom ' + dtDE(b.t) + ' (' + b.reason + ') wiederhergestellt: ' + nBuch(n.tx.length) + ', Cash ' + eur((n.cash.ftse || 0) + (n.cash.btc || 0) + (n.cash.gold || 0), 2) + '.' + (had ? ' ' + backupNote('Der Stand davor') : '')); } catch (e) { msg('dMsg', 'Wiederherstellen fehlgeschlagen: ' + e.message, true); }
      renderStore(); schedule();
    });
    $('bkSel').addEventListener('change', function () { restoreArmed = false; renderStore(); });
  }

  /* ---------- Schutz der Depotdaten: frühere Stände, unlesbarer Speicher, dauerhafter Speicher (so mit Justus am 26.09.2026 festgelegt) ---------- */
  var PERSIST = { asked: false, state: null }, dropArmed = false, restoreArmed = false;
  /* Den Browser bitten, die Daten dauerhaft zu behalten (Safari, Chrome und Firefox entscheiden selbst; Firefox fragt nach) */
  function askPersist() {
    if (PERSIST.asked || !STORE.has()) return;
    PERSIST.asked = true;
    var st = navigator.storage;
    if (!st || typeof st.persist !== 'function') { PERSIST.state = 'unbekannt'; renderStore(); return; }
    Promise.resolve(typeof st.persisted === 'function' ? st.persisted() : false)
      .then(function (p) { return p || st.persist(); })
      .then(function (ok) { PERSIST.state = ok ? 'ja' : 'nein'; renderStore(); }, function () { PERSIST.state = 'unbekannt'; renderStore(); });
  }
  function bkLabel(b) { return dtDE(b.t) + ' · ' + (b.reason || 'Sicherung') + ' · ' + (b.ok ? nBuch(b.tx) + ', Cash ' + eur(b.cash, 2) : 'nicht lesbar'); }
  function renderStore() {
    var sb = $('storeBanner');
    if (sb) {
      sb.textContent = '';
      var c = STORE.corruptInfo();
      if (c) {
        var b = el('div', 'banner bad');
        b.appendChild(el('b', null, 'Gespeicherte Depotdaten nicht lesbar'));
        b.appendChild(el('span', null, 'In diesem Browser liegt ein Depotstand, den die Seite nicht lesen kann (' + c.error + ', erkannt ' + dtDE(c.at) + '). ' + (STORE.has() ? 'Inzwischen gilt ein neuer Stand. ' : 'Die Seite zeigt deshalb ein leeres Depot. ') + (c.kept ? 'Der unlesbare Stand ist in diesem Browser aufgehoben und wird nicht überschrieben. ' : c.downloaded ? 'Er ließ sich im Browser nicht zusätzlich aufheben; du hast ihn heruntergeladen, beim nächsten Speichern wird er hier überschrieben. ' : 'Er ließ sich im Browser nicht zusätzlich aufheben: Bis du ihn heruntergeladen hast, speichert die Seite nichts. ') + 'Lade ihn herunter und bewahre die Datei auf. Danach kannst du unter Einstellungen einen früheren Stand wiederherstellen oder eine Sicherungsdatei importieren.'));
        var acts = el('div', 'actions'), dl = el('button', 'btn sm', 'Rohdaten herunterladen'), dr = el('button', 'btn sm ghost', dropArmed ? 'Wirklich verwerfen?' : 'Rohdaten verwerfen');
        dl.type = 'button'; dr.type = 'button';
        dl.addEventListener('click', function () { var list = STORE.corruptRaw(); download('regel-depot-rohdaten-' + todayISO() + '.txt', list.map(function (x) { return '=== Unlesbarer Stand, erkannt ' + x.at + ' (' + x.error + ') ===\n' + x.raw; }).join('\n\n'), 'text/plain'); STORE.rawSaved(); msg('dMsg', 'Rohdaten als Datei gespeichert.'); renderStore(); });
        dr.addEventListener('click', function () { if (!dropArmed) { dropArmed = true; renderStore(); setTimeout(function () { if (dropArmed) { dropArmed = false; renderStore(); } }, 4000); return; } dropArmed = false; STORE.dropCorrupt(); msg('dMsg', 'Unlesbare Rohdaten verworfen.'); renderStore(); schedule(); });
        acts.appendChild(dl); acts.appendChild(dr); b.appendChild(acts); sb.appendChild(b);
      }
    }
    var sel = $('bkSel'), btn = $('btnRestore'), list = STORE.backupList();
    if (sel && btn) {
      var keep = sel.value; sel.textContent = '';
      if (!list.length) { var o0 = el('option', null, 'Noch keine früheren Stände'); o0.value = ''; sel.appendChild(o0); }
      list.forEach(function (x) { var o = el('option', null, bkLabel(x)); o.value = String(x.i); o.disabled = !x.ok; sel.appendChild(o); });
      var okOne = list.filter(function (x) { return x.ok; });
      if (keep !== '' && okOne.some(function (x) { return String(x.i) === keep; })) sel.value = keep; else if (okOne.length) sel.value = String(okOne[0].i);
      sel.disabled = !list.length; btn.disabled = !okOne.length;
      if (!restoreArmed) btn.textContent = 'Vorherigen Stand wiederherstellen';
    }
    var pi = $('persistInfo');
    if (pi && STORE.memOnly()) { pi.textContent = 'Speicher: Dieser Browser lässt die Seite gerade nichts speichern (privates Fenster oder Speicher voll?). Deine Eingaben gehen beim Schließen verloren; sichere sie als Datei.'; return; }
    if (pi) pi.textContent = PERSIST.state === 'ja' ? 'Speicher: Der Browser hat zugesagt, die Depotdaten dauerhaft zu behalten. Eine Sicherung als Datei bleibt trotzdem sinnvoll.' : PERSIST.state === 'nein' ? 'Speicher: Der Browser hat dauerhaftes Speichern nicht zugesagt. Safari kann Website-Daten löschen, wenn du die Seite längere Zeit nicht öffnest; sichere deshalb regelmäßig als Datei.' : PERSIST.state === 'unbekannt' ? 'Speicher: Dieser Browser sagt nicht, ob er die Daten dauerhaft behält. Sichere regelmäßig als Datei.' : '';
  }
  function wireForms() {
    $('fDate').value = todayISO();
    /* Kein Datum in der Zukunft (Buchungen, Kontobewegungen, Cash-Stand); die Grenze folgt dem Tag, auch bei lange offenem Tab */
    function capDates() { var t = todayISO(); ['fDate', 'accDate', 'cDate'].forEach(function (id) { if ($(id)) $(id).max = t; }); }
    capDates(); document.addEventListener('visibilitychange', function () { if (!document.hidden) capDates(); });
    ['taxForm', 'cashForm'].forEach(function (f) { $(f).addEventListener('input', function () { formDirty[f === 'taxForm' ? 'tax' : 'cash'] = true; }); });
    $('taxForm').addEventListener('submit', function (e) { e.preventDefault();
      var n = readNums([['tPbUsed', 'Pauschbetrag genutzt'], ['tInt', 'Weitere Zinsen'], ['tLoss', 'Verlusttopf'], ['tS23', 'Andere private Veräußerungen'], ['tRate', 'Grenzsteuersatz'], ['tHead', 'Spielraum bis zum Grundfreibetrag'], ['tBuf', 'Abstand zur Freigrenze'], ['tMin', 'Mindestbetrag je Order'], ['tCashRate', 'Zins auf Cash']], 'tMsg');
      if (!n) return;
      var neg = [['tPbUsed', 'Pauschbetrag genutzt'], ['tInt', 'Weitere Zinsen'], ['tLoss', 'Verlusttopf'], ['tHead', 'Spielraum'], ['tBuf', 'Abstand zur Freigrenze'], ['tMin', 'Mindestbetrag'], ['tCashRate', 'Zins auf Cash']].filter(function (x) { return n[x[0]] != null && n[x[0]] < 0; });
      if (neg.length) { msg('tMsg', 'Nicht negativ: ' + neg.map(function (x) { return x[1]; }).join(', ') + '.', true); return; }
      if (n.tRate != null && n.tRate > 50) { msg('tMsg', 'Der Grenzsteuersatz liegt zwischen 0 und 50 %.', true); return; }
      if (n.tCashRate != null && n.tCashRate > 10) { msg('tMsg', 'Zins auf Cash bitte in % p. a. (0 bis 10).', true); return; }
      var law = (CFG && CFG.taxLaw) || {};
      var saved = saveOr('tMsg', function (d) { d.tax = d.tax || {}; d.tax.year = +todayISO().slice(0, 4); d.tax.pbUsed = n.tPbUsed; d.tax.pbUsedDate = $('tPbDate').value || ''; d.tax.interestRest = n.tInt || 0; d.tax.lossOther = n.tLoss || 0; d.tax.s23Other = n.tS23 || 0; d.tax.rate = n.tRate == null ? null : n.tRate / 100; d.tax.headroom = n.tHead; d.tax.nv = $('tNv').checked; d.tax.buffer = n.tBuf == null ? law.buffer : n.tBuf; d.tax.minOrder = n.tMin == null ? law.minOrder : n.tMin; d.tax.rebalDate = $('tReb').value || ''; d.tax.cashRate = n.tCashRate == null ? 0.025 : n.tCashRate / 100; });
      if (!saved) return;
      formDirty.tax = false; var t = saved.tax;
      msg('tMsg', 'Gespeichert (in diesem Browser): Pauschbetrag genutzt ' + (t.pbUsed == null ? 'ohne Angabe' : eur(t.pbUsed, 2)) + ', weitere Zinsen ' + eur(t.interestRest || 0, 2) + ', Grenzsteuersatz ' + (t.rate == null ? 'ohne Angabe' : pctPlain(t.rate, 1)) + ', Abstand zur Freigrenze ' + eur(t.buffer, 2) + ', Mindestbetrag ' + eur(t.minOrder, 2) + ', Zins auf Cash ' + pctPlain(t.cashRate, 2) + '.'); schedule(); });
    $('cashForm').addEventListener('submit', function (e) { e.preventDefault();
      var n = readNums([['cFtse', 'FTSE All-World'], ['cBtc', 'Bitcoin'], ['cGold', 'Gold']], 'cMsg'); if (!n) return;
      var c = { ftse: n.cFtse || 0, btc: n.cBtc || 0, gold: n.cGold || 0 }; if (c.ftse < 0 || c.btc < 0 || c.gold < 0) { msg('cMsg', 'Cash kann nicht negativ sein.', true); return; }
      var cd = $('cDate') && $('cDate').value ? $('cDate').value : todayISO();
      if (cd > todayISO()) { msg('cMsg', 'Das Datum „Stand vom“ liegt in der Zukunft.', true); return; }
      if (!saveOr('cMsg', function (d) { d.cash = c; d.cashDate = cd; })) return; formDirty.cash = false;
      msg('cMsg', 'Gespeichert (in diesem Browser): FTSE ' + eur(c.ftse, 2) + ', Bitcoin ' + eur(c.btc, 2) + ', Gold ' + eur(c.gold, 2) + ', Stand vom ' + dDE(cd) + '. Der Depotverlauf zeigt dieses Cash ab diesem Tag.'); schedule(); });
    function syncTxForm() { var cashMove = $('fType').value === 'einzahlung' || $('fType').value === 'auszahlung'; $('lUnits').hidden = cashMove; $('lFee').hidden = cashMove; $('lPriceText').textContent = cashMove ? 'Betrag in €' : 'Kurs je Stück in €'; }
    $('fType').addEventListener('change', syncTxForm); syncTxForm();
    /* Kauf, Verkauf, Ein- und Auszahlung eines Bausteins. Jede Buchung merkt sich, um wie viel sie das Cash tatsächlich verändert hat (tx.cash):
       Löschen bucht genau das zurück. Ein Kauf über das vorhandene Cash hinaus zieht das Cash auf 0; der Rest gilt als von außen bezahlt (Meldung). */
    $('txForm').addEventListener('submit', function (e) { e.preventDefault(); TXMSG = null;
      var d = $('fDate').value, a = $('fAsset').value, type = $('fType').value, note = $('fNote').value.trim(), cashMove = type === 'einzahlung' || type === 'auszahlung';
      if (!d) { msg('fMsg', 'Bitte ein Datum angeben.', true); return; }
      if (d > todayISO()) { msg('fMsg', 'Das Datum liegt in der Zukunft. Trag Buchungen erst ein, wenn sie ausgeführt sind. Nichts eingetragen.', true); return; }
      var n = readNums(cashMove ? [['fPrice', 'Betrag']] : [['fUnits', 'Stück', true], ['fPrice', 'Kurs je Stück'], ['fFee', 'Gebühr']], 'fMsg'); if (!n) return;
      var b = bucketOf(a), dep = STORE.load(), have = dep.cash[b] || 0, bn = bname(b), p = n.fPrice;
      if (cashMove) {
        if (!(p > 0)) { msg('fMsg', 'Bitte den Betrag in Euro angeben.', true); return; }
        if (type === 'auszahlung' && p > have + 0.005) { msg('fMsg', 'So viel Cash hat der Baustein ' + bn + ' nicht: ' + eur(have, 2) + ' vorhanden, ' + eur(p, 2) + ' angegeben. Nichts eingetragen.', true); return; }
        var dc = type === 'einzahlung' ? p : -p;
        if (!saveOr('fMsg', function (dp) { dp.tx.push({ id: 'tx' + Date.now(), d: d, a: a, type: type, amount: p, fee: 0, note: note, ts: Date.now(), cash: dc }); dp.cash[b] = Math.max(0, (dp.cash[b] || 0) + dc); })) return;
        msg('fMsg', (type === 'einzahlung' ? 'Einzahlung' : 'Auszahlung') + ' eingetragen: ' + eur(p, 2) + ' am ' + dDE(d) + '. Cash ' + bn + ' ' + eur(have, 2) + ' → ' + eur(Math.max(0, have + dc), 2) + '.'); $('fPrice').value = ''; $('fNote').value = ''; schedule(); return;
      }
      var u = n.fUnits, fee = n.fFee || 0;
      if (!(u > 0)) { msg('fMsg', 'Bitte die Stückzahl angeben.', true); return; } if (!(p > 0)) { msg('fMsg', 'Bitte den Kurs je Stück in Euro angeben.', true); return; } if (fee < 0) { msg('fMsg', 'Die Gebühr kann nicht negativ sein.', true); return; }
      if (type === 'verkauf') {
        /* Deckung zum Verkaufsdatum (FIFO): auch ein rückdatierter Verkauf braucht die Stücke an seinem Datum, und spätere Verkäufe müssen gedeckt bleiben */
        var openBefore = ENG.book(dep.tx).real.filter(function (r) { return r.open > 1e-9; }).map(function (r) { return r.id; });
        var bad = ENG.book(dep.tx.concat([{ id: '__neu', d: d, a: a, type: 'verkauf', units: u, price: p, fee: fee, ts: Date.now() }])).real.filter(function (r) { return r.open > 1e-9 && openBefore.indexOf(r.id) < 0; });
        if (bad.length) {
          if (bad[0].id === '__neu') { var held = ENG.units(ENG.book(dep.tx.filter(function (t) { return t.d <= d; })).pos[a] || []); msg('fMsg', 'Am ' + dDE(d) + ' hattest du nur ' + units(a, held) + ' im Depot; ein Verkauf von ' + units(a, u) + ' ist so nicht gedeckt. Nichts eingetragen.', true); }
          else msg('fMsg', 'Mit diesem Verkauf wäre der spätere Verkauf vom ' + dDE(bad[0].d) + ' nicht mehr gedeckt. Nichts eingetragen.', true);
          return;
        }
      }
      var amount = type === 'verkauf' ? u * p - fee : u * p + fee, delta = type === 'verkauf' ? amount : -Math.min(have, amount);
      var extra = type === 'kauf' && amount > have + 0.005 ? ' Das Cash des Bausteins reichte nicht: ' + eur(have, 2) + ' abgezogen, der Rest von ' + eur(amount - have, 2) + ' gilt als von außen bezahlt.' : '';
      if (!saveOr('fMsg', function (dp) { dp.tx.push({ id: 'tx' + Date.now(), d: d, a: a, type: type, units: u, price: p, fee: fee, note: note, ts: Date.now(), cash: delta }); dp.cash[b] = Math.max(0, (dp.cash[b] || 0) + delta); })) return;
      msg('fMsg', (type === 'kauf' ? 'Kauf' : 'Verkauf') + ' eingetragen: ' + units(a, u) + ' zu ' + eur(p, 2) + (fee > 0 ? (type === 'kauf' ? ' + ' : ' − ') + eur(fee, 2) + ' Gebühr' : '') + ' = ' + eur(amount, 2) + ' am ' + dDE(d) + '. Cash ' + bn + ' ' + eur(have, 2) + ' → ' + eur(Math.max(0, have + delta), 2) + '.' + extra);
      $('fUnits').value = ''; $('fPrice').value = ''; $('fNote').value = ''; schedule(); });
    /* Ein-/Auszahlung aufs Konto: Einzahlungen gehen an die Bausteine, deren Regel auf Cash steht (nach Zielgewicht), sonst an alle nach Zielgewicht;
       Auszahlungen kommen aus dem Cash der nicht investierten Bausteine (anteilig), notfalls aus anderem Cash. Nie ein Verkauf. */
    function splitDeposit(amount) { var outs = A.filter(function (a) { return C[a].E.last.st === 0; }); if (!outs.length) outs = A.slice(); var wsum = outs.reduce(function (sx, a) { return sx + CFG.assets[a].w; }, 0), parts = {}, acc = 0; outs.forEach(function (a, i) { var v = i === outs.length - 1 ? Math.round((amount - acc) * 100) / 100 : Math.round(amount * CFG.assets[a].w / wsum * 100) / 100; acc += v; parts[a] = v; }); return { parts: parts, why: outs.length === A.length ? 'alle drei Regeln investiert, deshalb nach Zielgewicht auf alle Bausteine als Cash bis zum Rebalancing' : 'auf die Bausteine mit Regel auf Cash (' + outs.map(function (a) { return CFG.assets[a].short; }).join(', ') + ') nach Zielgewicht' }; }
    function splitWithdrawal(amount, cash) { var outs = A.filter(function (a) { return C[a].E.last.st === 0 && cash[a] > 0.005; }), parts = {}, rest = amount, pool = outs.reduce(function (sx, a) { return sx + cash[a]; }, 0); outs.forEach(function (a) { var v = Math.min(cash[a], Math.round(amount * cash[a] / (pool || 1) * 100) / 100); parts[a] = v; rest -= v; }); if (rest > 0.005) { A.forEach(function (a) { if (rest <= 0.005) return; var free = cash[a] - (parts[a] || 0); if (free > 0.005) { var v = Math.min(free, rest); parts[a] = Math.round(((parts[a] || 0) + v) * 100) / 100; rest -= v; } }); } return { parts: parts, rest: Math.max(0, Math.round(rest * 100) / 100), fromInvested: A.some(function (a) { return parts[a] > 0.005 && C[a].E.last.st === 1; }) }; }
    $('accForm').addEventListener('submit', function (e) { e.preventDefault();
      var n = readNums([['accAmount', 'Betrag']], 'accMsg'); if (!n) return;
      var d = $('accDate').value, type = $('accType').value, amt = n.accAmount, note = $('accNote').value.trim(), cash = STORE.load().cash, pick = $('accAsset').value, hist = $('accHist').checked;
      if (!d) { msg('accMsg', 'Bitte ein Datum angeben.', true); return; } if (!(amt > 0)) { msg('accMsg', 'Bitte den Betrag angeben.', true); return; }
      if (d > todayISO()) { msg('accMsg', 'Das Datum liegt in der Zukunft. Trag Bewegungen erst ein, wenn sie gebucht sind. Nichts eingetragen.', true); return; }
      if (hist && pick === 'auto') { msg('accMsg', 'Beim Nachtragen bitte den Baustein wählen, zu dem das Geld damals gehörte (die Regel-Verteilung gilt nur für heutige Bewegungen).', true); return; }
      if (pick === 'auto' && !READY) { msg('accMsg', 'Die Kursdaten sind nicht geladen, deshalb kennt die Seite den Stand der Regeln nicht. Bitte den Baustein selbst wählen.', true); return; }
      var sp;
      if (pick !== 'auto') { var one = {}; one[pick] = Math.round(amt * 100) / 100; sp = { parts: one, why: 'auf den ' + bname(pick) + '-Baustein (von dir gewählt)', rest: type === 'auszahlung' && cash[pick] + 0.005 < amt ? Math.round((amt - cash[pick]) * 100) / 100 : 0, fromInvested: false }; }
      else sp = type === 'einzahlung' ? splitDeposit(amt) : splitWithdrawal(amt, cash);
      if (type === 'auszahlung' && !hist && sp.rest > 0.005) { msg('accMsg', 'So viel Cash ist nicht da: ' + eur(sp.rest, 2) + ' fehlen. Verkäufe macht die Seite nur bei Signal oder Rebalancing.', true); return; }
      var ts = Date.now(), lines = [];
      /* Nachgetragen (hist): die Bewegung steckt schon im heutigen Cash, deshalb Cash unverändert (tx.cash = 0) und beim Löschen auch */
      var okSave = saveOr('accMsg', function (dep) { Object.keys(sp.parts).forEach(function (a, i) { var v = sp.parts[a]; if (!(v > 0.005)) return; var dc = hist ? 0 : (type === 'einzahlung' ? v : -Math.min(v, dep.cash[a] || 0)); var tx = { id: 'acc' + ts + '-' + i, d: d, a: a, type: type, amount: v, fee: 0, note: (type === 'einzahlung' ? 'Einzahlung' : 'Auszahlung') + ' aufs Konto ' + eur(amt, 2) + (hist ? ' (nachgetragen)' : '') + (note ? ' · ' + note : ''), ts: ts + i, cash: dc }; if (hist) tx.hist = true; dep.tx.push(tx); if (!hist) dep.cash[a] = Math.max(0, (dep.cash[a] || 0) + dc); lines.push(bname(a) + ' ' + eur(v, 2)); }); });
      if (!okSave) return;
      msg('accMsg', (type === 'einzahlung' ? 'Einzahlung verbucht ' + sp.why + ': ' : 'Auszahlung aus dem Cash entnommen' + (sp.fromInvested ? ' (teilweise aus Cash investierter Bausteine, weil das Cash der Regel-Cash-Bausteine nicht reichte)' : '') + ': ') + lines.join(', ') + (hist ? '. Nur für den Verlauf nachgetragen, das heutige Cash bleibt unverändert.' : '.'));
      $('accAmount').value = ''; $('accNote').value = ''; $('accHist').checked = false; schedule(); });
    $('accDate').value = todayISO();
    if ($('btnNotes')) $('btnNotes').addEventListener('click', function () { SHOW_NOTES = !SHOW_NOTES; try { localStorage.setItem('regelDepot.notes', SHOW_NOTES ? '1' : '0'); } catch (e) { /* still */ } if (READY) renderTx(model()); });
  }

  /* ---------- Regeln ---------- */
  function renderRules() {
    var host = $('ruleCards'); host.textContent = '';
    A.forEach(function (a) { var m = CFG.assets[a], c = el('div', 'card rule'); c.style.setProperty('--acol', 'var(' + COLOR[a] + ')'); c.appendChild(el('p', 'eyebrow', m.name + ' · ' + pctPlain(m.w, 0))); c.appendChild(el('h3', null, m.ruleName));
      var f = el('div', 'formula'); f.innerHTML = m.rule.type === 'band' ? 'ein: Schluss &gt; 1,03 × SMA50<br>aus: Schluss &lt; 0,97 × SMA50<br>dazwischen: keine Änderung' : 'ein: ' + m.rule.n + ' Schlüsse in Folge &gt; SMA50<br>aus: ' + m.rule.n + ' Schlüsse in Folge &lt; SMA50'; c.appendChild(f);
      c.appendChild(el('p', 'small muted', 'Signal: ' + m.signal.label + '. Gehandelt wird ' + m.inst + (m.isin ? ' (' + m.isin + ')' : '') + '. Wochenschluss ' + (m.week === 'sun' ? 'Sonntag 24 Uhr UTC' : 'Freitag') + '.')); host.appendChild(c); });
    var sn = $('srcNotes'); sn.textContent = '';
    function note(t) { sn.appendChild(el('p', null, t)); }
    note('SMA50 = einfacher Durchschnitt der letzten 50 Wochenschlüsse einschließlich der aktuellen Woche. Nur abgeschlossene Wochen zählen. Feiertage: Der letzte Handelstag der Woche ist der Wochenschluss.');
    note('Signale (US-Dollar): FTSE aus VWRD London mit wieder angelegten Ausschüttungen von Alpha Vantage, der Freitagsschluss zuerst von EODHD (geprüft: identisch); liefert Alpha Vantage nicht, rechnen die Wiederholungsläufe mit den EODHD-Tagesschlüssen weiter. Bitcoin BTC-USD von Coinbase (Tageskerzen, Wochenschluss Sonntag 24 Uhr UTC), Ersatz Kraken, Yahoo Finance oder Alpha Vantage. Gold LBMA-Nachmittagsfixing; fehlt es am Montagmorgen noch, gilt vorläufig der Spotpreis kurz nach dem Fixing vom Freitag, bis das Fixing kommt. Gebuchte Bitcoin- und Gold-Wochen bleiben, wie sie gebucht wurden (bis 20.09.2026 stammen die Bitcoin-Schlüsse von Yahoo Finance). Ersatzquellen und vorläufige Schlüsse sind gekennzeichnet.'); note('Depotbewertung (Euro): ETF und Gold-ETC ausschließlich mit Lang-&-Schwarz-Kursen (dieselben wie bei Trade Republic; tagsüber stündlich, Tagesschluss 23 Uhr). Ist L&S nicht erreichbar, bleibt der letzte L&S-Kurs mit Datum stehen, es gibt keine Ersatzkurse. Bitcoin, ETH und SOL mit Coinbase in Euro (stündlich und live beim Öffnen der Seite, Tagesschluss 24 Uhr UTC), Ersatz Kraken, gekennzeichnet. EUR/USD von der EZB nur für Umrechnungen.');
    var btcT = btcCloseTime(), monAt = ((CFG.push && CFG.push.mondayAt) || '07:53').replace(/^0/, '');
    note('Ablauf: Freitag 15:17 Uhr Vorwarnung FTSE und Gold, ab 18:47 Uhr Wochenschluss FTSE (nach Londoner Börsenschluss) und Gold, mit Wiederholungen um 20:23 und 22:23 Uhr, in der Nacht um 1:37 Uhr und Samstag 9:23 Uhr, weil Alpha Vantage und LBMA die Schlusskurse oft erst Stunden später veröffentlichen. Der FTSE-Schluss kommt meist schon um 18:47 Uhr von EODHD; fehlt er noch, gilt ein vorläufiger Schluss aus dem aktuellen Kurs, der später bestätigt oder korrigiert wird. Sonntag 21:17 Uhr Vorwarnung Bitcoin; Montag kurz nach 0 Uhr UTC (' + btcT + ' Uhr) Wochenschluss Bitcoin, Push-Nachrichten dazu um ' + monAt + ' Uhr; Montag bis Donnerstag 19:37 und 23:37 Uhr Euro-Kurse. Alle Zeiten Berliner Zeit, im Sommer wie im Winter (London stellt am selben Tag um). Andere Nachrichten kommen sofort, auch nachts.');
    note('Die Läufe laufen als GitHub Actions in diesem Repo. Sie führen keine Käufe oder Verkäufe aus und kennen deine Depotdaten nicht; die liegen nur in deinem Browser.');
    $('footSrc').textContent = 'Wochenhistorie ab ' + dDE(C.ftse.S.d[0]) + ' (FTSE), ' + dDE(C.btc.S.d[0]) + ' (Bitcoin), ' + dDE(C.gold.S.d[0]) + ' (Gold). Letzte Aktualisierung der Kursdaten: ' + (D.state && D.state.updated ? dtDE(D.state.updated) : '–') + '.';
  }

  /* ---------- Render-Schleife ---------- */
  var raf = 0, lastW = 0, lastPW = 0, READY = false;
  function renderAll() {
    raf = 0;
    if (!READY) { renderOffline(); return; }
    try {
      var Mo = model();
      renderTop(Mo); renderGlobal(Mo); renderStatus(Mo); renderDepot(Mo); drawPerf(Mo); renderFeed(); renderSched(); renderRunLog(); renderPush(); renderReb(Mo); fillForms(Mo); renderRules();
    } catch (e) { console.error(e); renderFail(e); }
    renderStore(); askPersist();
  }
  /* Ohne Kursdaten (offline, Datei fehlt): Sichern, Import, Löschen und Buchungen funktionieren weiter; hier nur Stand und Formulare auffrischen */
  function renderOffline() {
    var dep = STORE.load(), ready = STORE.has();
    $('dataInfo').textContent = dataInfoText(dep, ready);
    if (!formDirty.cash) fillCash(dep.cash, dep.cashDate);
    renderStore(); askPersist();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(renderAll); }
  function cardW() { var c = $('ch-ftse'); return c ? c.clientWidth : 0; }
  $('perfSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; PERF.mode = b.getAttribute('data-m'); Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawPerf(model()); });
  (function () { var seg = $('perfRange'); if (!seg) return; PERF_RANGES.forEach(function (r) { var b = el('button', null, r[1]); b.type = 'button'; b.setAttribute('data-r', r[0]); b.setAttribute('aria-pressed', String(PERF.range === r[0])); seg.appendChild(b); }); seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; PERF.range = b.getAttribute('data-r'); Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawPerf(model()); }); })();
  $('rangeSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; VIEW.range = +b.getAttribute('data-r'); Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawCharts(); try { localStorage.setItem('regelDepot.range', String(VIEW.range)); } catch (err) { /* still */ } });
  window.addEventListener('resize', function () { var w = cardW(), pw = $('chPerf') ? $('chPerf').clientWidth : 0; if (Math.abs(w - lastW) > 4 || Math.abs(pw - lastPW) > 4) { lastW = w; lastPW = pw; schedule(); } if (BIG.a) drawBig(BIG.a); });
  if ($('bigModal')) $('bigModal').addEventListener('click', function (e) { if (e.target === this) closeBig(); });
  /* Dunkelmodus: Schalter oben; ohne eigene Wahl folgt die Seite dem System. Gemerkt in diesem Browser (regelDepot.theme). */
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function themeChoice() { try { var t = localStorage.getItem('regelDepot.theme'); return t === 'dark' || t === 'light' ? t : null; } catch (e) { return null; } }
  function applyTheme() { var t = themeChoice(); if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); var dark = t ? t === 'dark' : !!(mqDark && mqDark.matches); var tg = $('themeToggle'); if (tg) { tg.checked = dark; tg.setAttribute('aria-checked', String(dark)); } var mt = document.querySelector('meta[name="theme-color"]:not([media])'); if (!mt) { mt = document.createElement('meta'); mt.name = 'theme-color'; document.head.appendChild(mt); } mt.content = dark ? '#0E1217' : '#1B3A6B'; }
  applyTheme();
  if ($('themeToggle')) $('themeToggle').addEventListener('change', function () { var sys = !!(mqDark && mqDark.matches), want = this.checked ? 'dark' : 'light'; try { if ((want === 'dark') === sys) localStorage.removeItem('regelDepot.theme'); else localStorage.setItem('regelDepot.theme', want); } catch (e) { /* still */ } applyTheme(); schedule(); if (BIG.a) drawBig(BIG.a); });
  if (mqDark && mqDark.addEventListener) mqDark.addEventListener('change', function () { applyTheme(); schedule(); });
  STORE.onChange(function () { schedule(); });
  try { var r0s = localStorage.getItem('regelDepot.range'), r0 = r0s == null ? NaN : +r0s; if (!isNaN(r0)) { VIEW.range = r0; Array.prototype.forEach.call($('rangeSeg').querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(+x.getAttribute('data-r') === r0)); }); } } catch (e) { /* still */ }

  /* Prüf-Zugang für automatische Tests (keine Daten nach außen): Depotverlauf nachrechnen */
  window.RegelDepot = { perf: function (grid, from) { var Mo = model(); return Mo.ready ? perfSeries(Mo, grid, from) : null; } };

  /* Ladefehler (Daten) und Anzeigefehler (meist eine veraltete Version der Seite im Browser-Speicher) getrennt melden */
  function failBanner(title, text, reload) {
    var g = $('globalBanner'); if (!g) return; g.textContent = '';
    var b = el('div', 'banner bad'); b.appendChild(el('b', null, title)); b.appendChild(el('span', null, text));
    if (reload) { var acts = el('div', 'actions'), btn = el('button', 'btn sm', 'Seite neu laden'); btn.type = 'button'; btn.addEventListener('click', function () { try { location.reload(); } catch (e) { /* still */ } }); acts.appendChild(btn); b.appendChild(acts); }
    g.appendChild(b); var tm = $('topMeta'); if (tm) tm.textContent = 'Fehler beim Laden';
  }
  function renderFail(e) {
    failBanner('Die Seite konnte nicht vollständig angezeigt werden', 'Fehler: ' + (e && e.message ? e.message : String(e)) + '. Mögliche Ursachen: eine ältere Version der Seite im Browser-Speicher (einmal komplett neu laden: Safari Option + Cmd + R, Chrome oder Firefox Cmd + Shift + R) oder unerwartete Depotdaten (unter Einstellungen „Als Datei sichern“ und die Datei prüfen). Sichern, Import und Buchungen funktionieren weiter.', true);
  }
  /* Lange offener Tab: beim Zurückkehren (und alle paar Minuten, solange die Seite sichtbar ist) die Daten neu laden, wenn sie älter als
     10 Minuten sind. Klappt das nicht vollständig, bleibt der bisherige Stand stehen. */
  var reloading = false;
  function maybeReload() {
    if (!READY || reloading || document.hidden || Date.now() - LOADED_AT < 10 * 60 * 1000) return;
    reloading = true;
    loadAll().then(function (N) { if (!N.errors.length) { D.browserLive = {}; applyLoaded(N, true); schedule(); } else LOADED_AT = Date.now() - 5 * 60 * 1000; return refreshBrowserLive(); })
      .catch(function (e) { console.warn('Nachladen fehlgeschlagen', e); LOADED_AT = Date.now() - 5 * 60 * 1000; })
      .then(function () { reloading = false; });
  }
  document.addEventListener('visibilitychange', maybeReload);
  setInterval(maybeReload, 60 * 1000);
  /* Der Service Worker meldet, dass der Push-Dienst die Anmeldung erneuert hat: Push-Karte neu prüfen (die neue Anmeldung gehört ins Secret) */
  if ('serviceWorker' in navigator && navigator.serviceWorker.addEventListener) navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'pushsubscriptionchange' && READY) pushInit().then(schedule); });

  /* Formulare und Sichern/Import sofort bedienbar, unabhängig davon, ob die Kursdaten laden */
  wireData(); wireForms(); wireFolds(); renderOffline();
  var loaded = false;
  loadAll().then(function (N) { applyLoaded(N); loaded = true; READY = true; STORE.setAssets(A.concat(ALTS.map(function (x) { return x.id; }))); return pushInit(); }).then(function () { renderAll(); lastW = cardW(); lastPW = $('chPerf') ? $('chPerf').clientWidth : 0; refreshBrowserLive(); })
    .catch(function (e) {
      console.error(e);
      if (loaded) renderFail(e);
      else { READY = false; failBanner('Die Kursdaten konnten nicht geladen werden', e.message + '. Deine Depotdaten in diesem Browser sind davon nicht betroffen: Sichern, Import und Buchungen (Depot, Einstellungen) funktionieren weiter. Lade die Seite später neu; bleibt der Fehler, prüfe das Repo.', true); }
    });
})();
