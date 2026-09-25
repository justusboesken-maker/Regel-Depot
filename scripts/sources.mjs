/* Kursquellen für das Update-Skript. Primär Yahoo Finance (Chart-API) und LBMA, dazu Ersatzquellen.
   Alle Funktionen liefern {dates:[ISO], closes:[Zahl], price?, priceDate?, src} in chronologischer Reihenfolge. */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const iso = (t) => new Date(t).toISOString().slice(0, 10);

async function get(url, opts = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), opts.timeout || 25000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': opts.accept || 'application/json,text/plain,*/*', ...(opts.headers || {}) }, signal: ctl.signal, redirect: 'follow' });
    return res;
  } finally { clearTimeout(timer); }
}

/* ---------- Yahoo Finance ---------- */
let yahooSession = null; /* {cookie, crumb} */
async function yahooAuth() {
  if (yahooSession) return yahooSession;
  const r1 = await get('https://fc.yahoo.com/', { accept: 'text/html' });
  const setCookies = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Yahoo: kein Cookie erhalten');
  const r2 = await get('https://query2.finance.yahoo.com/v1/test/getcrumb', { accept: 'text/plain', headers: { Cookie: cookie } });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.length > 40 || crumb.includes('<')) throw new Error('Yahoo: kein Crumb (HTTP ' + r2.status + ')');
  yahooSession = { cookie, crumb };
  return yahooSession;
}
async function yahooJson(url) {
  let res = await get(url);
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    const s = await yahooAuth();
    res = await get(url + (url.includes('?') ? '&' : '?') + 'crumb=' + encodeURIComponent(s.crumb), { headers: { Cookie: s.cookie } });
  }
  if (!res.ok) throw new Error('Yahoo HTTP ' + res.status);
  return res.json();
}
/* Tageskerzen. opts: {adj, start:'YYYY-MM-DD', range:'1mo'} */
export async function yahooDaily(sym, opts = {}) {
  const q = new URLSearchParams({ interval: '1d', includeAdjustedClose: 'true', events: 'div,splits' });
  if (opts.start) { q.set('period1', String(Math.floor(new Date(opts.start + 'T00:00:00Z').getTime() / 1000))); q.set('period2', String(Math.floor(Date.now() / 1000) + 86400)); }
  else q.set('range', opts.range || '3mo');
  const j = await yahooJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?' + q.toString());
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

/* ---------- Ersatzquellen ---------- */
/* Coinbase Exchange: Tageskerzen in UTC, höchstens 300 je Abruf. [time, low, high, open, close, volume] */
export async function coinbaseDaily(product = 'BTC-USD', days = 60) {
  const end = new Date(), start = new Date(end.getTime() - days * 86400000);
  const url = 'https://api.exchange.coinbase.com/products/' + product + '/candles?granularity=86400&start=' + start.toISOString() + '&end=' + end.toISOString();
  const res = await get(url);
  if (!res.ok) throw new Error('Coinbase HTTP ' + res.status);
  const j = (await res.json()).sort((a, b) => a[0] - b[0]);
  const dates = j.map((c) => iso(c[0] * 1000)), closes = j.map((c) => c[4]);
  /* Die letzte Kerze ist der laufende Tag: ihr Schluss ist der aktuelle Kurs */
  return { dates, closes, price: closes[closes.length - 1], priceTime: new Date().toISOString(), src: 'coinbase ' + product + ' (Ersatzquelle)' };
}
/* Alpha Vantage: wöchentlich bereinigt (Woche endet Freitag), nur mit API-Key */
export async function alphaVantageWeeklyAdjusted(sym, key) {
  if (!key) throw new Error('Alpha Vantage: kein Key');
  const res = await get('https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=' + encodeURIComponent(sym) + '&apikey=' + encodeURIComponent(key));
  if (!res.ok) throw new Error('Alpha Vantage HTTP ' + res.status);
  const j = await res.json(), ts = j['Weekly Adjusted Time Series'];
  if (!ts) throw new Error('Alpha Vantage: ' + (j.Note || j.Information || j['Error Message'] || 'keine Daten').slice(0, 120));
  const dates = Object.keys(ts).sort(), closes = dates.map((d) => +ts[d]['5. adjusted close']);
  return { dates, closes, src: 'alphavantage ' + sym + ' weekly adjusted (Ersatzquelle)' };
}
/* EZB-Referenzkurs über frankfurter.app (nur Werktage) */
export async function ecbEurUsd() {
  const res = await get('https://api.frankfurter.app/latest?from=EUR&to=USD');
  if (!res.ok) throw new Error('Frankfurter HTTP ' + res.status);
  const j = await res.json();
  return { dates: [j.date], closes: [j.rates.USD], price: j.rates.USD, src: 'ezb eurusd (Ersatzquelle)' };
}
export async function coinbaseSpot(product = 'BTC-EUR') {
  const res = await get('https://api.coinbase.com/v2/prices/' + product + '/spot');
  if (!res.ok) throw new Error('Coinbase HTTP ' + res.status);
  const j = await res.json();
  return { price: +j.data.amount, priceTime: new Date().toISOString(), src: 'coinbase ' + product + ' spot (Ersatzquelle)' };
}
