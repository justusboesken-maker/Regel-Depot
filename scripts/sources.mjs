/* Kursquellen für das Update-Skript. Hauptquellen: Alpha Vantage (VWRD.LON bereinigt), EODHD (VWRD.LSE Tagesschluss), Coinbase (Krypto),
   LBMA (Gold), EZB (EUR/USD), Lang & Schwarz (Euro-Kurse von ETF und Gold-ETC wie bei Trade Republic; Ersatz: Alpha Vantage VWCE.DEX, GZUR.DEX).
   Weitere Quellen: Kraken (Krypto), Yahoo Finance (Gegenprobe; von GitHub-Runnern meist mit HTTP 429 abgewiesen), gold-api.
   Welche Quelle als „Ersatzquelle“ gilt, entscheidet das Update-Skript anhand der Konfiguration, nicht diese Datei. Alle Funktionen liefern {dates:[ISO], closes:[Zahl], price?, priceTime?, src}
   in chronologischer Reihenfolge. */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* API-Keys aus Fehlertexten entfernen (die landen sonst in runs.json, state.json und Commit-Nachrichten des öffentlichen Repos) */
export function hideKey(s, key) {
  let t = String(s == null ? '' : s);
  if (key && key.length >= 4) t = t.split(key).join('***');
  return t.replace(/(api ?key (?:as|is)\s+)[A-Za-z0-9_-]+/gi, '$1***').replace(/((?:apikey|api_key|api_token|token)=)[^&\s"']+/gi, '$1***');
}

async function get(url, opts = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeout || 25000);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA, 'Accept': opts.accept || 'application/json,text/plain,*/*', 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) }, signal: ctl.signal, redirect: 'follow' });
  } finally { clearTimeout(timer); }
}

/* ---------- Yahoo Finance ----------
   GitHub-Runner werden von Yahoo oft mit HTTP 429 abgewiesen. Deshalb: Wiederholungen mit Pause und Hostwechsel,
   und nach einem endgültigen Fehlschlag gilt Yahoo für den restlichen Lauf als gesperrt (schneller Abbruch). */
