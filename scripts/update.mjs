#!/usr/bin/env node
/* Regel-Depot 50/30/20 – Update-Skript für GitHub Actions
   Holt Kurse (Signale in US-Dollar: Alpha Vantage und EODHD für den FTSE, Coinbase für Bitcoin, LBMA für Gold; Euro-Kurse für die
   Depotbewertung: Lang & Schwarz, Coinbase, EZB; Ersatzquellen Kraken, Yahoo, gold-api), bildet Wochenschlüsse, rechnet die Regeln,
   schreibt docs/data/*.json, sammelt Ereignisse und schickt Web-Push-Nachrichten.

   Aufruf: node scripts/update.mjs --step <auto|live|fr-warn|fr-close|sa-close|so-warn|mo-close|mo-notify|eod|all|init|test-sources|test-eodhd|test-push>
           [--final] [--fallback] [--now 2026-09-28T00:30:00Z] [--mock <ordner>] [--dry] [--verbose]
   Umgebung: VAPID_PRIVATE_KEY, PUSH_SUB_1 … PUSH_SUB_5 (Subscription-JSON), ALPHAVANTAGE_KEY, EODHD_KEY, PUSH_SENT_FILE (Workflow) */
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

/* ---------- Geheimnisse nie in Dateien oder Commit-Nachrichten ----------
   Fehlertexte der Quellen können den API-Key enthalten (Alpha Vantage nennt ihn in der Limit-Meldung). Alles, was in docs/data
   (öffentlich) oder in die Commit-Nachricht geht, läuft durch mask(). */
const SECRETS = [process.env.ALPHAVANTAGE_KEY, process.env.EODHD_KEY, process.env.VAPID_PRIVATE_KEY].filter((s) => s && s.length >= 4);
function mask(s) {
  let t = String(s == null ? '' : s);
  for (const k of SECRETS) t = t.split(k).join('***');
  return SRC.hideKey(t);
}

/* ---------- Dateien ---------- */
function loadJson(rel, fallback) { const p = path.join(DATA, rel); if (!fs.existsSync(p)) return fallback; return JSON.parse(fs.readFileSync(p, 'utf8')); }
function saveJson(rel, obj, pretty) { const p = path.join(DATA, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, mask(pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj))); }

const CFG = loadJson('config.json');
const A = Object.keys(CFG.assets);
const ALTS = (CFG.alts && CFG.alts.list) || []; /* Krypto-Beimischung (ETH, SOL): nur Euro-Kurse für die Depotbewertung, kein Signal */
const STATE = loadJson('state.json', { version: 1, updated: null, assets: {}, cross: {}, warn: {}, queue: [] });
const EVENTS = loadJson('events.json', []);
const RUNS = loadJson('runs.json', []);
const EUR = loadJson('eur.json', { weekly: {}, latest: {} });
const WEEKLY = {}; A.concat(['goldf']).forEach((a) => { WEEKLY[a] = loadJson('weekly/' + a + '.json', null); });

/* ---------- Zeit ---------- */
const iso = ENG.iso, addDays = ENG.addDays, mondayOf = ENG.mondayOf;
const TODAY = iso(NOW.getTime()), THIS_MON = mondayOf(TODAY), DOW = (NOW.getUTCDay() + 6) % 7, HOUR = NOW.getUTCHours() + NOW.getUTCMinutes() / 60;
const NEXT_MON = addDays(THIS_MON, 7);
/* ---------- Handelskalender ----------
   Börse London und LBMA: keine Kurse am Wochenende und an englischen Bankfeiertagen (berechnet mit ENG.ukHolidays), dazu einmalige Sondertage
   (config holidays.extra, auch die ältere Liste holidays.fridays). Gold zusätzlich: am letzten Geschäftstag vor Weihnachten und vor Neujahr gibt es
   kein Nachmittagsfixing (isEve; weitere Tage in holidays.lbmaNoPm). Die Londoner Börse handelt an diesen Tagen verkürzt bis 12:30 Uhr. */
const HOLI = {};
function isUkHoliday(d) {
  const y = +d.slice(0, 4), H = CFG.holidays || {};
  if (!HOLI[y]) HOLI[y] = new Set(ENG.ukHolidays(y));
  if ((H.notHolidays || []).includes(d)) return false;
  return HOLI[y].has(d) || (H.extra || []).includes(d) || (H.fridays || []).includes(d);
}
function lseDay(d) { const w = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; return w < 5 && !isUkHoliday(d); }
/* Letzter Londoner Geschäftstag vor Weihnachten und vor Neujahr: kein LBMA-Nachmittagsfixing, Börse bis 12:30 Uhr. Meist 24.12./31.12.; fallen
   die aufs Wochenende, ist es der Freitag davor (weekly/gold.json: 2011, 2016, 2017, 2022 und 2023 enden diese Wochen donnerstags). */
const EVE = {};
function lastBizBefore(d) { let x = addDays(d, -1); while (!lseDay(x)) x = addDays(x, -1); return x; }
function isEve(d) { const y = +d.slice(0, 4); if (!EVE[y]) EVE[y] = new Set([lastBizBefore(y + '-12-25'), lastBizBefore((y + 1) + '-01-01')]); return EVE[y].has(d); }
function isTradingDay(a, d) {
  if (!lseDay(d)) return false;
  if (a === 'gold' && (isEve(d) || ((CFG.holidays && CFG.holidays.lbmaNoPm) || []).some((x) => x === d || x === d.slice(5)))) return false;
  return true;
}
/* Letzter Handelstag der Woche (Montag k): Freitag, bei Feiertag der Tag davor usw. */
function lastTradingDay(a, k) { for (let i = 4; i >= 0; i--) { const d = addDays(k, i); if (isTradingDay(a, d)) return d; } return null; }
function prevTradingDay(a, d, k) { for (let x = addDays(d, -1); x >= k; x = addDays(x, -1)) if (isTradingDay(a, x)) return x; return k; }
const halfDay = (d) => isEve(d);   /* Londoner Börse schließt um 12:30 Uhr */
/* Londoner Ortszeit (Sommer-/Winterzeit): die Börse schließt 16:30, die Schlussauktion endet 16:35 */
function localParts(tz) { const parts = {}; new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(NOW).forEach((x) => { parts[x.type] = x.value; }); return { dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), hour: ((+parts.hour) % 24) + (+parts.minute) / 60 }; }
const LONDON = localParts('Europe/London'), LONDON_HOUR = LONDON.hour, LONDON_DOW = LONDON.dow;
/* Berliner Ortszeit: Die Push-Zeit am Montag hat Justus in Berliner Zeit festgelegt (config push.mondayAt, 7:53 Uhr) */
const BERLIN = localParts('Europe/Berlin');
const MON_PUSH = (() => { const m = /^(\d{1,2}):(\d{2})$/.exec((CFG.push && CFG.push.mondayAt) || '07:53'); return m ? +m[1] + (+m[2]) / 60 : 7 + 53 / 60; })();
/* Freitag nach dem Londoner Schluss ist die laufende Woche fällig. Im Sommer ist es in London zwischen 23 und 24 Uhr UTC schon Samstag,
   während UTC noch Freitag zeigt: auch dann gilt die Woche als geschlossen (sonst würde ein offener Wochenschluss verworfen). */
const FRI_CLOSED = DOW === 4 && (LONDON_DOW !== 4 || LONDON_HOUR >= 16.67);

/* ---------- Formatierung (Meldungstexte) ---------- */
const de = (x, d) => (+x).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (a, x) => de(x, CFG.assets[a] ? CFG.assets[a].dec : 2) + ' $';
const ds = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.';
const dDE = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);
const name = (a) => CFG.assets[a].name;

/* ---------- Ergebnis eines Laufs ---------- */
const RUN = { t: NOW.toISOString(), step: OPT.step, ok: true, summary: [], errors: [], notified: 0, changed: false };
function note(s) { s = mask(s); RUN.summary.push(s); log('· ' + s); }
function fail(a, e) { const msg = mask((a ? a + ': ' : '') + (e && e.message ? e.message : String(e))); RUN.errors.push(msg); RUN.ok = false; log('! ' + msg); }

