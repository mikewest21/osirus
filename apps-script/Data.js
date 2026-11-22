/**
 * GAME OF TRADES — research desk: prices, history, indicators, news, Fear & Greed, CoinMarketCap.
 */

function fetchMarket_(cfg) {
  const warn = [];
  const uni = readUniverse_();
  const stocks = uni.filter(u => u.type === 'stock');
  const cryptos = uni.filter(u => u.type === 'crypto');
  const stocksOpen = !cfg.REQUIRE_MARKET_HOURS || isUsMarketOpen_();
  const assets = [];

  // Stocks: live price from GOOGLEFINANCE, daily history from Yahoo (GOOGLEFINANCE history is blocked for scripts)
  const gf = googleFinancePrices_(stocks);
  stocks.forEach(u => {
    const h = cached_('yh_' + u.sym, 3000, () => yahooHistory_(u.yahoo || u.sym));
    if (!h) warn.push('No history for ' + u.sym);
    const live = gf[u.sym] || (h && h.last);
    if (!live) { warn.push('No price for ' + u.sym); return; }
    const ready = !!(h && h.bars && h.bars.length >= 30);
    if (!ready) warn.push(u.sym + ' is display-only until 30+ daily history bars load');
    assets.push(buildAsset_(u, h, live, stocksOpen && ready));
  });

  // Crypto: CoinMarketCap (if key) or CoinGecko live price, CoinGecko history
  const cmc = cmcQuotes_(cryptos);
  const cg = coinGeckoPrices_(cryptos.filter(u => !(cmc[u.sym] && cmc[u.sym].price)));   // CoinGecko only fills gaps
  cryptos.forEach(u => {
    // CoinGecko's free tier often refuses back-to-back history calls; Yahoo (BTC-USD, ETH-USD…) is the backup
    let h = cached_('cg_' + u.cg, 6 * 3600, () => coinGeckoHistory_(u.cg));
    const yahooCrypto = u.yahoo || u.sym + '-USD';
    if (!h) h = cached_('yhc_' + u.sym + '_' + yahooCrypto, 6 * 3600, () => yahooHistory_(yahooCrypto));
    if (!h) warn.push('No history for ' + u.sym + ' (CoinGecko and Yahoo both failed)');
    const live = (cmc[u.sym] && cmc[u.sym].price) || cg[u.sym] || (h && h.last);
    if (!live) { warn.push('No price for ' + u.sym); return; }
    if (h && h.last) {
      const ratio = live / h.last;
      if (ratio > 5 || ratio < 0.2) {
        warn.push(u.sym + ' live/history mismatch (' + ratio.toFixed(1) + '×); indicators and trading paused');
        h = null;
      }
    }
    const ready = !!(h && h.bars && h.bars.length >= 30);
    if (!ready) warn.push(u.sym + ' is display-only until 30+ daily history bars load');
    const a = buildAsset_(u, h, live, ready);
    a.cmc = cmc[u.sym] || null;
    assets.push(a);
  });

  try { attachNews_(assets, cfg); } catch (e) { warn.push('News: ' + e.message); }
  const macro = { fngCrypto: safe_(cryptoFng_, warn), fngStock: safe_(stockFng_, warn) };
  const bySym = {};
  assets.forEach(a => bySym[a.sym] = a);
  const lead = t => bySym[t === 'stock' ? 'SPY' : 'BTC'] || assets.find(a => a.type === t);
  macro.regime = { stock: regime_(lead('stock'), macro.fngStock), crypto: regime_(lead('crypto'), macro.fngCrypto) };
  return { assets, bySym, macro, stocksOpen, warn };
}

/* ---------- market weather ---------- */