let yahooSession = null; /* {cookie, crumb} */
export const yahooStatus = { blocked: false, lastError: null, calls: 0, failures: 0 };
const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
async function yahooAuth(host) {
  if (yahooSession) return yahooSession;
  const r1 = await get('https://fc.yahoo.com/', { accept: 'text/html' });
  const setCookies = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('kein Cookie erhalten');
  const r2 = await get('https://' + host + '/v1/test/getcrumb', { accept: 'text/plain', headers: { Cookie: cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.length > 40 || crumb.includes('<')) throw new Error('kein Crumb (HTTP ' + r2.status + ')');
  yahooSession = { cookie, crumb };
  return yahooSession;
}
async function yahooJson(pathAndQuery, once) {
  if (yahooStatus.blocked) throw new Error('Yahoo in diesem Lauf gesperrt (' + yahooStatus.lastError + ')');
  const waits = once ? [0] : [0, 12000, 30000];
  let lastErr = null;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await sleep(waits[i]);
    const host = YAHOO_HOSTS[i % YAHOO_HOSTS.length];
    try {
      yahooStatus.calls++;
      let res = await get('https://' + host + pathAndQuery);
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        const s = await yahooAuth(host);
        res = await get('https://' + host + pathAndQuery + '&crumb=' + encodeURIComponent(s.crumb), { headers: { Cookie: s.cookie } });
      }
      if (!res.ok) throw new Error('Yahoo HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e; yahooStatus.failures++;
      if (!/429|401|403|Crumb|Cookie|abort/i.test(e.message)) break; /* andere Fehler nicht wiederholen */
    }
  }
  yahooStatus.blocked = true; yahooStatus.lastError = lastErr ? lastErr.message : 'unbekannt';
  throw new Error('Yahoo: ' + yahooStatus.lastError);
}
/* Tageskerzen. opts: {adj, start:'YYYY-MM-DD', range:'1mo'} */
export async function yahooDaily(sym, opts = {}) {
  const q = new URLSearchParams({ interval: '1d', includeAdjustedClose: 'true', events: 'div,splits' });
  if (opts.start) { q.set('period1', String(Math.floor(new Date(opts.start + 'T00:00:00Z').getTime() / 1000))); q.set('period2', String(Math.floor(Date.now() / 1000) + 86400)); }
  else q.set('range', opts.range || '3mo');
  const j = await yahooJson('/v8/finance/chart/' + encodeURIComponent(sym) + '?' + q.toString(), !!opts.once);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp || !r.timestamp.length) throw new Error('Yahoo ' + sym + ': keine Daten' + (j && j.chart && j.chart.error ? ' (' + JSON.stringify(j.chart.error).slice(0, 120) + ')' : ''));
  /* Devisen tragen den Zeitstempel 23:00 UTC des Vortags -> mit gmtoffset auf den Handelstag schieben */
  const off = sym.endsWith('=X') ? (r.meta.gmtoffset || 0) * 1000 : 0;
  const quote = r.indicators.quote[0];
  const arr = opts.adj ? (r.indicators.adjclose && r.indicators.adjclose[0].adjclose) : quote.close;
  if (!arr) throw new Error('Yahoo ' + sym + ': keine ' + (opts.adj ? 'bereinigten ' : '') + 'Schlusskurse');
  const dates = [], closes = [];
  for (let i = 0; i < r.timestamp.length; i++) { const c = arr[i]; if (c == null || !isFinite(c) || c <= 0) continue; dates.push(iso(r.timestamp[i] * 1000 + off)); closes.push(c); }
  const m = r.meta || {};
  return { dates, closes, price: m.regularMarketPrice, priceTime: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null, marketState: m.marketState || null, currency: m.currency || null, src: 'yahoo ' + sym + (opts.adj ? ' adjclose' : '') };
}

/* ---------- LBMA Gold (Fixing in USD) ----------
   Die LBMA-Seite weist Abrufe zeitweise mit HTTP 403 ab (26.09.2026 nachts, zwei Stunden vorher ging es). Deshalb bis zu drei Versuche
   mit Pause, abwechselnd mit ehrlicher Programm-Kennung und Browser-Kennung, ab dem zweiten Versuch ohne Zwischenspeicher (Zeitstempel in der Adresse). */
const UA_BOT = 'regel-depot/1.0 (+https://github.com/justusboesken-maker/Regel-Depot)';
export async function lbmaGold(fix = 'pm', since = '2005-01-01') {
  const tries = [{ ua: UA_BOT, wait: 0 }, { ua: UA, wait: 15000, bust: true }, { ua: UA_BOT, wait: 40000, bust: true }];
  let lastErr = null, n = 0;
  for (const t of tries) {
    if (t.wait) await sleep(t.wait);
    n++;
    try {
      const res = await get('https://prices.lbma.org.uk/json/gold_' + fix + '.json' + (t.bust ? '?t=' + Date.now() : ''), { headers: { 'User-Agent': t.ua } });
      if (!res.ok) throw new Error('LBMA HTTP ' + res.status);
      const j = await res.json();
      if (!Array.isArray(j)) throw new Error('LBMA: unerwartete Antwort');
      const rows = j.filter((x) => x && typeof x.d === 'string' && x.d >= since && x.v && +x.v[0] > 0).sort((a, b) => (a.d < b.d ? -1 : 1));
      if (!rows.length) throw new Error('LBMA: keine Daten');
      return { dates: rows.map((x) => x.d), closes: rows.map((x) => +x.v[0]), src: 'lbma gold ' + fix + ' usd' };
    } catch (e) {
      lastErr = e;
      /* Nur vorübergehende Fehler wiederholen (gesperrt, überlastet, Netz, abgebrochene oder kaputte Antwort) */
      if (!/HTTP (403|408|425|429|5\d\d)|abort|fetch failed|network|ECONN|ETIMEDOUT|socket|JSON|Unexpected|unerwartete/i.test(e.message)) break;
    }
  }
  throw new Error(lastErr.message + (n > 1 ? ' (' + n + ' Versuche)' : ''));
}