/* ---------- Ereignisse und Push-Warteschlange ---------- */
function addEvent(ev) {
  if (EVENTS.some((e) => e.id === ev.id)) return false;
  EVENTS.push({ t: NOW.toISOString(), ...ev });
  RUN.changed = true;
  return true;
}
/* Zweiter Anlauf nach einem Git-Konflikt (Workflow): Nachrichten, die der erste Anlauf schon zugestellt hat, stehen in PUSH_SENT_FILE und werden nicht noch einmal verschickt */
const SENT_FILE = process.env.PUSH_SENT_FILE || '';
function sentBefore() { try { return SENT_FILE && fs.existsSync(SENT_FILE) ? JSON.parse(fs.readFileSync(SENT_FILE, 'utf8')) : []; } catch (e) { return []; } }
function rememberSent(ids) { if (!SENT_FILE || !ids.length) return; try { fs.writeFileSync(SENT_FILE, JSON.stringify([...new Set(sentBefore().concat(ids))])); } catch (e) { /* nur Komfort */ } }
function queuePush(p) { STATE.queue = STATE.queue || []; if (STATE.queue.some((q) => q.id === p.id)) return; if (sentBefore().includes(p.id)) { log('Push ' + p.id + ' wurde im ersten Anlauf schon zugestellt'); return; } STATE.queue.push(p); RUN.changed = true; }
function subscriptions() {
  const out = [];
  for (let i = 1; i <= (CFG.push.maxSubscriptions || 5); i++) { const s = process.env['PUSH_SUB_' + i]; if (s && s.trim().startsWith('{')) { try { out.push({ n: i, sub: JSON.parse(s) }); } catch (e) { fail('Push', 'PUSH_SUB_' + i + ' ist kein gültiges JSON'); } } }
  return out;
}
async function flushQueue() {
  /* Nachrichten, die seit einer Woche nicht zugestellt werden konnten, verfallen (sonst würden sie ewig wiederholt) */
  const old = (STATE.queue || []).filter((p) => p.ts && Date.parse(p.ts) < NOW.getTime() - 7 * 864e5);
  if (old.length) { STATE.queue = STATE.queue.filter((p) => !old.includes(p)); RUN.changed = true; note('Push: ' + old.length + ' Nachricht(en) älter als 7 Tage verworfen (' + old.map((p) => p.title).join(' | ').slice(0, 120) + ')'); }
  const q = STATE.queue || [];
  if (!q.length) return;
  if (OPT.dry) { note('Push (Probelauf): ' + q.map((p) => p.title).join(' | ')); STATE.queue = []; RUN.changed = true; return; }
  const subs = subscriptions(), priv = process.env.VAPID_PRIVATE_KEY;
  if (!subs.length || !priv) { note('Push: ' + q.length + ' Nachricht(en) bleiben in der Warteschlange (' + (!priv ? 'VAPID_PRIVATE_KEY fehlt' : 'keine Push-Anmeldung hinterlegt') + ')'); return; }
  const vapid = { subject: CFG.push.subject, publicKey: CFG.push.vapidPublicKey, privateKey: priv };
  const keep = [], sentIds = [], before = sentBefore();
  for (const p of q) {
    if (before.includes(p.id)) { log('Push ' + p.id + ' wurde im ersten Anlauf schon zugestellt'); continue; }
    let sent = 0, gone = 0;
    for (const s of subs) {
      try { const r = await sendPush(s.sub, { title: p.title, body: p.body, url: p.url || './', tag: p.tag || p.id, ts: p.ts || NOW.toISOString() }, vapid, { topic: (p.tag || 'rd').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined });
        if (r.ok) sent++; else if (r.gone) { gone++; fail('Push', 'Anmeldung PUSH_SUB_' + s.n + ' ist abgelaufen (HTTP ' + r.status + '), bitte auf der Seite neu einrichten'); } else fail('Push', 'PUSH_SUB_' + s.n + ' HTTP ' + r.status + ' ' + r.text); }
      catch (e) { fail('Push', 'PUSH_SUB_' + s.n + ': ' + e.message); }
    }
    if (sent) { RUN.notified += sent; sentIds.push(p.id); } else if (!gone && subs.length) { keep.push(p); }
  }
  rememberSent(sentIds);
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
const AVKEY = process.env.ALPHAVANTAGE_KEY || '', EODKEY = process.env.EODHD_KEY || '';
const AVMEMO = {}, LSMEMO = {}, LBMAMEMO = {};
const F = {
  yahoo: (sym, opts) => OPT.mock ? fetchMock('yahoo_' + sym) : SRC.yahooDaily(sym, opts),
  lbma: (fix) => LBMAMEMO[fix] || (LBMAMEMO[fix] = OPT.mock ? fetchMock('lbma_' + fix) : SRC.lbmaGold(fix)), /* je Lauf einmal (auch ein Fehlschlag gilt für den ganzen Lauf) */
  coinbase: (p) => OPT.mock ? fetchMock('coinbase_' + p) : SRC.coinbaseDaily(p, 60),
  coinbaseSpot: (p) => OPT.mock ? fetchMock('coinbasespot_' + p) : SRC.coinbaseSpot(p),
  av: (sym) => AVMEMO[sym] || (AVMEMO[sym] = OPT.mock ? fetchMock('av_' + sym) : SRC.alphaVantageWeeklyAdjusted(sym, AVKEY)), /* je Lauf nur einmal laden */
  avCrypto: (sym, mkt) => OPT.mock ? fetchMock('avcrypto_' + sym) : SRC.alphaVantageCryptoDaily(sym, mkt, AVKEY),
  avQuote: (sym) => OPT.mock ? fetchMock('avquote_' + sym) : SRC.alphaVantageQuote(sym, AVKEY),
  avDaily: (sym, full) => OPT.mock ? fetchMock('avdaily_' + sym) : SRC.alphaVantageDaily(sym, AVKEY, full),
  ecbRange: (from, to) => OPT.mock ? fetchMock('ecbrange') : SRC.ecbEurUsdRange(from, to),
  coinbaseDays: (p, days) => OPT.mock ? fetchMock('coinbase_' + p) : SRC.coinbaseDaily(p, days),
  coinbaseFx: (b, q) => OPT.mock ? fetchMock('coinbasefx_' + b + q) : SRC.coinbaseFx(b, q),
  goldSpot1: () => OPT.mock ? fetchMock('goldprice') : SRC.goldSpotGoldpriceOrg(),
  goldSpot2: () => OPT.mock ? fetchMock('goldapi') : SRC.goldSpotGoldApi(),
  ecb: () => OPT.mock ? fetchMock('ecb') : SRC.ecbEurUsd(),
  eodhd: (sym, from) => OPT.mock ? fetchMock('eodhd_' + sym) : SRC.eodhdDaily(sym, EODKEY, from),
  eodhdLive: (sym) => OPT.mock ? fetchMock('eodhdlive_' + sym) : SRC.eodhdLive(sym, EODKEY),
  ls: (id, label) => LSMEMO[id] || (LSMEMO[id] = OPT.mock ? fetchMock('ls_' + id) : SRC.lsChart(id, label)), /* Lang & Schwarz, je Lauf einmal */
  lsSearch: (q) => OPT.mock ? fetchMock('lssearch_' + q) : SRC.lsSearch(q),
  kraken: (pair, days) => OPT.mock ? fetchMock('kraken_' + pair) : SRC.krakenDaily(pair, days || 60),
  krakenTicker: (pair) => OPT.mock ? fetchMock('krakenticker_' + pair) : SRC.krakenTicker(pair)
};
const KRAKEN_PAIR = { 'BTC-USD': 'XBTUSD', 'BTC-EUR': 'XBTEUR', 'ETH-EUR': 'ETHEUR', 'SOL-EUR': 'SOLEUR' };
/* Hauptquellen laut config (Alpha Vantage für den FTSE, Coinbase für Bitcoin, LBMA für Gold). Weitere Quellen (Kraken, Yahoo, Alpha-Vantage-Krypto)
   erst im zweiten Anlauf; geprüft: Alpha Vantage weicht von Yahoo seit 2014 unter 0,01 % ab, Coinbase von Yahoo im Mittel 0,05 %. */
const STEP0 = OPT.step;
let ALLOW_FB = OPT.final || OPT.fallback || ['mo-notify', 'eod', 'all'].includes(STEP0);   /* der Ticker setzt es beim Nachholen von mo-notify */
async function firstOk(label, tries) {
  const errs = [];
  for (const t of tries) { try { const r = await t(); if (r) return r; } catch (e) { errs.push((t.name || '?') + ': ' + e.message); vlog(label + ' · ' + errs[errs.length - 1]); } }
  throw new Error(errs.join(' | '));
}

/* Signalreihe einer Anlage laden: {daily (Tages- oder Wochenpunkte), src, fallback, weeklyAlready, preliminary} */
const START = { ftse: '2012-05-01', btc: '2014-09-15' };
/* Ungültige Punkte (null, NaN, 0, kaputtes Datum) entfernen: Sie zählten sonst als vorhandener Schluss, und die Woche fehlte still */
function cleanDaily(r) {
  if (!r || !Array.isArray(r.dates) || !Array.isArray(r.closes)) throw new Error('Kursreihe fehlt oder ist ungültig');
  const dates = [], closes = [], raw = Array.isArray(r.raw) ? [] : null;
  for (let i = 0; i < r.dates.length; i++) {
    const d = r.dates[i], c = r.closes[i];
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || c == null || c === '' || !isFinite(+c) || !(+c > 0)) continue;
    dates.push(d); closes.push(+c); if (raw) raw.push(r.raw[i]);
  }
  if (dates.length < r.dates.length) vlog('Kursreihe ' + (r.src || '') + ': ' + (r.dates.length - dates.length) + ' ungültige Punkte verworfen');
  return Object.assign({}, r, { dates, closes, raw: raw || r.raw });
}
/* Londoner Ortszeit eines Zeitpunkts: Datum, Wochentag (Mo = 0), Minuten seit Mitternacht */
function londonAt(t) {
  const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date(t)).forEach((x) => { p[x.type] = x.value; });
  return { d: p.year + '-' + p.month + '-' + p.day, dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday), m: ((+p.hour) % 24) * 60 + (+p.minute) };
}
/* Liegt ein Kurszeitpunkt nach der Londoner Schlussauktion des Tages day (16:35 Uhr Ortszeit, am 24.12./31.12. 12:35 Uhr)? Im Winter ist der
   um 15–20 Minuten verzögerte EODHD-Kurs kurz nach dem Schluss noch von vor der Auktion und taugt nicht als Schluss. */
function afterAuction(t, day) { if (!t) return false; const L = londonAt(t), end = halfDay(day) ? 12 * 60 + 35 : 16 * 60 + 35; return L.d > day || (L.d === day && L.m >= end); }
/* Schluss vom letzten Handelstag der fälligen Woche ergänzen, wenn die Wochenreihe r ihn noch nicht hat (nur nach dem Londoner Schluss).
   Kurse zählen nur mit genau diesem Datum (ein Montagskurs ist kein Freitagsschluss): EODHD-Tagesschluss (endgültig), EODHD-Live-Kurs nach der
   Schlussauktion (vorläufig), Alpha-Vantage-Quote ab 17 Uhr London (vorläufig; das Quote trägt keine Uhrzeit).
   scale: Faktor, mit dem Rohkurse auf die Basis der Reihe gebracht werden (EODHD-Ersatzreihe). */
async function addFridayClose(r, opts) {
  opts = opts || {};
  const dueK = addDays(dueCutoff('ftse'), -7), day = lastTradingDay('ftse', dueK), i = r.dates.length - 1, afterClose = TODAY > addDays(dueK, 4) || FRI_CLOSED, scale = opts.scale || 1;
  if (!day || !afterClose || (i >= 0 && r.dates[i] >= day)) return r;
  const put = (d, p, label, prelim) => { if (i >= 0 && mondayOf(r.dates[i]) === dueK) { r.dates[i] = d; r.closes[i] = p * scale; } else { r.dates.push(d); r.closes.push(p * scale); } r.src += ' + Schlusskurs ' + d + ' ' + label; r.preliminary = prelim ? d : null; r.prelimLabel = prelim ? label.replace(/^(aus dem|von) /, '').replace(/ \(vorläufig\)$/, '') : null; vlog('FTSE: Wochenschluss ' + d + ' ' + label + ': ' + p); };
  let done = false;
  if (EODKEY || OPT.mock) {
    /* EODHD veröffentlicht den Londoner Tagesschluss meist ein bis zwei Stunden nach Handelsschluss: endgültiger Kurs */
    if (!opts.skipEod) { try { const e = await F.eodhd('VWRD.LSE', dueK); const k = e.dates.indexOf(day); if (k >= 0 && e.closes[k] > 0) { put(day, e.closes[k], 'von EODHD (Tagesschluss)', false); done = true; } else vlog('FTSE: EODHD hat den ' + day + ' noch nicht (letzter Tag ' + e.dates[e.dates.length - 1] + ')'); } catch (e) { vlog('EODHD: ' + e.message); } }
    if (!done) { try { const l = await F.eodhdLive('VWRD.LSE'), ld = l.priceTime.slice(0, 10); if (ld === day && l.price > 0 && afterAuction(l.priceTime, day)) { put(ld, l.price, 'aus dem EODHD-Live-Kurs (vorläufig)', true); done = true; } else vlog('FTSE: EODHD-Live-Kurs vom ' + l.priceTime + ' passt nicht (nötig: ' + day + ' nach der Schlussauktion)'); } catch (e) { vlog('EODHD live: ' + e.message); } }
  }
  if (!done && !opts.noQuote) {
    const Ln = londonAt(NOW), quoteOk = Ln.d > day || (Ln.d === day && Ln.m >= (halfDay(day) ? 13 : 17) * 60);
    if (quoteOk) { try { const q = await F.avQuote('VWRD.LON'), qd = q.priceTime ? q.priceTime.slice(0, 10) : null; if (qd === day && q.price > 0) put(qd, q.price, 'aus dem Alpha-Vantage-Quote (vorläufig)', true); else vlog('FTSE: Quote vom ' + qd + ', nötig ' + day); } catch (e) { vlog('Alpha-Vantage-Quote: ' + e.message); } }
    else vlog('FTSE: Quote erst ab ' + (halfDay(day) ? 13 : 17) + ' Uhr London');
  }
  return r;
}
/* Wochenschluss von Alpha Vantage: bereinigte Wochenreihe; den frischen Freitagsschluss trägt Alpha Vantage oft erst Stunden nach
   Börsenschluss ein, deshalb wird er, wenn er noch fehlt, ergänzt (addFridayClose). */
async function avSignalFtse() {
  const r = cleanDaily(await F.av('VWRD.LON')); RUN.avWeeklyFtse = r;
  await addFridayClose(r);
  return { daily: r, src: r.src, weeklyAlready: true, preliminary: r.preliminary || null, prelimLabel: r.prelimLabel || null };
}
/* Ersatz, wenn Alpha Vantage nicht liefert: EODHD-Tagesschlüsse (bereinigt) zu Wochen, nur die Wochen nach der gespeicherten Reihe.
   Sie werden über das Verhältnis in der jüngsten gemeinsamen Woche an die gespeicherte Alpha-Vantage-Reihe angeglichen, damit eine
   Ausschüttung dazwischen die Reihe nicht versetzt. Sobald Alpha Vantage wieder liefert, ersetzt dessen Reihe diese Wochen. */
