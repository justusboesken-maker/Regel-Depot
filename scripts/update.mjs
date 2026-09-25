#!/usr/bin/env node
/* Regel-Depot 50/30/20 – Update-Skript für GitHub Actions
   Holt Kurse (Yahoo Finance, LBMA, Ersatzquellen), bildet Wochenschlüsse, rechnet die Regeln,
   schreibt docs/data/*.json, sammelt Ereignisse und schickt Web-Push-Nachrichten.

   Aufruf: node scripts/update.mjs --step <auto|fr-warn|fr-close|so-warn|mo-close|mo-notify|eod|all|init|test-push>
           [--final] [--now 2026-09-28T00:30:00Z] [--mock <ordner>] [--dry] [--verbose]
   Umgebung: VAPID_PRIVATE_KEY, PUSH_SUB_1 … PUSH_SUB_5 (Subscription-JSON), ALPHAVANTAGE_KEY (optional) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as SRC from './sources.mjs';
import { sendPush } from './webpush.mjs';

const require = createRequire(import.meta.url);
const ENG = require('../docs/js/engine.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'data');

/* ---------- Argumente ---------- */
const argv = process.argv.slice(2);
function arg(name, def) { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; }
const OPT = { step: arg('step', 'auto'), final: !!arg('final', false), fallback: !!arg('fallback', false), now: arg('now', null), mock: arg('mock', null), dry: !!arg('dry', false), verbose: !!arg('verbose', false) };
const NOW = OPT.now ? new Date(OPT.now) : new Date();
if (isNaN(NOW.getTime())) { console.error('Ungültiges --now'); process.exit(2); }
const log = (...a) => console.log(...a);
const vlog = (...a) => { if (OPT.verbose) console.log(...a); };

/* ---------- Dateien ---------- */
function loadJson(rel, fallback) { const p = path.join(DATA, rel); if (!fs.existsSync(p)) return fallback; return JSON.parse(fs.readFileSync(p, 'utf8')); }
function saveJson(rel, obj, pretty) { const p = path.join(DATA, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj)); }

const CFG = loadJson('config.json');
const A = Object.keys(CFG.assets);
const STATE = loadJson('state.json', { version: 1, updated: null, assets: {}, cross: {}, warn: {}, queue: [] });
const EVENTS = loadJson('events.json', []);
const RUNS = loadJson('runs.json', []);
const EUR = loadJson('eur.json', { weekly: {}, latest: {} });
const WEEKLY = {}; A.concat(['goldf']).forEach((a) => { WEEKLY[a] = loadJson('weekly/' + a + '.json', null); });

/* ---------- Zeit ---------- */
const iso = ENG.iso, addDays = ENG.addDays, mondayOf = ENG.mondayOf;
const TODAY = iso(NOW.getTime()), THIS_MON = mondayOf(TODAY), DOW = (NOW.getUTCDay() + 6) % 7, HOUR = NOW.getUTCHours() + NOW.getUTCMinutes() / 60;
const NEXT_MON = addDays(THIS_MON, 7);
const isHolidayFriday = (d) => (CFG.holidays && CFG.holidays.fridays || []).includes(d);

/* ---------- Formatierung (Meldungstexte) ---------- */
const de = (x, d) => (+x).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (a, x) => de(x, CFG.assets[a] ? CFG.assets[a].dec : 2) + ' $';
const ds = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.';
const dDE = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);
const name = (a) => CFG.assets[a].name;

/* ---------- Ergebnis eines Laufs ---------- */
const RUN = { t: NOW.toISOString(), step: OPT.step, ok: true, summary: [], errors: [], notified: 0, changed: false };
function note(s) { RUN.summary.push(s); log('· ' + s); }
function fail(a, e) { const msg = (a ? a + ': ' : '') + (e && e.message ? e.message : String(e)); RUN.errors.push(msg); RUN.ok = false; log('! ' + msg); }

/* ---------- Ereignisse und Push-Warteschlange ---------- */
function addEvent(ev) {
  if (EVENTS.some((e) => e.id === ev.id)) return false;
  EVENTS.push({ t: NOW.toISOString(), ...ev });
  RUN.changed = true;
  return true;
}
function queuePush(p) { STATE.queue = STATE.queue || []; if (STATE.queue.some((q) => q.id === p.id)) return; STATE.queue.push(p); RUN.changed = true; }
function subscriptions() {
  const out = [];
  for (let i = 1; i <= (CFG.push.maxSubscriptions || 5); i++) { const s = process.env['PUSH_SUB_' + i]; if (s && s.trim().startsWith('{')) { try { out.push({ n: i, sub: JSON.parse(s) }); } catch (e) { fail('Push', 'PUSH_SUB_' + i + ' ist kein gültiges JSON'); } } }
  return out;
}
async function flushQueue() {
  const q = STATE.queue || [];
  if (!q.length) return;
  if (OPT.dry) { note('Push (Probelauf): ' + q.map((p) => p.title).join(' | ')); STATE.queue = []; RUN.changed = true; return; }
  const subs = subscriptions(), priv = process.env.VAPID_PRIVATE_KEY;
  if (!subs.length || !priv) { note('Push: ' + q.length + ' Nachricht(en) bleiben in der Warteschlange (' + (!priv ? 'VAPID_PRIVATE_KEY fehlt' : 'keine Push-Anmeldung hinterlegt') + ')'); return; }
  const vapid = { subject: CFG.push.subject, publicKey: CFG.push.vapidPublicKey, privateKey: priv };
  const keep = [];
  for (const p of q) {
    let sent = 0, gone = 0;
    for (const s of subs) {
      try { const r = await sendPush(s.sub, { title: p.title, body: p.body, url: p.url || './', tag: p.tag || p.id, ts: p.ts || NOW.toISOString() }, vapid, { topic: (p.tag || 'rd').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined });
        if (r.ok) sent++; else if (r.gone) { gone++; fail('Push', 'Anmeldung PUSH_SUB_' + s.n + ' ist abgelaufen (HTTP ' + r.status + '), bitte auf der Seite neu einrichten'); } else fail('Push', 'PUSH_SUB_' + s.n + ' HTTP ' + r.status + ' ' + r.text); }
      catch (e) { fail('Push', 'PUSH_SUB_' + s.n + ': ' + e.message); }
    }
    if (sent) { RUN.notified += sent; } else if (!gone && subs.length) { keep.push(p); }
  }
  STATE.queue = keep;
  RUN.changed = true;
  note('Push: ' + RUN.notified + ' Nachricht(en) zugestellt' + (keep.length ? ', ' + keep.length + ' bleiben in der Warteschlange' : ''));
}