/* ---------- Alpha Vantage (kostenloser Key, 25 Abrufe am Tag) ---------- */
export const avStatus = { calls: 0, last: 0, budget: 8 };
async function avJson(params, key) {
  if (!key) throw new Error('Alpha Vantage: kein Key (Secret ALPHAVANTAGE_KEY)');
  if (avStatus.calls >= avStatus.budget) throw new Error('Alpha Vantage: Abrufbudget dieses Laufs aufgebraucht');
  const wait = avStatus.last ? 15000 - (Date.now() - avStatus.last) : 0;
  if (wait > 0) await sleep(wait);
  avStatus.calls++; avStatus.last = Date.now();
  const q = new URLSearchParams({ ...params, apikey: key });
  const res = await get('https://www.alphavantage.co/query?' + q.toString());
  if (!res.ok) throw new Error('Alpha Vantage HTTP ' + res.status);
  const j = await res.json();
  /* Die Limit-Meldung nennt den Key im Klartext („We have detected your API key as …“): nie in Fehlertexte übernehmen */
  if (j.Note || j.Information || j['Error Message']) throw new Error('Alpha Vantage: ' + hideKey(String(j.Note || j.Information || j['Error Message']), key).slice(0, 140));
  return j;
}
/* Wöchentlich bereinigt (Woche endet am letzten Handelstag), VWRD.LON: gleiche 2-Wochen-Signale wie Yahoo VWRD.L adjclose */
export async function alphaVantageWeeklyAdjusted(sym, key) {
  const j = await avJson({ function: 'TIME_SERIES_WEEKLY_ADJUSTED', symbol: sym }, key), ts = j['Weekly Adjusted Time Series'];
  if (!ts) throw new Error('Alpha Vantage ' + sym + ': keine Wochendaten');
  const dates = Object.keys(ts).sort(), closes = dates.map((d) => +ts[d]['5. adjusted close']), raw = dates.map((d) => +ts[d]['4. close']);
  return { dates, closes, raw, src: 'alphavantage ' + sym + ' weekly adjusted' };
}
/* Kryptowährung täglich in USD (volle Historie) */
export async function alphaVantageCryptoDaily(symbol, market, key) {
  const j = await avJson({ function: 'DIGITAL_CURRENCY_DAILY', symbol, market }, key), ts = j['Time Series (Digital Currency Daily)'];
  if (!ts) throw new Error('Alpha Vantage ' + symbol + ': keine Tagesdaten');
  const dates = Object.keys(ts).sort(), closes = dates.map((d) => { const r = ts[d]; return +(r['4. close'] || r['4a. close (' + market + ')'] || r['4b. close (USD)']); });
  const out = { dates: [], closes: [] };
  for (let i = 0; i < dates.length; i++) if (closes[i] > 0) { out.dates.push(dates[i]); out.closes.push(closes[i]); }
  /* Der jüngste Tag ist meist der laufende (unvollständige) Tag */
  return { dates: out.dates, closes: out.closes, price: out.closes[out.closes.length - 1], priceTime: new Date().toISOString(), src: 'alphavantage ' + symbol + '-' + market + ' daily' };
}
/* Tagesschlüsse (compact = 100 Tage, full = komplette Historie) */
/* outputsize=full ist seit 2025 nur noch im Bezahltarif; compact liefert die letzten 100 Handelstage (rund fünf Monate).
   Wird full verlangt und abgelehnt, fällt die Funktion auf compact zurück. */