async function eodhdSignalFtse() {
  if (!EODKEY && !OPT.mock) throw new Error('kein EODHD-Key');
  const stored = storedSeries('ftse'); if (!stored.k.length) throw new Error('keine gespeicherte Reihe zum Angleichen');
  const lastK = stored.k[stored.k.length - 1], e = await F.eodhd('VWRD.LSE', addDays(lastK, -28));
  const W = ENG.weeklyFromDaily(e.dates, (e.adj || e.closes).map((x) => +x), null);
  let f = null, refK = null;
  for (let i = W.k.length - 1; i >= 0 && f == null; i--) { const j = stored.k.indexOf(W.k[i]); if (j >= 0 && W.c[i] > 0 && stored.c[j] > 0) { f = stored.c[j] / W.c[i]; refK = W.k[i]; } }
  if (f == null) throw new Error('keine gemeinsame Woche mit der gespeicherten Reihe');
  const idx = W.k.map((k, i) => (k > lastK ? i : -1)).filter((i) => i >= 0);
  const r = { dates: idx.map((i) => W.d[i]), closes: idx.map((i) => W.c[i] * f), src: 'eodhd VWRD.LSE bereinigt, angeglichen an die gespeicherte Reihe (Faktor ' + f.toFixed(5) + ', Woche ' + refK + ')' };
  await addFridayClose(r, { scale: f, skipEod: true, noQuote: true });
  return { daily: r, src: r.src, weeklyAlready: true, preliminary: r.preliminary || null, prelimLabel: r.prelimLabel || null };
}
/* Quellenkette je Anlage: erste = Hauptquelle laut config, die weiteren erst im zweiten Anlauf (ALLOW_FB) */
function signalChain(a) {
  const c = CFG.assets[a];
  if (a === 'ftse') {
    const yahoo = async function yahoo() { const r = await F.yahoo('VWRD.L', { adj: true, start: START.ftse }); return { daily: r, src: r.src }; };
    const eodhd = async function eodhd() { return eodhdSignalFtse(); };
    return c.signal.src === 'yahoo' ? [yahoo, avSignalFtse, eodhd] : [avSignalFtse, eodhd, yahoo];
  }
  if (a === 'btc') {
    const chain = {
      coinbase: async function coinbase() { const r = await F.coinbase('BTC-USD'); return { daily: r, src: r.src }; },
      kraken: async function kraken() { const r = await F.kraken('XBTUSD', 60); return { daily: r, src: r.src }; },
      yahoo: async function yahoo() { const r = await F.yahoo('BTC-USD', { adj: false, start: START.btc }); return { daily: r, src: r.src }; },
      alphavantage: async function alphaVantage() { const r = await F.avCrypto('BTC', 'USD'); return { daily: r, src: r.src }; }
    };
    const first = chain[c.signal.src] || chain.coinbase;
    return [first].concat(Object.keys(chain).map((k) => chain[k]).filter((f) => f !== first));
  }
  return [];
}
async function loadSignalSeries(a) {
  const c = CFG.assets[a];
  if (c.signal.src === 'lbma') {
    const r = cleanDaily(await F.lbma(c.signal.fix || 'pm'));
    return { daily: r, src: r.src, fallback: false };
  }
  const chain = signalChain(a);
  const clean = (r) => Object.assign(r, { daily: cleanDaily(r.daily) });
  let primaryError = null;
  try { const r = clean(await chain[0]()); return Object.assign({ fallback: false }, r); }
  catch (e) { primaryError = e.message; vlog('Hauptquelle ' + c.signal.src + ' für ' + a + ' fehlgeschlagen: ' + e.message); }
  if (!ALLOW_FB) throw new Error(primaryError + ' (weitere Quellen erst im nächsten Anlauf)');
  const errs = [primaryError];
  for (const f of chain.slice(1)) { try { const r = clean(await f()); return Object.assign({ fallback: true, primaryError }, r); } catch (e) { errs.push((f.name || '?') + ': ' + e.message); vlog(a + ' · ' + errs[errs.length - 1]); } }
  throw new Error(errs.join(' | '));
}

/* Welche Wochen sind zum Zeitpunkt NOW abgeschlossen? Liefert den Montag der ersten NICHT fälligen Woche. */
function dueCutoff(a) {
  const c = CFG.assets[a];
  if (c.week === 'sun') return THIS_MON;                               /* Bitcoin: Woche endet Sonntag 24 Uhr UTC */
  if (DOW >= 5 || FRI_CLOSED) return NEXT_MON;                          /* Freitag nach dem Londoner Schluss gilt die laufende Woche als fällig */
  return THIS_MON;
}
/* Ist die fällige Woche (Montag k) in den Tagesdaten vollständig? Maßgeblich ist der letzte Handelstag der Woche laut Kalender. */
function weekComplete(a, k, lastD) {
  const c = CFG.assets[a], sun = addDays(k, 6), weekOver = TODAY >= addDays(k, 7);
  if (!lastD || lastD < k) return { ok: false, reason: 'noch kein Kurs der Woche' };
  if (c.week === 'sun') return lastD >= sun ? { ok: true } : { ok: false, reason: 'Sonntagsschluss fehlt noch' };
  const ltd = lastTradingDay(a, k), fri = addDays(k, 4);
  if (!ltd) return { ok: true, holiday: true };
  if (lastD >= ltd) return ltd < fri ? { ok: true, holiday: true } : { ok: true };
  /* Ohne Kurs vom letzten Handelstag erst dann mit dem letzten Kurs der Woche abschließen, wenn er sicher nicht mehr kommt: ab Montag,
     bei der LBMA (Nachlieferungen) erst ab Mittwoch 12 Uhr UTC */
  const graceOver = c.signal.src === 'lbma' ? (NOW.getTime() >= new Date(addDays(k, 9) + 'T12:00:00Z').getTime()) : weekOver;
  if (graceOver && lastD >= prevTradingDay(a, ltd, k)) return { ok: true, partial: true };
  return { ok: false, reason: (ltd === fri ? 'Freitagsschluss (' + ds(fri) + ')' : 'Wochenschluss vom ' + ds(ltd)) + ' fehlt noch' };
}

