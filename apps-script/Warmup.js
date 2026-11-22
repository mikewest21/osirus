/**
 * GAME OF TRADES — the warm-up: replay the last 30 days so every bot starts the season with a track record.
 *
 * Each past day is one round at the close: bots see the price history up to that day (same indicators as live),
 * that day's Fear & Greed where history exists, and trade with the real fee, slippage and tax rules.
 * No news history exists, so Headline Hank sits out and news counts for nothing.
 *
 * The replayed equity curves are written to EquityHistory, rescaled so each bot arrives at its starting cash:
 * returns (and so the luck test, win odds and market-condition records) are real, and the season still starts
 * with everyone on level money. The practice trades go to the ledger marked "Warm-up".
 */

const WARMUP_DAYS = 30;

function warmUp() {
  assertOwner_();
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Warm up the arena?', 'The bots replay the last ' + WARMUP_DAYS + ' days of real prices, so the chart, luck test, ' +
    'win odds and market records start with data. Then everyone resets to starting cash and the season begins with a live round. ' +
    'This wipes the current season’s trades and history.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const r = warmUpCore_();
  ui.alert('Warm-up done', r.error || r.summary, ui.ButtonSet.OK);
}

function warmUpCore_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { error: 'A round is running. Try again in a minute.' };
  let summary;
  try {
    startFreshSeason_();
    const cfg = readConfig_(), uni = readUniverse_(), roster = getCompetitionRoster_(), dayKey = t => Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd');

    // Full dated price history for every asset. Crypto: CoinGecko, or Yahoo (BTC-USD) when CoinGecko is rate-limited.
    const hist = {}, missing = [];
    uni.forEach(u => {
      let h, src;
      if (u.type === 'stock') { h = yahooHistory_(u.yahoo || u.sym, true); src = 'stock'; }
      else {
        h = u.cg && coinGeckoHistory_(u.cg); src = 'cg';
        if (!h || !h.bars.length) { h = yahooHistory_(u.sym + '-USD', true); src = 'yahooCrypto'; }
      }
      if (!h || !h.bars.length) { missing.push(u.sym); return; }
      // CoinGecko's 00:00 UTC point is the previous day's close; Yahoo crypto bars start at 00:00 UTC
      const key = t => src === 'stock' ? dayKey(t) : Utilities.formatDate(new Date(src === 'cg' ? t - 1 : t), 'UTC', 'yyyy-MM-dd');
      hist[u.sym] = h.bars.filter(b => b[4]).map(b => ({ key: key(b[4]), bar: b }));
      hist[u.sym].src = src;
    });
    const fngC = fngHistoryCrypto_(), fngS = fngHistoryStock_();

    // The days to replay: the last WARMUP_DAYS calendar days, ending yesterday
    const days = [];
    for (let i = WARMUP_DAYS; i >= 1; i--) days.push(dayKey(Date.now() - i * 864e5));

    const bots = {}, start = cfg.STARTING_CASH;
    roster.forEach(d => bots[d.id] = { start, cash: start, fees: 0, taxes: 0, carry: 0, trades: 0, wins: 0, losses: 0, peak: start, maxDD: 0, state: {} });
    const lots = [], trades = [], rows = [], first = {}, last = {};

    days.forEach(key => {
      const now = Utilities.parseDate(key + ' 16:00', TZ, 'yyyy-MM-dd HH:mm');
      const assets = [];
      uni.forEach(u => {
        const h = hist[u.sym];
        if (!h) return;
        const before = h.filter(x => x.key < key).map(x => x.bar), today = h.find(x => x.key === key);
        if (!before.length) return;
        const live = today ? today.bar[0] : before[before.length - 1][0];
        const a = buildAsset_(u, { bars: before, src: h.src === 'cg' ? 'cg' : '' }, live, !!today, now);
        assets.push(a);
        if (first[u.sym] == null) first[u.sym] = live;
        last[u.sym] = live;
      });
      if (!assets.length) return;
      const bySym = {}; assets.forEach(a => bySym[a.sym] = a);
      const macro = { fngCrypto: fngC[key] || null, fngStock: fngS[key] || null };
      const lead = t => bySym[t === 'stock' ? 'SPY' : 'BTC'] || assets.find(a => a.type === t);
      macro.regime = { stock: regime_(lead('stock'), macro.fngStock), crypto: regime_(lead('crypto'), macro.fngCrypto) };
      const mkt = { assets, bySym, macro, stocksOpen: assets.some(a => a.type === 'stock' && a.tradable), warn: [] };

      roster.forEach(def => {
        const b = bots[def.id];
        let orders = [];
        try { orders = (strategyFor_(def)(buildCtx_(def, b, lots, mkt, cfg, key, paramsFor_(def))) || []).filter(Boolean); } catch (e) { return; }
        orders.sort((x, y) => (x.side === 'SELL' ? 0 : 1) - (y.side === 'SELL' ? 0 : 1));
        orders.forEach(o => {
          const t = execute_(def, b, lots, mkt, cfg, o, now);
          if (t) { t[11] = 'Warm-up: ' + t[11]; trades.push(t); }
        });
      });
      const scores = roster.map(d => liquidationValue_(d.id, bots[d.id], lots, mkt, cfg, now));
      rows.push([now].concat(scores, [macro.regime.stock.name, macro.regime.crypto.name]));
    });
    if (rows.length < 2) return { error: 'Not enough price history came back to replay. Check the Research sheet warnings and try again.' };

    // Rescale each bot's curve so it ends exactly at starting cash (returns unchanged), then write it
    const final = rows[rows.length - 1];
    const scaled = rows.map(r => r.map((v, j) => j === 0 || j > roster.length || !(final[j] > 0) ? v : v * start / final[j]));
    getSheet_(SHEETS.HISTORY).getRange(2, 1, scaled.length, scaled[0].length).setValues(scaled);
    appendTrades_(trades);

    const results = roster.map((d, j) => ({ name: d.name, ghost: !!d.ghost, ret: rows[0][j + 1] > 0 ? final[j + 1] / start - 1 : null, trades: bots[d.id].trades }))
      .sort((a, b) => (a.ghost - b.ghost) || (b.ret - a.ret));
    const moves = Object.keys(last).map(s => ({ sym: s, ret: last[s] / first[s] - 1 })).sort((a, b) => b.ret - a.ret);
    const info = { version: 2, missing, days: rows.length, from: days[0], to: days[days.length - 1], seasonStart: new Date().toISOString(),
      results, bestAsset: moves[0], worstAsset: moves[moves.length - 1], trades: trades.length };
    PropertiesService.getScriptProperties().setProperty('WARMUP', JSON.stringify(info));
    const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
    const champ = results.find(r => !r.ghost);
    summary = 'Replayed ' + rows.length + ' days (' + info.from + ' to ' + info.to + '), ' + trades.length + ' practice trades. ' +
      'Practice champion: ' + champ.name + ' ' + pct(champ.ret) + '. Best asset: ' + moves[0].sym + ' ' + pct(moves[0].ret) + '. ' +
      'Everyone is back to $' + start.toLocaleString() + ' and the season starts now.' +
      (missing.length ? ' No history came back for ' + missing.join(', ') + ', so they sat out the replay.' : '');
  } finally {
    lock.releaseLock();
  }
    runRound_();   // the first live round of the season
  return { summary };
}