export async function alphaVantageDaily(sym, key, full) {
  let j;
  try { j = await avJson({ function: 'TIME_SERIES_DAILY', symbol: sym, outputsize: full ? 'full' : 'compact' }, key); }
  catch (e) { if (full && /outputsize|premium/i.test(e.message)) j = await avJson({ function: 'TIME_SERIES_DAILY', symbol: sym, outputsize: 'compact' }, key); else throw e; }
  const ts = j['Time Series (Daily)'];
  if (!ts) throw new Error('Alpha Vantage ' + sym + ': keine Tagesdaten');
  const dates = Object.keys(ts).sort(), closes = dates.map((d) => +ts[d]['4. close']);
  const out = { dates: [], closes: [] };
  for (let i = 0; i < dates.length; i++) if (closes[i] > 0) { out.dates.push(dates[i]); out.closes.push(closes[i]); }
  return { dates: out.dates, closes: out.closes, price: out.closes[out.closes.length - 1], priceTime: out.dates[out.dates.length - 1] + 'T16:30:00Z', src: 'alphavantage ' + sym + ' daily' };
}
/* Aktueller Kurs (verzögert) */
export async function alphaVantageQuote(sym, key) {
  const j = await avJson({ function: 'GLOBAL_QUOTE', symbol: sym }, key), g = j['Global Quote'];
  if (!g || !(+g['05. price'] > 0)) throw new Error('Alpha Vantage ' + sym + ': kein Kurs');
  return { price: +g['05. price'], priceTime: g['07. latest trading day'] ? g['07. latest trading day'] + 'T16:30:00Z' : null, src: 'alphavantage ' + sym + ' quote' };
}

/* ---------- Coinbase (ohne Key) ---------- */
/* Tageskerzen in UTC, höchstens 300 je Abruf. [time, low, high, open, close, volume] */
export async function coinbaseDaily(product = 'BTC-USD', days = 60) {
  const end = new Date(), start = new Date(end.getTime() - days * 86400000);
  const url = 'https://api.exchange.coinbase.com/products/' + product + '/candles?granularity=86400&start=' + start.toISOString() + '&end=' + end.toISOString();
  const res = await get(url);
  if (!res.ok) throw new Error('Coinbase HTTP ' + res.status);
  const j = (await res.json()).sort((a, b) => a[0] - b[0]);
  const dates = j.map((c) => iso(c[0] * 1000)), closes = j.map((c) => c[4]);
  return { dates, closes, price: closes[closes.length - 1], priceTime: new Date().toISOString(), src: 'coinbase ' + product + '' };
}
/* Wechselkurs (Basis -> Gegenwährung), aktualisiert sich laufend */
export async function coinbaseFx(base = 'EUR', quote = 'USD') {
  const res = await get('https://api.coinbase.com/v2/exchange-rates?currency=' + base);
  if (!res.ok) throw new Error('Coinbase HTTP ' + res.status);
  const j = await res.json(), r = j && j.data && j.data.rates && +j.data.rates[quote];
  if (!(r > 0)) throw new Error('Coinbase: kein Kurs ' + base + '/' + quote);
  return { rate: r, priceTime: new Date().toISOString(), src: 'coinbase ' + base + '-' + quote + '' };
}
export async function coinbaseSpot(product = 'BTC-EUR') {
  const res = await get('https://api.coinbase.com/v2/prices/' + product + '/spot');
  if (!res.ok) throw new Error('Coinbase HTTP ' + res.status);
  const j = await res.json();
  return { price: +j.data.amount, priceTime: new Date().toISOString(), src: 'coinbase ' + product + ' spot' };
}