function storedSeries(a) { const j = WEEKLY[a]; return j && j.w ? ENG.fromRows(j.w) : { k: [], d: [], c: [] }; }
function switchText(a, s, pre) {
  const r = CFG.assets[a].rule, buy = s.to === 1, mon = addDays(s.k, 7);
  /* Schwelle wie in Vorwarnung und Statuskarte: aus den 49 Schlüssen davor (engine.js thresholds), nicht (1±p)·SMA50 mit dem Schluss */
  const thr = s.thr > 0 ? s.thr : (r.type === 'band' ? s.m * (buy ? 1 + r.p : 1 - r.p) : s.m);
  const why = r.type === 'band'
    ? 'Schluss ' + usd(a, s.c) + ' liegt ' + (buy ? 'über der Kaufschwelle ' : 'unter der Verkaufsschwelle ') + usd(a, thr) + ' (' + de(r.p * 100, 0) + ' % ' + (buy ? 'über' : 'unter') + ' dem SMA50)'
    : r.n + '. Wochenschluss in Folge ' + (buy ? 'über' : 'unter') + ' dem SMA50 (Schluss ' + usd(a, s.c) + ', Schwelle ' + usd(a, thr) + ')';
  /* Vorläufiger Schluss (FTSE aus dem Live-Kurs oder Quote, Gold aus dem Spotpreis): in Titel und Text kennzeichnen */
  const pv = pre ? ' Vorläufiger Wochenschluss (' + pre + '); der endgültige folgt, eine Änderung der Regel wird gemeldet.' : '';
  return { title: name(a) + ': ' + (buy ? 'Kaufsignal' : 'Verkaufssignal') + (pre ? ' (vorläufig)' : ''), body: 'Wochenschluss ' + ds(s.d) + ': ' + why + '. Laut Regel ' + (buy ? 'kaufen' : 'verkaufen') + ' zur Eröffnung am Montag, ' + ds(mon) + pv };
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
const stTxt = (st) => (st === 1 ? 'investiert' : 'Cash');
function subset(S, keep) { const idx = S.k.map((k, i) => (keep(k) ? i : -1)).filter((i) => i >= 0); return { k: idx.map((i) => S.k[i]), d: idx.map((i) => S.d[i]), c: idx.map((i) => S.c[i]) }; }
/* Gebucht bleibt gebucht (config signal.keepBooked, Bitcoin und Gold; von Justus am 26.09.2026 festgelegt): Eine Quelle überschreibt schon
   gebuchte Wochen nicht, auch nicht eine andere Quelle mit leicht anderem Schluss. Ausnahme: eine vorläufig gebuchte Woche (allowK), die der
   endgültige Schluss ersetzt. Der FTSE bleibt ausgenommen: Seine bereinigte Reihe verschiebt sich mit jeder Ausschüttung und wird neu übernommen. */
function mergeFor(a, stored, fresh, allowK) {
  const c = CFG.assets[a];
  if (c.signal.keepBooked) { const have = {}; stored.k.forEach((k) => { have[k] = 1; }); fresh = subset(fresh, (k) => !have[k] || k === allowK); }
  return ENG.mergeWeekly(stored, fresh, !!c.signal.adj);
}
function sameSeries(x, y) {
  if (x.k.length !== y.k.length) return false;
  for (let i = 0; i < x.k.length; i++) if (x.k[i] !== y.k[i] || x.d[i] !== y.d[i] || round(x.c[i], 4) !== round(y.c[i], 4)) return false;
  return true;
}
function stateAt(S, E, k) { const j = S.k.indexOf(k); return j >= 0 && E.st[j] != null ? E.st[j] : null; }
/* Schon gebuchte Wochen (bis prevK), deren Regelzustand sich durch neue Daten geändert hat; skipK: die vorläufige Woche (wird als Korrektur gemeldet) */
function revisedWeeks(a, stored, merged, E, prevK, skipK) {
  if (prevK == null || !stored.k.length) return [];
  const E0 = ENG.evalRule(stored, CFG.assets[a].rule), pos = {}, out = [];
  merged.k.forEach((k, j) => { pos[k] = j; });
  for (let i = 0; i < stored.k.length; i++) { const k = stored.k[i], j = pos[k]; if (k > prevK || k === skipK || j == null) continue; if (E0.st[i] != null && E.st[j] != null && E0.st[i] !== E.st[j]) out.push(k); }
  return out;
}
/* Wochen buchen: zusammenführen, Regel rechnen, speichern, melden.
   targetK: jüngste Woche, die jetzt gebucht wird; src: {src, fallback, primaryError, preliminary (Datum), prelimLabel}; comp: Ergebnis von weekComplete.
   Meldungen: Hat sich der Zustand der zuletzt gebuchten Woche geändert (vorläufiger Schluss korrigiert oder rückwirkende Datenänderung),
   gibt es genau eine Nachricht mit dem Ergebnis; sonst die neuen Wechsel als Kauf- oder Verkaufssignal. */
function bookWeeks(a, stored, fresh, prev, targetK, src, comp) {
  const c = CFG.assets[a], prelimK = prev && prev.preliminary && prev.k ? prev.k : null;
  const merged = mergeFor(a, stored, fresh, prelimK);
  const lastStored = stored.k.length ? stored.k[stored.k.length - 1] : null;
  /* Keine Lücken: Jede Woche nach der zuletzt gespeicherten bis zur gebuchten braucht einen Schluss */
  if (lastStored) { const have = {}; merged.k.forEach((k) => { have[k] = 1; }); for (let k = addDays(lastStored, 7); k <= targetK; k = addDays(k, 7)) if (!have[k]) { const reason = 'Schluss der Woche ab ' + ds(k) + ' fehlt in der Kursreihe'; markPending(a, targetK, reason); note(name(a) + ': ' + reason); return { done: false, pending: true }; } }
  if (!merged.k.length || merged.k[merged.k.length - 1] < targetK) { markPending(a, targetK, 'Schlusskurs der Woche fehlt oder ist ungültig'); note(name(a) + ': Schlusskurs der Woche ' + ds(targetK) + ' fehlt oder ist ungültig'); return { done: false, pending: true }; }
  const E = ENG.evalRule(merged, c.rule);
  if (E.st.length < 60) { fail(name(a), 'zu wenige Wochen: ' + E.st.length); return { done: false }; }
  saveSeries(a, merged, src.src);
  const L = E.last, prevK = prev && prev.k ? prev.k : lastStored, prevSt = prev && prev.st != null ? prev.st : null;
  const wasPrelim = !!(prelimK && prelimK === prevK);
  const srcPrelimK = src.preliminary ? mondayOf(src.preliminary) : null;
  const stPrevNow = prevK ? stateAt(merged, E, prevK) : null;
  const rev = revisedWeeks(a, stored, merged, E, prevK, wasPrelim ? prevK : null);
  const newSw = E.sw.filter((s) => prevK == null || s.k > prevK);
  const flipPrev = prevSt != null && stPrevNow != null && stPrevNow !== prevSt;
  const pushEv = (ev, push) => { if (addEvent(ev) && push) queuePush({ id: ev.id, title: push.title, body: push.body, tag: 'signal-' + a, url: './#status', ts: NOW.toISOString() }); };
  if (!flipPrev) {
    if (wasPrelim) { const j = merged.k.indexOf(prevK); if (srcPrelimK === prevK) vlog(a + ': Schluss weiterhin vorläufig (' + src.preliminary + ')'); else if (j >= 0) note(name(a) + ': endgültiger Schluss ' + ds(merged.d[j]) + ' ' + usd(a, merged.c[j]) + ' bestätigt den vorläufigen Stand'); }
    if (rev.length) {
      addEvent({ id: 'rev-' + a + '-' + L.d, kind: 'info', a, k: L.k, d: L.d, title: name(a) + ': Datenrevision', text: 'Die Kursquelle (' + src.src + ') liefert für ' + rev.length + ' frühere Woche(n) andere Schlüsse (ab ' + ds(rev[0]) + '); der Regelzustand dieser Wochen ist rückwirkend anders. Der Zustand zum Wochenschluss ' + ds(prev.d) + ' bleibt ' + stTxt(prevSt) + '.', c: round(L.c, 4), m: round(L.m, 4) });
      note(name(a) + ': Datenrevision, ' + rev.length + ' Woche(n) rückwirkend anders, Zustand unverändert');
    }
    newSw.forEach((s) => {
      const pre = srcPrelimK && s.k === srcPrelimK ? (src.prelimLabel || 'vorläufiger Kurs') : null, txt = switchText(a, s, pre), id = 'sig-' + a + '-' + s.d;
      pushEv(Object.assign({ id, kind: s.to === 1 ? 'kauf' : 'verkauf', a, k: s.k, d: s.d, title: txt.title, text: txt.body, c: round(s.c, 4), m: round(s.m, 4) }, pre ? { preliminary: true } : {}), txt);
    });
  } else {
    /* Der Zustand der zuletzt gebuchten Woche ist jetzt ein anderer: eine Nachricht mit dem Ergebnis (neue Wechsel stecken darin) */
    const j = merged.k.indexOf(prevK), stillPrelim = srcPrelimK === prevK;
    const why = wasPrelim
      ? (stillPrelim ? 'Neuer vorläufiger Wochenschluss ' : 'Endgültiger Wochenschluss ') + ds(merged.d[j]) + ' ' + usd(a, merged.c[j]) + ' statt vorläufig ' + usd(a, prev.c) + '.'
      : 'Die Kursquelle (' + src.src + ') liefert für ' + Math.max(1, rev.length) + ' frühere Woche(n) andere Schlüsse' + (rev.length ? ' (ab ' + ds(rev[0]) + ')' : '') + '; rückwirkend war die Regel zum Wochenschluss ' + ds(prev.d) + ' ' + stTxt(stPrevNow) + ' statt ' + stTxt(prevSt) + '.';
    const extra = L.k > prevK ? ' Dazu der neue Wochenschluss ' + ds(L.d) + ' ' + usd(a, L.c) + (srcPrelimK === L.k ? ' (vorläufig: ' + (src.prelimLabel || 'vorläufiger Kurs') + ')' : '') + '.' : '';
    const net = L.st !== prevSt;
    const body = why + extra + (net ? ' Laut Regel jetzt ' + stTxt(L.st) + ' statt ' + stTxt(prevSt) + '.' : ' Damit ist die Regel wieder ' + stTxt(L.st) + '; für dich ändert sich nichts.');
    const kindT = wasPrelim ? 'Korrektur' : 'Datenrevision', id = (wasPrelim ? 'korr-' : 'rev-') + a + '-' + L.d;
    pushEv({ id, kind: net ? (L.st === 1 ? 'kauf' : 'verkauf') : 'info', a, k: L.k, d: L.d, title: name(a) + ': ' + (wasPrelim ? 'Korrektur des Wochenschlusses' : 'Datenrevision'), text: body, c: round(L.c, 4), m: round(L.m, 4) }, net ? { title: name(a) + ': ' + kindT, body } : null);
    note(name(a) + ': ' + kindT + ', Zustand zum ' + ds(prev.d) + ' jetzt ' + stTxt(stPrevNow) + (net ? ', ZUSTAND GEDREHT' : ', unterm Strich unverändert'));
  }
  const edge = Math.abs(L.c / (c.rule.type === 'band' ? L.m * (L.st === 1 ? 1 - c.rule.p : 1 + c.rule.p) : L.m) - 1) < (CFG.edge ? CFG.edge.pct : 0.005);
  if (edge && !newSw.length && !flipPrev) addEvent({ id: 'edge-' + a + '-' + L.d, kind: 'info', a, k: L.k, d: L.d, title: name(a) + ': Grenzfall', text: 'Wochenschluss ' + ds(L.d) + ' ' + usd(a, L.c) + ' liegt sehr nah an der Schwelle (SMA50 ' + usd(a, L.m) + '). Quelle: ' + src.src + '.' });
  const prelimNow = srcPrelimK && L.k === srcPrelimK ? src.preliminary : null;
  STATE.assets[a] = summarizeAsset(a, E, { src: src.src, fallback: !!src.fallback, primaryError: src.primaryError || null, pending: null, holiday: !!comp.holiday, partial: !!comp.partial, edge, preliminary: prelimNow, prelimLabel: prelimNow ? (src.prelimLabel || null) : null });
  RUN.changed = true;
  note(name(a) + ': Schluss ' + ds(L.d) + ' ' + usd(a, L.c) + ', SMA50 ' + usd(a, L.m) + ', ' + stTxt(L.st) + (newSw.length && !flipPrev ? ', SIGNALWECHSEL' : '') + (prelimNow ? ' (vorläufig: ' + (src.prelimLabel || '') + ')' : '') + (src.fallback ? ' (Ersatz: ' + src.src + ')' : ''));
  return { done: true, E, newSw };
}
/* Gold: Fehlt das LBMA-Fixing am Montagmorgen (ab 5 Uhr UTC) noch, zählt der Spotpreis kurz nach dem Fixing vom Freitag (STATE.goldSnap) als
   vorläufiger Wochenschluss. Das Fixing ersetzt ihn, sobald es da ist; ändert sich dadurch die Regel, kommt eine Korrektur.
   Von Justus am 26.09.2026 so festgelegt (config signal.spotFallback). */
function spotFallback(a, base, prev, dueK, reason) {
  const c = CFG.assets[a], snap = STATE.goldSnap;
  if (!c.signal.spotFallback || !snap || snap.k !== dueK || !(snap.p > 0)) return null;
  if (NOW.getTime() < new Date(addDays(dueK, 7) + 'T05:00:00Z').getTime()) return null;
  const tl = londonAt(snap.t), hm = String(Math.floor(tl.m / 60)).padStart(2, '0') + ':' + String(tl.m % 60).padStart(2, '0');
  const label = 'Spotpreis ' + ds(snap.d) + ' ' + hm + ' Uhr London (' + (snap.src || 'gold-api.com') + '), das LBMA-Fixing fehlt noch';
  /* Die nächtliche Fehlermeldung „ohne Wochenschluss“ ist damit überholt */
  STATE.queue = (STATE.queue || []).filter((q) => q.id !== 'err-' + a + '-' + dueK);
  note(name(a) + ': LBMA-Fixing fehlt (' + String(reason).slice(0, 80) + '), vorläufiger Wochenschluss aus dem ' + label.split(', das')[0]);
  return bookWeeks(a, base, { k: [dueK], d: [snap.d], c: [snap.p] }, prev, dueK, { src: 'Spotpreis ' + (snap.src || 'gold-api.com') + ' ' + snap.t + ' (vorläufig, LBMA-Fixing fehlt)', fallback: true, primaryError: String(reason).slice(0, 200), preliminary: snap.d, prelimLabel: label }, { ok: true });
}
async function closeAsset(a) {
  const c = CFG.assets[a], cutoff = dueCutoff(a), stored = storedSeries(a), prev = lastState(a);
  const dueK = addDays(cutoff, -7);                                   /* jüngste fällige Woche */
  const lastStored = stored.k.length ? stored.k[stored.k.length - 1] : null;
  const already = !!(lastStored && lastStored >= dueK && prev && prev.k >= dueK && !prev.pending);
  const prelimNow = !!(already && prev.preliminary);
  if (already && !prev.preliminary) { vlog(a + ': Woche ' + dueK + ' schon verarbeitet'); return { done: true, already: true }; }
  if (prelimNow) vlog(a + ': Woche ' + dueK + ' vorläufig gebucht (' + prev.preliminary + '), prüfe auf endgültigen Schluss');
  let src;
  try { src = await loadSignalSeries(a); }
  catch (e) {
    const reason = 'Kursabruf fehlgeschlagen: ' + e.message;
    if (prelimNow) { note(name(a) + ': Schluss ' + ds(prev.d) + ' bleibt vorläufig (' + e.message.slice(0, 80) + ')'); return { done: true, already: true }; }
    const fb = spotFallback(a, stored, prev, dueK, reason); if (fb) return fb;
    fail(name(a), reason); markPending(a, dueK, reason); return { done: false, error: e.message };
  }
  const daily = src.daily;
  const fresh0 = src.weeklyAlready ? ENG.fromRows(daily.dates.map((d, i) => [mondayOf(d), d, daily.closes[i]])) : ENG.weeklyFromDaily(daily.dates, daily.closes, cutoff);
  const fresh = subset(fresh0, (k) => k < cutoff);
  /* Für die Vollständigkeit zählt der letzte (gültige) Tageskurs, der zur fälligen Woche gehört */
  const lastInWeek = daily.dates.filter((d) => mondayOf(d) === dueK).pop() || null;
  const comp = weekComplete(a, dueK, lastInWeek);
  if (!comp.ok) {
    if (prelimNow) { note(name(a) + ': Schluss ' + ds(prev.d) + ' bleibt vorläufig (' + comp.reason + ')'); return { done: true, already: true }; }
    /* Frühere Wochen trotzdem übernehmen (ohne die unvollständige) – als Buchung, damit rückwirkende Änderungen und neue Wechsel gemeldet werden */
    let base = stored, prevB = prev;
    const older = subset(fresh, (k) => k < dueK);
    if (older.k.length) {
      const trial = mergeFor(a, stored, older, prev && prev.preliminary ? prev.k : null);
      if (!sameSeries(stored, trial)) { const r = bookWeeks(a, stored, older, prev, older.k[older.k.length - 1], src, { ok: true }); if (r.done) { base = storedSeries(a); prevB = lastState(a); } }
    }
    const fb = spotFallback(a, base, prevB, dueK, comp.reason); if (fb) return fb;
    markPending(a, dueK, comp.reason + (src.fallback ? ' (Ersatzquelle)' : ''));
    note(name(a) + ': Wochenschluss ' + ds(addDays(dueK, c.week === 'sun' ? 6 : 4)) + ' fehlt noch (' + comp.reason + ')');
    return { done: false, pending: true };
  }
  return bookWeeks(a, stored, fresh, prev, dueK, src, comp);
}
function markPending(a, k, reason) {
  STATE.assets[a] = Object.assign({}, STATE.assets[a] || {}, { pending: { k, reason: mask(reason), at: NOW.toISOString() } });
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
    /* LBMA hat keinen Live-Kurs: Spotpreis (gold-api, goldprice.org), sonst das heutige Vormittagsfixing, zuletzt der COMEX-Future
       mit dem Verhältnis zur LBMA. Die LBMA-Reihe wird erst im letzten Schritt gebraucht, damit ein LBMA-Ausfall die Vorwarnung nicht verhindert. */
    return firstOk('Gold', [
      async function spot2() { const q = await F.goldSpot2(); return { price: q.price, priceTime: q.priceTime, note: 'Spotpreis (gold-api.com)', src: q.src }; },
      async function lbmaAm() { const am = await F.lbma('am'); const i = am.dates.length - 1; if (am.dates[i] !== TODAY) throw new Error('Vormittagsfixing von heute noch nicht da (' + am.dates[i] + ')'); return { price: am.closes[i], priceTime: TODAY + 'T09:30:00Z', note: 'LBMA-Vormittagsfixing von heute', src: am.src }; },
      async function spot1() { const q = await F.goldSpot1(); return { price: q.price, priceTime: q.priceTime, note: 'Spotpreis (goldprice.org)', src: q.src }; },
      async function yahooComex() { const pm = await F.lbma(c.signal.fix || 'pm'); const g = await F.yahoo(c.cross.sym, { range: '1mo' }); const ratio = lbmaRatio(pm, g); if (!ratio || !(g.price > 0)) throw new Error('kein Verhältnis oder Kurs'); return { price: g.price * ratio, priceTime: g.priceTime, note: 'geschätzt aus dem COMEX-Future ' + usd(a, g.price) + ' × ' + de(ratio, 4), src: g.src + ' × lbma ratio' }; }
    ]);
  }
  if (a === 'btc') {
    return firstOk('Bitcoin', [
      async function coinbase() { const r = await F.coinbaseSpot('BTC-USD'); return { price: r.price, priceTime: r.priceTime, src: r.src }; },
      async function kraken() { const r = await F.krakenTicker('XBTUSD'); return { price: r.price, priceTime: r.priceTime, src: r.src }; },
      async function yahoo() { const r = await F.yahoo('BTC-USD', { range: '5d', adj: false }); if (!(r.price > 0)) throw new Error('kein Kurs'); return { price: r.price, priceTime: r.priceTime, src: r.src }; }
    ]);
  }
  return firstOk('FTSE', [
    async function alphaVantage() { const r = await F.avQuote('VWRD.LON'); const old = r.priceTime && r.priceTime.slice(0, 10) < TODAY; return { price: r.price, priceTime: r.priceTime, note: old ? 'Schlusskurs vom ' + ds(r.priceTime.slice(0, 10)) + ' (Alpha Vantage, kein Tageskurs)' : 'Alpha Vantage, verzögert', src: r.src }; },
    async function yahoo() { const r = await F.yahoo('VWRD.L', { range: '5d', adj: false }); if (!(r.price > 0)) throw new Error('kein Kurs'); return { price: r.price, priceTime: r.priceTime, src: r.src }; }
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
/* Euro-Kurse und Tagesreihen für die Depotbewertung.
   Hauptquellen laut config: EUR/USD EZB (untertägig Coinbase), Bitcoin Coinbase BTC-EUR (dann Kraken), VWCE und Gold-ETC (GZUR) Alpha Vantage
   Tagesschluss an der Xetra (liegt meist bis zum Abend einen Tag zurück). Yahoo nur noch als letzte Möglichkeit.
   Für den laufenden Tag schätzt der Ticker ETF und Gold-ETC aus USD-Referenz / EURUSD × Kalibrierfaktor; der Faktor wird hier aus den
   echten Xetra-Schlüssen nachkalibriert (eur.json: calib). */
/* Lang & Schwarz als Euro-Quelle für ETF und Gold-ETC (config: assets.<a>.eur = {src:'ls', ls:{id,label}, sym:<Alpha-Vantage-Ersatz>}) */
function lsCfg(a) { const e = CFG.assets[a] && CFG.assets[a].eur; return e && e.src === 'ls' && e.ls && e.ls.id ? e.ls : null; }
/* Lang & Schwarz: ISIN der Antwort gegen die Konfiguration prüfen, damit nie die Kurse eines anderen Wertpapiers übernommen werden */
async function lsQuote(a) {
  const l = lsCfg(a); if (!l) return null;
  const r = await F.ls(l.id, l.label || CFG.assets[a].short);
  if (r && r.isin && l.isin && r.isin !== l.isin) throw new Error('L&S liefert ISIN ' + r.isin + ' statt ' + l.isin + ' (Instrument ' + l.id + ')');
  return r;
}
function cryptoDaily(product, days) {
  return firstOk(product, [async function coinbase() { return F.coinbaseDays(product, days); }, async function kraken() { return Object.assign({ fallback: true }, await F.kraken(KRAKEN_PAIR[product] || product.replace('-', ''), days)); }]);
}
/* Lang & Schwarz nicht erreichbar: der letzte L&S-Kurs bleibt stehen und wird markiert (keine Xetra-Kurse, keine Schätzung) */
function lsStale(a, msg) {
  const cur = EUR.latest && EUR.latest[a];
  if (cur) cur.stale = NOW.toISOString();
  RUN.lsStale = RUN.lsStale || {};
  if (!RUN.lsStale[a]) { RUN.lsStale[a] = true; RUN.summary.push('L&S ' + CFG.assets[a].short + ' nicht erreichbar, letzter L&S-Kurs vom ' + (cur && cur.d ? ds(cur.d) : '–') + ' bleibt stehen'); }
  vlog('L&S ' + a + ': ' + msg);
}
function weeklyFromDailyRows(a, r, dec, dropLast, onlyMissing) {
  const dates = dropLast ? r.dates.slice(0, -1) : r.dates, closes = dropLast ? r.closes.slice(0, -1) : r.closes;
  const cutoff = (a === 'btc' || ALTS.some((x) => x.id === a)) ? THIS_MON : ((DOW >= 5 || FRI_CLOSED) ? NEXT_MON : THIS_MON);
  let W = ENG.weeklyFromDaily(dates, closes, cutoff);
  if (onlyMissing) { const have = {}; (EUR.weekly[a] || []).forEach((x) => { have[x[0]] = 1; }); const keep = W.k.map((k, i) => have[k] ? -1 : i).filter((i) => i >= 0); W = { k: keep.map((i) => W.k[i]), d: keep.map((i) => W.d[i]), c: keep.map((i) => W.c[i]) }; }
  EUR.weekly[a] = ENG.toRows(ENG.mergeWeekly(ENG.fromRows(EUR.weekly[a] || []), W, false), dec);
}
/* Kalibrierfaktor Euro-Kurs / (USD-Referenz / EURUSD) aus dem jüngsten gemeinsamen Tag */
function recalibrate(a, eurDates, eurCloses, refDates, refCloses) {
  const fx = {}; (EUR.daily.eurusd || []).forEach((r) => { fx[r[0]] = r[1]; });
  const ref = {}; refDates.forEach((d, i) => { ref[d] = refCloses[i]; });
  for (let i = eurDates.length - 1; i >= 0 && i >= eurDates.length - 10; i--) {
    const d = eurDates[i]; if (ref[d] > 0 && fx[d] > 0 && eurCloses[i] > 0) { const ratio = eurCloses[i] / (ref[d] / fx[d]); EUR.calib = EUR.calib || {}; EUR.calib[a] = { ratio: round(ratio, 6), d, ref: a === 'gold' ? 'LBMA PM USD' : 'VWRD.LON USD' }; return; }
  }
}
async function eurQuotes(keys) {
  EUR.weekly = EUR.weekly || {}; EUR.latest = EUR.latest || {}; EUR.daily = EUR.daily || {};
  const order = ['eurusd', 'btc', 'ftse', 'gold'].filter((a) => keys.includes(a));
  const backfill = !(EUR.daily.btc && EUR.daily.btc.length > 30), since = backfill ? '2026-05-01' : addDays(TODAY, -40);
  for (const a of order) {
    const sym = a === 'eurusd' ? CFG.fx.sym : CFG.assets[a].eur.sym, dec = a === 'eurusd' ? 6 : 4;
    try {
      if (a === 'eurusd') {
        const r = await F.ecbRange(since, TODAY); mergeDaily('eurusd', r.dates, r.closes, 6);
        const i = r.dates.length - 1; setLatest(a, r.dates[i], r.closes[i], sym, 'ezb eurusd'); upsertWeekly(a, r.dates[i], r.closes[i], dec);
      } else if (a === 'btc') {
        const d = await cryptoDaily('BTC-EUR', backfill ? 150 : 40);
        mergeDaily('btc', d.dates.slice(0, -1), d.closes.slice(0, -1), 2);
        if (backfill && d.dates[0] > since) { try { const d2 = await cryptoDaily('BTC-EUR', 300); mergeDaily('btc', d2.dates.slice(0, -1), d2.closes.slice(0, -1), 2); } catch (e) { vlog('BTC-EUR Rückfüllung: ' + e.message); } }
        /* Wochenwerte aus derselben Tagesreihe (Coinbase, Schluss 24 Uhr UTC), damit Tages- und Wochenansicht dieselbe Quelle haben */
        const dly = EUR.daily.btc || []; weeklyFromDailyRows(a, { dates: dly.map((x) => x[0]), closes: dly.map((x) => x[1]) }, dec, false);
        setLatest(a, TODAY, d.price, sym, d.src, d.fallback ? { fallback: true } : undefined);
      } else if (lsCfg(a)) {
        /* ETF und Gold-ETC: ausschließlich Lang & Schwarz (Kurse wie bei Trade Republic; Tagesschlüsse 23 Uhr, dazu der letzte Kurs).
           Ist L&S nicht erreichbar, bleibt der letzte L&S-Kurs stehen und wird markiert; keine Xetra-Kurse, keine Schätzung. */
        let r = null;
        try { r = await lsQuote(a); } catch (e) { lsStale(a, e.message); continue; }
        const i = r.dates.length - 1;
        if (i >= 0) { mergeDaily(a, r.dates, r.closes, 4); weeklyFromDailyRows(a, r, dec, false); }
        if (r.price > 0) setLatest(a, r.priceDay || r.dates[i], r.price, sym, r.src, { live: r.priceDay === TODAY, quoteTime: r.priceTime || null });
        else if (i >= 0) setLatest(a, r.dates[i], r.closes[i], sym, r.src);
        /* Kalibrierfaktor Dollar-Referenz -> L&S-Kurs (für die Umrechnung der Dollar-Schwellen in Euro-Kurse des Wertpapiers) */
        if (a === 'gold') { try { const pm = await F.lbma(CFG.assets.gold.signal.fix || 'pm'); recalibrate('gold', r.dates, r.closes, pm.dates, pm.closes); } catch (e) { vlog('Kalibrierung Gold: ' + e.message); } }
        if (a === 'ftse') { const w = WEEKLY.ftse && WEEKLY.ftse.w; if (RUN.avWeeklyFtse) recalibrate('ftse', r.dates, r.closes, RUN.avWeeklyFtse.dates, RUN.avWeeklyFtse.closes); else if (w && w.length) recalibrate('ftse', r.dates, r.closes, w.map((x) => x[1]), w.map((x) => x[2])); }
      } else {
        /* Ohne L&S-Konfiguration: Xetra-Tagesschlüsse von Alpha Vantage (100 Handelstage) */
        const r = await F.avDaily(sym, false), i = r.dates.length - 1;
        mergeDaily(a, r.dates, r.closes, 4); weeklyFromDailyRows(a, r, dec, false);
        const prev = EUR.latest[a];
        /* Der Xetra-Schluss ersetzt einen Ticker-Schätzwert nur, wenn er nicht älter ist */
        if (!prev || !prev.estimate || !prev.d || prev.d <= r.dates[i]) setLatest(a, r.dates[i], r.closes[i], sym, r.src);
        if (a === 'gold') { try { const pm = await F.lbma(CFG.assets.gold.signal.fix || 'pm'); recalibrate('gold', r.dates, r.closes, pm.dates, pm.closes); } catch (e) { vlog('Kalibrierung Gold: ' + e.message); } }
        if (a === 'ftse') { const w = WEEKLY.ftse && WEEKLY.ftse.w; if (RUN.avWeeklyFtse) recalibrate('ftse', r.dates, r.closes, RUN.avWeeklyFtse.dates, RUN.avWeeklyFtse.closes); else if (w && w.length) recalibrate('ftse', r.dates, r.closes, w.map((x) => x[1]), w.map((x) => x[2])); }
      }
    } catch (e) {
      vlog('Euro-Kurs ' + sym + ': ' + e.message);
      if (lsCfg(a)) { lsStale(a, e.message); continue; }
      /* Notlösungen: Schätzung aus USD-Referenz, zuletzt Yahoo */
      try {
        if (a === 'eurusd') { const q = await F.coinbaseFx('EUR', 'USD'); setLatest(a, TODAY, q.rate, sym, q.src, { fallback: true }); }
        else if (a === 'btc') { const r = await F.yahoo(sym, { range: '3mo' }); weeklyFromDailyRows(a, r, dec, false); setLatest(a, r.dates[r.dates.length - 1], r.closes[r.closes.length - 1], sym, r.src, { fallback: true }); }
        else {
          const cb = calib(a), fx = EUR.latest.eurusd && EUR.latest.eurusd.p;
          if (!cb || !(fx > 0)) throw new Error('keine Kalibrierung oder kein EUR/USD');
          if (a === 'ftse') { const q = await F.avQuote('VWRD.LON'); const d = q.priceTime ? q.priceTime.slice(0, 10) : TODAY, p = q.price / fx * cb.ratio; setLatest(a, d, p, sym, 'geschätzt: VWRD ' + de(q.price, 2) + ' $ / EURUSD ' + de(fx, 4) + ' × ' + de(cb.ratio, 4) + ' (kalibriert ' + cb.d + ')', { fallback: true, estimate: true }); upsertWeekly(a, d, p, dec); }
          else { const pm = await F.lbma(CFG.assets.gold.signal.fix || 'pm'); const i = pm.dates.length - 1, p = pm.closes[i] / fx * cb.ratio; setLatest(a, pm.dates[i], p, sym, 'geschätzt: LBMA ' + de(pm.closes[i], 2) + ' $ / EURUSD ' + de(fx, 4) + ' × ' + de(cb.ratio, 5) + ' (kalibriert ' + cb.d + ')', { fallback: true, estimate: true }); upsertWeekly(a, pm.dates[i], p, dec); }
        }
      } catch (e2) { RUN.summary.push('Euro-Kurs ' + sym + ' nicht aktualisiert (' + e2.message.slice(0, 90) + ')'); vlog('Notlösung ' + a + ': ' + e2.message); }
    }
  }
  if (order.includes('btc')) await altQuotes(backfill);
  if (order.includes('gold') && !lsCfg('gold')) await goldDailyFallback();   /* Schätzreihe aus LBMA nur ohne L&S */
  EUR.updated = NOW.toISOString();
  saveJson('eur.json', EUR);
  RUN.changed = true;
  note('Euro-Kurse: ' + order.map((a) => a + ' ' + (EUR.latest[a] ? de(EUR.latest[a].p, a === 'eurusd' ? 4 : 2) + ' (' + ds(EUR.latest[a].d) + (EUR.latest[a].estimate ? ', geschätzt' : EUR.latest[a].fallback ? ', Ersatz' : '') + ')' : '–')).join(', '));
}
function mergeDaily(a, dates, closes, dec, onlyMissing) {
  EUR.daily = EUR.daily || {}; const map = {}; (EUR.daily[a] || []).forEach((r) => { map[r[0]] = r[1]; });
  for (let i = 0; i < dates.length; i++) if (closes[i] > 0 && !(onlyMissing && map[dates[i]] > 0)) map[dates[i]] = round(closes[i], dec == null ? 4 : dec);
  const ks = Object.keys(map).sort().filter((d) => d >= '2026-05-01');
  EUR.daily[a] = ks.map((d) => [d, map[d]]);
}
/* Beimischungen (ETH, SOL): Coinbase, dann Kraken; Wochen- und Tagesreihe plus letzter Kurs */
async function altQuotes(backfill) {
  for (const alt of ALTS) {
    try {
      const have = EUR.daily[alt.id] && EUR.daily[alt.id].length > 30;
      const d = await cryptoDaily(alt.eur.sym, have && !backfill ? 40 : 150);
      mergeDaily(alt.id, d.dates.slice(0, -1), d.closes.slice(0, -1), 4);
      const dly = EUR.daily[alt.id] || []; weeklyFromDailyRows(alt.id, { dates: dly.map((x) => x[0]), closes: dly.map((x) => x[1]) }, 4, false);
      setLatest(alt.id, TODAY, d.price, alt.eur.sym, d.src, d.fallback ? { fallback: true } : undefined);
    } catch (e) { vlog('Beimischung ' + alt.id + ': ' + e.message); RUN.summary.push('Kurs ' + alt.short + ' nicht aktualisiert (' + e.message.slice(0, 60) + ')'); }
  }
}
/* Gold-Tagesreihe: Lücken (Tage ohne Xetra-Schluss in den Daten) mit LBMA / EURUSD × Kalibrierfaktor füllen */
async function goldDailyFallback() {
  try {
    const cb = calib('gold'); if (!cb) return;
    const have = {}; (EUR.daily.gold || []).forEach((r) => { have[r[0]] = 1; });
    const fxm = {}; (EUR.daily.eurusd || []).forEach((r) => { fxm[r[0]] = r[1]; });
    const pm = await F.lbma(CFG.assets.gold.signal.fix || 'pm'), dates = [], closes = []; let lastFx = null;
    for (let i = 0; i < pm.dates.length; i++) { const d = pm.dates[i]; if (d < '2026-05-01') continue; if (fxm[d]) lastFx = fxm[d]; if (!lastFx || have[d]) continue; dates.push(d); closes.push(pm.closes[i] / lastFx * cb.ratio); }
    if (dates.length) mergeDaily('gold', dates, closes, 4);
  } catch (e) { vlog('Gold-Tagesreihe (Schätzung): ' + e.message); }
}

/* ---------- Live-Ticker (stündlich): aktuelle Kurse und Abstand zur Wochenschluss-Schwelle ----------
   Bitcoin und Gold laufend (Coinbase, gold-api), EUR/USD laufend (Coinbase-Wechselkurs), FTSE nur mit dem letzten Tagesschluss (Alpha Vantage, im eod-Lauf). */
/* Offene Woche: die erste Woche, deren Schluss noch aussteht. FTSE und Gold: nach dem Freitagsschluss (und am Wochenende) die nächste Woche;
   Bitcoin: die Woche endet Sonntag 24 Uhr UTC. Fehlt die zuletzt geschlossene Woche noch in der Reihe (Buchung steht aus), bleibt sie die
   offene Woche; der aktuelle Kurs steht dann für ihren Schluss. */
function openWeek(a, stored) {
  const cal = dueCutoff(a), last = stored.k.length ? stored.k[stored.k.length - 1] : null, next = last ? addDays(last, 7) : cal;
  return next < cal ? next : cal;
}
function ruleNow(a, price) {
  const c = CFG.assets[a], stored = storedSeries(a), openK = openWeek(a, stored);
  const S = subset(stored, (k) => k < openK);
  if (S.k.length < 60 || !(price > 0)) return null;
  const E = ENG.evalRule(S, c.rule), ft = ENG.flipThreshold(E, c.rule), E2 = ENG.whatIf(S, c.rule, addDays(openK, c.week === 'sun' ? 6 : 4), price);
  return { thr: round(ft.thr, 4), dist: round(price / ft.thr - 1, 6), can: ft.can, need: ft.need || null, st: E.last.st, would: E2.last.changed, wouldSt: E2.last.st, sma: round(E.last.m, 4), up: E2.last.up, dn: E2.last.dn, week: openK, closePending: openK < dueCutoff(a) };
}
/* Gold: den ersten Spotpreis nach dem LBMA-Nachmittagsfixing am letzten Fixing-Tag der Woche (meist Freitag, vor Feiertagen früher; 15 Uhr London)
   festhalten; er dient als vorläufiger Wochenschluss, falls das Fixing am Montagmorgen noch fehlt (spotFallback). Nur Kurse aus dem Fenster
   15:02 bis 17:00 Uhr London, damit er nah am Fixing liegt. Der stündliche Ticker läuft jeden Tag, das Fenster wird also auch mittwochs getroffen. */
function recordGoldSnap(g) {
  if (!CFG.assets.gold.signal.spotFallback || !g || !(g.price > 0)) return;
  const t = g.priceTime || NOW.toISOString(), L = londonAt(t);
  if (L.d !== lastTradingDay('gold', mondayOf(L.d)) || L.m < 15 * 60 + 2 || L.m > 17 * 60) return;   /* nur am letzten Fixing-Tag der Woche */
  if (londonAt(NOW).d !== L.d) return;                                   /* nur ein frischer Kurs vom selben Tag */
  const k = mondayOf(L.d), cur = STATE.goldSnap;
  if (cur && cur.k === k) return;                                        /* der erste Kurs nach dem Fixing zählt */
  STATE.goldSnap = { k, d: L.d, p: round(g.price, 2), t, src: String(g.src || '').replace(/ XAU\/USD spot$/, '') };
  RUN.changed = true;
  note('Gold: Spotpreis nach dem Fixing festgehalten, ' + usd('gold', g.price) + ' (' + t.slice(11, 16) + ' UTC), Ersatz für den Wochenschluss, falls das LBMA-Fixing bis Montagmorgen fehlt');
}
async function liveTick() {
  const prev = loadJson('live.json', { prices: {} }), out = { t: NOW.toISOString(), prices: {}, rule: {} };
  let fx = null;
  try { const r = await F.coinbaseFx('EUR', 'USD'); fx = { rate: round(r.rate, 6), src: r.src, t: NOW.toISOString() }; }
  catch (e) { try { const r = await F.ecb(); fx = { rate: round(r.price, 6), src: r.src, t: r.priceTime }; } catch (e2) { fx = EUR.latest && EUR.latest.eurusd ? { rate: EUR.latest.eurusd.p, src: EUR.latest.eurusd.src, t: EUR.latest.eurusd.t } : null; } }
  out.prices.eurusd = fx;
  try {
    const q = await firstOk('Live Bitcoin', [
      async function coinbase() { const u = await F.coinbaseSpot('BTC-USD'), e = await F.coinbaseSpot('BTC-EUR'); return { usd: u.price, eur: e.price, src: u.src, srcEur: e.src }; },
      async function kraken() { const u = await F.krakenTicker('XBTUSD'), e = await F.krakenTicker('XBTEUR'); return { usd: u.price, eur: e.price, src: u.src, srcEur: e.src, fallback: true }; }
    ]);
    out.prices.btc = { usd: round(q.usd, 2), eur: round(q.eur, 2), src: q.src, srcEur: q.srcEur, t: NOW.toISOString() }; if (q.fallback) out.prices.btc.fallback = true;
  } catch (e) { fail('Live Bitcoin', e.message); if (prev.prices && prev.prices.btc) out.prices.btc = prev.prices.btc; }
  try {
    let g = null; try { g = await F.goldSpot2(); } catch (e) { g = await F.goldSpot1(); }
    recordGoldSnap(g);
    const cb = calib('gold');
    out.prices.gold = { usd: round(g.price, 2), eur: !lsCfg('gold') && fx && cb ? round(g.price / fx.rate * cb.ratio, 4) : null, src: g.src, t: g.priceTime || NOW.toISOString(), spot: true };
  } catch (e) {
    fail('Live Gold', e.message);
    if (prev.prices && prev.prices.gold) out.prices.gold = prev.prices.gold;
  }
  for (const alt of ALTS) {
    try { const e = await firstOk('Live ' + alt.short, [async function coinbase() { return F.coinbaseSpot(alt.eur.sym); }, async function kraken() { return Object.assign({ fallback: true }, await F.krakenTicker(KRAKEN_PAIR[alt.eur.sym] || alt.eur.sym.replace('-', ''))); }]); out.prices[alt.id] = { eur: round(e.price, 4), src: e.src, t: NOW.toISOString() }; if (e.fallback) out.prices[alt.id].fallback = true; }
    catch (e) { if (prev.prices && prev.prices[alt.id]) out.prices[alt.id] = prev.prices[alt.id]; }
  }
  /* FTSE: letzter Tagesschluss aus dem eod-Lauf (Alpha Vantage), sonst aus der Wochenreihe */
  const Sf = storedSeries('ftse'), jf = Sf.k.length - 1;
  if (prev.prices && prev.prices.ftse && prev.prices.ftse.usd > 0) out.prices.ftse = Object.assign({}, prev.prices.ftse);
  if (jf >= 0 && (!out.prices.ftse || !out.prices.ftse.d || Sf.d[jf] > out.prices.ftse.d)) out.prices.ftse = { usd: Sf.c[jf], d: Sf.d[jf], src: 'Wochenschluss ' + ds(Sf.d[jf]), eod: true };
  if (lsCfg('ftse')) delete out.prices.ftse.eur;
  else if (fx && calib('ftse') && out.prices.ftse.usd > 0 && !(out.prices.ftse.eur > 0)) out.prices.ftse.eur = round(out.prices.ftse.usd / fx.rate * calib('ftse').ratio, 4);
  /* ETF und Gold-ETC in Euro ausschließlich von Lang & Schwarz (Kurs wie bei Trade Republic); ist L&S nicht erreichbar, bleibt der letzte L&S-Kurs (markiert) */
  out.ls = {}; const lsOk = {};
  for (const a of ['ftse', 'gold']) {
    if (!lsCfg(a)) continue;
    try { const q = await lsQuote(a); if (q && q.price > 0) { out.ls[a] = { eur: round(q.price, 4), d: q.priceDay, t: q.priceTime || NOW.toISOString(), src: q.src }; lsOk[a] = true; } }
    catch (e) { lsStale(a, e.message); if (prev.ls && prev.ls[a]) out.ls[a] = Object.assign({}, prev.ls[a], { stale: NOW.toISOString() }); }
    if (out.ls[a] && out.prices[a]) { out.prices[a].eur = out.ls[a].eur; out.prices[a].eurSrc = out.ls[a].src; out.prices[a].eurT = out.ls[a].t; }
  }
  A.forEach((a) => { const p = out.prices[a]; const r = p && p.usd > 0 ? ruleNow(a, p.usd) : null; if (r) out.rule[a] = r; });
  saveJson('live.json', out);
  /* Depotbewertung mit den aktuellen Kursen (Wochenreihen bleiben unberührt) */
  EUR.latest = EUR.latest || {};
  if (out.prices.btc && out.prices.btc.eur > 0) { EUR.latest.btc = { d: TODAY, p: out.prices.btc.eur, sym: CFG.assets.btc.eur.sym, src: out.prices.btc.srcEur || out.prices.btc.src, t: NOW.toISOString(), live: true }; if (out.prices.btc.fallback) EUR.latest.btc.fallback = true; }
  if (lsOk.gold) EUR.latest.gold = { d: out.ls.gold.d, p: out.ls.gold.eur, sym: CFG.assets.gold.eur.sym, src: out.ls.gold.src, t: NOW.toISOString(), quoteTime: out.ls.gold.t, live: out.ls.gold.d === TODAY };
  else if (!lsCfg('gold') && out.prices.gold && out.prices.gold.eur > 0 && fx) EUR.latest.gold = { d: TODAY, p: out.prices.gold.eur, sym: CFG.assets.gold.eur.sym, src: 'geschätzt: Spot ' + de(out.prices.gold.usd, 2) + ' $ / EURUSD ' + de(fx.rate, 4) + ' × Kalibrierfaktor (Xetra-Schluss folgt abends)', t: NOW.toISOString(), estimate: true, live: true };
  if (lsOk.ftse) { const cur = EUR.latest.ftse; if (!cur || !cur.d || out.ls.ftse.d >= cur.d) EUR.latest.ftse = { d: out.ls.ftse.d, p: out.ls.ftse.eur, sym: CFG.assets.ftse.eur.sym, src: out.ls.ftse.src, t: NOW.toISOString(), quoteTime: out.ls.ftse.t, live: out.ls.ftse.d === TODAY }; }
  if (fx) EUR.latest.eurusd = { d: TODAY, p: fx.rate, sym: CFG.fx.sym, src: fx.src, t: NOW.toISOString(), live: true };
  ALTS.forEach((alt) => { const p = out.prices[alt.id]; if (p && p.eur > 0) { EUR.latest[alt.id] = { d: TODAY, p: p.eur, sym: alt.eur.sym, src: p.src, t: NOW.toISOString(), live: true }; if (p.fallback) EUR.latest[alt.id].fallback = true; } });
  EUR.updated = NOW.toISOString(); saveJson('eur.json', EUR);
  RUN.changed = true;
  note('Live: ' + A.map((a) => { const p = out.prices[a], r = out.rule[a]; return p ? CFG.assets[a].short + ' ' + usd(a, p.usd) + (r ? ' (' + de(r.dist * 100, 1) + ' % zur Schwelle' + (r.would ? ', würde auslösen' : '') + ')' : '') : CFG.assets[a].short + ' –'; }).join(' · ') + (fx ? ' · EUR/USD ' + de(fx.rate, 4) : '') + (Object.keys(out.ls).length ? ' · L&S ' + Object.keys(out.ls).map((a) => CFG.assets[a].short + ' ' + de(out.ls[a].eur, 2) + ' €').join(', ') : ''));
}
/* Letzter Tagesschluss VWRD (USD) für die Live-Anzeige, einmal am Tag */
async function ftseEod() {
  try {
    /* Alpha Vantage hängt oft einen Tag zurück oder ist nicht erreichbar: Ist der gespeicherte Wochenschluss (z. B. von EODHD) neuer, gilt der */
    let d = null, c = null, src = null, avErr = null;
    try { const r = cleanDaily(await F.av('VWRD.LON')), i = r.dates.length - 1; if (i < 0) throw new Error('keine gültigen Schlüsse'); d = r.dates[i]; c = r.closes[i]; src = r.src; } catch (e) { avErr = e; }
    const S = storedSeries('ftse'), j = S.k.length - 1;
    if (j >= 0 && (!d || S.d[j] > d)) { d = S.d[j]; c = S.c[j]; src = 'Wochenschluss ' + ds(d) + (WEEKLY.ftse && /EODHD/.test(WEEKLY.ftse.src || '') ? ' (EODHD)' : ''); }
    if (!d) throw avErr || new Error('keine Daten');
    if (avErr) vlog('FTSE-Tagesschluss: Alpha Vantage nicht erreichbar (' + avErr.message.slice(0, 60) + '), gespeicherter Schluss ' + ds(d));
    const live = loadJson('live.json', { prices: {}, rule: {} }); live.prices = live.prices || {};
    const have = live.prices.ftse;
    if (have && have.d && have.d > d) { note('FTSE Tagesschluss: Quelle liefert ' + ds(d) + ', Anzeige behält den neueren Stand vom ' + ds(have.d)); return; }
    live.prices.ftse = { usd: round(c, 4), d, src, eod: true, t: NOW.toISOString() };
    const fx = (live.prices.eurusd && live.prices.eurusd.rate) || (EUR.latest.eurusd && EUR.latest.eurusd.p);
    if (lsCfg('ftse')) { if (live.ls && live.ls.ftse) live.prices.ftse.eur = live.ls.ftse.eur; }       /* Euro-Kurs nur von L&S, keine Schätzung */
    else if (fx && calib('ftse')) live.prices.ftse.eur = round(c / fx * calib('ftse').ratio, 4);
    const rr = ruleNow('ftse', c); if (rr) { live.rule = live.rule || {}; live.rule.ftse = rr; }
    saveJson('live.json', live); RUN.changed = true;
    /* Der Xetra-Schluss kommt erst abends: bis dahin den Euro-Kurs des ETF aus dem Londoner Schluss schätzen, damit die Depotbewertung nicht einen Tag hinterherhinkt */
    const cur = EUR.latest && EUR.latest.ftse;
    if (!lsCfg('ftse') && live.prices.ftse.eur > 0 && (!cur || !cur.d || cur.d < d)) {
      setLatest('ftse', d, live.prices.ftse.eur, CFG.assets.ftse.eur.sym, 'geschätzt: VWRD ' + de(c, 2) + ' $ / EURUSD ' + de(fx, 4) + ' × Kalibrierfaktor (Xetra-Schluss folgt abends)', { estimate: true });
      upsertWeekly('ftse', d, live.prices.ftse.eur, 4); EUR.updated = NOW.toISOString(); saveJson('eur.json', EUR);
    }
    note('FTSE Tagesschluss ' + ds(d) + ': ' + usd('ftse', c));
  } catch (e) { RUN.summary.push('FTSE-Tagesschluss nicht aktualisiert (' + e.message.slice(0, 80) + ')'); }
}

/* ---------- Gegenprobe Gold (COMEX) ---------- */
async function goldCross() {
  const c = CFG.assets.gold;
  try {
    /* Yahoo weist GitHub-Runner fast immer ab (HTTP 429): nur ein Versuch, damit der Lauf nicht 40 Sekunden wartet */
    const g = await F.yahoo(c.cross.sym, { start: '2023-06-01', once: true });
    const cutoff = (DOW >= 5 || FRI_CLOSED) ? NEXT_MON : THIS_MON;
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
  const prel = A.filter((a) => STATE.assets[a] && !STATE.assets[a].pending && STATE.assets[a].preliminary).map((a) => name(a) + ' (' + (STATE.assets[a].prelimLabel || 'vorläufiger Kurs') + ')');
  let body = parts.join(' · ') + '. ' + (sig.length ? sig.map((e) => e.title).join('; ') + '.' : 'Keine neuen Signale.');
  (CFG.oneTimeHints || []).forEach((h) => { if (h.date === TODAY && STATE.assets[h.asset] && STATE.assets[h.asset].st === h.ifState) body += ' ' + h.text; });
  if (prel.length) body += ' Vorläufig: ' + prel.join('; ') + '.';
  if (pend.length) body += ' Noch offen: ' + pend.join(', ') + '.';
  addEvent({ id, kind: 'info', a: null, k: THIS_MON, d: TODAY, title: 'Wochenstart ' + ds(THIS_MON), text: body });
  queuePush({ id, title: 'Regel-Depot · Wochenstart ' + ds(THIS_MON), body, tag: 'week', url: './#status', ts: NOW.toISOString() });
}

/* ---------- Aufbewahrung ----------
   Laufprotokoll: fehlerfreie Ticker-Läufe (stündlich) nur 36 Stunden, alle anderen Läufe bis zu 150 Einträge (vorher 60 insgesamt, das reichte
   nur für etwa drei Tage). Ereignisse: bis zu 600; zuerst fallen alte Info-Einträge und Vorwarnungen weg, Signale, Korrekturen und Fehler bleiben. */
function pruneRuns(list) { const cut = NOW.getTime() - 36 * 3600e3; return list.filter((r, i) => i === 0 || !(r.step === 'live' && r.ok && Date.parse(r.t) < cut)).slice(0, 150); }
function pruneEvents(list, max) {
  if (list.length <= max) return list;
  let drop = list.length - max; const out = [];
  for (const e of list) { if (drop > 0 && (e.kind === 'info' || e.kind === 'vorwarnung')) { drop--; continue; } out.push(e); }
  while (out.length > max) out.shift();
  return out;
}

/* ---------- Schritt bestimmen ---------- */
function autoStep() {
  if (DOW === 4 && !FRI_CLOSED) return 'fr-warn';
  if (DOW === 4) return 'fr-close';
  if (DOW === 5) return 'sa-close';
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
      for (const a of ['ftse', 'gold']) {
        const ltd = lastTradingDay(a, THIS_MON);
        if (ltd && ltd < TODAY) { note(name(a) + ': keine Vorwarnung, die Woche schloss schon am ' + ds(ltd) + ' (Feiertag)'); continue; }
        try { await warnAsset(a, await currentPrice(a)); } catch (e) { fail(name(a), 'Vorwarnung: ' + e.message); }
      }
    } else if (step === 'fr-close') {
      /* Freitag nach dem Londoner Schluss: FTSE und Gold (LBMA-PM-Fixing, falls schon veröffentlicht). Wiederholungen (--fallback) sparen die Euro-Kurse aus. */
      await closeAsset('ftse'); await closeAsset('gold');
      if (!OPT.fallback) { await eurQuotes(['ftse', 'gold', 'btc', 'eurusd']); await ftseEod(); }
      await liveTick();
    } else if (step === 'sa-close') {
      /* Samstagmorgen: was am Freitag noch fehlte (Alpha Vantage und LBMA liefern spät), dazu die Euro-Schlüsse vom Freitag */
      /* closeAsset prüft selbst, ob die fällige Woche schon endgültig gebucht ist (dann kein Abruf) */
      for (const a of ['ftse', 'gold']) await closeAsset(a);
      await eurQuotes(['ftse', 'gold', 'btc', 'eurusd']);
      await ftseEod();
      await liveTick();
    } else if (step === 'so-warn') {
      try { await warnAsset('btc', await currentPrice('btc')); } catch (e) { fail(name('btc'), 'Vorwarnung: ' + e.message); }
    } else if (step === 'mo-close') {
      await closeAsset('btc'); await closeAsset('gold'); await closeAsset('ftse');
      await goldCross();
      await eurQuotes(['btc', 'eurusd']);
      if (OPT.final) { A.forEach((a) => { const p = STATE.assets[a] && STATE.assets[a].pending; if (p) { const id = 'err-' + a + '-' + p.k; if (addEvent({ id, kind: 'fehler', a, k: p.k, d: TODAY, title: name(a) + ': Wochenschluss fehlt', text: p.reason + '. Die Seite zeigt den Stand der Vorwoche; die nächsten Läufe versuchen es weiter.' })) queuePush({ id, title: 'Regel-Depot: ' + name(a) + ' ohne Wochenschluss', body: p.reason + '. Es wird weiter versucht.', tag: 'err-' + a, url: './#signale', ts: NOW.toISOString() }); } }); }
      flush = false;                                                   /* Nachts nicht pushen, das macht mo-notify */
    } else if (step === 'mo-notify') {
      for (const a of A) await closeAsset(a);
      weeklySummary();
    } else if (step === 'live') {
      await liveTick();
      /* Montag: Die Nachrichten vom Wochenende gehen um 7:53 Uhr (Berlin) mit mo-notify hinaus. Fällt dieser Lauf aus oder verdrängt GitHub ihn,
         holt der nächste Ticker-Lauf das nach (Wochenschlüsse, Wochenübersicht, Warteschlange). Sonst verschickt der Ticker, was noch wartet. */
      const monHold = BERLIN.dow === 0 && BERLIN.hour < MON_PUSH;
      if (BERLIN.dow === 0 && !monHold && CFG.push.weeklySummary && !EVENTS.some((e) => e.id === 'week-' + THIS_MON)) { note('Montag: Wochenübersicht fehlt noch, der Ticker holt mo-notify nach'); ALLOW_FB = true; for (const a of A) await closeAsset(a); weeklySummary(); }
      flush = !monHold;
    } else if (step === 'eod') {
      for (const a of A) await closeAsset(a);
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
        ['Alpha Vantage GZUR.DEX daily (Gold-ETC Xetra)', async () => { const r = await F.avDaily('GZUR.DEX', false); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }],
        ['Alpha Vantage VWCE.DEX daily', async () => { const r = await F.avDaily('VWCE.DEX', false); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }],
        ['EODHD VWRD.LSE eod (ab Montag dieser Woche)', async () => { const r = await F.eodhd('VWRD.LSE', THIS_MON); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }],
        ['EODHD VWRD.LSE live', async () => { const r = await F.eodhdLive('VWRD.LSE'); return de(r.price, 2) + ' ' + r.priceTime; }],
        ['Lang & Schwarz Suche IE00BK5BQT80', async () => { const r = await F.lsSearch('IE00BK5BQT80'); return r.name + ' (ID ' + r.id + ')'; }],
        ['Lang & Schwarz VWCE (ID ' + ((CFG.assets.ftse.eur.ls || {}).id || '?') + ')', async () => { const r = await lsQuote('ftse'); return de(r.price, 2) + ' € ' + (r.priceTime || '') + ', Tagesschlüsse bis ' + r.dates[r.dates.length - 1] + ' (' + r.dates.length + ')'; }],
        ['Lang & Schwarz Gold-ETC (ID ' + ((CFG.assets.gold.eur.ls || {}).id || '?') + ')', async () => { const r = await lsQuote('gold'); return de(r.price, 2) + ' € ' + (r.priceTime || '') + ', Tagesschlüsse bis ' + r.dates[r.dates.length - 1] + ' (' + r.dates.length + ')'; }],
        ['Kraken XBTUSD daily', async () => { const r = await F.kraken('XBTUSD', 10); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }],
        ['Kraken XBTEUR ticker', async () => { const r = await F.krakenTicker('XBTEUR'); return de(r.price, 2); }],
        ['Kraken ETHEUR ticker', async () => { const r = await F.krakenTicker('ETHEUR'); return de(r.price, 2); }],
        ['Coinbase ETH-EUR spot', async () => { const r = await F.coinbaseSpot('ETH-EUR'); return de(r.price, 2); }],
        ['Coinbase SOL-EUR spot', async () => { const r = await F.coinbaseSpot('SOL-EUR'); return de(r.price, 2); }],
        ['Alpha Vantage BTC-USD daily', async () => { const r = await F.avCrypto('BTC', 'USD'); return r.dates[r.dates.length - 1] + ' ' + de(r.closes[r.closes.length - 1], 2) + ' (' + r.dates.length + ' Tage)'; }]
      ];
      for (const [label, fn] of probes) { try { note('OK ' + label + ': ' + await fn()); } catch (e) { RUN.summary.push('FEHLT ' + label + ': ' + e.message.slice(0, 120)); log('! ' + label + ': ' + e.message); } }
      RUN.ok = true; flush = false;
    } else if (step === 'test-eodhd') {
      /* Datenvergleich EODHD gegen Alpha Vantage und die gespeicherte Reihe: Wochenschlüsse roh und bereinigt, nur runs.json wird geschrieben */
      const e = await F.eodhd('VWRD.LSE', addDays(TODAY, -420)), av = await F.av('VWRD.LON'), stored = storedSeries('ftse');
      note('EODHD VWRD.LSE: ' + e.dates.length + ' Tage von ' + e.dates[0] + ' bis ' + e.dates[e.dates.length - 1] + ' (letzter Schluss ' + de(e.closes[e.closes.length - 1], 2) + ', bereinigt ' + de(e.adj[e.adj.length - 1], 2) + ')');
      const wRaw = ENG.weeklyFromDaily(e.dates, e.closes, null), wAdj = ENG.weeklyFromDaily(e.dates, e.adj, null);
      const avAdj = {}, avRaw = {}; av.dates.forEach((d, i) => { avAdj[mondayOf(d)] = { d, c: av.closes[i] }; avRaw[mondayOf(d)] = { d, c: av.raw ? av.raw[i] : null }; });
      const stMap = {}; stored.k.forEach((k, i) => { stMap[k] = { d: stored.d[i], c: stored.c[i] }; });
      function compare(label, W, ref, skipLast) {
        const diffs = [], dateMismatch = [];
        for (let i = 0; i < W.k.length - (skipLast ? 1 : 0); i++) { const r = ref[W.k[i]]; if (!r || !(r.c > 0)) continue; if (r.d !== W.d[i]) dateMismatch.push(W.d[i] + '/' + r.d); diffs.push({ d: W.d[i], e: W.c[i], r: r.c, rel: W.c[i] / r.c - 1 }); }
        if (!diffs.length) { note(label + ': keine gemeinsamen Wochen'); return; }
        const abs = diffs.map((x) => Math.abs(x.rel)).sort((a, b) => a - b), mean = diffs.reduce((s, x) => s + x.rel, 0) / diffs.length, worst = diffs.slice().sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel)).slice(0, 3);
        note(label + ': ' + diffs.length + ' Wochen, mittlere Abweichung ' + de(mean * 100, 3) + ' %, Median ' + de(abs[Math.floor(abs.length / 2)] * 100, 3) + ' %, größte ' + de(abs[abs.length - 1] * 100, 3) + ' %, über 0,1 %: ' + abs.filter((x) => x > 0.001).length + (dateMismatch.length ? ', Wochenschlusstag abweichend bei ' + dateMismatch.length + ' Wochen (' + dateMismatch.slice(0, 3).join(', ') + ')' : '') + ' · größte: ' + worst.map((x) => ds(x.d) + ' ' + de(x.e, 2) + ' vs ' + de(x.r, 2)).join('; '));
      }
      compare('EODHD roh vs Alpha Vantage roh', wRaw, avRaw, false);
      compare('EODHD bereinigt vs Alpha Vantage bereinigt', wAdj, avAdj, false);
      compare('EODHD bereinigt vs gespeicherte Signalreihe', wAdj, stMap, false);
      /* Signalprüfung: SMA50-Zustand der letzten Wochen mit EODHD-Daten (an die gespeicherte Reihe angehängt) gegen den gespeicherten Zustand */
      try { const merged = ENG.mergeWeekly(stored, wAdj, true), E1 = ENG.evalRule(merged, CFG.assets.ftse.rule), E0 = ENG.evalRule(stored, CFG.assets.ftse.rule); const n = Math.min(52, E0.st.length); let diff = 0; for (let i = 1; i <= n; i++) { const k = stored.k[stored.k.length - i], j = merged.k.indexOf(k); if (j >= 0 && E1.st[j] !== E0.st[E0.st.length - i]) diff++; } note('Regelzustand der letzten ' + n + ' Wochen mit EODHD-Daten: ' + (diff ? diff + ' Woche(n) anders' : 'identisch')); } catch (e2) { note('Regelprüfung nicht möglich: ' + e2.message); }
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
  saveJson('events.json', pruneEvents(EVENTS, 600));
  RUNS.unshift({ t: RUN.t, step, ok: RUN.ok, summary: RUN.summary.join(' | '), errors: RUN.errors, notified: RUN.notified, final: OPT.final });
  const keptRuns = pruneRuns(RUNS); RUNS.length = 0; keptRuns.forEach((r) => RUNS.push(r));
  saveJson('runs.json', RUNS);
  if (SRC.yahooStatus && SRC.yahooStatus.calls) { RUN.yahoo = { calls: SRC.yahooStatus.calls, failures: SRC.yahooStatus.failures, blocked: SRC.yahooStatus.blocked }; RUNS[0].yahoo = RUN.yahoo; saveJson('runs.json', RUNS); }
  log((RUN.ok ? 'OK' : 'MIT FEHLERN') + ' · ' + RUN.summary.length + ' Punkte · ' + RUN.errors.length + ' Fehler' + (RUN.yahoo ? ' · Yahoo ' + RUN.yahoo.calls + ' Abrufe, ' + RUN.yahoo.failures + ' Fehler' + (RUN.yahoo.blocked ? ', gesperrt' : '') : ''));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'ok=' + (RUN.ok ? 'true' : 'false') + '\nsummary=' + mask(RUN.summary.join(' | ').replace(/\n/g, ' ')).slice(0, 900) + '\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