// Classifies a market (led by SPY for stocks, BTC for crypto) as Panic, Euphoria, Trending up/down, or Choppy.
function regime_(a, fng) {
  if (!a || !a.sma50 || a.er20 == null) return { name: 'Unknown', emoji: '❔', why: 'not enough price history yet' };
  const hot = a.vol20 && a.vol60 && a.vol20 > a.vol60 * 1.4;
  if ((hot && a.ret5 < -0.03) || (fng && fng.value <= 20 && a.ret5 < 0))
    return { name: 'Panic', emoji: '⛈️', why: a.sym + ' falling ' + pct_(a.ret5) + ' in 5d' + (hot ? ' on spiking volatility' : ' amid extreme fear') };
  if (fng && fng.value >= 80 && a.ret20 > 0.1)
    return { name: 'Euphoria', emoji: '🔥', why: a.sym + ' ' + pct_(a.ret20) + ' in 20d with greed at ' + fng.value };
  if (a.er20 >= 0.3 && a.ret20 > 0)
    return { name: 'Trending up', emoji: '☀️', why: a.sym + ' climbing steadily (efficiency ' + a.er20.toFixed(2) + ')' };
  if (a.er20 >= 0.3 && a.ret20 < 0)
    return { name: 'Trending down', emoji: '🌧️', why: a.sym + ' sliding steadily (efficiency ' + a.er20.toFixed(2) + ')' };
  return { name: 'Choppy', emoji: '🌫️', why: a.sym + ' moving sideways (efficiency ' + a.er20.toFixed(2) + ')' };
}

/* ---------- indicators ---------- */

function buildAsset_(u, h, live, tradable, asOf) {
  const bars = (h && h.bars) || [];               // completed daily bars: [close, high, low, volume]
  const closes = bars.map(b => b[0]).concat([live]);
  const highs = bars.map(b => b[1]), lows = bars.map(b => b[2]), vols = bars.map(b => b[3]);
  const n = closes.length, rets = [];
  for (let i = Math.max(1, n - 20); i < n; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const rets60 = [];
  for (let i = Math.max(1, n - 60); i < n; i++) rets60.push(closes[i] / closes[i - 1] - 1);
  let path = 0;
  for (let i = Math.max(1, n - 20); i < n; i++) path += Math.abs(closes[i] - closes[i - 1]);
  const prevVol = vols.slice(-21, -1), avgVol = prevVol.length ? mean_(prevVol) : 0;
  const last20 = closes.slice(-20);
  return {
    sym: u.sym, type: u.type, price: live, tradable, query: u.news,
    sma10: sma_(closes, 10), sma20: sma_(closes, 20), sma30: sma_(closes, 30), sma50: sma_(closes, 50), rsi14: rsi_(closes, 14),
    sd20: last20.length >= 20 ? stdev_(last20) : null,          // Bollinger bands: sma20 ± 2 × sd20
    closes: closes.slice(-61),                                  // recent closes (live last), for pairs spreads
    tom: turnOfMonth_(bars, u.type, h && h.src, asOf),          // the turn-of-the-month habit, measured on this asset
    ret1: ret_(closes, 1), ret5: ret_(closes, 5), ret20: ret_(closes, 20),
    vol20: rets.length >= 10 ? stdev_(rets) : null,
    vol60: rets60.length >= 40 ? stdev_(rets60) : null,
    er20: n > 21 && path > 0 ? Math.abs(closes[n - 1] - closes[n - 21]) / path : null,   // Kaufman efficiency: 1 = straight line, 0 = noise
    high20: highs.length >= 20 ? Math.max.apply(null, highs.slice(-20)) : null,
    low10: lows.length >= 10 ? Math.min.apply(null, lows.slice(-10)) : null,
    volRatio: vols.length >= 21 && avgVol > 0 ? vols[vols.length - 1] / avgVol : null,
    news: null, cmc: null
  };
}

// Turn of the month: the last trading day of a month plus the first three of the next. Weekdays only for stocks;
// crypto never closes, so it uses the last calendar day plus the first three. d = a UTC Date.
const TOM_MEMO_ = {};
function inTomWindow_(d, type) {
  const key = type + d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
  if (key in TOM_MEMO_) return TOM_MEMO_[key];
  return (TOM_MEMO_[key] = tomCalc_(d, type));
}
function tomCalc_(d, type) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate(), last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (type === 'crypto') return day <= 3 || day === last;
  const wk = x => { const w = new Date(Date.UTC(y, m, x)).getUTCDay(); return w > 0 && w < 6; };
  if (!wk(day)) return false;
  let before = 0, after = 0;
  for (let x = 1; x < day; x++) if (wk(x)) before++;
  for (let x = day + 1; x <= last; x++) if (wk(x)) after++;
  return before < 3 || after === 0;
}