/* ---------- EODHD (kostenloser Key, 20 Abrufe am Tag; Tagesschlüsse europäischer Börsen meist 1–2 Stunden nach Handelsschluss) ---------- */
export const eodhdStatus = { calls: 0, budget: 4 };
async function eodhdJson(pathAndQuery, key) {
  if (!key) throw new Error('EODHD: kein Key (Secret EODHD_KEY)');
  if (eodhdStatus.calls >= eodhdStatus.budget) throw new Error('EODHD: Abrufbudget dieses Laufs aufgebraucht');
  eodhdStatus.calls++;
  const res = await get('https://eodhd.com/api/' + pathAndQuery + (pathAndQuery.includes('?') ? '&' : '?') + 'api_token=' + encodeURIComponent(key) + '&fmt=json');
  if (!res.ok) throw new Error('EODHD HTTP ' + res.status);
  const j = await res.json();
  if (j && !Array.isArray(j) && (j.errors || j.message)) throw new Error('EODHD: ' + hideKey(String(j.message || JSON.stringify(j.errors)), key).slice(0, 120));
  return j;
}
/* Tagesschlüsse (unbereinigt und bereinigt), sym z. B. VWRD.LSE */
export async function eodhdDaily(sym, key, from) {
  const j = await eodhdJson('eod/' + encodeURIComponent(sym) + '?period=d&order=a' + (from ? '&from=' + from : ''), key);
  if (!Array.isArray(j) || !j.length) throw new Error('EODHD ' + sym + ': keine Daten');
  const rows = j.filter((r) => r && r.date && +r.close > 0);
  if (!rows.length) throw new Error('EODHD ' + sym + ': keine Schlusskurse');
  return { dates: rows.map((r) => r.date), closes: rows.map((r) => +r.close), adj: rows.map((r) => +(r.adjusted_close || r.close)), price: +rows[rows.length - 1].close, priceTime: rows[rows.length - 1].date + 'T16:30:00Z', src: 'eodhd ' + sym };
}
/* Letzter Kurs (15–20 Minuten verzögert); nach Börsenschluss der Schlusskurs */
export async function eodhdLive(sym, key) {
  const j = await eodhdJson('real-time/' + encodeURIComponent(sym), key);
  const p = +(j && j.close), ts = j && +j.timestamp;
  if (!(p > 0) || !(ts > 0)) throw new Error('EODHD ' + sym + ': kein Kurs');
  return { price: p, priceTime: new Date(ts * 1000).toISOString(), src: 'eodhd ' + sym + ' live (verzögert)' };
}

/* ---------- Lang & Schwarz TradeCenter (ls-tc.de) ----------
   Kurse des Market Makers, den auch Trade Republic stellt (LS Exchange). Es sind die Endpunkte, die die Website selbst für Suche und Chart nutzt (nicht dokumentiert).
   Zeitstempel kommen als Berliner Uhrzeit, die wie UTC kodiert ist; für Tagesdaten zählt deshalb das UTC-Datum des Stempels. */