/* ---------- Quellen (mit Mock für Tests) ---------- */
async function fetchMock(key) {
  const p = path.join(OPT.mock, key.replace(/[^A-Za-z0-9._=-]/g, '_') + '.json');
  if (!fs.existsSync(p)) throw new Error('Mock fehlt: ' + path.basename(p));
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const AVKEY = process.env.ALPHAVANTAGE_KEY || '';
const F = {
  yahoo: (sym, opts) => OPT.mock ? fetchMock('yahoo_' + sym) : SRC.yahooDaily(sym, opts),
  lbma: (fix) => OPT.mock ? fetchMock('lbma_' + fix) : SRC.lbmaGold(fix),
  coinbase: (p) => OPT.mock ? fetchMock('coinbase_' + p) : SRC.coinbaseDaily(p, 60),
  coinbaseSpot: (p) => OPT.mock ? fetchMock('coinbasespot_' + p) : SRC.coinbaseSpot(p),
  av: (sym) => OPT.mock ? fetchMock('av_' + sym) : SRC.alphaVantageWeeklyAdjusted(sym, AVKEY),
  avCrypto: (sym, mkt) => OPT.mock ? fetchMock('avcrypto_' + sym) : SRC.alphaVantageCryptoDaily(sym, mkt, AVKEY),
  avQuote: (sym) => OPT.mock ? fetchMock('avquote_' + sym) : SRC.alphaVantageQuote(sym, AVKEY),
  avDaily: (sym, full) => OPT.mock ? fetchMock('avdaily_' + sym) : SRC.alphaVantageDaily(sym, AVKEY, full),
  ecbRange: (from, to) => OPT.mock ? fetchMock('ecbrange') : SRC.ecbEurUsdRange(from, to),
  coinbaseDays: (p, days) => OPT.mock ? fetchMock('coinbase_' + p) : SRC.coinbaseDaily(p, days),
  coinbaseFx: (b, q) => OPT.mock ? fetchMock('coinbasefx_' + b + q) : SRC.coinbaseFx(b, q),
  goldSpot1: () => OPT.mock ? fetchMock('goldprice') : SRC.goldSpotGoldpriceOrg(),
  goldSpot2: () => OPT.mock ? fetchMock('goldapi') : SRC.goldSpotGoldApi(),
  ecb: () => OPT.mock ? fetchMock('ecb') : SRC.ecbEurUsd()
};
/* Ersatzquellen für Wochenschlüsse erst im zweiten Anlauf: Yahoo ist die maßgebliche Quelle, Ersatzdaten weichen um Hundertstel Prozent ab */
const STEP0 = OPT.step;
const ALLOW_FB = OPT.final || OPT.fallback || ['mo-notify', 'eod', 'all'].includes(STEP0);
async function firstOk(label, tries) {
  const errs = [];
  for (const t of tries) { try { const r = await t(); if (r) return r; } catch (e) { errs.push((t.name || '?') + ': ' + e.message); vlog(label + ' · ' + errs[errs.length - 1]); } }
  throw new Error(errs.join(' | '));
}

/* Signalreihe einer Anlage laden: {S (Wochenserie ohne laufende/unvollständige Wochen), price, priceTime, src, fallback, lastD, raw} */
const START = { ftse: '2012-05-01', btc: '2014-09-15' };
async function loadSignalSeries(a) {
  const c = CFG.assets[a];
  if (c.signal.src === 'lbma') {
    const r = await F.lbma(c.signal.fix || 'pm');
    return { daily: r, src: r.src, fallback: false };
  }
  let primaryError = null;
  try { const r = await F.yahoo(c.signal.sym, { adj: !!c.signal.adj, start: START[a] || '2016-01-01' }); return { daily: r, src: r.src, fallback: false }; }
  catch (e) { primaryError = e.message; vlog('Yahoo ' + c.signal.sym + ' fehlgeschlagen: ' + e.message); }
  if (!ALLOW_FB) throw new Error(primaryError + ' (Ersatzquelle erst im nächsten Anlauf)');
  if (a === 'ftse') {
    const r = await F.av('VWRD.LON'); /* wöchentlich bereinigt, signalgleich geprüft */
    return { daily: r, src: r.src, fallback: true, primaryError, weeklyAlready: true };
  }
  if (a === 'btc') {
    const r = await firstOk('BTC', [async function coinbase() { return F.coinbase('BTC-USD'); }, async function alphaVantage() { return F.avCrypto('BTC', 'USD'); }]);
    return { daily: r, src: r.src, fallback: true, primaryError };
  }
  throw new Error(primaryError);
}

/* Welche Wochen sind zum Zeitpunkt NOW abgeschlossen? Liefert den Montag der ersten NICHT fälligen Woche. */
function dueCutoff(a) {
  const c = CFG.assets[a];
  if (c.week === 'sun') return THIS_MON;                               /* Bitcoin: Woche endet Sonntag 24 Uhr UTC */
  if (DOW >= 5 || (DOW === 4 && HOUR >= 17)) return NEXT_MON;           /* Freitag ab 17 Uhr UTC gilt die laufende Woche als fällig */
  return THIS_MON;
}
/* Ist die fällige Woche (Montag k) in den Tagesdaten vollständig? */
function weekComplete(a, k, lastD) {
  const c = CFG.assets[a], fri = addDays(k, 4), sun = addDays(k, 6), weekOver = TODAY >= addDays(k, 7);
  if (!lastD || lastD < k) return { ok: false, reason: 'noch kein Kurs der Woche' };
  if (c.week === 'sun') return lastD >= sun ? { ok: true } : { ok: false, reason: 'Sonntagsschluss fehlt noch' };
  if (lastD >= fri) return { ok: true };
  if (isHolidayFriday(fri) && lastD >= addDays(k, 3)) return { ok: true, holiday: true };
  /* Ohne Freitagskurs erst dann mit dem letzten Kurs der Woche abschließen, wenn er sicher nicht mehr kommt: Yahoo ab Montag, LBMA (Nachlieferungen) erst ab Mittwoch */
  const graceOver = c.signal.src === 'lbma' ? (NOW.getTime() >= new Date(addDays(k, 9) + 'T12:00:00Z').getTime()) : weekOver;
  if (graceOver && lastD >= addDays(k, 3)) return { ok: true, partial: true };
  return { ok: false, reason: 'Freitagsschluss (' + ds(fri) + ') fehlt noch' };
}

function storedSeries(a) { const j = WEEKLY[a]; return j && j.w ? ENG.fromRows(j.w) : { k: [], d: [], c: [] }; }
function switchText(a, s) {
  const r = CFG.assets[a].rule, buy = s.to === 1, mon = addDays(s.k, 7);
  const why = r.type === 'band'
    ? 'Schluss ' + usd(a, s.c) + ' liegt mehr als ' + de(r.p * 100, 0) + ' % ' + (buy ? 'über' : 'unter') + ' dem SMA50 (Schwelle ' + usd(a, s.m * (buy ? 1 + r.p : 1 - r.p)) + ')'
    : r.n + '. Wochenschluss in Folge ' + (buy ? 'über' : 'unter') + ' dem SMA50 (' + usd(a, s.c) + ' gegen ' + usd(a, s.m) + ')';
  return { title: name(a) + ': ' + (buy ? 'Kaufsignal' : 'Verkaufssignal'), body: 'Wochenschluss ' + ds(s.d) + ': ' + why + '. Laut Regel ' + (buy ? 'kaufen' : 'verkaufen') + ' zur Eröffnung am Montag, ' + ds(mon) };
}
function lastState(a) { return STATE.assets && STATE.assets[a] ? STATE.assets[a] : null; }
function summarizeAsset(a, E, extra) {
  const L = E.last, r = CFG.assets[a].rule;
  return Object.assign({
    k: L.k, d: L.d, c: round(L.c, 4), m: round(L.m, 4), dist: round(L.dist, 6), st: L.st, up: L.up, dn: L.dn, changed: L.changed,
    lastSwitch: L.lastSwitch ? { k: L.lastSwitch.k, d: L.lastSwitch.d, to: L.lastSwitch.to, c: round(L.lastSwitch.c, 4), m: round(L.lastSwitch.m, 4) } : null,
    next: { above: round(E.next.above, 4), bandUp: round(E.next.bandUp, 4), bandDown: round(E.next.bandDown, 4) },
    rule: r, weeks: E.st.length, updated: NOW.toISOString()
  }, extra || {});
}
const round = (x, d) => (x == null || !isFinite(x) ? null : Math.round(x * Math.pow(10, d)) / Math.pow(10, d));

/* ---------- Wochenschluss einer Anlage verarbeiten ---------- */
async function closeAsset(a) {
  const c = CFG.assets[a], cutoff = dueCutoff(a), stored = storedSeries(a), prev = lastState(a);
  const dueK = addDays(cutoff, -7);                                   /* jüngste fällige Woche */
  if (stored.k.length && stored.k[stored.k.length - 1] >= dueK && prev && prev.k >= dueK && !prev.pending) { vlog(a + ': Woche ' + dueK + ' schon verarbeitet'); return { done: true, already: true }; }
  let src;
  try { src = await loadSignalSeries(a); }
  catch (e) { fail(name(a), 'Kursabruf fehlgeschlagen: ' + e.message); markPending(a, dueK, 'Kursabruf fehlgeschlagen: ' + e.message); return { done: false, error: e.message }; }
  const daily = src.daily, lastD = daily.dates[daily.dates.length - 1];
  const fresh = src.weeklyAlready ? ENG.fromRows(daily.dates.map((d, i) => [mondayOf(d), d, daily.closes[i]])) : ENG.weeklyFromDaily(daily.dates, daily.closes, cutoff);
  if (src.weeklyAlready) { const keep = fresh.k.map((k, i) => k < cutoff ? i : -1).filter((i) => i >= 0); fresh.k = keep.map((i) => fresh.k[i]); fresh.d = keep.map((i) => fresh.d[i]); fresh.c = keep.map((i) => fresh.c[i]); }
  /* Für die Vollständigkeit zählt der letzte Tageskurs, der zur fälligen Woche gehört */
  const lastInWeek = daily.dates.filter((d) => mondayOf(d) === dueK).pop() || null;
  const comp = weekComplete(a, dueK, lastInWeek);
  if (!comp.ok) {
    /* Frühere Wochen trotzdem einmischen (ohne die unvollständige) */
    const cut = fresh.k.map((k, i) => k < dueK ? i : -1).filter((i) => i >= 0);
    const older = { k: cut.map((i) => fresh.k[i]), d: cut.map((i) => fresh.d[i]), c: cut.map((i) => fresh.c[i]) };
    if (older.k.length) saveSeries(a, ENG.mergeWeekly(stored, older, !!c.signal.adj), src.src);
    markPending(a, dueK, comp.reason + (src.fallback ? ' (Ersatzquelle)' : ''));
    note(name(a) + ': Wochenschluss ' + ds(addDays(dueK, c.week === 'sun' ? 6 : 4)) + ' fehlt noch (' + comp.reason + ')');
    return { done: false, pending: true };
  }
  const merged = ENG.mergeWeekly(stored, fresh, !!c.signal.adj);
  const E = ENG.evalRule(merged, c.rule);
  if (E.st.length < 60) { fail(name(a), 'zu wenige Wochen: ' + E.st.length); return { done: false }; }
  saveSeries(a, merged, src.src);
  /* Neue Wechsel seit dem letzten verarbeiteten Stand */
  const prevK = prev && prev.k ? prev.k : (stored.k.length ? stored.k[stored.k.length - 1] : null);
  const newSw = E.sw.filter((s) => prevK == null || s.k > prevK);
  newSw.forEach((s) => {
    const txt = switchText(a, s), id = 'sig-' + a + '-' + s.d;
    if (addEvent({ id, kind: s.to === 1 ? 'kauf' : 'verkauf', a, k: s.k, d: s.d, title: txt.title, text: txt.body, c: round(s.c, 4), m: round(s.m, 4) })) {
      queuePush({ id, title: txt.title, body: txt.body, tag: 'signal-' + a, url: './#status', ts: NOW.toISOString() });
    }
  });
  const L = E.last, thr = ENG.flipThreshold(E, c.rule);
  const edge = Math.abs(L.c / (c.rule.type === 'band' ? L.m * (L.st === 1 ? 1 - c.rule.p : 1 + c.rule.p) : L.m) - 1) < (CFG.edge ? CFG.edge.pct : 0.005);
  if (edge && !newSw.length) addEvent({ id: 'edge-' + a + '-' + L.d, kind: 'info', a, k: L.k, d: L.d, title: name(a) + ': Grenzfall', text: 'Wochenschluss ' + ds(L.d) + ' ' + usd(a, L.c) + ' liegt sehr nah an der Schwelle (SMA50 ' + usd(a, L.m) + '). Quelle: ' + src.src + '.' });
  STATE.assets[a] = summarizeAsset(a, E, { src: src.src, fallback: !!src.fallback, primaryError: src.primaryError || null, pending: null, holiday: !!comp.holiday, partial: !!comp.partial, edge });
  RUN.changed = true;
  note(name(a) + ': Schluss ' + ds(L.d) + ' ' + usd(a, L.c) + ', SMA50 ' + usd(a, L.m) + ', ' + (L.st ? 'investiert' : 'Cash') + (newSw.length ? ', SIGNALWECHSEL' : '') + (src.fallback ? ' (' + src.src + ')' : ''));
  return { done: true, E, newSw };
}
function markPending(a, k, reason) {
  STATE.assets[a] = Object.assign({}, STATE.assets[a] || {}, { pending: { k, reason, at: NOW.toISOString() } });
  RUN.changed = true;
}
function saveSeries(a, S, src) {
  const old = WEEKLY[a] || {};
  const j = { a, src, note: old.note || '', updated: NOW.toISOString(), w: ENG.toRows(S, 4) };
  WEEKLY[a] = j; saveJson('weekly/' + a + '.json', j);
  RUN.changed = true;
}

/* ---------- Vorwarnung ---------- */
async function warnAsset(a, priceInfo) {
  const c = CFG.assets[a], stored = storedSeries(a);
  /* Serie ohne die laufende Woche */
  const cut = stored.k.map((k, i) => k < THIS_MON ? i : -1).filter((i) => i >= 0);
  const S = { k: cut.map((i) => stored.k[i]), d: cut.map((i) => stored.d[i]), c: cut.map((i) => stored.c[i]) };
  if (S.k.length < 60) { fail(name(a), 'Vorwarnung: Serie zu kurz'); return; }
  const E = ENG.evalRule(S, c.rule), price = priceInfo.price;
  if (!(price > 0)) { fail(name(a), 'Vorwarnung: kein aktueller Kurs'); return; }
  const E2 = ENG.whatIf(S, c.rule, TODAY, price), ft = ENG.flipThreshold(E, c.rule);
  const thr = ft.thr, dist = price / thr - 1, would = E2.last.changed;
  const near = Math.abs(dist) < (CFG.warn.pct || 0.015);
  const mon = NEXT_MON, closeWhen = c.week === 'sun' ? 'am Sonntag um 24 Uhr UTC' : 'am Freitag';
  let out;
  if (would) out = 'Schließt die Woche so, gibt es ein ' + (E2.last.st ? 'Kaufsignal' : 'Verkaufssignal') + ' (Handel am Montag, ' + ds(mon) + ').';
  else if (c.rule.type === 'confirm' && ((E.last.st === 1 && price < thr) || (E.last.st === 0 && price > thr))) out = 'Schließt die Woche so, wäre das der ' + (price > thr ? E2.last.up : E2.last.dn) + '. Schluss in Folge ' + (price > thr ? 'über' : 'unter') + ' dem SMA50; das ' + (E.last.st ? 'Verkaufssignal' : 'Kaufsignal') + ' kommt erst nach ' + c.rule.n + '.';
  else out = 'Schließt die Woche so, bleibt die Regel ' + (E2.last.st ? 'investiert' : 'auf Cash') + '.';
  const pos = de(Math.abs(dist * 100), 1) + ' % ' + (dist >= 0 ? 'darüber' : 'darunter');
  const text = name(a) + ' steht gerade bei ' + usd(a, price) + (priceInfo.note ? ' (' + priceInfo.note + ')' : '') + '. Schwelle für den Wochenschluss ' + closeWhen + ': ' + usd(a, thr) + ', ' + pos + '. ' + out;
  const level = would ? 'switch' : near ? 'near' : 'none';
  STATE.warn = STATE.warn || {};
  STATE.warn[a] = { t: NOW.toISOString(), forWeek: THIS_MON, price: round(price, 4), priceTime: priceInfo.priceTime || null, thr: round(thr, 4), dist: round(dist, 6), level, would: would ? E2.last.st : null, text, src: priceInfo.src };
  RUN.changed = true;
  if (level !== 'none') {
    const id = 'warn-' + a + '-' + THIS_MON;
    if (addEvent({ id, kind: 'vorwarnung', a, k: THIS_MON, d: TODAY, title: name(a) + ': Vorwarnung', text, price: round(price, 4), thr: round(thr, 4) })) {
      queuePush({ id, title: 'Vorwarnung ' + name(a), body: usd(a, price) + ' gerade, Schwelle ' + usd(a, thr) + ' (' + pos + '). ' + out, tag: 'warn-' + a, url: './#status', ts: NOW.toISOString() });
    }
  }
  note('Vorwarnung ' + name(a) + ': ' + usd(a, price) + ', Schwelle ' + usd(a, thr) + ', ' + pos + (would ? ', SIGNAL MÖGLICH' : near ? ', nahe' : ''));
}
/* Referenzkurs mit Verhältnis zur LBMA: Median LBMA/Referenz der letzten fünf gemeinsamen Tage */
function lbmaRatio(pm, ref) {
  const map = {}; pm.dates.forEach((d, i) => { map[d] = pm.closes[i]; });
  const ratios = []; for (let i = ref.dates.length - 1; i >= 0 && ratios.length < 5; i--) { if (map[ref.dates[i]] && ref.closes[i] > 0) ratios.push(map[ref.dates[i]] / ref.closes[i]); }
  if (!ratios.length) return null;
  ratios.sort((x, y) => x - y); return ratios[Math.floor(ratios.length / 2)];
}
async function currentPrice(a) {
  const c = CFG.assets[a];
  if (a === 'gold') {
    /* LBMA hat keinen Live-Kurs: COMEX-Future (Yahoo) oder Spot (Stooq) mit dem Verhältnis zur LBMA skalieren */
    const pm = await F.lbma(c.signal.fix || 'pm');
    return firstOk('Gold', [
      async function yahooComex() { const g = await F.yahoo(c.cross.sym, { range: '1mo' }); const ratio = lbmaRatio(pm, g); if (!ratio || !(g.price > 0)) throw new Error('kein Verhältnis oder Kurs'); return { price: g.price * ratio, priceTime: g.priceTime, note: 'geschätzt aus dem COMEX-Future ' + usd(a, g.price) + ' × ' + de(ratio, 4), src: g.src + ' × lbma ratio' }; },
      async function lbmaAm() { const am = await F.lbma('am'); const i = am.dates.length - 1; if (am.dates[i] !== TODAY) throw new Error('Vormittagsfixing von heute noch nicht da (' + am.dates[i] + ')'); return { price: am.closes[i], priceTime: TODAY + 'T09:30:00Z', note: 'LBMA-Vormittagsfixing von heute', src: am.src }; },
      async function spot1() { const q = await F.goldSpot1(); return { price: q.price, priceTime: q.priceTime, note: 'Spotpreis (goldprice.org)', src: q.src }; },
      async function spot2() { const q = await F.goldSpot2(); return { price: q.price, priceTime: q.priceTime, note: 'Spotpreis (gold-api.com)', src: q.src }; }
    ]);
  }
  if (a === 'btc') {
    return firstOk('Bitcoin', [
      async function yahoo() { const r = await F.yahoo(c.signal.sym, { range: '5d', adj: false }); if (!(r.price > 0)) throw new Error('kein Kurs'); return { price: r.price, priceTime: r.priceTime, src: r.src }; },
      async function coinbase() { const r = await F.coinbaseSpot('BTC-USD'); return { price: r.price, priceTime: r.priceTime, note: 'Ersatzquelle Coinbase', src: r.src }; }
    ]);
  }
  return firstOk('FTSE', [
    async function yahoo() { const r = await F.yahoo(c.signal.sym, { range: '5d', adj: false }); if (!(r.price > 0)) throw new Error('kein Kurs'); return { price: r.price, priceTime: r.priceTime, src: r.src }; },
    async function alphaVantage() { const r = await F.avQuote('VWRD.LON'); const old = r.priceTime && r.priceTime.slice(0, 10) < TODAY; return { price: r.price, priceTime: r.priceTime, note: old ? 'Ersatzquelle Alpha Vantage: Schlusskurs vom ' + ds(r.priceTime.slice(0, 10)) + ', kein Tageskurs' : 'Ersatzquelle Alpha Vantage, verzögert', src: r.src }; }
  ]);
}

/* ---------- Euro-Kurse ----------
   Primär Yahoo (Tageskerzen). Ersatz: Bitcoin über Coinbase (BTC-EUR), EUR/USD über die EZB, VWCE über Alpha Vantage (VWCE.DEX) oder
   Schätzung aus VWRD (USD) / EURUSD × Kalibrierfaktor, Gold-ETC als Schätzung aus LBMA / EURUSD × Kalibrierfaktor (eur.json: calib). */
function upsertWeekly(a, d, p, dec) {
  EUR.weekly = EUR.weekly || {}; const k = mondayOf(d), rows = (EUR.weekly[a] || []).filter((r) => r[0] !== k);
  rows.push([k, d, round(p, dec)]); rows.sort((x, y) => (x[0] < y[0] ? -1 : 1)); EUR.weekly[a] = rows;
}
function setLatest(a, d, p, sym, src, extra) { EUR.latest[a] = Object.assign({ d, p: round(p, a === 'eurusd' ? 6 : 4), sym, src, t: NOW.toISOString() }, extra || {}); }
function calib(a) { return EUR.calib && EUR.calib[a] && EUR.calib[a].ratio > 0 ? EUR.calib[a] : null; }
async function eurQuotes(keys) {
  EUR.weekly = EUR.weekly || {}; EUR.latest = EUR.latest || {};
  const order = ['eurusd', 'btc', 'ftse', 'gold'].filter((a) => keys.includes(a));
  for (const a of order) {
    const sym = a === 'eurusd' ? CFG.fx.sym : CFG.assets[a].eur.sym, dec = a === 'eurusd' ? 6 : 4;
    let r = null;
    try { r = await F.yahoo(sym, { range: '3mo' }); } catch (e) { vlog('Euro-Kurs ' + sym + ': ' + e.message); }
    if (r) {
      if (a === 'ftse') RUN.yahooDailyFtse = r; if (a === 'gold') RUN.yahooDailyGold = r;
      const cutoff = a === 'btc' ? THIS_MON : ((DOW >= 5 || (DOW === 4 && HOUR >= 17)) ? NEXT_MON : THIS_MON);
      const W = ENG.weeklyFromDaily(r.dates, r.closes, cutoff);
      EUR.weekly[a] = ENG.toRows(ENG.mergeWeekly(ENG.fromRows(EUR.weekly[a] || []), W, false), dec);
      const lastD = r.dates[r.dates.length - 1], lastC = r.closes[r.closes.length - 1];
      const usePrice = r.price > 0 && r.priceTime && r.priceTime.slice(0, 10) >= lastD;
      setLatest(a, usePrice ? r.priceTime.slice(0, 10) : lastD, usePrice ? r.price : lastC, sym, r.src);
      continue;
    }
    try {
      if (a === 'btc') {
        const d = await F.coinbase('BTC-EUR');
        const W = ENG.weeklyFromDaily(d.dates.slice(0, -1), d.closes.slice(0, -1), THIS_MON); /* letzte Kerze = laufender Tag */
        EUR.weekly[a] = ENG.toRows(ENG.mergeWeekly(ENG.fromRows(EUR.weekly[a] || []), W, false), dec);
        setLatest(a, TODAY, d.price, sym, d.src, { fallback: true });
      } else if (a === 'eurusd') {
        const q = await F.ecb(); setLatest(a, q.dates[0], q.price, sym, q.src, { fallback: true }); upsertWeekly(a, q.dates[0], q.price, dec);
      } else if (a === 'ftse') {
        let done = false;
        try { const q = await F.avQuote('VWCE.DEX'); const d = q.priceTime ? q.priceTime.slice(0, 10) : TODAY; setLatest(a, d, q.price, sym, q.src, { fallback: true }); upsertWeekly(a, d, q.price, dec); done = true; } catch (e) { vlog('VWCE.DEX: ' + e.message); }
        if (!done) {
          const cb = calib('ftse'), fx = EUR.latest.eurusd && EUR.latest.eurusd.p;
          if (!cb || !(fx > 0)) throw new Error('keine Kalibrierung oder kein EUR/USD');
          const q = await F.avQuote('VWRD.LON'); const d = q.priceTime ? q.priceTime.slice(0, 10) : TODAY, p = q.price / fx * cb.ratio;
          setLatest(a, d, p, sym, 'geschätzt: VWRD ' + de(q.price, 2) + ' $ / EURUSD ' + de(fx, 4) + ' × ' + de(cb.ratio, 4) + ' (kalibriert ' + cb.d + ')', { fallback: true, estimate: true }); upsertWeekly(a, d, p, dec);
        }
      } else if (a === 'gold') {
        const cb = calib('gold'), fx = EUR.latest.eurusd && EUR.latest.eurusd.p;
        if (!cb || !(fx > 0)) throw new Error('keine Kalibrierung oder kein EUR/USD');
        const pm = await F.lbma(CFG.assets.gold.signal.fix || 'pm'); const i = pm.dates.length - 1, p = pm.closes[i] / fx * cb.ratio;
        setLatest(a, pm.dates[i], p, sym, 'geschätzt: LBMA ' + de(pm.closes[i], 2) + ' $ / EURUSD ' + de(fx, 4) + ' × ' + de(cb.ratio, 5) + ' (kalibriert ' + cb.d + ')', { fallback: true, estimate: true }); upsertWeekly(a, pm.dates[i], p, dec);
      }
    } catch (e2) { RUN.summary.push('Euro-Kurs ' + sym + ' nicht aktualisiert (' + e2.message.slice(0, 90) + ')'); vlog('Ersatz ' + a + ': ' + e2.message); }
  }
  await dailyEur(order);
  EUR.updated = NOW.toISOString();
  saveJson('eur.json', EUR);
  RUN.changed = true;
  note('Euro-Kurse: ' + order.map((a) => a + ' ' + (EUR.latest[a] ? de(EUR.latest[a].p, a === 'eurusd' ? 4 : 2) + ' (' + ds(EUR.latest[a].d) + (EUR.latest[a].estimate ? ', geschätzt' : EUR.latest[a].fallback ? ', Ersatz' : '') + ')' : '–')).join(', '));
}

/* Tagesschlüsse in Euro für den Depotverlauf (eur.json: daily). Bitcoin über Coinbase, VWCE über Alpha Vantage (oder Yahoo-Tagesdaten),
   EUR/USD über die EZB, Gold-ETC als Schätzung aus LBMA / EURUSD × Kalibrierfaktor. Beim ersten Mal wird bis 2026-05-01 zurückgefüllt. */
function mergeDaily(a, dates, closes, dec) {
  EUR.daily = EUR.daily || {}; const map = {}; (EUR.daily[a] || []).forEach((r) => { map[r[0]] = r[1]; });
  for (let i = 0; i < dates.length; i++) if (closes[i] > 0) map[dates[i]] = round(closes[i], dec == null ? 4 : dec);
  const ks = Object.keys(map).sort().filter((d) => d >= '2026-05-01');
  EUR.daily[a] = ks.map((d) => [d, map[d]]);
}
async function dailyEur(keys) {
  EUR.daily = EUR.daily || {};
  const backfill = !(EUR.daily.btc && EUR.daily.btc.length > 30);
  const since = backfill ? '2026-05-01' : addDays(TODAY, -40);
  for (const a of keys) {
    try {
      if (a === 'eurusd') { const r = await F.ecbRange(since, TODAY); mergeDaily('eurusd', r.dates, r.closes, 6); }
      else if (a === 'btc') { const r = await F.coinbaseDays('BTC-EUR', backfill ? 150 : 40); mergeDaily('btc', r.dates.slice(0, -1), r.closes.slice(0, -1), 2); if (backfill && r.dates[0] > since) { const r2 = await F.coinbaseDays('BTC-EUR', 300); mergeDaily('btc', r2.dates.slice(0, -1), r2.closes.slice(0, -1), 2); } }
      else if (a === 'ftse') {
        if (RUN.yahooDailyFtse) mergeDaily('ftse', RUN.yahooDailyFtse.dates, RUN.yahooDailyFtse.closes, 4);
        else { const r = await F.avDaily('VWCE.DEX', backfill); mergeDaily('ftse', r.dates, r.closes, 4); }
      } else if (a === 'gold') {
        if (RUN.yahooDailyGold) mergeDaily('gold', RUN.yahooDailyGold.dates, RUN.yahooDailyGold.closes, 4);
        else { const cb = calib('gold'), fxm = {}; (EUR.daily.eurusd || []).forEach((r) => { fxm[r[0]] = r[1]; }); if (cb && Object.keys(fxm).length) { const pm = await F.lbma(CFG.assets.gold.signal.fix || 'pm'); const dates = [], closes = []; let lastFx = null; for (let i = 0; i < pm.dates.length; i++) { const d = pm.dates[i]; if (d < since) continue; if (fxm[d]) lastFx = fxm[d]; if (!lastFx) continue; dates.push(d); closes.push(pm.closes[i] / lastFx * cb.ratio); } mergeDaily('gold', dates, closes, 4); } }
      }
    } catch (e) { vlog('Tagesreihe ' + a + ': ' + e.message); RUN.summary.push('Tagesreihe ' + a + ' nicht aktualisiert (' + e.message.slice(0, 80) + ')'); }
  }
}

/* ---------- Live-Ticker (stündlich): aktuelle Kurse und Abstand zur Wochenschluss-Schwelle ----------
   Bitcoin und Gold laufend (Coinbase, gold-api), EUR/USD laufend (Coinbase-Wechselkurs), FTSE nur mit dem letzten Tagesschluss (Alpha Vantage, im eod-Lauf). */
function ruleNow(a, price) {
  const c = CFG.assets[a], stored = storedSeries(a);
  const cut = stored.k.map((k, i) => k < THIS_MON ? i : -1).filter((i) => i >= 0);
  const S = { k: cut.map((i) => stored.k[i]), d: cut.map((i) => stored.d[i]), c: cut.map((i) => stored.c[i]) };
  if (S.k.length < 60 || !(price > 0)) return null;
  const E = ENG.evalRule(S, c.rule), ft = ENG.flipThreshold(E, c.rule), E2 = ENG.whatIf(S, c.rule, TODAY, price);
  return { thr: round(ft.thr, 4), dist: round(price / ft.thr - 1, 6), can: ft.can, need: ft.need || null, st: E.last.st, would: E2.last.changed, wouldSt: E2.last.st, sma: round(E.last.m, 4), up: E2.last.up, dn: E2.last.dn, week: THIS_MON };
}
async function liveTick() {
  const prev = loadJson('live.json', { prices: {} }), out = { t: NOW.toISOString(), prices: {}, rule: {} };
  let fx = null;
  try { const r = await F.coinbaseFx('EUR', 'USD'); fx = { rate: round(r.rate, 6), src: r.src, t: NOW.toISOString() }; }
  catch (e) { try { const r = await F.ecb(); fx = { rate: round(r.price, 6), src: r.src, t: r.priceTime }; } catch (e2) { fx = EUR.latest && EUR.latest.eurusd ? { rate: EUR.latest.eurusd.p, src: EUR.latest.eurusd.src, t: EUR.latest.eurusd.t } : null; } }
  out.prices.eurusd = fx;
  try { const u = await F.coinbaseSpot('BTC-USD'), e = await F.coinbaseSpot('BTC-EUR'); out.prices.btc = { usd: round(u.price, 2), eur: round(e.price, 2), src: u.src, t: NOW.toISOString() }; }
  catch (e) { fail('Live Bitcoin', e.message); if (prev.prices && prev.prices.btc) out.prices.btc = prev.prices.btc; }
  try {
    let g = null; try { g = await F.goldSpot2(); } catch (e) { g = await F.goldSpot1(); }
    const cb = calib('gold');
    out.prices.gold = { usd: round(g.price, 2), eur: fx && cb ? round(g.price / fx.rate * cb.ratio, 4) : null, src: g.src, t: g.priceTime || NOW.toISOString(), spot: true };
  } catch (e) {
    fail('Live Gold', e.message);
    if (prev.prices && prev.prices.gold) out.prices.gold = prev.prices.gold;
  }
  /* FTSE: letzter Tagesschluss aus dem eod-Lauf (Alpha Vantage), sonst aus der Wochenreihe */
  if (prev.prices && prev.prices.ftse && prev.prices.ftse.usd > 0) out.prices.ftse = prev.prices.ftse;
  else { const S = storedSeries('ftse'), i = S.k.length - 1; out.prices.ftse = { usd: S.c[i], d: S.d[i], src: 'Wochenschluss', eod: true }; }
  if (fx && calib('ftse') && out.prices.ftse.usd > 0 && !(out.prices.ftse.eur > 0)) out.prices.ftse.eur = round(out.prices.ftse.usd / fx.rate * calib('ftse').ratio, 4);
  A.forEach((a) => { const p = out.prices[a]; const r = p && p.usd > 0 ? ruleNow(a, p.usd) : null; if (r) out.rule[a] = r; });
  saveJson('live.json', out);
  /* Depotbewertung mit den aktuellen Kursen (Wochenreihen bleiben unberührt) */
  EUR.latest = EUR.latest || {};
  if (out.prices.btc && out.prices.btc.eur > 0) EUR.latest.btc = { d: TODAY, p: out.prices.btc.eur, sym: CFG.assets.btc.eur.sym, src: out.prices.btc.src, t: NOW.toISOString(), fallback: true, live: true };
  if (out.prices.gold && out.prices.gold.eur > 0) EUR.latest.gold = { d: TODAY, p: out.prices.gold.eur, sym: CFG.assets.gold.eur.sym, src: 'geschätzt: Spot ' + de(out.prices.gold.usd, 2) + ' $ / EURUSD ' + de(fx.rate, 4) + ' × Kalibrierfaktor', t: NOW.toISOString(), fallback: true, estimate: true, live: true };
  if (fx) EUR.latest.eurusd = { d: TODAY, p: fx.rate, sym: CFG.fx.sym, src: fx.src, t: NOW.toISOString(), fallback: true, live: true };
  EUR.updated = NOW.toISOString(); saveJson('eur.json', EUR);
  RUN.changed = true;
  note('Live: ' + A.map((a) => { const p = out.prices[a], r = out.rule[a]; return p ? CFG.assets[a].short + ' ' + usd(a, p.usd) + (r ? ' (' + de(r.dist * 100, 1) + ' % zur Schwelle' + (r.would ? ', würde auslösen' : '') + ')' : '') : CFG.assets[a].short + ' –'; }).join(' · ') + (fx ? ' · EUR/USD ' + de(fx.rate, 4) : ''));
}
/* Letzter Tagesschluss VWRD (USD) für die Live-Anzeige, einmal am Tag */
async function ftseEod() {
  try {
    const r = await F.av('VWRD.LON'); const i = r.dates.length - 1;
    const live = loadJson('live.json', { prices: {}, rule: {} }); live.prices = live.prices || {};
    live.prices.ftse = { usd: round(r.closes[i], 4), d: r.dates[i], src: r.src, eod: true, t: NOW.toISOString() };
    const fx = live.prices.eurusd && live.prices.eurusd.rate; if (fx && calib('ftse')) live.prices.ftse.eur = round(r.closes[i] / fx * calib('ftse').ratio, 4);
    const rr = ruleNow('ftse', r.closes[i]); if (rr) { live.rule = live.rule || {}; live.rule.ftse = rr; }
    saveJson('live.json', live); RUN.changed = true;
    note('FTSE Tagesschluss ' + ds(r.dates[i]) + ': ' + usd('ftse', r.closes[i]));
  } catch (e) { RUN.summary.push('FTSE-Tagesschluss nicht aktualisiert (' + e.message.slice(0, 80) + ')'); }
}

/* ---------- Gegenprobe Gold (COMEX) ---------- */
async function goldCross() {
  const c = CFG.assets.gold;
  try {
    const g = await F.yahoo(c.cross.sym, { start: '2023-06-01' });
    const cutoff = (DOW >= 5 || (DOW === 4 && HOUR >= 17)) ? NEXT_MON : THIS_MON;
    const W = ENG.weeklyFromDaily(g.dates, g.closes, cutoff);
    const merged = ENG.mergeWeekly(storedSeries('goldf'), W, false);
    if (merged.k.length < 55) throw new Error('zu wenige Wochen');
    const E = ENG.evalRule(merged, c.rule);
    WEEKLY.goldf = { a: 'goldf', src: g.src, note: 'COMEX-Gold-Future GC=F, nur zur Gegenprobe', updated: NOW.toISOString(), w: ENG.toRows(merged, 2) };
    saveJson('weekly/goldf.json', WEEKLY.goldf);
    STATE.cross = STATE.cross || {};
    STATE.cross.goldf = summarizeAsset('gold', E, { src: g.src });
    RUN.changed = true;
    note('COMEX-Gold ' + ds(E.last.d) + ': ' + usd('gold', E.last.c) + ', ' + (E.last.st ? 'investiert' : 'Cash'));
  } catch (e) { RUN.summary.push('Gegenprobe COMEX nicht möglich (' + e.message.slice(0, 80) + ')'); vlog('Gegenprobe Gold: ' + e.message); }
}

/* ---------- Wochenübersicht (Montag) ---------- */
function weeklySummary() {
  if (!CFG.push.weeklySummary) return;
  const id = 'week-' + THIS_MON;
  if (EVENTS.some((e) => e.id === id)) return;
  const parts = A.map((a) => { const s = STATE.assets[a]; return s ? CFG.assets[a].short + ' ' + (s.st ? 'investiert' : 'Cash') : null; }).filter(Boolean);
  const sig = EVENTS.filter((e) => (e.kind === 'kauf' || e.kind === 'verkauf') && e.k >= addDays(THIS_MON, -7));
  const pend = A.filter((a) => STATE.assets[a] && STATE.assets[a].pending).map((a) => name(a));
  let body = parts.join(' · ') + '. ' + (sig.length ? sig.map((e) => e.title).join('; ') + '.' : 'Keine neuen Signale.');
  (CFG.oneTimeHints || []).forEach((h) => { if (h.date === TODAY && STATE.assets[h.asset] && STATE.assets[h.asset].st === h.ifState) body += ' ' + h.text; });
  if (pend.length) body += ' Noch offen: ' + pend.join(', ') + '.';
  addEvent({ id, kind: 'info', a: null, k: THIS_MON, d: TODAY, title: 'Wochenstart ' + ds(THIS_MON), text: body });
  queuePush({ id, title: 'Regel-Depot · Wochenstart ' + ds(THIS_MON), body, tag: 'week', url: './#status', ts: NOW.toISOString() });
}

/* ---------- Schritt bestimmen ---------- */
function autoStep() {
  if (DOW === 4 && HOUR < 16) return 'fr-warn';
  if (DOW === 4) return 'fr-close';
  if (DOW === 5) return 'fr-close';
  if (DOW === 6) return 'so-warn';
  if (DOW === 0 && HOUR < 4) return 'mo-close';
  if (DOW === 0 && HOUR < 9) return 'mo-notify';
  return 'live';
}

/* ---------- Hauptprogramm ---------- */
async function main() {
  const step = OPT.step === 'auto' ? autoStep() : OPT.step;
  RUN.step = step;
  log('Regel-Depot Update · ' + NOW.toISOString() + ' · Schritt ' + step + (OPT.final ? ' (letzter Versuch)' : '') + (OPT.mock ? ' · Mock ' + OPT.mock : ''));
  STATE.assets = STATE.assets || {}; STATE.queue = STATE.queue || [];
  let flush = true;
  try {
    if (step === 'init') {
      /* Zustand aus den gespeicherten Serien berechnen, ohne Abruf */
      A.forEach((a) => { const S = storedSeries(a); const E = ENG.evalRule(S, CFG.assets[a].rule); STATE.assets[a] = summarizeAsset(a, E, { src: (WEEKLY[a] && WEEKLY[a].src) || '', fallback: false, pending: null }); note(name(a) + ': ' + ds(E.last.d) + ' ' + usd(a, E.last.c) + ' ' + (E.last.st ? 'investiert' : 'Cash')); });
      RUN.changed = true; flush = false;
    } else if (step === 'fr-warn') {
      for (const a of ['ftse', 'gold']) { try { await warnAsset(a, await currentPrice(a)); } catch (e) { fail(name(a), 'Vorwarnung: ' + e.message); } }
    } else if (step === 'fr-close') {
      await closeAsset('ftse');
      await eurQuotes(['ftse', 'gold', 'btc', 'eurusd']);
      await ftseEod();
      await liveTick();
    } else if (step === 'so-warn') {
      try { await warnAsset('btc', await currentPrice('btc')); } catch (e) { fail(name('btc'), 'Vorwarnung: ' + e.message); }
    } else if (step === 'mo-close') {
      await closeAsset('btc'); await closeAsset('gold');
      if (STATE.assets.ftse && STATE.assets.ftse.pending) await closeAsset('ftse');
      await goldCross();
      await eurQuotes(['btc', 'eurusd']);
      if (OPT.final) { A.forEach((a) => { const p = STATE.assets[a] && STATE.assets[a].pending; if (p) { const id = 'err-' + a + '-' + p.k; if (addEvent({ id, kind: 'fehler', a, k: p.k, d: TODAY, title: name(a) + ': Wochenschluss fehlt', text: p.reason + '. Die Seite zeigt den Stand der Vorwoche; die nächsten Läufe versuchen es weiter.' })) queuePush({ id, title: 'Regel-Depot: ' + name(a) + ' ohne Wochenschluss', body: p.reason + '. Es wird weiter versucht.', tag: 'err-' + a, url: './#signale', ts: NOW.toISOString() }); } }); }
      flush = false;                                                   /* Nachts nicht pushen, das macht mo-notify */
    } else if (step === 'mo-notify') {
      for (const a of A) { if (STATE.assets[a] && STATE.assets[a].pending) await closeAsset(a); }
      weeklySummary();
    } else if (step === 'live') {
      await liveTick(); flush = false;
    } else if (step === 'eod') {
      for (const a of A) { if (STATE.assets[a] && STATE.assets[a].pending) await closeAsset(a); }
      await eurQuotes(['ftse', 'gold', 'btc', 'eurusd']);
      await ftseEod();
      await liveTick();
    } else if (step === 'all') {
      for (const a of A) await closeAsset(a);
      await goldCross();
      await eurQuotes(['ftse', 'gold', 'btc', 'eurusd']);
    } else if (step === 'test-sources') {
      /* Alle Quellen einmal anfassen; nur runs.json wird geschrieben */
      const probes = [
        ['Yahoo BTC-USD 5d', async () => { const r = await F.yahoo('BTC-USD', { range: '5d' }); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 0) + ' (aktuell ' + de(r.price, 0) + ')'; }],
        ['LBMA Gold PM', async () => { const r = await F.lbma('pm'); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }],
        ['LBMA Gold AM', async () => { const r = await F.lbma('am'); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2); }],
        ['Coinbase BTC-USD daily', async () => { const r = await F.coinbase('BTC-USD'); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }],
        ['Coinbase BTC-EUR daily', async () => { const r = await F.coinbase('BTC-EUR'); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2); }],
        ['goldprice.org XAU/USD', async () => { const r = await F.goldSpot1(); return de(r.price, 2) + ' ' + (r.priceTime || ''); }],
        ['gold-api.com XAU/USD', async () => { const r = await F.goldSpot2(); return de(r.price, 2) + ' ' + (r.priceTime || ''); }],
        ['EZB EUR/USD', async () => { const r = await F.ecb(); return r.dates[0] + ' ' + de(r.price, 4); }],
        ['Alpha Vantage VWRD.LON weekly adj', async () => { const r = await F.av('VWRD.LON'); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 4) + ' (' + r.dates.length + ' Wochen)'; }],
        ['Alpha Vantage VWRD.LON quote', async () => { const r = await F.avQuote('VWRD.LON'); return de(r.price, 2) + ' ' + (r.priceTime || ''); }],
        ['Alpha Vantage VWCE.DEX quote', async () => { const r = await F.avQuote('VWCE.DEX'); return de(r.price, 2) + ' ' + (r.priceTime || ''); }],
        ['Alpha Vantage BTC-USD daily', async () => { const r = await F.avCrypto('BTC', 'USD'); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }]
      ];
      for (const [label, fn] of probes) { try { note('OK ' + label + ': ' + await fn()); } catch (e) { RUN.summary.push('FEHLT ' + label + ': ' + e.message.slice(0, 120)); log('! ' + label + ': ' + e.message); } }
      RUN.ok = true; flush = false;
    } else if (step === 'test-push') {
      queuePush({ id: 'test-' + NOW.toISOString(), title: 'Regel-Depot: Test', body: 'Push funktioniert. ' + NOW.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) + ' Uhr.', tag: 'test', url: './#signale', ts: NOW.toISOString() });
    } else { throw new Error('unbekannter Schritt ' + step); }
  } catch (e) { fail(null, e); }
  if (flush) await flushQueue();
  /* Zustand und Protokoll schreiben */
  STATE.updated = NOW.toISOString(); STATE.step = step; STATE.version = 1;
  STATE.pendingQueue = (STATE.queue || []).length;
  saveJson('state.json', STATE, true);
  while (EVENTS.length > 400) EVENTS.shift();
  saveJson('events.json', EVENTS);
  RUNS.unshift({ t: RUN.t, step, ok: RUN.ok, summary: RUN.summary.join(' | '), errors: RUN.errors, notified: RUN.notified, final: OPT.final });
  while (RUNS.length > 60) RUNS.pop();
  saveJson('runs.json', RUNS);
  if (SRC.yahooStatus && SRC.yahooStatus.calls) { RUN.yahoo = { calls: SRC.yahooStatus.calls, failures: SRC.yahooStatus.failures, blocked: SRC.yahooStatus.blocked }; RUNS[0].yahoo = RUN.yahoo; saveJson('runs.json', RUNS); }
  log((RUN.ok ? 'OK' : 'MIT FEHLERN') + ' · ' + RUN.summary.length + ' Punkte · ' + RUN.errors.length + ' Fehler' + (RUN.yahoo ? ' · Yahoo ' + RUN.yahoo.calls + ' Abrufe, ' + RUN.yahoo.failures + ' Fehler' + (RUN.yahoo.blocked ? ', gesperrt' : '') : ''));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'ok=' + (RUN.ok ? 'true' : 'false') + '\nsummary=' + RUN.summary.join(' | ').replace(/\n/g, ' ').slice(0, 900) + '\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