// alternative.me history: { 'yyyy-MM-dd': {value, label, source} }
function fngHistoryCrypto_(limit) {
  const out = {};
  try {
    const r = http_('https://api.alternative.me/fng/?limit=' + (limit || WARMUP_DAYS + 10), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return out;
    JSON.parse(r.getContentText()).data.forEach(d => {
      out[Utilities.formatDate(new Date(+d.timestamp * 1000), 'UTC', 'yyyy-MM-dd')] = { value: Number(d.value), label: d.value_classification, source: 'Crypto' };
    });
  } catch (e) { /* no history: Cass sits out crypto during the warm-up */ }
  return out;
}

// CNN's unofficial history, best effort
function fngHistoryStock_(range) {
  const out = {};
  try {
    const r = http_('https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    if (r.getResponseCode() !== 200) return out;
    const h = JSON.parse(r.getContentText()).fear_and_greed_historical;
    ((h && h.data) || []).forEach(p => {
      out[Utilities.formatDate(new Date(p.x), TZ, 'yyyy-MM-dd')] = { value: Math.round(p.y), label: p.rating, source: 'CNN stock' };
    });
  } catch (e) { /* no history */ }
  if (Object.keys(out).length) return out;
  // CNN blocked: rebuild each day's reading from VIX and SPY history instead
  try {
    const vix = yahooHistory_('^VIX', true, range), spy = yahooHistory_('SPY', true, range);
    if (!vix || !spy) return out;
    const key = t => Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd');
    vix.bars.filter(b => b[4]).forEach(b => {
      const k = key(b[4]), closes = spy.bars.filter(x => x[4] && key(x[4]) <= k).map(x => x[0]);
      out[k] = fngFromVix_(b[0], closes);
    });
  } catch (e) { /* no history */ }
  return out;
}

function webWarmUp() {
  assertOwner_();
  const r = warmUpCore_();
  return JSON.stringify(r);
}
