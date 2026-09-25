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
  function units(a, u) { return a === 'btc' ? de(u, 6) + ' BTC' : de(u, u < 10 ? 3 : 2) + ' Stück'; }
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
  function loadAll() {
    return getJson('config.json').then(function (cfg) {
      CFG = cfg;
      var jobs = A.map(function (a) { return getJson('weekly/' + a + '.json').then(function (j) { D.weekly[a] = j; }); });
      jobs.push(getJson('eur.json').then(function (j) { D.eur = j; }).catch(function (e) { D.errors.push(e.message); D.eur = { weekly: {}, latest: {} }; }));
      jobs.push(getJson('state.json').then(function (j) { D.state = j; }).catch(function (e) { D.errors.push(e.message); D.state = { assets: {}, warn: {}, cross: {} }; }));
      jobs.push(getJson('events.json').then(function (j) { D.events = j; }).catch(function () { D.events = []; }));
      jobs.push(getJson('runs.json').then(function (j) { D.runs = j; }).catch(function () { D.runs = []; }));
      jobs.push(getJson('live.json').then(function (j) { D.live = j; }).catch(function () { D.live = null; }));
      jobs.push(fetchBrowserLive());
      return Promise.all(jobs);
    }).then(function () { A.forEach(function (a) { var S = ENG.fromRows(D.weekly[a].w); C[a] = { S: S, E: ENG.evalRule(S, CFG.assets[a].rule) }; }); applyBrowserLiveToEur(); });
  }

  /* ---------- Live-Kurse im Browser (Coinbase, gold-api), still bei Fehlern ---------- */
  D.browserLive = {};
  function fetchTimeout(url, ms) { var ctl = 'AbortController' in window ? new AbortController() : null; var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 5000); return fetch(url, { signal: ctl ? ctl.signal : undefined, cache: 'no-store' }).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; }); }
  function fetchBrowserLive() {
    var now = new Date().toISOString();
    var p1 = Promise.all([fetchTimeout('https://api.coinbase.com/v2/prices/BTC-USD/spot'), fetchTimeout('https://api.coinbase.com/v2/prices/BTC-EUR/spot')]).then(function (r) { var u = +r[0].data.amount, e = +r[1].data.amount; if (u > 0 && e > 0) D.browserLive.btc = { usd: u, eur: e, t: now, src: 'Coinbase (live im Browser)' }; }).catch(function () { /* still */ });
    var p2 = fetchTimeout('https://api.gold-api.com/price/XAU').then(function (j) { if (+j.price > 0) D.browserLive.gold = { usd: +j.price, t: j.updatedAt || now, src: 'gold-api.com (live im Browser)' }; }).catch(function () { /* still */ });
    var p3 = fetchTimeout('https://api.coinbase.com/v2/exchange-rates?currency=EUR').then(function (j) { var r = j && j.data && j.data.rates && +j.data.rates.USD; if (r > 0) D.browserLive.eurusd = { rate: r, t: now }; }).catch(function () { /* still */ });
    return Promise.all([p1, p2, p3]);
  }
  function utcToday() { return new Date().toISOString().slice(0, 10); }
  /* Aktueller Kurs je Anlage: Browser-Live vor Ticker (live.json) vor Tagesschluss */
  function livePrice(a) {
    var b = D.browserLive[a], l = D.live && D.live.prices && D.live.prices[a];
    if (b && b.usd > 0 && (!l || !l.t || b.t >= l.t)) return { usd: b.usd, eur: b.eur || null, t: b.t, src: b.src, live: true };
    if (l && l.usd > 0) return { usd: l.usd, eur: l.eur || null, t: l.t || (D.live && D.live.t), src: l.src, eod: !!l.eod, d: l.d || null, spot: !!l.spot };
    return null;
  }
  function ruleNow(a, price) {
    var S0 = C[a].S, rule = CFG.assets[a].rule, mon = ENG.mondayOf(utcToday()), S = { k: [], d: [], c: [] };
    for (var i = 0; i < S0.k.length; i++) { if (S0.k[i] < mon) { S.k.push(S0.k[i]); S.d.push(S0.d[i]); S.c.push(S0.c[i]); } }
    if (S.k.length < 60 || !(price > 0)) return null;
    var E = ENG.evalRule(S, rule), ft = ENG.flipThreshold(E, rule), E2 = ENG.whatIf(S, rule, utcToday(), price);
    return { thr: ft.thr, dist: price / ft.thr - 1, can: ft.can, need: ft.need, st: E.last.st, would: E2.last.changed, wouldSt: E2.last.st, up: E2.last.up, dn: E2.last.dn };
  }
  function applyBrowserLiveToEur() {
    if (!D.eur || !D.eur.latest) return;
    var b = D.browserLive.btc; if (b && b.eur > 0) D.eur.latest.btc = { d: utcToday(), p: b.eur, sym: 'BTC-EUR', src: b.src, t: b.t, live: true, fallback: true };
    var g = D.browserLive.gold, fx = D.browserLive.eurusd && D.browserLive.eurusd.rate, cb = D.eur.calib && D.eur.calib.gold;
    if (g && fx > 0 && cb && cb.ratio > 0) D.eur.latest.gold = { d: utcToday(), p: g.usd / fx * cb.ratio, sym: 'SGBS.MI', src: 'geschätzt aus Spot ' + de(g.usd, 2) + ' $ / EURUSD ' + de(fx, 4) + ' × Kalibrierfaktor (live im Browser)', t: g.t, live: true, fallback: true, estimate: true };
    if (fx > 0) D.eur.latest.eurusd = { d: utcToday(), p: fx, sym: 'EURUSD=X', src: 'Coinbase (live im Browser)', t: D.browserLive.eurusd.t, live: true, fallback: true };
  }

  /* ---------- Modell ---------- */
  function taxCfg() {
    var law = CFG.taxLaw, t = STORE.load().tax || {}, cfg = {};
    ['year', 'pb', 'abg', 'tfs', 'fg', 'basiszins', 'vwceStart', 'buffer', 'minOrder', 'fee', 'rebalDate'].forEach(function (k) { cfg[k] = law[k]; });
    cfg.pbUsed = 0; cfg.pbUsedDate = ''; cfg.interestRest = 0; cfg.lossOther = 0; cfg.s23Other = 0; cfg.rate = 0.25; cfg.headroom = null; cfg.nv = false; cfg.pbKnown = false; cfg.rateKnown = false;
    for (var k in t) { if (t[k] !== null && t[k] !== '' && t[k] !== undefined) cfg[k] = t[k]; }
    cfg.pbKnown = t.pbUsed !== undefined && t.pbUsed !== null && t.pbUsed !== '';
    cfg.rateKnown = t.rate !== undefined && t.rate !== null && t.rate !== '';
    cfg.rate = +cfg.rate; cfg.headroom = cfg.headroom == null || cfg.headroom === '' ? null : +cfg.headroom;
    cfg.cashRate = t.cashRate == null || t.cashRate === '' ? 0.025 : +t.cashRate;
    return cfg;
  }
  function pxOf(a) { var p = D.eur && D.eur.latest && D.eur.latest[a]; return p && p.p > 0 ? p : null; }
  function model() {
    var dep = STORE.load(), B = ENG.book(dep.tx), cfg = taxCfg(), ty = ENG.taxYear(cfg, B.real, cfg.year), pos = {};
    A.forEach(function (a) { var lots = B.pos[a], u = ENG.units(lots), cost = ENG.cost(lots), p = pxOf(a); pos[a] = { lots: lots, u: u, cost: cost, px: p ? p.p : null, pxd: p ? p.d : null, val: p ? u * p.p : (u > 0 ? null : 0), cash: dep.cash[a] || 0 }; });
    return { ready: STORE.has(), dep: dep, B: B, cfg: cfg, ty: ty, pos: pos, cash: dep.cash, est: dep.tx.some(function (t) { return t.est; }) };
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
    if (sm.sg === 0 && sm.lg !== 0) return { level: 'ok', text: t + 'Haltefrist abgelaufen: steuerfrei.' };
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
    if (L.changed && fresh) return { cls: 'sell', title: 'Verkaufen', text: 'Verkaufssignal: alle ' + units(a, P.u) + val + ' verkaufen ' + dueText(due) + '.', tax: saleTax(a, Mo), todo: true };
    var fx = D.eur && D.eur.latest && D.eur.latest.eurusd && D.eur.latest.eurusd.p, pxThr = (fi.can && fx && P.px) ? Math.min(P.px, fi.thr / fx) : null;
    return { cls: 'sell', title: 'Verkaufen', text: 'Laut Regel nicht investiert' + (ls ? ' seit ' + dDE(ls.d) : '') + '. Du hältst noch ' + units(a, P.u) + val + '.', todo: true,
      next: fi.can ? 'Nächster Wochenschluss am ' + dShort(nc) + ': Über ' + usd(a, fi.thr) + ' gibt es ein Kaufsignal, dann behältst du die Position. Sonst verkaufen zur Eröffnung am Montag, ' + dShort(due2) : 'Verkaufen, sobald es passt.',
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
    var p = pxOf('ftse') || pxOf('btc'); if (p) s('Euro-Kurse', 'vom ' + dShort(p.d));
    if (D.live && D.live.t) s('Kurs-Ticker', dtDE(D.live.t) + (D.browserLive.btc ? ' · Bitcoin live' : ''));
    var r = lastRun(); if (r) s('Letzter Lauf', dtDE(r.t) + (r.ok ? '' : ' · mit Fehlern'), r.ok ? null : 'bad');
    s('Depot', Mo.ready ? 'in diesem Browser' : 'noch nicht importiert');
  }
  function renderGlobal(Mo) {
    var g = $('globalBanner'); g.textContent = '';
    var r = lastRun(), age = r ? ENG.daysBetween(r.t.slice(0, 10), todayISO()) : null;
    if (D.errors.length) { var b0 = el('div', 'banner bad'); b0.appendChild(el('b', null, 'Ein Teil der Daten konnte nicht geladen werden')); b0.appendChild(el('span', null, D.errors.join(' · '))); g.appendChild(b0); }
    if (age != null && age > 8) { var b1 = el('div', 'banner'); b1.appendChild(el('b', null, 'Die automatischen Läufe sind seit ' + age + ' Tagen ausgeblieben')); b1.appendChild(el('span', null, 'Die Kurse und Signale sind möglicherweise veraltet. Prüfe bei GitHub unter „Actions“, ob der Workflow „Regel-Depot Update“ läuft.')); g.appendChild(b1); }
    if (!Mo.ready) { var b2 = el('div', 'banner info'); b2.appendChild(el('b', null, 'Depotdaten fehlen in diesem Browser')); b2.appendChild(el('span', null, 'Importiere deine Depot-Datei unter „Einstellungen“ (oder trage Käufe von Hand ein). Kurse und Signale funktionieren auch ohne Depot.'));
      var acts = el('div', 'actions'); var btn = el('a', 'btn sm', 'Zu den Einstellungen'); btn.href = '#einstellungen'; acts.appendChild(btn); b2.appendChild(acts); g.appendChild(b2); }
  }
  function renderTodo(Mo) {
    var host = $('todo'); host.textContent = ''; var items = [];
    A.forEach(function (a) {
      var act = actionFor(a, Mo), L = C[a].E.last, w = currentWarn(a), st = D.state && D.state.assets && D.state.assets[a];
      if (act.todo) items.push({ cls: act.cls, ic: act.cls === 'buy' ? '▲' : '▼', title: CFG.assets[a].name + ': ' + act.title, text: act.text + (act.next ? ' ' + act.next : ''), href: '#card-' + a });
      if (w && w.level !== 'none') items.push({ cls: 'warn', ic: '!', title: CFG.assets[a].name + ': Vorwarnung ' + dtDE(w.t), text: w.text, href: '#card-' + a });
      var lp = livePrice(a), rn = lp ? ruleNow(a, lp.usd) : null;
      if (rn && rn.would && !(w && w.level !== 'none')) items.push({ cls: 'warn', ic: '!', title: CFG.assets[a].name + ': Kurs aktuell auf der Signalseite', text: 'Aktuell ' + usd(a, lp.usd) + ' (' + pct(rn.dist, 1) + ' zur Schwelle ' + usd(a, rn.thr) + '). Schließt die Woche so, gibt es ein ' + (rn.wouldSt ? 'Kaufsignal' : 'Verkaufssignal') + '. Entscheidend ist allein der Wochenschluss ' + (CFG.assets[a].week === 'sun' ? 'am Sonntag um 24 Uhr UTC' : 'am Freitag') + '.', href: '#card-' + a });
      if (st && st.pending) items.push({ cls: 'info', ic: 'i', title: CFG.assets[a].name + ': Wochenschluss fehlt noch', text: st.pending.reason + ' (Stand ' + dtDE(st.pending.at) + '). Die Seite zeigt bis dahin die Vorwoche.', href: '#signale' });
      if (st && st.fallback) items.push({ cls: 'info', ic: 'i', title: CFG.assets[a].name + ': Ersatzquelle', text: 'Der letzte Wochenschluss stammt aus einer Ersatzquelle (' + st.src + '), weil Yahoo nicht erreichbar war. Nah an der Schwelle mit Yahoo gegenprüfen.', href: '#card-' + a });
    });
    var r = lastRun(); if (r && !r.ok) items.push({ cls: 'info', ic: 'i', title: 'Letzter Lauf mit Fehlern', text: (r.errors || []).join(' · ') || r.summary, href: '#signale' });
    if (!items.length) { host.appendChild(el('p', 'small muted', Mo.ready ? 'Keine offenen Aktionen: Depot und Regeln passen zusammen.' : 'Ohne Depotdaten kann die Seite nicht sagen, was für dich zu tun ist. Importiere dein Depot unter Einstellungen.')); return; }
    items.forEach(function (it) { var d = el('a', 'it ' + it.cls); d.href = it.href; d.style.textDecoration = 'none'; d.style.color = 'inherit'; d.appendChild(el('span', 'ic', it.ic)); var b = el('div'); b.appendChild(el('b', null, it.title)); b.appendChild(el('p', null, it.text)); d.appendChild(b); host.appendChild(d); });
  }

  /* ---------- Status-Karten ---------- */
  function renderSummary() {
    var h = $('statusSummary'); h.textContent = '';
    var inv = A.filter(function (a) { return C[a].E.last.st === 1; }).length;
    h.appendChild(el('span', 'sumchip strong', inv + ' von 3 investiert'));
    A.forEach(function (a) { var L = C[a].E.last, c = el('a', 'sumchip'); c.href = '#card-' + a; c.appendChild(el('i', 'dot ' + (L.st === 1 ? 'in' : 'out'))); c.appendChild(document.createTextNode(CFG.assets[a].name + (L.st === 1 ? '' : ' · Cash'))); h.appendChild(c); });
  }
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
    renderSummary(); renderChartLegend();
    var host = $('statusCards'); host.textContent = '';
    A.forEach(function (a) {
      var m = CFG.assets[a], E = C[a].E, L = E.last, ls = L.lastSwitch, st = D.state && D.state.assets && D.state.assets[a];
      var card = el('article', 'card scard'); card.id = 'card-' + a; card.style.setProperty('--acol', 'var(' + COLOR[a] + ')');
      var top = el('div', 'top1'), hd = el('div', 'hd'), left = el('div'), h = el('h3');
      h.appendChild(el('i', 'sw')); h.appendChild(document.createTextNode(m.name)); left.appendChild(h); left.appendChild(el('p', 'sub', m.ruleName + ' · Signal ' + (m.signal.sym || 'LBMA') + ' (USD) · Depot ' + (a === 'btc' ? 'Bitcoin' : a === 'ftse' ? 'VWCE' : 'WisdomTree Gold'))); hd.appendChild(left);
      var right = el('div', 'stbox'), stp = el('span', 'state ' + (L.st === 1 ? 'in' : 'out')); stp.appendChild(el('i')); stp.appendChild(document.createTextNode(L.st === 1 ? 'Investiert' : 'Cash')); right.appendChild(stp); if (ls) right.appendChild(el('span', 'since', 'seit ' + dDE(ls.d)));
      var bigBtn = el('button', 'btn sm ghost bigbtn', 'Groß anzeigen'); bigBtn.type = 'button'; bigBtn.setAttribute('aria-label', m.name + ' in Großansicht öffnen'); bigBtn.addEventListener('click', function () { openBig(a); }); right.appendChild(bigBtn); hd.appendChild(right);
      top.appendChild(hd);
      var fig = el('div', 'fig'); fig.appendChild(el('span', 'fl', 'Wochenschluss ' + dDE(L.d))); fig.appendChild(el('b', 'fv', usd(a, L.c))); fig.appendChild(el('span', 'fd', pct(L.dist, 1) + ' zum SMA50')); top.appendChild(fig);
      var lp = livePrice(a), rn = lp ? ruleNow(a, lp.usd) : null;
      if (lp && rn) {
        var lv = el('div', 'live' + (rn.would ? ' would' : ''));
        var head = el('div', 'lh'); head.appendChild(el('span', 'll', lp.eod ? 'Letzter Schluss ' + (lp.d ? dShort(lp.d) : '') : 'Aktuell ' + (lp.t ? new Date(lp.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr' : ''))); head.appendChild(el('b', 'lv', usd(a, lp.usd))); lv.appendChild(head);
        var what = rn.would ? ('Schließt die Woche so: ' + (rn.wouldSt ? 'Kaufsignal' : 'Verkaufssignal')) : (CFG.assets[a].rule.type === 'confirm' && ((rn.st === 1 && lp.usd < rn.thr) || (rn.st === 0 && lp.usd > rn.thr)) ? 'So wäre das der ' + (lp.usd > rn.thr ? rn.up : rn.dn) + '. Schluss ' + (lp.usd > rn.thr ? 'über' : 'unter') + ' dem SMA50, Signal erst nach ' + CFG.assets[a].rule.n : 'Schließt die Woche so, bleibt die Regel ' + (rn.wouldSt ? 'investiert' : 'auf Cash'));
        lv.appendChild(el('p', 'ld', pct(rn.dist, 1) + ' zur Schwelle ' + usd(a, rn.thr) + ' · ' + what + '.'));
        if (lp.live || lp.src) lv.appendChild(el('p', 'ls', (lp.live ? 'Live im Browser' : lp.spot ? 'Spotpreis, stündlich' : lp.eod ? 'Tagesschluss, kein Intraday-Kurs verfügbar' : 'stündlich') + (lp.src ? ' · ' + lp.src.replace(/ \(Ersatzquelle\)/, '') : '')));
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
      var mid = el('div', 'mid'), act = actionFor(a, Mo), ab = el('div', 'act ' + act.cls); ab.appendChild(el('b', null, act.title)); ab.appendChild(el('span', null, act.text)); mid.appendChild(ab);
      card.appendChild(mid);
      var cw = el('div', 'cchart'), ch = el('div', 'chart'); ch.id = 'ch-' + a; ch.setAttribute('role', 'img'); cw.appendChild(ch); card.appendChild(cw);
      var bot = el('div', 'bot');
      var w = currentWarn(a); if (w && w.level !== 'none') { var wb = el('div', 'warnbox'); wb.innerHTML = ICON.warn; wb.appendChild(el('span', null, 'Vorwarnung ' + dtDE(w.t) + ': ' + (w.text || ''))); bot.appendChild(wb); }
      if (act.next) bot.appendChild(el('p', 'nextact', act.next));
      if (act.tax) { var tb = el('div', act.tax.level === 'warn' ? 'warnbox' : 'infobox'); if (act.tax.level === 'warn') tb.innerHTML = ICON.warn; tb.appendChild(el('span', null, act.tax.text)); bot.appendChild(tb); }
      var dl = el('dl');
      kv(dl, 'SMA50', usd(a, L.m)); kv(dl, 'Serie', streakText(L)); kv(dl, 'Letztes Signal', ls ? (ls.to ? 'Kauf ' : 'Verkauf ') + dDE(ls.d) : '–');
      if (ls && ls.c > 0) kv(dl, 'Kurs seit dem Signal', pct(L.c / ls.c - 1, 1));
      if (st && st.src) kv(dl, 'Quelle', st.src.replace(/ adjclose/, ' bereinigt'));
      bot.appendChild(dl);
      var nx = el('p', 'next'); nx.appendChild(document.createTextNode(ti.text[0])); nx.appendChild(el('b', null, ti.text[1])); nx.appendChild(document.createTextNode(ti.text[2])); bot.appendChild(nx);
      var det = el('details', 'box mini'); det.appendChild(el('summary', null, 'Letzte 12 Wochen als Tabelle')); var twr = el('div', 'body'), tw = el('div', 'tablewrap'); tw.appendChild(weeksTable(a)); twr.appendChild(tw); det.appendChild(twr); bot.appendChild(det);
      card.appendChild(bot);
      host.appendChild(card);
    });
    drawCharts();
  }
  /* ---------- Großansicht ---------- */
  var BIG = { a: null, range: null };
  function closeBig() { var mo = $('bigModal'); if (!mo) return; mo.hidden = true; document.body.style.overflow = ''; BIG.a = null; }
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
    if (Mo.ready && (Mo.est || !Mo.cfg.pbKnown)) { var b1 = el('div', 'banner'), txt = []; b1.appendChild(el('b', null, Mo.est ? 'Teilweise geschätzt' : 'Pauschbetrag fehlt'));
      Mo.dep.tx.forEach(function (t) { if (t.est) txt.push(CFG.assets[t.a].inst + ': ' + (t.note || 'Werte geschätzt.')); });
      if (!Mo.cfg.pbKnown) txt.push('Der schon genutzte Pauschbetrag fehlt noch, gerechnet wird mit den vollen 1.000 €.');
      b1.appendChild(el('span', null, txt.join(' '))); ban.appendChild(b1); }
    var tot = 0, inv = 0, cost = 0, cashT = 0;
    A.forEach(function (a) { var P = Mo.pos[a]; inv += P.val || 0; cost += P.cost; cashT += P.cash; });
    tot = inv + cashT; var gain = inv - cost;
    var k = $('kpis'); k.textContent = '';
    function kpi(label, val, sub, cls) { var c = el('div', 'card kpi'); c.appendChild(el('p', 'k', label)); c.appendChild(el('p', 'v ' + (cls || ''), val)); if (sub) c.appendChild(el('p', 'd', sub)); k.appendChild(c); }
    var pd = pxOf('ftse') || pxOf('btc');
    var estAny = A.some(function (a) { var p = pxOf(a); return p && p.estimate && Mo.pos[a].u > 0; });
    kpi('Depotwert', eur(tot), pd ? 'Kurse vom ' + dDE(pd.d) + (estAny ? ', teils geschätzt' : '') : '');
    kpi('Gewinn / Verlust', sgnEur(gain), cost > 0 ? pct(gain / cost, 1) + ' auf ' + eur(cost) + ' Einstand' : '', gain >= 0 ? 'up' : 'down');
    kpi('Investiert', eur(inv), tot > 0 ? pctPlain(inv / tot, 0) + ' des Depots' : '');
    kpi('Cash', eur(cashT), tot > 0 ? pctPlain(cashT / tot, 0) + ' des Depots · ' + pctPlain(Mo.cfg.cashRate || 0, 1) + ' Zins p. a., ca. ' + eur(cashT * (Mo.cfg.cashRate || 0) / 12) + ' im Monat' : '');
    renderAlloc(Mo, tot, cashT);
    var pt = $('posTable'); pt.textContent = ''; var t = el('table'), th = el('thead'), tr = el('tr');
    ['Position', 'Regel', 'Bestand', 'Kurs', 'Wert', 'Cash', 'Summe', 'Anteil mit Cash', 'Ziel', 'Abweichung'].forEach(function (h, i) { var c = el('th', i > 1 ? 'n' : null, h); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    A.forEach(function (a) { var P = Mo.pos[a], r = el('tr'), c0 = el('td'), sw = el('span', 'sw'); sw.style.background = 'var(' + COLOR[a] + ')'; c0.appendChild(sw); c0.appendChild(document.createTextNode(CFG.assets[a].inst)); r.appendChild(c0);
      var st = C[a].E.last.st; var c1 = el('td'); c1.appendChild(el('span', 'tag ' + (st === 1 ? 'ok' : ''), st === 1 ? 'investiert' : 'Cash')); r.appendChild(c1);
      r.appendChild(el('td', 'n', P.u > 0 ? units(a, P.u) : '–')); var pxc = el('td', 'n', P.px ? eur(P.px, a === 'btc' ? 0 : 2) + ' ' : '–'); var pxo = pxOf(a); if (pxo && pxo.estimate) { var et = el('span', 'tag est', 'geschätzt'); et.title = pxo.src || ''; pxc.appendChild(et); } else if (pxo && pxo.fallback) { var ft = el('span', 'tag', 'Ersatzquelle'); ft.title = pxo.src || ''; pxc.appendChild(ft); } r.appendChild(pxc); r.appendChild(el('td', 'n', eur(P.val || 0))); r.appendChild(el('td', 'n', eur(P.cash)));
      var sum = (P.val || 0) + P.cash; r.appendChild(el('td', 'n', eur(sum))); r.appendChild(el('td', 'n', tot > 0 ? pctPlain(sum / tot, 1) : '–')); r.appendChild(el('td', 'n', pctPlain(CFG.assets[a].w, 0))); r.appendChild(el('td', 'n', sgnEur(sum - tot * CFG.assets[a].w))); tb.appendChild(r); });
    t.appendChild(tb); var tf = el('tfoot'), fr = el('tr'); fr.appendChild(el('td', null, 'Summe')); fr.appendChild(el('td')); fr.appendChild(el('td')); fr.appendChild(el('td')); fr.appendChild(el('td', 'n', eur(inv))); fr.appendChild(el('td', 'n', eur(cashT))); fr.appendChild(el('td', 'n', eur(tot))); fr.appendChild(el('td', 'n', '100 %')); fr.appendChild(el('td', 'n', '100 %')); fr.appendChild(el('td')); tf.appendChild(fr); t.appendChild(tf);
    pt.appendChild(t);
    var lt = el('table'), lh = el('thead'), lr = el('tr'); ['Kauflos (FIFO)', 'Kaufdatum', 'Stück', 'Einstand je Stück', 'Wert', 'Gewinn', 'Steuerlich'].forEach(function (h, i) { var c = el('th', i >= 2 && i <= 5 ? 'n' : null, h); c.scope = 'col'; lr.appendChild(c); }); lh.appendChild(lr); lt.appendChild(lh);
    var lb = el('tbody'), any = false;
    A.forEach(function (a) { Mo.pos[a].lots.forEach(function (l) { any = true; var P = Mo.pos[a], r = el('tr'); var c0 = el('td'), sw = el('span', 'sw'); sw.style.background = 'var(' + COLOR[a] + ')'; c0.appendChild(sw); c0.appendChild(document.createTextNode(CFG.assets[a].inst + ' ')); if (l.est) c0.appendChild(el('span', 'tag est', 'geschätzt')); r.appendChild(c0);
      r.appendChild(el('td', null, dDE(l.d))); r.appendChild(el('td', 'n', a === 'btc' ? de(l.units, 6) : de(l.units, 3))); r.appendChild(el('td', 'n', eur(l.cpu, a === 'btc' ? 0 : 2)));
      var val = P.px ? l.units * P.px : null, g = val != null ? val - l.units * l.cpu : null; r.appendChild(el('td', 'n', val != null ? eur(val) : '–')); r.appendChild(el('td', 'n ' + (g >= 0 ? 'up' : 'down'), g != null ? sgnEur(g) + ' (' + pct(g / (l.units * l.cpu), 1) + ')' : '–'));
      var note = a === 'ftse' ? '§ 20: Abgeltungsteuer, 30 % Teilfreistellung' : (ENG.isLongTerm(l.d, todayISO()) ? '§ 23: Haltefrist vorbei, steuerfrei' : '§ 23: steuerfrei ' + (l.est ? 'spätestens ' : '') + 'ab ' + dDE(ENG.taxFreeFrom(l.d)));
      r.appendChild(el('td', null, note)); lb.appendChild(r); }); });
    if (!any) { var er = el('tr'), ec = el('td', null, Mo.ready ? 'Noch keine Käufe erfasst.' : 'Depotdaten noch nicht importiert.'); ec.colSpan = 7; er.appendChild(ec); lb.appendChild(er); }
    lt.appendChild(lb); var lw = el('div'); lw.style.borderTop = '1px solid var(--rule)'; lw.appendChild(lt); pt.appendChild(lw);
    renderTx(Mo);
  }
  function renderAlloc(Mo, tot, cashT) {
    var al = $('alloc'); al.textContent = ''; al.appendChild(el('p', 'subhd', 'Aufteilung: Ist und Ziel'));
    if (!(tot > 0)) { al.appendChild(el('p', 'small muted', 'Noch keine Werte.')); return; }
    var ist = { btc: Mo.pos.btc.val || 0, ftse: Mo.pos.ftse.val || 0, gold: Mo.pos.gold.val || 0, cash: cashT };
    var ziel = { btc: 0, ftse: 0, gold: 0, cash: 0 }, outs = [];
    A.forEach(function (a) { var w = CFG.assets[a].w * tot; if (C[a].E.last.st === 1) ziel[a] += w; else { ziel.cash += w; outs.push(CFG.assets[a].name); } });
    function parts(o, which) { return CAT.map(function (c) { var note = null; if (which === 'ziel' && c.k === 'cash' && outs.length) note = 'Anteil von ' + outs.join(' und ') + ', Regel auf Cash'; if (which === 'ist' && c.k === 'cash') { var bits = A.filter(function (a) { return Mo.pos[a].cash > 0.5; }).map(function (a) { return CFG.assets[a].name + ' ' + eur(Mo.pos[a].cash); }); if (bits.length) note = 'davon ' + bits.join(', '); } return { k: c.k, label: c.label, color: c.color, v: o[c.k], note: note }; }); }
    var wrap = el('div', 'donuts');
    wrap.appendChild(CH.donut('Ist', 'was gerade im Depot liegt', parts(ist, 'ist'), tot));
    wrap.appendChild(CH.donut('Ziel', 'laut Regeln', parts(ziel, 'ziel'), tot));
    al.appendChild(wrap);
    al.appendChild(el('p', 'small muted', 'Ziel: 50 % FTSE All-World, 30 % Bitcoin, 20 % Gold. ' + (outs.length ? outs.join(' und ') + (outs.length > 1 ? ' stehen' : ' steht') + ' laut Regel auf Cash, deshalb liegt ' + (outs.length > 1 ? 'ihr Anteil' : 'sein Anteil') + ' im Ziel als Cash.' : 'Alle drei Regeln sind investiert.')));
    var tw = el('div', 'tablewrap'), t = el('table'), th = el('thead'), tr = el('tr');
    ['Anlage', 'Ist', 'Ziel', 'Differenz'].forEach(function (h, i) { var c = el('th', i > 0 ? 'n' : null, h); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    CAT.forEach(function (c) { var r = el('tr'), c0 = el('td'), sw = el('span', 'sw'); sw.style.background = 'var(' + c.color + ')'; c0.appendChild(sw); c0.appendChild(document.createTextNode(c.label)); r.appendChild(c0);
      function cell(v, d) { var td = el('td', 'n'); td.appendChild(document.createTextNode(eur(v))); td.appendChild(el('span', 'sub', pctPlain(v / tot, d))); return td; }
      var d = ziel[c.k] - ist[c.k], dtxt = Math.abs(d) < 0.5 ? '–' : sgnEur(d);
      r.appendChild(cell(ist[c.k], 1)); var zc = cell(ziel[c.k], 0); if (dtxt !== '–') zc.appendChild(el('span', 'sub dm', 'Differenz ' + dtxt)); r.appendChild(zc);
      r.appendChild(el('td', 'n', dtxt)); tb.appendChild(r); });
    t.appendChild(tb); var tf = el('tfoot'), fr = el('tr'); fr.appendChild(el('td', null, 'Summe')); fr.appendChild(el('td', 'n', eur(tot))); fr.appendChild(el('td', 'n', eur(tot))); fr.appendChild(el('td')); tf.appendChild(fr); t.appendChild(tf);
    tw.appendChild(t); al.appendChild(tw);
  }
  var pendingDelete = null;
  function renderTx(Mo) {
    var h = $('txTable'); h.textContent = '';
    var t = el('table'), th = el('thead'), tr = el('tr'); ['Datum', 'Position', 'Art', 'Stück', 'Kurs', 'Gebühr', 'Betrag', ''].forEach(function (x, i) { var c = el('th', i >= 3 && i <= 6 ? 'n' : null, x); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody'), list = Mo.dep.tx.slice().sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; });
    if (!list.length) { var er = el('tr'), ec = el('td', null, 'Noch keine Buchungen.'); ec.colSpan = 8; er.appendChild(ec); tb.appendChild(er); }
    list.forEach(function (x) { var r = el('tr'), cashMove = x.type === 'einzahlung' || x.type === 'auszahlung'; r.appendChild(el('td', null, dDE(x.d))); var c1 = el('td', null, CFG.assets[x.a].inst + ' '); if (x.est) c1.appendChild(el('span', 'tag est', 'geschätzt')); if (x.note) { var nt = el('span', 'sub small muted', x.note); nt.style.display = 'block'; c1.appendChild(nt); } r.appendChild(c1); r.appendChild(el('td', null, x.type === 'kauf' ? 'Kauf' : x.type === 'verkauf' ? 'Verkauf' : x.type === 'einzahlung' ? 'Einzahlung' : 'Auszahlung'));
      if (cashMove) { r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'n', '–')); r.appendChild(el('td', 'n', (x.type === 'einzahlung' ? '+' : '−') + eur(x.amount, 2))); }
      else { r.appendChild(el('td', 'n', x.a === 'btc' ? de(x.units, 6) : de(x.units, 3))); r.appendChild(el('td', 'n', eur(x.price, x.a === 'btc' ? 0 : 2))); r.appendChild(el('td', 'n', eur(x.fee || 0, 2))); r.appendChild(el('td', 'n', eur(x.units * x.price + (x.type === 'kauf' ? 1 : -1) * (x.fee || 0), 2))); }
      var c = el('td', 'n'); var b = el('button', 'btn sm ' + (pendingDelete === x.id ? 'danger' : 'ghost'), pendingDelete === x.id ? 'Wirklich löschen' : 'Löschen'); b.type = 'button'; b.addEventListener('click', function () { if (pendingDelete !== x.id) { pendingDelete = x.id; renderTx(model()); return; } pendingDelete = null; deleteTx(x); }); c.appendChild(b); if (pendingDelete === x.id) { var cn = el('button', 'btn sm ghost', 'Abbrechen'); cn.type = 'button'; cn.style.marginLeft = '6px'; cn.addEventListener('click', function () { pendingDelete = null; renderTx(model()); }); c.appendChild(cn); } r.appendChild(c); tb.appendChild(r); });
    t.appendChild(tb); h.appendChild(t);
  }
  function deleteTx(x) {
    STORE.update(function (d) { d.tx = d.tx.filter(function (t) { return t.id !== x.id; }); d.cash[x.a] = Math.max(0, d.cash[x.a] - cashDelta(x)); });
    msg('fMsg', 'Buchung gelöscht, Cash angepasst.'); schedule();
  }

  /* ---------- Performance ---------- */
  function eurSeries() {
    var out = {};
    A.forEach(function (a) { var map = {}; ((D.eur && D.eur.weekly && D.eur.weekly[a]) || []).forEach(function (x) { map[x[0]] = { d: x[1], c: x[2] }; }); var l = pxOf(a); if (l) { var k = ENG.mondayOf(l.d); if (!map[k] || l.d >= map[k].d) map[k] = { d: l.d, c: l.p }; } out[a] = map; });
    return out;
  }
  /* Depotverlauf je Woche: Positionen zu Euro-Wochenkursen, Cash je Baustein rückwärts aus den Buchungen abgeleitet,
     Zinsen auf Cash (cashRate p. a.) wöchentlich aufgelaufen. Einzahlungen/Auszahlungen als Buchungen vom Typ einzahlung/auszahlung. */
  function cashDelta(t) { if (t.type === 'kauf') return -(t.units * t.price + (t.fee || 0)); if (t.type === 'verkauf') return t.units * t.price - (t.fee || 0); if (t.type === 'einzahlung') return +t.amount || 0; if (t.type === 'auszahlung') return -(+t.amount || 0); return 0; }
  /* Kursreihen in Euro je Anlage als sortierte [Datum, Kurs]-Listen: täglich (eur.json daily + aktueller Kurs) oder wöchentlich */
  function eurPoints(a, daily) {
    var rows = [];
    if (daily) { ((D.eur && D.eur.daily && D.eur.daily[a]) || []).forEach(function (r) { rows.push([r[0], r[1]]); }); }
    else { ((D.eur && D.eur.weekly && D.eur.weekly[a]) || []).forEach(function (r) { rows.push([r[1], r[2]]); }); }
    var l = pxOf(a); if (l && l.d && (!rows.length || l.d >= rows[rows.length - 1][0])) { if (rows.length && rows[rows.length - 1][0] === l.d) rows[rows.length - 1][1] = l.p; else rows.push([l.d, l.p]); }
    rows.sort(function (x, y) { return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0; });
    return rows;
  }
  function hasDaily() { return !!(D.eur && D.eur.daily && D.eur.daily.btc && D.eur.daily.btc.length > 5); }
  /* Depotverlauf: Positionen zu Euro-Kursen (letzter bekannter Kurs am Stichtag), Cash je Baustein rückwärts aus den Buchungen,
     Zinsen auf Cash (cashRate p. a.) über die Zeit aufgelaufen. grid: 'tag' oder 'woche'; from: erster Stichtag (ISO) oder null */
  function perfSeries(Mo, grid, from) {
    var tx = Mo.dep.tx.filter(function (t) { return t && t.d && CFG.assets[t.a]; });
    if (!tx.length) return null;
    var daily = grid === 'tag', P = {}, idx = {}, first = tx.reduce(function (mn, t) { return t.d < mn ? t.d : mn; }, '9999-12-31');
    A.forEach(function (a) { P[a] = eurPoints(a, daily); idx[a] = 0; });
    var today = todayISO(), start = daily ? first : ENG.mondayOf(first), lastDate = today;
    if (from && from > start) start = daily ? from : ENG.mondayOf(from);
    var stamps = [], d = start;
    if (daily) { while (d <= lastDate) { stamps.push(d); d = ENG.addDays(d, 1); } }
    else { while (d <= lastDate) { stamps.push(d); d = ENG.addDays(d, 7); } }
    if (!stamps.length) return null;
    function priceAt(a, date) { var rows = P[a], v = null; for (var i = 0; i < rows.length && rows[i][0] <= date; i++) v = rows[i]; return v; }
    var rate = Mo.cfg.cashRate || 0, interest = { ftse: 0, btc: 0, gold: 0 }, pts = [], prevEnd = null;
    /* Zinsen vor dem Anzeigefenster aufholen */
    if (from && from > (daily ? first : ENG.mondayOf(first))) { var t0 = daily ? first : ENG.mondayOf(first), cur = t0; while (cur < start) { A.forEach(function (a) { var cash = Mo.cash[a] || 0; tx.forEach(function (t) { if (t.a === a && t.d > cur) cash -= cashDelta(t); }); interest[a] += Math.max(0, cash) * rate / 365; }); cur = ENG.addDays(cur, 1); } }
    stamps.forEach(function (k) {
      var end = daily ? k : ENG.addDays(k, 6); if (end > today) end = today;
      var upTo = tx.filter(function (t) { return t.d <= end; }), B = ENG.book(upTo.filter(function (t) { return t.type === 'kauf' || t.type === 'verkauf'; }));
      var days = prevEnd ? Math.max(0, ENG.daysBetween(prevEnd, end)) : 0; prevEnd = end;
      var parts = {}, total = 0, gainTotal = 0, dmax = '';
      A.forEach(function (a) {
        var u = ENG.units(B.pos[a]), val = 0, cost = ENG.cost(B.pos[a]), pr = priceAt(a, end);
        if (u > 1e-12 && pr) { val = u * pr[1]; if (pr[0] > dmax) dmax = pr[0]; }
        var cash = Mo.cash[a] || 0; tx.forEach(function (t) { if (t.a === a && t.d > end) cash -= cashDelta(t); }); cash = Math.max(0, cash);
        if (days > 0) interest[a] += cash * rate * days / 365;
        var real = B.real.filter(function (r) { return r.a === a; }).reduce(function (sx, r) { return sx + (r.gain || 0); }, 0);
        var gain = val - cost + real + interest[a];
        parts[a] = { val: val, cash: cash, interest: interest[a], gain: gain, cost: cost, units: u, missing: u > 1e-12 && !pr };
        total += val + cash + interest[a]; gainTotal += gain;
      });
      pts.push({ k: k, d: end, total: total, gainTotal: gainTotal, parts: parts });
    });
    return pts;
  }
  var PERF_RANGES = [['tage', '1 M · Tage'], ['wochen', '1 J · Wochen'], ['jahr', 'Jahr ' + new Date().getFullYear()], ['alles', 'Alles']];
  function drawPerf(Mo) {
    var host = $('chPerf'), leg = $('perfLegend'), cap = $('perfCap');
    var series = [{ key: 'total', label: 'Depot gesamt' }, { key: 'ftse', label: 'FTSE-Baustein', colorVar: '--ftse' }, { key: 'btc', label: 'Bitcoin-Baustein', colorVar: '--btc' }, { key: 'gold', label: 'Gold-Baustein', colorVar: '--gold' }];
    var est = Mo.dep.tx.filter(function (t) { return t.est; }).map(function (t) { return (t.a === 'btc' ? 'Bitcoin' : t.a === 'ftse' ? 'VWCE' : 'Gold-ETC') + ' ' + dDE(t.d); });
    var r = PERF.range, today = todayISO(), grid = 'woche', from = null, note = '';
    if (r === 'tage') { if (hasDaily()) { grid = 'tag'; from = ENG.addDays(today, -31); } else { note = 'Tageswerte liegen noch nicht vor (kommen mit den nächsten Läufen); gezeigt werden Wochenwerte. '; } }
    else if (r === 'wochen') from = ENG.addDays(today, -364);
    else if (r === 'jahr') from = today.slice(0, 4) + '-01-01';
    var capText = note + 'Jeder Baustein = Position zu Euro-' + (grid === 'tag' ? 'Tages' : 'Wochen') + 'kursen plus sein Cash plus aufgelaufene Zinsen (' + pctPlain(Mo.cfg.cashRate || 0, 2) + ' p. a. auf Cash, geschätzt). Cash vor heute wird rückwärts aus den Buchungen abgeleitet; Ein- und Auszahlungen aufs Konto bitte unten erfassen. Letzter Punkt mit den aktuellen Kursen.' + (est.length ? ' Kaufdatum geschätzt: ' + est.join(', ') + '.' : '');
    CH.portfolioChart(host, leg, cap, Mo.ready ? perfSeries(Mo, grid, from) : null, PERF.mode, series, capText);
  }

  /* ---------- Signale: Verlauf, Push, Zeitplan, Läufe ---------- */
  var feedAll = false;
  function switchText(a, s) {
    var r = CFG.assets[a].rule;
    if (r.type === 'band') return 'Schluss ' + usd(a, s.c) + (s.to ? ' über 1,03' : ' unter 0,97') + ' × SMA50 (' + usd(a, s.m * (s.to ? 1.03 : 0.97)) + '). Handel am ' + dShort(nextMonday(s.d));
    return r.n + '. Wochenschluss in Folge ' + (s.to ? 'über' : 'unter') + ' dem SMA50: ' + usd(a, s.c) + ' gegen ' + usd(a, s.m) + '. Handel am ' + dShort(nextMonday(s.d));
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
  /* Cron ("m h * * dow") -> nächster Zeitpunkt */
  function nextCron(cron, now) {
    var p = cron.split(/\s+/), mi = +p[0], h = +p[1], dows = [];
    p[4].split(',').forEach(function (x) { var r = x.split('-'); if (r.length === 2) { for (var d = +r[0]; d <= +r[1]; d++) dows.push(d); } else if (x === '*') { for (var q = 0; q < 7; q++) dows.push(q); } else dows.push(+x); });
    for (var add = 0; add < 8; add++) { var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add, h, mi)); if (dows.indexOf(d.getUTCDay()) >= 0 && d > now) return d; }
    return null;
  }
  function renderSched() {
    var host = $('sched'); host.textContent = ''; var now = new Date(), seen = {};
    (CFG.schedule || []).filter(function (s) { return !s.retry && !s.quiet; }).map(function (s) { return { d: nextCron(s.cron, now), label: s.label, id: s.id }; }).filter(function (o) { return o.d && !seen[o.id + o.label] && (seen[o.id + o.label] = 1); })
      .sort(function (x, y) { return x.d - y.d; }).slice(0, 6).forEach(function (o) { var r = el('div'); r.appendChild(el('span', null, o.label)); r.appendChild(el('b', null, o.d.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' Uhr')); host.appendChild(r); });
  }
  var STEPS = { 'fr-warn': 'Vorwarnung FTSE und Gold', 'fr-close': 'Wochenschluss FTSE', 'so-warn': 'Vorwarnung Bitcoin', 'mo-close': 'Wochenschluss Bitcoin und Gold', 'mo-notify': 'Benachrichtigungen', 'eod': 'Euro-Kurse', 'all': 'Alles (manuell)', 'init': 'Startdaten', 'test-push': 'Test-Push' };
  function renderRunLog() {
    var host = $('runlog'); host.textContent = '';
    var rows = (D.runs || []).slice(0, 7);
    if (!rows.length) { host.appendChild(el('div', 'empty', 'Noch kein automatischer Lauf.')); return; }
    rows.forEach(function (r) { var d = el('div'), left = el('span'); left.appendChild(el('b', null, (STEPS[r.step] || r.step) + ' ')); var bad = !r.ok; left.appendChild(el('span', bad ? 'bad' : 'muted', bad ? 'Fehler' : 'ok' + (r.notified ? ', ' + r.notified + ' Push' : ''))); d.appendChild(left);
      var t = el('time', null, dtDE(r.t)); t.setAttribute('datetime', r.t); d.appendChild(t);
      var txt = (r.errors && r.errors.length ? r.errors.join(' · ') + (r.summary ? ' · ' : '') : '') + (r.summary || ''); if (txt) d.appendChild(el('p', null, txt.length > 260 ? txt.slice(0, 257) + '…' : txt)); host.appendChild(d); });
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
    var host = $('pushCard'); host.textContent = '';
    host.appendChild(el('p', 'subhd', 'Push-Nachrichten auf diesem Gerät'));
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
    var cfg = Mo.cfg, date = cfg.rebalDate || CFG.taxLaw.rebalDate, days = ENG.daysBetween(todayISO(), date);
    $('rebDate').textContent = dDE(date);
    $('rebLede').textContent = (days >= 0 ? 'Noch ' + days + ' Tage. ' : 'Der Stichtag ist vorbei; trage unter Einstellungen den nächsten ein. ') + 'Zurück auf 50/30/20, gerechnet mit den aktuellen Euro-Kursen und Regelständen. Die Seite rechnet nach jedem Wochenschluss neu, die endgültigen Zahlen stehen also kurz vor dem Stichtag hier.';
    if (!Mo.ready) { cards.appendChild(el('div', 'card pad muted', 'Ohne Depotdaten keine Vorschau. Importiere dein Depot unter Einstellungen.')); return; }
    if (!cfg.pbKnown) { var b = el('div', 'banner'); b.appendChild(el('b', null, 'Pauschbetrag noch ohne Angabe von Trade Republic')); b.appendChild(el('span', null, 'Gerechnet wird, als wären die vollen 1.000 € frei, abzüglich der geschätzten Zinsen. Trag den genutzten Betrag unter Einstellungen ein.')); ban.appendChild(b); }
    var st = {}, px = {}, pos = {}, cash = {}, ty = { pbFree: Mo.ty.pbFree, s23Before: Mo.ty.s23Before }, open = [], noPx = [];
    A.forEach(function (a) { st[a] = C[a].E.last.st; px[a] = Mo.pos[a].px || 0; cash[a] = Mo.cash[a] || 0; pos[a] = Mo.pos[a].lots.map(function (l) { return { d: l.d, units: l.units, cpu: l.cpu }; }); if (Mo.pos[a].u > 0 && !(px[a] > 0)) noPx.push(CFG.assets[a].name);
      if (st[a] === 0 && Mo.pos[a].u > 1e-9 && px[a] > 0) { var fi = flipInfo(a), fx = D.eur && D.eur.latest && D.eur.latest.eurusd && D.eur.latest.eurusd.p, ps = (fi.can && fx) ? Math.min(px[a], fi.thr / fx) : px[a];
        var sm = ENG.simSell(pos[a], Mo.pos[a].u * ps, ps, todayISO(), a, cfg); if (a === 'ftse') ty.pbFree -= sm.taxable20; else ty.s23Before += sm.sg; cash[a] += Mo.pos[a].u * ps; pos[a] = []; open.push(a); } });
    if (noPx.length) { var nb = el('div', 'banner'); nb.appendChild(el('b', null, 'Euro-Kurs fehlt für ' + noPx.join(', '))); nb.appendChild(el('span', null, 'Die Vorschau ist erst vollständig, wenn der nächste Lauf die Euro-Kurse geliefert hat.')); ban.appendChild(nb); }
    if (open.length) { var ob = el('div', 'banner info'); ob.appendChild(el('b', null, 'Offene Regel-Aktion: ' + open.map(function (a) { return CFG.assets[a].name + ' verkaufen'; }).join(', '))); ob.appendChild(el('span', null, 'Das Rebalancing unten geht davon aus, dass du das vorher erledigst (siehe Status). Der Gewinn daraus ist in Pauschbetrag und Freigrenze schon eingerechnet, geschätzt zum Kurs knapp unter der Schwelle.')); ban.appendChild(ob); }
    var base = { date: date, w: { ftse: 0.5, btc: 0.3, gold: 0.2 }, st: st, px: px, cash: cash, cfg: cfg, ty: ty };
    function run(v) { var o = {}; for (var k in base) o[k] = base[k]; o.variant = v; o.pos = JSON.parse(JSON.stringify(pos)); return ENG.rebalance(o); }
    var R = { frei: run('frei'), voll: run('voll') };
    [['frei', 'Ohne Steuer und ohne Steuererklärung', 'Nur Umschichtungen im Pauschbetrag, unter der Freigrenze oder nach der Haltefrist. Kein Abzug bei Trade Republic, nichts zu erklären.'], ['voll', 'Voll auf 50/30/20', 'Exakte Zielgewichte, mit dem, was das steuerlich bedeutet.']].forEach(function (v) {
      var r = R[v[0]], card = el('div', 'card rv'), hd = el('div', 'hd'); hd.appendChild(el('h3', null, v[1])); hd.appendChild(el('p', 'small muted', v[2]));
      var tot = el('div', 'tot'); function tt(l, val) { var s = el('span'); s.appendChild(document.createTextNode(l + ' ')); s.appendChild(el('b', null, val)); tot.appendChild(s); }
      tt('Steuer', eur(r.tax)); if (r.withheld20 > 0.5) tt('Abzug bei TR', eur(r.withheld20)); tt('Orders', String(r.orders)); tt('Ergebnis', BAR_ORDER.map(function (a) { return pctPlain(r.rows[a].wAfter, 0); }).join(' / ') + ' (BTC/FTSE/Gold)');
      hd.appendChild(tot); card.appendChild(hd);
      var tw = el('div', 'tablewrap'), t = el('table'), th = el('thead'), tr = el('tr'); ['Position', 'Aktion', 'Betrag', 'Gewinn', 'Steuerlich'].forEach(function (h, i) { var c = el('th', i === 2 || i === 3 ? 'n' : null, h); c.scope = 'col'; tr.appendChild(c); }); th.appendChild(tr); t.appendChild(th);
      var tb = el('tbody');
      A.forEach(function (a) { var x = r.rows[a], row = el('tr'), c0 = el('td'), sw = el('span', 'sw'); sw.style.background = 'var(' + COLOR[a] + ')'; c0.appendChild(sw); c0.appendChild(document.createTextNode(CFG.assets[a].inst)); row.appendChild(c0);
        var act = 'Nichts', amt = '–', gain = '–', note = '–', small = false;
        if (x.sell > 0.5) { act = x.ruleSale ? 'Regel-Verkauf (alles)' : 'Verkaufen'; amt = eur(x.sell) + ' · ' + units(a, x.sellUnits); var g = a === 'ftse' ? x.g20 : x.sg + x.lg; gain = sgnEur(g); note = a === 'ftse' ? eur(Math.max(0, x.t20)) + ' steuerpflichtig' : (x.sg !== 0 ? 'kurzfristig ' + sgnEur(x.sg) + (x.lg !== 0 ? ', steuerfrei ' + sgnEur(x.lg) : '') : 'Haltefrist vorbei, steuerfrei'); small = !x.ruleSale && x.sell < cfg.minOrder; if (x.capped) note += ' · gedeckelt'; }
        if (x.buy > 0.5) { act = x.sell > 0.5 ? act + ', dann kaufen' : 'Kaufen'; amt = (x.sell > 0.5 ? amt + ' · ' : '') + eur(x.buy) + ' · ' + units(a, x.buyUnits); small = small || x.buy < cfg.minOrder; }
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
    note('Steuersatz: Du hast ' + pctPlain(cfg.rate, 0) + ' angegeben' + (cfg.headroom != null ? ' mit ' + eur(cfg.headroom) + ' Spielraum bis zum Grundfreibetrag' : '') + '. Bei 0 % kostet ein Überschreiten der Freigrenze keine Steuer, aber eine Steuererklärung mit Anlage SO. Die 26,375 % auf ETF-Gewinne über dem Pauschbetrag behält Trade Republic trotzdem ein; zurück gibt es sie mit der Anlage KAP (Günstigerprüfung), oder du reichst eine NV-Bescheinigung vom Finanzamt ein, dann entfällt der Abzug.');
    Mo.pos.btc.lots.forEach(function (l) { if (!ENG.isLongTerm(l.d, date)) note(l.est ? 'Bitcoin (Kaufdatum geschätzt, gerechnet mit ' + dDE(l.d) + '): Die Haltefrist läuft am ' + dDE(date) + ' noch, jeder Gewinn zählt zur Freigrenze. Steuerfrei spätestens ab ' + dDE(ENG.taxFreeFrom(l.d)) + '.' : 'Bitcoin vom ' + dDE(l.d) + ': steuerfrei ab ' + dDE(ENG.taxFreeFrom(l.d)) + '.'); });
    var vp = ENG.vorab(Mo.pos.ftse.lots, cfg.year, cfg.vwceStart, Mo.pos.ftse.px || 0, cfg.basiszins);
    if (vp > 0.5) note('Vorabpauschale für ' + cfg.year + ' auf VWCE: ca. ' + eur(vp) + ', davon nach Teilfreistellung ' + eur(vp * (1 - cfg.tfs)) + ' steuerpflichtig. Sie wird Anfang Januar ' + (cfg.year + 1) + ' abgerechnet und zählt zum Pauschbetrag ' + (cfg.year + 1) + ', nicht ' + cfg.year + '.');
    note('Krypto-Neuregelung (Referentenentwurf, noch kein Gesetz): Bitcoin-Käufe ab 01.01.2027 sollen unabhängig von der Haltedauer mit 26,375 % besteuert werden. Käufe bis zum 31.12.2026, auch beim Rebalancing, behalten die Haltefrist-Regel.');
    var left = R.frei.pbLeft;
    if (left >= 50 && Mo.pos.ftse.lots.length && Mo.pos.ftse.px) { var gpu = 0, q = 0, room = left; for (var i = 0; i < Mo.pos.ftse.lots.length && room > 0; i++) { var l = Mo.pos.ftse.lots[i], g = (Mo.pos.ftse.px - l.cpu) * (1 - cfg.tfs); if (g <= 0) continue; var take = Math.min(l.units, room / g); q += take; room -= take * g; gpu += take * g; }
      if (gpu >= 100) note('Pauschbetrag nutzen: Verkaufst du am ' + dDE(date) + ' ' + de(q, 2) + ' Stück VWCE und kaufst sie sofort zurück, realisierst du ' + eur(gpu) + ' steuerpflichtigen Gewinn ohne Abzug. Dein Einstand steigt, das spart später bis zu ' + eur(gpu * cfg.abg) + ' Abgeltungsteuer. Nur ein Hinweis, keine Automatik; kostet zwei Orders.'); }
  }

  /* ---------- Einstellungen ---------- */
  var formDirty = { tax: false, cash: false };
  function fillForms(Mo) {
    var t = Mo.cfg, c = Mo.cash;
    if (!formDirty.tax) { $('tPbUsed').value = t.pbKnown ? t.pbUsed : ''; $('tPbDate').value = t.pbUsedDate || ''; $('tInt').value = t.interestRest || 0; $('tLoss').value = t.lossOther || 0; $('tS23').value = t.s23Other || 0; $('tRate').value = t.rateKnown ? String(Math.round(t.rate * 1000) / 10) : ''; $('tHead').value = t.headroom == null ? '' : t.headroom; $('tNv').checked = !!t.nv; $('tBuf').value = t.buffer; $('tMin').value = t.minOrder; $('tReb').value = t.rebalDate || ''; $('tCashRate').value = String(Math.round((t.cashRate || 0) * 10000) / 100); }
    if (!formDirty.cash) { $('cFtse').value = (c.ftse || 0).toFixed(2); $('cBtc').value = (c.btc || 0).toFixed(2); $('cGold').value = (c.gold || 0).toFixed(2); }
    $('taxYearLbl').textContent = String(t.year);
    var tn = $('taxNote'); tn.textContent = (Mo.dep.tax && Mo.dep.tax.note) || '';
    var di = $('dataInfo'), m = Mo.dep.meta || {};
    di.textContent = Mo.ready ? (Mo.dep.tx.length + ' Buchungen, Cash ' + eur((c.ftse || 0) + (c.btc || 0) + (c.gold || 0), 2) + (m.imported ? ' · importiert ' + dtDE(m.imported) : '') + (m.saved ? ' · zuletzt gespeichert ' + dtDE(m.saved) : '') + (m.source ? ' · Quelle: ' + m.source : '')) : 'Noch keine Depotdaten in diesem Browser.';
    var an = $('assumeNotes'); an.textContent = '';
    [['A-1', 'Cash gehört je Position; Kauf- und Verkaufssignale bewegen nur dieses Cash. Umgeschichtet wird nur beim Rebalancing.'], ['A-2', 'Beim Rebalancing bekommt eine nicht investierte Position ihr Zielgewicht als Cash.'], ['A-5', 'Gold-Signal aus dem LBMA-Nachmittagsfixing (PM), wie in den Backtests. Gegenprobe mit dem COMEX-Future.'], ['A-6', 'Ein Schluss genau auf dem SMA50 setzt beide Zähler zurück; alle Vergleiche sind streng.'], ['A-7', 'Startzustand einer Regel: investiert, wenn der erste Schluss mit SMA50 darüber liegt.'], ['A-9', 'Vorabpauschale: Kurs zu Jahresbeginn × Basiszins × 70 %, im Kaufjahr anteilig, höchstens der Wertzuwachs; 30 % steuerfrei.'], ['A-12', 'Vorwarnung, wenn der aktuelle Kurs zum Wochenschluss ein Signal auslösen würde oder weniger als ' + pctPlain((CFG.warn && CFG.warn.pct) || 0.015, 1) + ' von der Schwelle entfernt ist (Freitag 15:17 Uhr für FTSE und Gold, Sonntag 21:17 Uhr für Bitcoin, Berliner Sommerzeit). Grenzfall unter ' + pctPlain((CFG.edge && CFG.edge.pct) || 0.005, 1) + ' Abstand. Puffer zur Freigrenze und Mindestbetrag je Order stehen oben.'], ['Fest', 'Abgeltungsteuer ' + pctPlain(CFG.taxLaw.abg, 3) + ', Sparer-Pauschbetrag ' + eur(CFG.taxLaw.pb) + ', Teilfreistellung ' + pctPlain(CFG.taxLaw.tfs, 0) + ', Freigrenze ' + eur(CFG.taxLaw.fg) + ' (§ 23), Basiszins ' + CFG.taxLaw.year + ' ' + pctPlain(CFG.taxLaw.basiszins, 2) + ', VWCE-Kurs zu Jahresbeginn ' + eur(CFG.taxLaw.vwceStart, 2) + ', Orderkosten ' + eur(CFG.taxLaw.fee) + '.']].forEach(function (x) { var p = el('p'); p.appendChild(el('b', null, x[0] + ' · ')); p.appendChild(document.createTextNode(x[1])); an.appendChild(p); });
  }
  function num(id) { var v = $(id).value.trim().replace(',', '.'); return v === '' ? null : +v; }
  function msg(id, text, err) { var m = $(id); if (!m) return; m.textContent = text; m.className = 'formmsg' + (err ? ' err' : ''); }
  function download(name, text) { var blob = new Blob([text], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function wireForms() {
    $('fDate').value = todayISO();
    ['taxForm', 'cashForm'].forEach(function (f) { $(f).addEventListener('input', function () { formDirty[f === 'taxForm' ? 'tax' : 'cash'] = true; }); });
    $('taxForm').addEventListener('submit', function (e) { e.preventDefault();
      var pb = num('tPbUsed'), rate = num('tRate'), head = num('tHead');
      STORE.update(function (d) { d.tax = d.tax || {}; d.tax.pbUsed = pb == null ? null : pb; d.tax.pbUsedDate = $('tPbDate').value || ''; d.tax.interestRest = num('tInt') || 0; d.tax.lossOther = num('tLoss') || 0; d.tax.s23Other = num('tS23') || 0; if (rate != null && rate >= 0 && rate <= 50) d.tax.rate = rate / 100; else d.tax.rate = null; d.tax.headroom = head == null ? null : head; d.tax.nv = $('tNv').checked; d.tax.buffer = num('tBuf') == null ? CFG.taxLaw.buffer : num('tBuf'); d.tax.minOrder = num('tMin') == null ? CFG.taxLaw.minOrder : num('tMin'); d.tax.rebalDate = $('tReb').value || ''; var cr = num('tCashRate'); d.tax.cashRate = cr == null ? 0.025 : cr / 100; });
      formDirty.tax = false; msg('tMsg', 'Gespeichert (in diesem Browser).'); schedule(); });
    $('cashForm').addEventListener('submit', function (e) { e.preventDefault();
      var c = { ftse: num('cFtse') || 0, btc: num('cBtc') || 0, gold: num('cGold') || 0 }; if (c.ftse < 0 || c.btc < 0 || c.gold < 0) { msg('cMsg', 'Cash kann nicht negativ sein.', true); return; }
      STORE.update(function (d) { d.cash = c; }); formDirty.cash = false; msg('cMsg', 'Gespeichert (in diesem Browser).'); schedule(); });
    function syncTxForm() { var cashMove = $('fType').value === 'einzahlung' || $('fType').value === 'auszahlung'; $('lUnits').hidden = cashMove; $('lFee').hidden = cashMove; $('lPriceText').textContent = cashMove ? 'Betrag in €' : 'Kurs je Stück in €'; }
    $('fType').addEventListener('change', syncTxForm); syncTxForm();
    $('txForm').addEventListener('submit', function (e) { e.preventDefault();
      var d = $('fDate').value, a = $('fAsset').value, type = $('fType').value, u = num('fUnits'), p = num('fPrice'), fee = num('fFee') || 0, note = $('fNote').value.trim();
      if (!d) { msg('fMsg', 'Bitte ein Datum angeben.', true); return; }
      if (type === 'einzahlung' || type === 'auszahlung') {
        if (!(p > 0)) { msg('fMsg', 'Bitte den Betrag in Euro angeben.', true); return; }
        STORE.update(function (dep) { dep.tx.push({ id: 'tx' + Date.now(), d: d, a: a, type: type, amount: p, fee: 0, note: note, ts: Date.now() }); dep.cash[a] = Math.max(0, dep.cash[a] + (type === 'einzahlung' ? p : -p)); });
        msg('fMsg', (type === 'einzahlung' ? 'Einzahlung' : 'Auszahlung') + ' eingetragen, Cash angepasst.'); $('fPrice').value = ''; $('fNote').value = ''; schedule(); return;
      }
      if (!(u > 0)) { msg('fMsg', 'Bitte die Stückzahl angeben.', true); return; } if (!(p > 0)) { msg('fMsg', 'Bitte den Kurs je Stück in Euro angeben.', true); return; }
      if (type === 'verkauf') { var have = ENG.units(ENG.book(STORE.load().tx).pos[a]); if (u > have + 1e-9) { msg('fMsg', 'Du hast nur ' + units(a, have) + ' im Depot.', true); return; } }
      STORE.update(function (dep) { dep.tx.push({ id: 'tx' + Date.now(), d: d, a: a, type: type, units: u, price: p, fee: fee, note: note, ts: Date.now() }); if (type === 'verkauf') dep.cash[a] = dep.cash[a] + u * p - fee; else dep.cash[a] = Math.max(0, dep.cash[a] - (u * p + fee)); });
      msg('fMsg', (type === 'kauf' ? 'Kauf' : 'Verkauf') + ' eingetragen, Cash angepasst.'); $('fUnits').value = ''; $('fPrice').value = ''; $('fNote').value = ''; schedule(); });
    /* Ein-/Auszahlung aufs Konto: Einzahlungen gehen an die Bausteine, deren Regel auf Cash steht (nach Zielgewicht), sonst an alle nach Zielgewicht;
       Auszahlungen kommen aus dem Cash der nicht investierten Bausteine (anteilig), notfalls aus anderem Cash. Nie ein Verkauf. */
    function splitDeposit(amount) { var outs = A.filter(function (a) { return C[a].E.last.st === 0; }); if (!outs.length) outs = A.slice(); var wsum = outs.reduce(function (sx, a) { return sx + CFG.assets[a].w; }, 0), parts = {}, acc = 0; outs.forEach(function (a, i) { var v = i === outs.length - 1 ? Math.round((amount - acc) * 100) / 100 : Math.round(amount * CFG.assets[a].w / wsum * 100) / 100; acc += v; parts[a] = v; }); return { parts: parts, why: outs.length === A.length ? 'alle drei Regeln investiert, deshalb nach Zielgewicht auf alle Bausteine als Cash bis zum Rebalancing' : 'auf die Bausteine mit Regel auf Cash (' + outs.map(function (a) { return CFG.assets[a].short; }).join(', ') + ') nach Zielgewicht' }; }
    function splitWithdrawal(amount, cash) { var outs = A.filter(function (a) { return C[a].E.last.st === 0 && cash[a] > 0.005; }), parts = {}, rest = amount, pool = outs.reduce(function (sx, a) { return sx + cash[a]; }, 0); outs.forEach(function (a) { var v = Math.min(cash[a], Math.round(amount * cash[a] / (pool || 1) * 100) / 100); parts[a] = v; rest -= v; }); if (rest > 0.005) { A.forEach(function (a) { if (rest <= 0.005) return; var free = cash[a] - (parts[a] || 0); if (free > 0.005) { var v = Math.min(free, rest); parts[a] = Math.round(((parts[a] || 0) + v) * 100) / 100; rest -= v; } }); } return { parts: parts, rest: Math.max(0, Math.round(rest * 100) / 100), fromInvested: A.some(function (a) { return parts[a] > 0.005 && C[a].E.last.st === 1; }) }; }
    $('accForm').addEventListener('submit', function (e) { e.preventDefault();
      var d = $('accDate').value, type = $('accType').value, amt = num('accAmount'), note = $('accNote').value.trim(), cash = STORE.load().cash;
      if (!d) { msg('accMsg', 'Bitte ein Datum angeben.', true); return; } if (!(amt > 0)) { msg('accMsg', 'Bitte den Betrag angeben.', true); return; }
      var sp = type === 'einzahlung' ? splitDeposit(amt) : splitWithdrawal(amt, cash);
      if (type === 'auszahlung' && sp.rest > 0.005) { msg('accMsg', 'So viel Cash ist nicht da: ' + eur(sp.rest, 2) + ' fehlen. Verkäufe macht die Seite nur bei Signal oder Rebalancing.', true); return; }
      var ts = Date.now(), lines = [];
      STORE.update(function (dep) { Object.keys(sp.parts).forEach(function (a, i) { var v = sp.parts[a]; if (!(v > 0.005)) return; dep.tx.push({ id: 'acc' + ts + '-' + i, d: d, a: a, type: type, amount: v, fee: 0, note: (type === 'einzahlung' ? 'Einzahlung' : 'Auszahlung') + ' aufs Konto ' + eur(amt, 2) + (note ? ' · ' + note : ''), ts: ts + i }); dep.cash[a] = Math.max(0, dep.cash[a] + (type === 'einzahlung' ? v : -v)); lines.push(CFG.assets[a].short + ' ' + eur(v, 2)); }); });
      msg('accMsg', (type === 'einzahlung' ? 'Einzahlung verteilt ' + sp.why + ': ' : 'Auszahlung aus dem Cash entnommen' + (sp.fromInvested ? ' (teilweise aus Cash investierter Bausteine, weil das Cash der Regel-Cash-Bausteine nicht reichte)' : '') + ': ') + lines.join(', ') + '.');
      $('accAmount').value = ''; $('accNote').value = ''; schedule(); });
    $('accDate').value = todayISO();
    $('btnExport').addEventListener('click', function () { download('regel-depot-' + todayISO() + '.json', STORE.exportJson()); msg('dMsg', 'Datei gespeichert. Bewahre sie sicher auf; sie enthält deine Depotdaten.'); });
    $('fileImport').addEventListener('change', function () { var f = this.files && this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { try { STORE.importJson(String(r.result)); formDirty.tax = formDirty.cash = false; msg('dMsg', 'Importiert.'); schedule(); } catch (e) { msg('dMsg', 'Import fehlgeschlagen: ' + e.message, true); } }; r.readAsText(f); this.value = ''; });
    $('btnPaste').addEventListener('click', function () { var b = $('pasteBox'); b.hidden = !b.hidden; if (!b.hidden) $('pasteArea').focus(); });
    $('btnPasteImport').addEventListener('click', function () { try { STORE.importJson($('pasteArea').value); $('pasteArea').value = ''; $('pasteBox').hidden = true; formDirty.tax = formDirty.cash = false; msg('dMsg', 'Importiert.'); schedule(); } catch (e) { msg('dMsg', 'Import fehlgeschlagen: ' + e.message, true); } });
    var resetArmed = false;
    $('btnReset').addEventListener('click', function () { if (!resetArmed) { resetArmed = true; this.textContent = 'Wirklich alles löschen?'; setTimeout(function () { resetArmed = false; $('btnReset').textContent = 'Alles löschen'; }, 4000); return; } STORE.reset(); resetArmed = false; this.textContent = 'Alles löschen'; formDirty.tax = formDirty.cash = false; msg('dMsg', 'Depotdaten in diesem Browser gelöscht.'); schedule(); });
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
    note('Kurse: Yahoo Finance (VWRD.L bereinigt, BTC-USD, GC=F sowie VWCE.DE, BTC-EUR, SGBS.MI, EURUSD=X) und LBMA (Gold PM in USD). Yahoo ist die maßgebliche Quelle; fällt sie aus, springen Coinbase (Bitcoin) und Alpha Vantage (FTSE) ein und die Seite kennzeichnet das.');
    note('Ablauf: Freitag 15:17 Uhr Vorwarnung FTSE und Gold, 19:23 Uhr Wochenschluss FTSE und Euro-Kurse; Sonntag 21:17 Uhr Vorwarnung Bitcoin; Montag 02:23 Uhr Wochenschluss Bitcoin und Gold (LBMA veröffentlicht erst um Mitternacht London), Push-Nachrichten dazu um 07:53 Uhr; Montag bis Donnerstag 19:37 Uhr Euro-Kurse. Zeiten in Berliner Sommerzeit; im Winter jeweils eine Stunde früher.');
    note('Die Läufe laufen als GitHub Actions in diesem Repo. Sie führen keine Käufe oder Verkäufe aus und kennen deine Depotdaten nicht; die liegen nur in deinem Browser.');
    $('footSrc').textContent = 'Wochenhistorie ab ' + dDE(C.ftse.S.d[0]) + ' (FTSE), ' + dDE(C.btc.S.d[0]) + ' (Bitcoin), ' + dDE(C.gold.S.d[0]) + ' (Gold). Letzte Aktualisierung der Kursdaten: ' + (D.state && D.state.updated ? dtDE(D.state.updated) : '–') + '.';
  }

  /* ---------- Render-Schleife ---------- */
  var raf = 0, lastW = 0, lastPW = 0;
  function renderAll() {
    raf = 0; var Mo = model();
    renderTop(Mo); renderGlobal(Mo); renderTodo(Mo); renderStatus(Mo); renderDepot(Mo); drawPerf(Mo); renderFeed(); renderSched(); renderRunLog(); renderPush(); renderReb(Mo); fillForms(Mo); renderRules();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(renderAll); }
  function cardW() { var c = $('ch-ftse'); return c ? c.clientWidth : 0; }
  $('perfSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; PERF.mode = b.getAttribute('data-m'); Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawPerf(model()); });
  (function () { var seg = $('perfRange'); if (!seg) return; PERF_RANGES.forEach(function (r) { var b = el('button', null, r[1]); b.type = 'button'; b.setAttribute('data-r', r[0]); b.setAttribute('aria-pressed', String(PERF.range === r[0])); seg.appendChild(b); }); seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; PERF.range = b.getAttribute('data-r'); Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawPerf(model()); }); })();
  $('rangeSeg').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; VIEW.range = +b.getAttribute('data-r'); Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); }); drawCharts(); try { localStorage.setItem('regelDepot.range', String(VIEW.range)); } catch (err) { /* still */ } });
  window.addEventListener('resize', function () { var w = cardW(), pw = $('chPerf') ? $('chPerf').clientWidth : 0; if (Math.abs(w - lastW) > 4 || Math.abs(pw - lastPW) > 4) { lastW = w; lastPW = pw; schedule(); } if (BIG.a) drawBig(BIG.a); });
  if ($('bigModal')) $('bigModal').addEventListener('click', function (e) { if (e.target === this) closeBig(); });
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', schedule); }
  STORE.onChange(function () { schedule(); });
  try { var r0s = localStorage.getItem('regelDepot.range'), r0 = r0s == null ? NaN : +r0s; if (!isNaN(r0)) { VIEW.range = r0; Array.prototype.forEach.call($('rangeSeg').querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(+x.getAttribute('data-r') === r0)); }); } } catch (e) { /* still */ }

  loadAll().then(function () { wireForms(); return pushInit(); }).then(function () { renderAll(); lastW = cardW(); lastPW = $('chPerf') ? $('chPerf').clientWidth : 0; })
    .catch(function (e) { var g = $('globalBanner'); g.textContent = ''; var b = el('div', 'banner bad'); b.appendChild(el('b', null, 'Die Kursdaten konnten nicht geladen werden')); b.appendChild(el('span', null, e.message + '. Lade die Seite neu; bleibt der Fehler, prüfe das Repo.')); g.appendChild(b); $('topMeta').textContent = 'Fehler beim Laden'; console.error(e); });
})();