// How this asset did inside the window vs outside it over its history: { now, inAvg, outAvg, edge, nIn }.
// CoinGecko stamps a day's close at the next midnight UTC, so its bars shift back a day.
function turnOfMonth_(bars, type, src, asOf) {
  const shift = src === 'cg' ? -864e5 : 0, inR = [], outR = [];
  for (let i = 1; i < bars.length; i++) {
    if (!bars[i][4] || !(bars[i - 1][0] > 0)) continue;
    (inTomWindow_(new Date(bars[i][4] + shift), type) ? inR : outR).push(bars[i][0] / bars[i - 1][0] - 1);
  }
  const inAvg = inR.length ? mean_(inR) : null, outAvg = outR.length ? mean_(outR) : null;
  const today = new Date(Utilities.formatDate(asOf || new Date(), type === 'crypto' ? 'UTC' : TZ, 'yyyy-MM-dd') + 'T12:00:00Z');
  return { now: inTomWindow_(today, type), inAvg, outAvg, edge: inAvg != null && outAvg != null ? inAvg - outAvg : null, nIn: inR.length };
}

function mean_(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function sma_(a, n) { return a.length < n ? null : mean_(a.slice(-n)); }
function ret_(a, n) { return a.length <= n ? null : a[a.length - 1] / a[a.length - 1 - n] - 1; }
function stdev_(a) { const m = mean_(a); return Math.sqrt(mean_(a.map(x => (x - m) * (x - m)))); }
function rsi_(a, n) {
  if (a.length < n + 1) return null;
  let up = 0, dn = 0;
  for (let i = a.length - n; i < a.length; i++) { const d = a[i] - a[i - 1]; if (d > 0) up += d; else dn -= d; }
  if (dn === 0) return 100;
  return 100 - 100 / (1 + up / dn);
}

/* ---------- stock data ---------- */

function googleFinancePrices_(stocks) {
  const out = {};
  if (!stocks.length) return out;
  const sh = getSheet_(SHEETS.GF);
  sh.clear();
  sh.getRange(1, 1, stocks.length, 1).setFormulas(stocks.map(u => ['=GOOGLEFINANCE("' + (u.gf || u.sym) + '","price")']));
  for (let t = 0; t < 4; t++) {
    SpreadsheetApp.flush();
    const vals = sh.getRange(1, 1, stocks.length, 1).getValues();
    stocks.forEach((u, i) => { const v = Number(vals[i][0]); if (v > 0) out[u.sym] = v; });
    if (Object.keys(out).length === stocks.length) break;
    Utilities.sleep(1500);
  }
  return out;
}

// Daily bars [close, high, low, volume, time ms]. Drops today's partial bar unless keepAll (the warm-up wants every bar).
function yahooHistory_(sym, keepAll, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + (range || '6mo') + '&interval=1d';
  const r = http_(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (r.getResponseCode() !== 200) return null;
  const res = JSON.parse(r.getContentText()).chart.result[0];
  const q = res.indicators.quote[0], bars = [];
  (res.timestamp || []).forEach((t, i) => { if (q.close[i] != null) bars.push([q.close[i], q.high[i], q.low[i], q.volume[i] || 0, t * 1000]); });
  if (!bars.length) return null;
  return { bars: keepAll ? bars : bars.slice(0, -1), last: bars[bars.length - 1][0] };   // drop today's partial bar
}

// NYSE full-day holidays and 1 PM early closes. Add the next year's dates each December.
const NYSE_HOLIDAYS = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
  '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05',
  '2027-09-06', '2027-11-25', '2027-12-24'];
const NYSE_EARLY_CLOSE = ['2026-11-27', '2026-12-24', '2027-11-26'];

// Closing time (HHmm) on that day, or 0 when the market is shut all day.
function usMarketCloseHm_(now) {
  now = now || new Date();
  const day = Number(Utilities.formatDate(now, TZ, 'u')), date = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');   // 1=Mon … 7=Sun
  if (day > 5 || NYSE_HOLIDAYS.indexOf(date) >= 0) return 0;
  return NYSE_EARLY_CLOSE.indexOf(date) >= 0 ? 1300 : 1600;
}

function isUsMarketOpen_() {
  const now = new Date(), close = usMarketCloseHm_(now);
  const hm = Number(Utilities.formatDate(now, TZ, 'HHmm'));
  return close > 0 && hm >= 930 && hm < close;
}

/* ---------- crypto data ---------- */

// CoinGecko usually refuses Google's shared servers. One refusal pauses it for 20 minutes instead of paying
// a failed call (and a polite wait) for every coin, every round. Yahoo fills in meanwhile.
function cgFetch_(path) {
  const cache = CacheService.getScriptCache();
  if (cache.get('cg_down')) return null;
  const key = PropertiesService.getScriptProperties().getProperty('COINGECKO_API_KEY');
  const r = http_('https://api.coingecko.com/api/v3' + path,
    { muteHttpExceptions: true, headers: key ? { 'x-cg-demo-api-key': key } : {} });
  if (r.getResponseCode() !== 200) { cache.put('cg_down', String(r.getResponseCode()), 1200); return null; }
  return JSON.parse(r.getContentText());
}

function coinGeckoPrices_(cryptos) {
  const out = {};
  const ids = cryptos.map(u => u.cg).filter(String);
  if (!ids.length) return out;
  const d = cgFetch_('/simple/price?vs_currencies=usd&ids=' + ids.join(','));
  if (d) cryptos.forEach(u => { if (d[u.cg]) out[u.sym] = d[u.cg].usd; });
  return out;
}

function coinGeckoHistory_(id) {
  if (!id || CacheService.getScriptCache().get('cg_down')) return null;
  Utilities.sleep(1200);   // be gentle with the free tier
  const d = cgFetch_('/coins/' + id + '/market_chart?vs_currency=usd&days=180&interval=daily');
  if (!d || !d.prices || !d.prices.length) return null;
  const bars = d.prices.map((p, i) => [p[1], p[1], p[1], ((d.total_volumes || [])[i] || [0, 0])[1], p[0]]);
  return { bars: bars.slice(0, -1), last: d.prices[d.prices.length - 1][1], src: 'cg' };
}

function cmcQuotes_(cryptos) {
  const key = PropertiesService.getScriptProperties().getProperty('CMC_API_KEY');
  const out = {};
  if (!key || !cryptos.length) return out;
  const r = http_('https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=' +
    cryptos.map(u => u.sym).join(','), { muteHttpExceptions: true, headers: { 'X-CMC_PRO_API_KEY': key } });
  if (r.getResponseCode() !== 200) return out;
  const data = JSON.parse(r.getContentText()).data || {};
  cryptos.forEach(u => {
    let c = data[u.sym]; if (Array.isArray(c)) c = c[0];
    if (!c || !c.quote || !c.quote.USD) return;
    const q = c.quote.USD;
    out[u.sym] = { price: q.price, ch24: q.percent_change_24h / 100, ch7: q.percent_change_7d / 100,
                   mcap: q.market_cap, vol24: q.volume_24h, rank: c.cmc_rank };
  });
  return out;
}

/* ---------- Fear & Greed ---------- */

function cryptoFng_() {
  return cached_('fng_c', 1800, () => {
    const key = PropertiesService.getScriptProperties().getProperty('CMC_API_KEY');
    if (key) {
      const r = http_('https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest',
        { muteHttpExceptions: true, headers: { 'X-CMC_PRO_API_KEY': key } });
      if (r.getResponseCode() === 200) {
        const d = JSON.parse(r.getContentText()).data;
        if (d && d.value != null) return { value: Number(d.value), label: d.value_classification, source: 'CMC crypto' };
      }
    }
    const r2 = http_('https://api.alternative.me/fng/?limit=1', { muteHttpExceptions: true });
    if (r2.getResponseCode() === 200) {
      const d2 = (JSON.parse(r2.getContentText()).data || [])[0];
      if (d2) return { value: Number(d2.value), label: d2.value_classification, source: 'Crypto' };
    }
    // Last resort: read the mood from Bitcoin itself (its recent swings and trend)
    const btc = cached_('yhc_BTC', 6 * 3600, () => yahooHistory_('BTC-USD'));
    return btc ? fngFromPrices_(btc.bars.map(b => b[0]).concat([btc.last]), 'crypto') : null;
  });
}

function stockFng_() {   // CNN's unofficial endpoint first; CNN often blocks Google's servers, so fall back to our own reading
  const cnn = cached_('fng_s', 3600, () => {
    const r = http_('https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    if (r.getResponseCode() !== 200) return null;
    const f = JSON.parse(r.getContentText()).fear_and_greed;
    return f ? { value: Math.round(f.score), label: f.rating, source: 'CNN stock' } : null;
  }, 6 * 3600);   // CNN nearly always blocks Google: remember a refusal for 6 hours
  if (cnn) return cnn;
  return cached_('fng_sx', 3600, () => {
    const vix = yahooHistory_('^VIX'), spy = cached_('yh_SPY', 3000, () => yahooHistory_('SPY'));
    const closes = spy ? spy.bars.map(b => b[0]).concat([spy.last]) : [];
    if (vix && vix.last) return fngFromVix_(vix.last, closes);
    return closes.length > 21 ? fngFromPrices_(closes, 'stock') : null;   // no VIX either: SPY's own swings stand in for it
  });
}

// Fear & Greed from prices alone: recent swings (annualised volatility) play the part of the VIX, plus the trend.
// Crypto is naturally about 2.5x as volatile as stocks, so its swings are scaled down to the same yardstick.
function fngFromPrices_(closes, kind) {
  const rets = [];
  for (let i = Math.max(1, closes.length - 20); i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  const annVol = stdev_(rets) * Math.sqrt(kind === 'crypto' ? 365 : 252) * 100;
  const out = fngFromVix_(kind === 'crypto' ? annVol / 2.5 : annVol, closes, kind === 'crypto' ? 150 : 400);
  out.source = kind === 'crypto' ? 'Academy crypto (BTC swings + trend)' : 'Academy stock (SPY swings + trend)';
  return out;
}

// Our own stock Fear & Greed, from two of CNN's main ingredients: the VIX "fear index" (60%) and how far SPY
// sits from its 125-day average (40%). 0 = extreme fear, 100 = extreme greed, same bands as CNN.
function fngFromVix_(vix, spyCloses, trendScale) {
  const clamp = x => Math.max(0, Math.min(100, x));
  const vixScore = clamp(50 + (20 - vix) * 5);                           // VIX 20 (its long-run average) = neutral 50; 10 = calm, 30+ = panic
  let value = vixScore;
  if (spyCloses.length >= 125) {
    const sma = mean_(spyCloses.slice(-125)), mom = spyCloses[spyCloses.length - 1] / sma - 1;
    value = 0.6 * vixScore + 0.4 * clamp(50 + mom * (trendScale || 400));   // SPY 12.5% above its average = 100
  }
  value = Math.round(value);
  const label = value < 25 ? 'Extreme Fear' : value < 45 ? 'Fear' : value <= 55 ? 'Neutral' : value <= 75 ? 'Greed' : 'Extreme Greed';
  return { value, label, source: 'Academy stock (VIX ' + vix.toFixed(1) + ' + SPY trend)' };
}

/* ---------- news ---------- */

const POS_WORDS = new Set(('beat beats surge surges soar soars rally rallies record upgrade upgraded bullish growth gain gains ' +
  'jump jumps rise rises rising strong approval approved approves partnership outperform breakout profit profits higher boom ' +
  'adoption inflow inflows raise raises raised expands launch launches wins buyback optimism rebound').split(' '));
const NEG_WORDS = new Set(('miss misses plunge plunges crash crashes drop drops fall falls falling downgrade downgraded bearish ' +
  'lawsuit sues probe investigation selloff sell-off weak loss losses cut cuts hack hacked ban bans fraud outflow outflows ' +
  'recall layoffs slump slumps tumble tumbles fear fears warns warning lower decline declines bankruptcy delay delays risk').split(' '));

function lexScore_(t) {
  let p = 0, n = 0;
  (t.toLowerCase().match(/[a-z\-]+/g) || []).forEach(w => { if (POS_WORDS.has(w)) p++; if (NEG_WORDS.has(w)) n++; });
  return (p - n) / Math.max(1, p + n);
}

function googleNews_(q) {
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:2d') + '&hl=en-US&gl=US&ceid=US:en';
  const r = http_(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return null;
  const items = XmlService.parse(r.getContentText()).getRootElement().getChild('channel').getChildren('item').slice(0, 20);
  const titles = items.map(i => (i.getChildText('title') || '').replace(/\s+-\s+[^-]+$/, ''));
  if (!titles.length) return { score: 0, count: 0, top: '', titles: [], src: 'keywords' };
  const scores = titles.map(lexScore_);
  let best = 0;
  scores.forEach((s, i) => { if (Math.abs(s) > Math.abs(scores[best])) best = i; });
  return { score: mean_(scores), count: titles.length, top: titles[best].slice(0, 90), titles: titles.slice(0, 10), src: 'keywords' };
}

// The round never waits on the LLM: it reads the scores the insights job stored (good for 6 hours), so a news
// score doesn't flip between the LLM's scale and the keyword model's from one round to the next.
function attachNews_(assets, cfg) {
  assets.forEach(a => { a.news = cached_('nw_' + a.sym, 1800, () => googleNews_(a.query || a.sym)); });
  const llm = storedNewsScores_();
  if (!llm) return;
  assets.forEach(a => {
    if (a.news && a.news.count && typeof llm.scores[a.sym] === 'number') {
      a.news.score = Math.max(-1, Math.min(1, llm.scores[a.sym]));
      a.news.src = llm.src;
      a.news.top = headlineFor_(a.news.titles, a.news.score) || a.news.top;
    }
  });
}

const NEWS_LLM_MAX_AGE = 6 * 3600e3, NEWS_LLM_REFRESH = 30 * 60e3;

function storedNewsScores_() {
  let s = null;
  try { s = JSON.parse(PropertiesService.getScriptProperties().getProperty('NEWS_LLM') || 'null'); } catch (e) { s = null; }
  return s && s.scores && Date.now() - new Date(s.at).getTime() < NEWS_LLM_MAX_AGE ? s : null;
}

// The headline quoted as the reason should lean the same way as the score.
function headlineFor_(titles, score) {
  if (!titles || !titles.length) return '';
  const want = Math.sign(score), scored = titles.map(t => [t, lexScore_(t)]);
  const match = scored.filter(x => Math.sign(x[1]) === want).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return (match ? match[0] : titles[0]).slice(0, 90);
}

// Insights job: re-score the headlines with the LLM every 30 minutes, outside the trading round.
function refreshNewsScores_(cfg) {
  const old = storedNewsScores_();
  if (old && Date.now() - new Date(old.at).getTime() < NEWS_LLM_REFRESH) return 'fresh';
  if (!llmProvider_()) return 'no key';
  const assets = readUniverse_().map(u => ({ sym: u.sym, news: cached_('nw_' + u.sym, 1800, () => googleNews_(u.query || u.sym)) }));
  const got = llmNewsScores_(assets, cfg);
  if (!got) return 'failed: ' + (LLM_ERROR_ || 'no scores');
  const scores = {};
  Object.keys(got).forEach(k => { if (k !== '_src' && typeof got[k] === 'number' && isFinite(got[k])) scores[k] = got[k]; });
  PropertiesService.getScriptProperties().setProperty('NEWS_LLM', JSON.stringify({ at: new Date().toISOString(), src: got._src, scores }));
  return 'scored ' + Object.keys(scores).length;
}

function llmNewsScores_(assets, cfg) {
  if (!llmProvider_()) return null;
  const input = {};
  assets.forEach(a => { if (a.news && a.news.count) input[a.sym] = a.news.titles; });
  if (!Object.keys(input).length) return null;
  const prompt = 'You are a market news analyst. For each symbol, rate how the headlines affect the asset\'s ' +
    'short-term price outlook from -1 (very bearish) to 1 (very bullish). Return ONLY a JSON object like {"AAPL":0.2}.\n\n' +
    JSON.stringify(input);
  const text = llm_(prompt, cfg, { maxTokens: 400, json: true });
  const m = text && text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let out; try { out = JSON.parse(m[0]); } catch (e) { LLM_ERROR_ = 'the news scores came back malformed'; return null; }
  out._src = llmProvider_() === 'gemini' ? 'Gemini' : 'Claude';
  return out;
}

/* ---------- LLM (Gemini preferred, Claude fallback) ---------- */

function llmProvider_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('GEMINI_API_KEY')) return 'gemini';
  if (p.getProperty('ANTHROPIC_API_KEY')) return 'claude';
  return null;
}

// Returns the model's text, or null if no key is set or the call fails (reason in LLM_ERROR_).
let LLM_ERROR_ = '', LLM_BUSY_ = false;
function llm_(prompt, cfg, opts) {
  LLM_ERROR_ = ''; LLM_BUSY_ = false;
  opts = opts || {};
  const provider = llmProvider_();
  if (!provider) return null;
  const props = PropertiesService.getScriptProperties();
  const model = String(cfg.LLM_MODEL || '');
  if (provider === 'gemini') {
    const main = /^gemini/.test(model) ? model : 'gemini-flash-latest';
    const gen = { maxOutputTokens: Math.max(2048, opts.maxTokens || 0) }; // headroom for thinking tokens
    if (opts.json) gen.responseMimeType = 'application/json';
    // Busy (429/500/503): retry once after a pause, then fall back to the lighter Flash-Lite model.
    const tries = opts.quick ? [[main, 0], ['gemini-flash-lite-latest', 0]]
      : [[main, 0], [main, 2500], ['gemini-flash-lite-latest', 0], ['gemini-flash-lite-latest', 3000]];
    let r = null, code = 0;
    for (const [m, wait] of tries) {
      if (wait) Utilities.sleep(wait);
      r = http_('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-goog-api-key': props.getProperty('GEMINI_API_KEY') },
        payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen })
      });
      code = r.getResponseCode();
      if (code === 200 || [429, 500, 503].indexOf(code) < 0) break;
    }
    if (code !== 200) {
      LLM_ERROR_ = [429, 500, 503].indexOf(code) >= 0
        ? 'Gemini is overloaded right now (Google says error ' + code + ', usually temporary).'
        : 'Gemini ' + code + ': ' + r.getContentText().slice(0, 200);
      LLM_BUSY_ = [429, 500, 503].indexOf(code) >= 0;
      console.error(LLM_ERROR_, r.getContentText().slice(0, 200)); return null;
    }
    const c = (JSON.parse(r.getContentText()).candidates || [])[0];
    const text = c && c.content ? (c.content.parts || []).map(p => p.text || '').join('').trim() : '';
    if (c && c.finishReason && c.finishReason !== 'STOP') LLM_ERROR_ = 'Gemini stopped early (' + c.finishReason + ')';
    if (!text) { LLM_ERROR_ = LLM_ERROR_ || 'Gemini returned no text'; return null; }
    return text;
  }
  const r = http_('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': props.getProperty('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: /^claude/.test(model) ? model : 'claude-haiku-4-5-20251001', max_tokens: opts.maxTokens || 400, messages: [{ role: 'user', content: prompt }] })
  });
  if (r.getResponseCode() !== 200) { LLM_ERROR_ = 'Claude ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200); console.error(LLM_ERROR_); return null; }
  return JSON.parse(r.getContentText()).content.map(c => c.text || '').join('').trim();
}