const lsData = (x) => Array.isArray(x) ? x : (x && Array.isArray(x.data) ? x.data : []);
function berlinOffsetMs(t) {
  /* Abstand Berlin zu UTC zum Zeitpunkt t (Sommer 2 h, Winter 1 h) */
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
  const g = (k) => +parts.find((p) => p.type === k).value;
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}
export async function lsSearch(query) {
  const res = await get('https://www.ls-tc.de/_rpc/json/.lstc/instrument/search/main?q=' + encodeURIComponent(query) + '&localeId=2');
  if (!res.ok) throw new Error('L&S Suche HTTP ' + res.status);
  const j = await res.json(), list = Array.isArray(j) ? j : [];
  const hit = list.find((x) => x.isin === query || x.wkn === query) || list[0];
  if (!hit || !hit.instrumentId) throw new Error('L&S: ' + query + ' nicht gefunden');
  return { id: hit.instrumentId || hit.id, name: hit.displayname || hit.displayName || '', isin: hit.isin, wkn: hit.wkn, src: 'ls-tc.de Suche' };
}
/* Tagesschlüsse (Schluss um 23 Uhr Berlin) und letzter Kurs (Mitte aus Geld und Brief). id = L&S-Instrument-ID, label nur für die Quellenangabe */
export async function lsChart(id, label) {
  const res = await get('https://www.ls-tc.de/_rpc/json/instrument/chart/dataForInstrument?container=chart1&instrumentId=' + id + '&marketId=1&quotetype=mid&series=intraday%2Chistory&type=&localeId=2');
  if (!res.ok) throw new Error('L&S HTTP ' + res.status);
  const j = await res.json(), S = j.series || {};
  const hist = lsData(S.history).filter((p) => p && p[1] > 0).sort((a, b) => a[0] - b[0]);
  const intra = lsData(S.intraday).filter((p) => p && p[1] > 0).sort((a, b) => a[0] - b[0]);
  const byDay = {}; hist.forEach((p) => { byDay[iso(p[0])] = p[1]; });
  const dates = Object.keys(byDay).sort(), closes = dates.map((d) => byDay[d]);
  let price = null, priceTime = null, priceDay = null;
  if (intra.length) { const last = intra[intra.length - 1]; price = last[1]; priceDay = iso(last[0]); priceTime = new Date(last[0] - berlinOffsetMs(last[0])).toISOString(); }
  else if (dates.length) { price = closes[closes.length - 1]; priceDay = dates[dates.length - 1]; }
  if (!dates.length && !(price > 0)) throw new Error('L&S: keine Daten für ' + (label || id));
  const prev = ((j.info || {}).plotlines || []).find((x) => x.id === 'previousDay');
  return { dates, closes, price, priceTime, priceDay, prevClose: prev ? prev.value : null, isin: (j.info || {}).isin || null, src: 'ls-tc.de ' + (label || id) };
}

/* ---------- Kraken (öffentliche API, ohne Key) ---------- */
function krakenResult(j) {
  if (!j || (j.error && j.error.length)) throw new Error('Kraken: ' + (j && j.error ? j.error.join(', ') : 'keine Antwort'));
  const keys = Object.keys(j.result || {}).filter((k) => k !== 'last');
  if (!keys.length) throw new Error('Kraken: leeres Ergebnis');
  return j.result[keys[0]];
}
/* Tageskerzen (UTC-Tage), letzte Kerze = laufender Tag. pair z. B. XBTUSD, XBTEUR, ETHEUR, SOLEUR */
export async function krakenDaily(pair = 'XBTUSD', days = 60) {
  const since = Math.floor(Date.now() / 1000) - (days + 1) * 86400;
  const res = await get('https://api.kraken.com/0/public/OHLC?pair=' + pair + '&interval=1440&since=' + since);
  if (!res.ok) throw new Error('Kraken HTTP ' + res.status);
  const rows = krakenResult(await res.json()).slice().sort((a, b) => a[0] - b[0]);
  const dates = rows.map((c) => iso(c[0] * 1000)), closes = rows.map((c) => +c[4]);
  if (!dates.length) throw new Error('Kraken ' + pair + ': keine Kerzen');
  return { dates, closes, price: closes[closes.length - 1], priceTime: new Date().toISOString(), src: 'kraken ' + pair };
}
export async function krakenTicker(pair = 'XBTEUR') {
  const res = await get('https://api.kraken.com/0/public/Ticker?pair=' + pair);
  if (!res.ok) throw new Error('Kraken HTTP ' + res.status);
  const t = krakenResult(await res.json()), p = +(t.c && t.c[0]);
  if (!(p > 0)) throw new Error('Kraken ' + pair + ': kein Kurs');
  return { price: p, priceTime: new Date().toISOString(), src: 'kraken ' + pair + ' ticker' };
}

