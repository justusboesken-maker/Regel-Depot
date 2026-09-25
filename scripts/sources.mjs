/* Kursquellen für das Update-Skript. Primär Yahoo Finance (Chart-API) und LBMA, dazu Ersatzquellen
   (Alpha Vantage, Coinbase, Stooq, EZB). Alle Funktionen liefern {dates:[ISO], closes:[Zahl], price?, priceTime?, src}
   in chronologischer Reihenfolge. */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function yahooJson(pathAndQuery) {
  if (yahooStatus.blocked) throw new Error('Yahoo in diesem Lauf gesperrt (' + yahooStatus.lastError + ')');
  const waits = [0, 12000, 30000];
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
  const j = await yahooJson('/v8/finance/chart/' + encodeURIComponent(sym) + '?' + q.toString());
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

/* ---------- LBMA Gold (Fixing in USD) ---------- */
export async function lbmaGold(fix = 'pm', since = '2005-01-01') {
  const res = await get('https://prices.lbma.org.uk/json/gold_' + fix + '.json');
  if (!res.ok) throw new Error('LBMA HTTP ' + res.status);
  const j = await res.json();
  const rows = j.filter((x) => x && x.d >= since && x.v && x.v[0] > 0).sort((a, b) => (a.d < b.d ? -1 : 1));
  if (!rows.length) throw new Error('LBMA: keine Daten');
  return { dates: rows.map((x) => x.d), closes: rows.map((x) => x.v[0]), src: 'lbma gold ' + fix + ' usd' };
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
  if (j.Note || j.Information || j['Error Message']) throw new Error('Alpha Vantage: ' + String(j.Note || j.Information || j['Error Message']).slice(0, 140));
  return j;
}
/* Wöchentlich bereinigt (Woche endet am letzten Handelstag), VWRD.LON: gleiche 2-Wochen-Signale wie Yahoo VWRD.L adjclose */
export async function alphaVantageWeeklyAdjusted(sym, key) {
  const j = await avJson({ function: 'TIME_SERIES_WEEKLY_ADJUSTED', symbol: sym }, key), ts = j['Weekly Adjusted Time Series'];
  if (!ts) throw new Error('Alpha Vantage ' + sym + ': keine Wochendaten');
  const dates = Object.keys(ts).sort(), closes = dates.map((d) => +ts[d]['5. adjusted close']);
  return { dates, closes, src: 'alphavantage ' + sym + ' weekly adjusted (Ersatzquelle)' };
}
/* Kryptowährung täglich in USD (volle Historie) */
export async function alphaVantageCryptoDaily(symbol, market, key) {
  const j = await avJson({ function: 'DIGITAL_CURRENCY_DAILY', symbol, market }, key), ts = j['Time Series (Digital Currency Daily)'];
  if (!ts) throw new Error('Alpha Vantage ' + symbol + ': keine Tagesdaten');
  const dates = Object.keys(ts).sort(), closes = dates.map((d) => { const r = ts[d]; return +(r['4. close'] || r['4a. close (' + market + ')'] || r['4b. close (USD)']); });
  const out = { dates: [], closes: [] };
  for (let i = 0; i < dates.length; i++) if (closes[i] > 0) { out.dates.push(dates[i]); out.closes.push(closes[i]); }
  /* Der jüngste Tag ist meist der laufende (unvollständige) Tag */
  return { dates: out.dates, closes: out.closes, price: out.closes[out.closes.length - 1], priceTime: new Date().toISOString(), src: 'alphavantage ' + symbol + '-' + market + ' daily (Ersatzquelle)' };
}
/* Aktueller Kurs (verzögert) */
export async function alphaVantageQuote(sym, key) {
  const j = await avJson({ function: 'GLOBAL_QUOTE', symbol: sym }, key), g = j['Global Quote'];
  if (!g || !(+g['05. price'] > 0)) throw new Error('Alpha Vantage ' + sym + ': kein Kurs');
  return { price: +g['05. price'], priceTime: g['07. latest trading day'] ? g['07. latest trading day'] + 'T16:30:00Z' : null, src: 'alphavantage ' + sym + ' quote (Ersatzquelle)' };
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
  return { dates, closes, price: closes[closes.length - 1], priceTime: new Date().toISOString(), src: 'coinbase ' + product + ' (Ersatzquelle)' };
}
export async function coinbaseSpot(product = 'BTC-EUR') {
  const res = await get('https://api.coinbase.com/v2/prices/' + product + '/spot');
  if (!res.ok) throw new Error('Coinbase HTTP ' + res.status);
  const j = await res.json();
  return { price: +j.data.amount, priceTime: new Date().toISOString(), src: 'coinbase ' + product + ' spot (Ersatzquelle)' };
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
  return { dates: rows.map((r) => r.date), closes: rows.map((r) => +r.close), price: +rows[rows.length - 1].close, priceTime: rows[rows.length - 1].date + 'T00:00:00Z', src: 'stooq ' + sym + ' daily (Ersatzquelle)' };
}
/* Aktueller Kurs (verzögert): Symbol,Date,Time,Open,High,Low,Close,Volume */
export async function stooqQuote(sym) {
  const res = await get('https://stooq.com/q/l/?s=' + encodeURIComponent(sym) + '&f=sd2t2ohlcv&h&e=csv', { accept: 'text/csv,text/plain,*/*' });
  if (!res.ok) throw new Error('Stooq HTTP ' + res.status);
  const rows = parseCsv(await res.text());
  const r = rows[0];
  if (!r || !(+r.close > 0) || r.close === 'N/D') throw new Error('Stooq ' + sym + ': kein Kurs');
  return { price: +r.close, priceTime: (r.date && r.time) ? r.date + 'T' + r.time + 'Z' : null, date: r.date, src: 'stooq ' + sym + ' quote (Ersatzquelle)' };
}

/* ---------- Gold-Spot ohne Key (für die Vorwarnung; Preis je Feinunze in USD) ---------- */
export async function goldSpotGoldpriceOrg() {
  const res = await get('https://data-asg.goldprice.org/dbXRates/USD');
  if (!res.ok) throw new Error('goldprice.org HTTP ' + res.status);
  const j = await res.json(), it = j && j.items && j.items[0];
  if (!it || !(+it.xauPrice > 0)) throw new Error('goldprice.org: kein Kurs');
  return { price: +it.xauPrice, priceTime: j.ts ? new Date(j.ts).toISOString() : new Date().toISOString(), src: 'goldprice.org XAU/USD spot (Ersatzquelle)' };
}
export async function goldSpotGoldApi() {
  const res = await get('https://api.gold-api.com/price/XAU');
  if (!res.ok) throw new Error('gold-api.com HTTP ' + res.status);
  const j = await res.json();
  if (!(+j.price > 0)) throw new Error('gold-api.com: kein Kurs');
  return { price: +j.price, priceTime: j.updatedAt || new Date().toISOString(), src: 'gold-api.com XAU/USD spot (Ersatzquelle)' };
}

/* ---------- EZB-Referenzkurs über frankfurter.app (nur Werktage) ---------- */
export async function ecbEurUsd() {
  const res = await get('https://api.frankfurter.app/latest?from=EUR&to=USD');
  if (!res.ok) throw new Error('Frankfurter HTTP ' + res.status);
  const j = await res.json();
  return { dates: [j.date], closes: [j.rates.USD], price: j.rates.USD, priceTime: j.date + 'T14:15:00Z', src: 'ezb eurusd (Ersatzquelle)' };
}