/* ---------- utils ---------- */

// Every outside call goes through here so the Engine room can show how many calls each source took and whether they failed.
let CALLS_ = {};
function http_(url, opts) {
  const host = ((url.match(/^https?:\/\/([^\/]+)/) || [])[1] || '?').replace(/^(www|api|query1|production\.dataviz|pro-api)\./, '');
  const e = CALLS_[host] || (CALLS_[host] = { n: 0, ms: 0, fail: 0 }), t = Date.now();
  let r;
  try { r = UrlFetchApp.fetch(url, opts || {}); } catch (err) { e.n++; e.fail++; e.ms += Date.now() - t; throw err; }
  e.n++; e.ms += Date.now() - t;
  if (r.getResponseCode() >= 400) e.fail++;
  return r;
}

// failTtl (optional): also remember a failure (as null) for that many seconds, so a source that keeps
// refusing isn't asked again every round.
function cached_(key, ttl, fn, failTtl) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  let v = null;
  try { v = fn(); } catch (e) { console.error(key, e); }
  if (v != null) { try { cache.put(key, JSON.stringify(v), ttl); } catch (e) { /* too big to cache */ } }
  else if (failTtl) cache.put(key, 'null', failTtl);
  return v;
}

function safe_(fn, warn) {
  try { return fn(); } catch (e) { warn.push(fn.name + ': ' + e.message); return null; }
}