/* ---------- Stooq (ohne Key; CSV) ---------- */
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('Stooq: leere Antwort');
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => { const c = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = (c[i] || '').trim(); }); return o; });
}
/* Tagesdaten: Date,Open,High,Low,Close,Volume */
export async function stooqDaily(sym) {
  const res = await get('https://stooq.com/q/d/l/?s=' + encodeURIComponent(sym) + '&i=d', { accept: 'text/csv,text/plain,*/*' });
  if (!res.ok) throw new Error('Stooq HTTP ' + res.status);
  const text = await res.text();
  if (/exceeded|limit/i.test(text) && text.length < 200) throw new Error('Stooq: Tageslimit erreicht');
  const rows = parseCsv(text).filter((r) => r.date && +r.close > 0);
  if (!rows.length) throw new Error('Stooq ' + sym + ': keine Daten');
  return { dates: rows.map((r) => r.date), closes: rows.map((r) => +r.close), price: +rows[rows.length - 1].close, priceTime: rows[rows.length - 1].date + 'T00:00:00Z', src: 'stooq ' + sym + ' daily' };
}
/* Aktueller Kurs (verzögert): Symbol,Date,Time,Open,High,Low,Close,Volume */
export async function stooqQuote(sym) {
  const res = await get('https://stooq.com/q/l/?s=' + encodeURIComponent(sym) + '&f=sd2t2ohlcv&h&e=csv', { accept: 'text/csv,text/plain,*/*' });
  if (!res.ok) throw new Error('Stooq HTTP ' + res.status);
  const rows = parseCsv(await res.text());
  const r = rows[0];
  if (!r || !(+r.close > 0) || r.close === 'N/D') throw new Error('Stooq ' + sym + ': kein Kurs');
  return { price: +r.close, priceTime: (r.date && r.time) ? r.date + 'T' + r.time + 'Z' : null, date: r.date, src: 'stooq ' + sym + ' quote' };
}

/* ---------- Gold-Spot ohne Key (für die Vorwarnung; Preis je Feinunze in USD) ---------- */
export async function goldSpotGoldpriceOrg() {
  const res = await get('https://data-asg.goldprice.org/dbXRates/USD');
  if (!res.ok) throw new Error('goldprice.org HTTP ' + res.status);
  const j = await res.json(), it = j && j.items && j.items[0];
  if (!it || !(+it.xauPrice > 0)) throw new Error('goldprice.org: kein Kurs');
  return { price: +it.xauPrice, priceTime: j.ts ? new Date(j.ts).toISOString() : new Date().toISOString(), src: 'goldprice.org XAU/USD spot' };
}
export async function goldSpotGoldApi() {
  const res = await get('https://api.gold-api.com/price/XAU');
  if (!res.ok) throw new Error('gold-api.com HTTP ' + res.status);
  const j = await res.json();
  if (!(+j.price > 0)) throw new Error('gold-api.com: kein Kurs');
  return { price: +j.price, priceTime: j.updatedAt || new Date().toISOString(), src: 'gold-api.com XAU/USD spot' };
}

/* ---------- EZB-Referenzkurs über frankfurter.app (nur Werktage) ---------- */
/* EZB-Referenzkurse als Zeitreihe (Werktage) */
export async function ecbEurUsdRange(from, to) {
  const res = await get('https://api.frankfurter.app/' + from + '..' + (to || '') + '?from=EUR&to=USD');
  if (!res.ok) throw new Error('Frankfurter HTTP ' + res.status);
  const j = await res.json(), dates = Object.keys(j.rates || {}).sort();
  if (!dates.length) throw new Error('Frankfurter: keine Daten');
  return { dates, closes: dates.map((d) => j.rates[d].USD), src: 'ezb eurusd' };
}
export async function ecbEurUsd() {
  const res = await get('https://api.frankfurter.app/latest?from=EUR&to=USD');
  if (!res.ok) throw new Error('Frankfurter HTTP ' + res.status);
  const j = await res.json();
  return { dates: [j.date], closes: [j.rates.USD], price: j.rates.USD, priceTime: j.date + 'T14:15:00Z', src: 'ezb eurusd' };
}
