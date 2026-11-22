/**
 * GAME OF TRADES — the brains. Each strategy gets a context `c` and returns orders:
 *   { sym, side: 'BUY', usd, why }  or  { sym, side: 'SELL', frac (0–1 of holding), why }
 * The engine applies cash limits, position caps, market hours, fees, slippage and taxes.
 * Context: c.cash, c.equity, c.holdings{sym:{qty,value,avgCost}}, c.assets[], c.bySym{}, c.macro, c.cfg, c.state, c.today,
 *          c.params (this bot's levers: LEVERS defaults, plus lessons it has adopted, plus a shadow twin's one change)
 *
 * Proof of work: strategies note every asset they check (seen_: passed or not, with the numbers) and every
 * holding they decide to keep (kept_). The engine stores it with the orders in the Telemetry sheet each round.
 */

// 🚀 Momentum: ride the strongest stacked uptrends, dump anything that loses its 20-day average.
// A 1% band on each side of the average stops a price sitting on the line from flipping him in and out every
// 15 minutes (each flip cost him about 1.4% in crypto fees and spread).
const MOMO_BAND = 0.01;
function stratMomo_(c) {
  const P = c.params, o = [];
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s];
    if (a && a.sma20 && a.price < a.sma20 * (1 - MOMO_BAND)) o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' lost its 20-day average' });
    else if (a && a.sma20) kept_(c, s, rel_(a.price, a.sma20) + ' vs its 20-day average (sells 1% below it)');
  });
  c.assets.filter(a => !c.holdings[a.sym] && seen_(c, a.sym, a.sma50 && a.price > a.sma20 * (1 + MOMO_BAND) && a.sma20 > a.sma50 && a.ret5 > 0,
    a.sma50 ? 'price ' + rel_(a.price, a.sma20) + ' vs 20d avg (needs 1% above), 20d avg ' + rel_(a.sma20, a.sma50) + ' vs 50d, 5d ' + pct_(a.ret5) + ' (needs all three rising)' : 'not enough history'))
    .sort((x, y) => y.ret20 - x.ret20).slice(0, P.picks)
    .forEach(a => o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size, why: a.sym + ' ' + pct_(a.ret20) + ' in 20d, trend stacked' }));
  return o;
}

// 🧶 Mean reversion: buy oversold stocks, sell on recovery, at the profit target, or at the stop.
function stratVal_(c) {
  const P = c.params, o = [];
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s], g = a ? a.price / c.holdings[s].avgCost - 1 : 0;
    if (!a) return;
    if (g >= P.takeProfit) o.push({ sym: s, side: 'SELL', frac: 1, why: 'took ' + pct_(g) + ' profit on ' + s });
    else if (g <= -P.stopLoss) o.push({ sym: s, side: 'SELL', frac: 1, why: 'stop-loss on ' + s + ' at ' + pct_(g), urgent: true });
    else if (a.rsi14 != null && a.rsi14 > P.rsiSell) o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' recovered (RSI ' + a.rsi14.toFixed(0) + ')' });
    else kept_(c, s, pct_(g) + ' so far, RSI ' + (a.rsi14 == null ? 'n/a' : a.rsi14.toFixed(0)) +
      ' (sells at ' + pct_(P.takeProfit) + ', ' + pct_(-P.stopLoss) + ' or RSI above ' + P.rsiSell + ')');
  });
  c.assets.filter(a => a.type === 'stock' && !c.holdings[a.sym] && seen_(c, a.sym, a.rsi14 != null && a.rsi14 < P.rsiBuy,
    a.rsi14 == null ? 'not enough history' : 'RSI ' + a.rsi14.toFixed(0) + ' (buys under ' + P.rsiBuy + ')'))
    .sort((x, y) => x.rsi14 - y.rsi14).slice(0, 2)
    .forEach(a => o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size, why: a.sym + ' oversold (RSI ' + a.rsi14.toFixed(0) + ')' }));
  return o;
}

// 🦉 Contrarian: load up on extreme fear, lighten up on greed. Crypto F&G drives BTC/ETH, CNN F&G drives SPY.
function stratCass_(c) {
  const P = c.params, m = c.macro, o = [];
  [['BTC', m.fngCrypto, 0.35], ['ETH', m.fngCrypto, 0.2], ['SPY', m.fngStock, 0.35]].forEach(([sym, f, max]) => {
    if (!c.bySym[sym]) return;
    if (!f) { seen_(c, sym, false, 'no Fear & Greed reading this round'); return; }
    max *= P.sizeMult;
    let w = null;
    if (f.value <= P.fearBuy) w = max;
    else if (f.value >= 90) w = 0;
    else if (f.value >= P.greedTrim) w = max * 0.3;
    seen_(c, sym, w !== null, f.source + ' Fear & Greed ' + f.value + ' (' + f.label + '); buys at ' + P.fearBuy + ' or below, trims at ' + P.greedTrim + ' and up');
    if (w === null) return;
    const ord = toTarget_(c, sym, w, f.source + ' Fear & Greed ' + f.value + ' (' + f.label + ')');
    if (ord && !(f.value >= P.greedTrim && ord.side === 'BUY')) o.push(ord);   // greed only ever trims
  });
  return o;
}

// 📰 News: buy the most positively covered assets, dump holdings with bad press.
// Good press only counts when the price agrees: he buys only above the 20-day average, so he stops
// buying cheerful headlines on assets that are falling anyway (5.6% win rate in crypto, Season 6).
// He gives a story a day to play out: bad press only sells once he has held 24 hours, unless it's
// truly awful (well below his sell line) or the position is down 8%.
const HANK_MIN_HOLD_MS = 24 * 3600e3;
function stratHank_(c) {
  const P = c.params, o = [];
  const since = c.state.since = c.state.since || {}, nowMs = Date.now();
  Object.keys(since).forEach(s => { if (!c.holdings[s]) delete since[s]; });
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s];
    if (!a) return;
    const g = a.price / c.holdings[s].avgCost - 1, young = since[s] && nowMs - since[s] < HANK_MIN_HOLD_MS;
    const bad = a.news && a.news.count >= 3 && a.news.score < P.sellScore, awful = bad && a.news.score < P.sellScore - 0.3;
    if (g <= -0.08) o.push({ sym: s, side: 'SELL', frac: 1, why: 'stop-loss on ' + s + ' at ' + pct_(g), urgent: true });
    else if (bad && (!young || awful)) o.push({ sym: s, side: 'SELL', frac: 1, why: 'bad press on ' + s + ': "' + a.news.top + '"' });
    else kept_(c, s, bad ? 'bad press (score ' + a.news.score.toFixed(2) + '), but giving the story a day to play out' :
      a.news ? 'press still OK (score ' + a.news.score.toFixed(2) + ', sells below ' + P.sellScore + ')' : 'no news, holding');
  });
  c.assets.filter(a => !c.holdings[a.sym] && seen_(c, a.sym, a.tradable && a.news && a.news.count >= P.minHeadlines && a.news.score > P.buyScore && a.sma20 && a.price > a.sma20,
    !a.tradable ? 'market closed' : a.news ? 'news score ' + a.news.score.toFixed(2) + ' from ' + a.news.count + ' headlines (buys above ' + P.buyScore + ' with ' + P.minHeadlines + '+), price ' + (a.sma20 ? rel_(a.price, a.sma20) : 'n/a') + ' vs 20d avg (good news must agree with the trend: needs to be above it)' : 'no news this round'))
    .sort((x, y) => y.news.score - x.news.score).slice(0, 2)
    .forEach(a => { since[a.sym] = nowMs; o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size,
      why: 'buzz ' + a.news.score.toFixed(2) + ' on ' + a.sym + ': "' + a.news.top + '"' }); });
  return o;
}

// 🧮 Patient multi-factor: rank assets, but make incumbents hard to dislodge. Replacements require
// a poor buffered rank, a decisive score advantage and a cooldown. Routine weight resizing has a
// separate clock and wider crypto thresholds so small statistical changes do not become fee churn.
function stratQuant_(c) {
  const P = c.params;
  const pool = c.assets.filter(a => a.sma50 && a.vol20 > 0 && a.rsi14 != null);
  c.assets.filter(a => pool.indexOf(a) < 0).forEach(a => seen_(c, a.sym, false, 'not enough history to score'));
  if (pool.length < 3) return [];
  const zm = zs_(pool.map(a => a.ret20)), zt = zs_(pool.map(a => a.price / a.sma50 - 1));
  const score = {};
  pool.forEach((a, i) => { score[a.sym] = zm[i] + zt[i] + (a.news ? a.news.score : 0) - (a.rsi14 > P.overbought ? 1 : 0); });
  const ranked = pool.filter(a => score[a.sym] > 0 && a.price > a.sma50).sort((x, y) => score[y.sym] - score[x.sym]);
  const rank = {}; ranked.forEach((a, i) => rank[a.sym] = i);
  const held = Object.keys(c.holdings), crypto = pool[0].type === 'crypto';
  const rankBuffer = Math.max(3, +P.rankBuffer || 0), swapEdge = Math.max(crypto ? 1.5 : 1, +P.swapEdge || 0);
  const swapCooldown = Math.max(crypto ? 96 : 48, +P.cooldown || 0);
  const rebalanceBand = Math.max(crypto ? 0.18 : 0.12, +P.rebalanceBand || 0);
  const rebalanceCooldown = Math.max(crypto ? 192 : 96, +P.rebalanceCooldown || 0);
  const st = c.state.quant || (c.state.quant = { round: 0, lastSwap: -999, lastRebalance: -999 });
  st.round = (st.round || 0) + 1;
  const canSwap = st.round - (st.lastSwap == null ? -999 : st.lastSwap) >= swapCooldown;
  let top = held.map(s => c.bySym[s]).filter(a => a && a.vol20 > 0)
    .sort((x, y) => (score[y.sym] == null ? -999 : score[y.sym]) - (score[x.sym] == null ? -999 : score[x.sym])).slice(0, P.topN);
  ranked.forEach(a => { if (top.length < P.topN && top.indexOf(a) < 0) top.push(a); });
  let swapped = false;
  if (top.length >= P.topN && canSwap) {
    const newcomer = ranked.find(a => top.indexOf(a) < 0), weakest = top.slice().sort((a, b) =>
      (score[a.sym] == null ? -999 : score[a.sym]) - (score[b.sym] == null ? -999 : score[b.sym]))[0];
    const weakScore = weakest && score[weakest.sym] != null ? score[weakest.sym] : -999;
    const weakRank = weakest && rank[weakest.sym] != null ? rank[weakest.sym] : 999;
    if (newcomer && weakest && held.indexOf(weakest.sym) >= 0 && weakRank >= P.topN + rankBuffer && score[newcomer.sym] >= weakScore + swapEdge) {
      top[top.indexOf(weakest)] = newcomer; st.lastSwap = st.round; swapped = true;
    }
  }
  pool.forEach(a => seen_(c, a.sym, top.indexOf(a) >= 0, 'factor score ' + score[a.sym].toFixed(2) +
    (a.price > a.sma50 ? '' : ', below its 50d avg') + (a.rsi14 > P.overbought ? ', overbought penalty' : '') +
    ' (holds ' + P.topN + '; incumbents get a ' + rankBuffer + '-rank buffer, swaps need +' + swapEdge.toFixed(2) + ' score and a ' + swapCooldown + '-round cooldown)'));
  const inv = top.map(a => 1 / a.vol20), tot = inv.reduce((s, x) => s + x, 0);
  const tgt = {};
  top.forEach((a, i) => tgt[a.sym] = P.invest * inv[i] / tot);
  const o = [];
  held.forEach(s => { if (!(s in tgt)) o.push(toTarget_(c, s, 0, s + ' lost its buffered factor rank or was replaced by a meaningfully stronger score')); });
  const canRebalance = st.round - (st.lastRebalance == null ? -999 : st.lastRebalance) >= rebalanceCooldown;
  let resized = swapped;
  top.forEach(a => {
    const cur = (c.holdings[a.sym] || {}).value || 0, drift = Math.abs(tgt[a.sym] - cur / Math.max(1, c.equity));
    if (cur && drift < rebalanceBand) kept_(c, a.sym, 'target drift ' + pct_(drift, true) + ' is inside the ' + pct_(rebalanceBand, true) + ' no-trade band');
    else if (cur && (!canRebalance || swapped)) kept_(c, a.sym, 'target drift ' + pct_(drift, true) +
      (swapped ? '; keeping the surviving position untouched while the one-for-one swap settles' : '; next routine rebalance waits for the ' + rebalanceCooldown + '-round fee guard'));
    else {
      const order = toTarget_(c, a.sym, tgt[a.sym], a.sym + ' score ' + score[a.sym].toFixed(2) + ', target weight ' + pct_(tgt[a.sym], true));
      if (order) { o.push(order); resized = true; }
    }
  });
  if (resized || o.some(x => x)) st.lastRebalance = st.round;
  return o.filter(Boolean);
}

// 💎 DCA: buy a fixed amount of BTC and SPY once per day. Never sells.
function stratDana_(c) {
  const P = c.params, o = [];
  c.state.dca = c.state.dca || {};
  [['BTC', P.btcShare], ['SPY', 1 - P.btcShare]].forEach(([sym, w]) => {
    const a = c.bySym[sym];
    if (!seen_(c, sym, a && a.tradable && c.state.dca[sym] !== c.today,
      !a ? 'no price data' : !a.tradable ? 'market closed' : c.state.dca[sym] === c.today ? 'already bought today' : 'daily buy due')) return;
    c.state.dca[sym] = c.today;
    o.push({ sym, side: 'BUY', usd: c.cfg.DCA_USD * w, why: 'daily DCA into ' + sym + '. Price is irrelevant.' });
  });
  Object.keys(c.holdings).forEach(s => kept_(c, s, 'never sells'));
  return o;
}

// ⚡ Breakout: buy a new 20-day high on strong volume, exit on a break of the 10-day low.
function stratBella_(c) {
  const P = c.params, o = [];
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s];
    if (a && a.low10 && a.price < a.low10) o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' broke its 10-day low', urgent: true });
    else if (a && a.low10) kept_(c, s, rel_(a.price, a.low10) + ' above its 10-day low');
  });
  c.assets.filter(a => !c.holdings[a.sym] && seen_(c, a.sym, a.high20 && a.price > a.high20 && a.volRatio > P.volNeed,
    a.high20 ? 'price ' + rel_(a.price, a.high20) + ' vs 20d high, volume ' + (a.volRatio == null ? 'n/a' : a.volRatio.toFixed(1) + 'x') + ' (needs a new high on ' + P.volNeed + 'x+)' : 'not enough history'))
    .sort((x, y) => y.price / y.high20 - x.price / x.high20).slice(0, 2)
    .forEach(a => o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size,
      why: a.sym + ' cleared its 20-day high on ' + a.volRatio.toFixed(1) + 'x volume' }));
  return o;
}

// 🐋 Whale watcher (crypto only): unusual volume on a green day = accumulation; heavy volume on red or losing trend = exit.
// He only buys 1% above the 20-day average and sells 1% below it. Without that, a green high-volume day under a
// falling average bought every other round and sold the next (Season 6: 364 trades, no wins, $3.4k in fees).
const WES_BAND = 0.01;
// Wes reads daily signals, so he trades at most once per coin per day: no selling on the day he bought
// (unless it falls WES_STOP below his cost) and no buying back on the day he sold. Before this guard, data
// wobbles between 15-minute rounds made him round-trip the same coins hundreds of times, paying ~1.4% each time.
const WES_STOP = 0.06;

function stratWes_(c) {
  const P = c.params, o = [];
  const st = c.state ? (c.state.wes = c.state.wes || { in: {}, out: {} }) : { in: {}, out: {} };
  const sell = (s, why) => { o.push({ sym: s, side: 'SELL', frac: 1, why }); st.out[s] = c.today; delete st.in[s]; };
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s], h = c.holdings[s];
    if (!a) return;
    if (st.in[s] === c.today) {
      if (h.avgCost && a.price < h.avgCost * (1 - WES_STOP)) sell(s, s + ' fell ' + pct_(a.price / h.avgCost - 1) + ' from cost on day one — protective stop');
      else kept_(c, s, 'bought today; Wes holds at least until tomorrow unless it falls ' + pct_(WES_STOP, true) + ' below cost');
      return;
    }
    if (a.volRatio >= P.exitVol && a.ret1 < 0) sell(s, s + ' heavy volume on a red day — distribution');
    else if (a.sma20 && a.price < a.sma20 * (1 - WES_BAND)) sell(s, s + ' slipped under its 20-day average');
    else kept_(c, s, 'no distribution, ' + (a.sma20 ? rel_(a.price, a.sma20) + ' vs its 20-day average (sells 1% below it)' : 'no 20-day average yet'));
  });
  c.assets.filter(a => a.type === 'crypto' && !c.holdings[a.sym] && st.out[a.sym] !== c.today && seen_(c, a.sym,
    a.volRatio >= P.volNeed && a.ret1 > 0 && (!a.cmc || a.cmc.ch24 > 0) && a.sma20 && a.price > a.sma20 * (1 + WES_BAND),
    'volume ' + (a.volRatio == null ? 'n/a' : a.volRatio.toFixed(1) + 'x') + ', day ' + (a.ret1 == null ? 'n/a' : pct_(a.ret1)) +
    ', price ' + (a.sma20 ? rel_(a.price, a.sma20) : 'n/a') + ' vs 20d avg (needs ' + P.volNeed + 'x+ on a green day, 1% above the 20d avg)'))
    .sort((x, y) => y.volRatio - x.volRatio).slice(0, 2)
    .forEach(a => { st.in[a.sym] = c.today; o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size,
      why: a.volRatio.toFixed(1) + 'x normal volume on ' + a.sym + ' — whales accumulating' }); });
  return o;
}

// 🧇 Grid: pick the most sideways market, lay a ladder of price levels around the price, buy a slice at each level
// on the way down and sell that slice when the price climbs back one level. Falling through the bottom = exit and
// rebuild lower; running off the top with nothing held = re-centre. Spacing must beat the round-trip fees.
function stratGreta_(c) {
  const P = c.params, o = [], g = c.state.grid;
  const lvl = (grid, a) => Math.floor(Math.log(a.price / grid.center) / Math.log(1 + grid.spacing) + 1e-9);
  const price = (grid, L) => grid.center * Math.pow(1 + grid.spacing, L);
  if (g && c.bySym[g.sym]) {
    const a = c.bySym[g.sym], L = lvl(g, a), filled = Object.keys(g.filled).map(Number).sort((x, y) => x - y);
    seen_(c, g.sym, true, 'on its grid at level ' + L + ' of ±' + g.levels + ' (' + pct_(g.spacing, true) + ' steps around $' + g.center.toFixed(2) + '), ' + filled.length + ' slice(s) held');
    if (!a.tradable) return o;
    if (L < -g.levels - 1) {   // fell through the floor: cut and rebuild lower next round
      if (c.holdings[g.sym]) o.push({ sym: g.sym, side: 'SELL', frac: 1, why: g.sym + ' fell through the bottom of the grid, rebuilding lower', urgent: true });
      c.state.grid = null;
      return o;
    }
    const sells = filled.filter(f => L >= f + 1);
    if (sells.length && c.holdings[g.sym]) {
      o.push({ sym: g.sym, side: 'SELL', frac: Math.min(1, sells.length / filled.length),
        why: 'grid sell on ' + g.sym + ': bounced back up from level ' + sells[0] + ' (+' + (g.spacing * 100).toFixed(1) + '% per slice)' });
      sells.forEach(f => delete g.filled[f]);
      return o;
    }
    const buys = [];
    for (let k = -1; k >= -g.levels; k--) if (L <= k && !g.filled[k]) buys.push(k);
    if (buys.length) {
      const take = buys.slice(0, 2);
      take.forEach(k => g.filled[k] = true);
      o.push({ sym: g.sym, side: 'BUY', usd: c.equity * P.slice * take.length,
        why: 'grid buy on ' + g.sym + ': down to level ' + take[take.length - 1] + ' ($' + price(g, take[take.length - 1]).toFixed(2) + ')' });
      return o;
    }
    if (L > g.levels && !filled.length) { c.state.grid = null; kept_(c, g.sym, 'ran off the top of an empty grid, re-centring'); }
    else if (!filled.length && daysSince_(g.built, c.today) >= 3) { c.state.grid = null; kept_(c, g.sym, 'grid sat empty for 3 days, re-picking the market'); }
    return o;
  }
  // No grid yet: score each market on expected grid profit per day and centre a ladder on the best one.
  //   step  = about one day's typical swing (× the stepSwing lever), but at least 1.5× the round-trip cost
  //   score = steps crossed per day × profit per step after costs × sideways-ness (stocks trade 5 days of 7)
  const pool = c.assets.filter(a => ['BTC', 'ETH', 'SOL', 'SPY'].indexOf(a.sym) >= 0);
  const scored = pool.map(a => {
    if (a.er20 == null || !a.vol20) { seen_(c, a.sym, false, 'not enough history to judge'); return null; }
    const k = costs_(a.type, c.cfg), cost = 2 * k.slip + 2 * k.rate + k.sellExtra;
    const step = Math.min(0.08, Math.max(cost * 1.5, a.vol20 * P.stepSwing, 0.004));
    const score = (a.vol20 / step) * (step - cost) * (1 - a.er20) * (a.type === 'stock' ? 5 / 7 : 1);
    return { a, step, cost, score, why: 'sideways ' + (1 - a.er20).toFixed(2) + ', swings ' + pct_(a.vol20, true) + '/day, step ' + pct_(step, true) +
      ', costs ' + pct_(cost, true) + ' per buy+sell → grid score ' + (score * 1000).toFixed(2) + ' (per $1k per day)' };
  }).filter(Boolean).sort((x, y) => y.score - x.score);
  const best = scored.find(x => x.a.tradable && x.score > 0);
  scored.forEach(x => seen_(c, x.a.sym, x === best, x.why));
  if (best) {
    const a = best.a;
    c.state.grid = { sym: a.sym, center: a.price, spacing: +best.step.toFixed(4), levels: P.levels, filled: {}, built: c.today };
    kept_(c, a.sym, 'built a grid on ' + a.sym + ' (best score): ' + P.levels + ' levels each way, ' + pct_(best.step, true) + ' apart, around $' + a.price.toFixed(2) +
      '; each step nets about ' + pct_(best.step - best.cost, true) + ' after costs');
  }
  return o;
}

function daysSince_(a, b) { return a && b ? Math.round((new Date(b) - new Date(a)) / 864e5) : 0; }

// 🪙 15-minute scalper. Stocks use a tight target; crypto targets expand above its roughly 1.4% round-trip cost.
// Buys a quick dip in an asset that's up on the day, then exits on profit, stop or time. Stocks go flat by the bell;
// crypto can trade around the clock. c.hm is the round's time (HHmm), when live.
function stratNick_(c) {
  const P = c.params, o = [];
  c.state.last = c.state.last || {}; c.state.held = c.state.held || {};
  if (c.state.lastDay !== c.today) { c.state.last = {}; c.state.lastDay = c.today; }   // do not compare a new day with the prior day's last tick
  // Measured from today's close, so 1 PM early-close days (day after Thanksgiving, Christmas Eve) work too
  const mins = x => Math.floor(x / 100) * 60 + x % 100, toClose = c.hm != null ? mins(c.closeHm || 1600) - mins(c.hm) : null;
  const late = toClose != null && toClose <= 60, bell = toClose != null && toClose <= 15;
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s];
    if (!a) return;
    const g = a.price / c.holdings[s].avgCost - 1, rounds = (c.state.held[s] || 0) + (a.tradable ? 1 : 0);
    const crypto = a.type === 'crypto', roundTrip = crypto ? 2 * (c.cfg.CRYPTO_FEE_RATE + c.cfg.CRYPTO_SLIPPAGE) : 0;
    const take = crypto ? Math.max(0.02, P.take + roundTrip) : P.take;
    const stop = crypto ? Math.max(0.012, P.stop) : P.stop;
    const maxHold = crypto ? Math.max(8, P.maxHold) : P.maxHold;
    c.state.held[s] = rounds;
    if (!a.tradable) { kept_(c, s, 'market closed, waiting for the bell'); return; }
    if (g >= take) o.push({ sym: s, side: 'SELL', frac: 1, why: 'scalped ' + pct_(g) + ' on ' + s + (crypto ? ' after clearing about ' + pct_(roundTrip, true) + ' in crypto trading costs' : ' (' + pct_(g * (1 - c.cfg.ST_TAX_RATE)) + ' after the ' + Math.round(c.cfg.ST_TAX_RATE * 100) + '% short-term tax)') });
    else if (g <= -stop) o.push({ sym: s, side: 'SELL', frac: 1, why: 'cut ' + s + ' fast at ' + pct_(g), urgent: true });
    else if (rounds >= maxHold) o.push({ sym: s, side: 'SELL', frac: 1, why: 'time\'s up on ' + s + ' after ' + rounds + ' 15-minute rounds (' + pct_(g) + ')' });
    else if (!crypto && bell) o.push({ sym: s, side: 'SELL', frac: 1, why: 'flat before the closing bell (' + s + ' ' + pct_(g) + ')' });
    else kept_(c, s, pct_(g) + ' after ' + rounds + ' round(s); out at ' + pct_(take) + ', ' + pct_(-stop) + ' or ' + maxHold + ' rounds');
  });
  Object.keys(c.state.held).forEach(s => { if (!c.holdings[s]) delete c.state.held[s]; });
  // PDT limits only stock scalps; crypto remains available when the stock day-trade allowance is exhausted.
  const stockHeld = Object.keys(c.holdings).filter(s => c.bySym[s] && c.bySym[s].type === 'stock').length;
  const left = c.pdt && c.pdt.limited ? Math.max(0, c.pdt.max - c.pdt.used - stockHeld) : 3;
  const slots = Math.max(0, 3 - Object.keys(c.holdings).length);
  if (c.pdt && c.pdt.limited && !left) {
    c.assets.filter(a => a.type === 'stock' && !c.holdings[a.sym]).forEach(a => seen_(c, a.sym, false,
      'PDT rule: ' + c.pdt.used + ' of ' + c.pdt.max + ' day trades used in 5 business days, no new scalps until one rolls off'));
  }
  const pool = c.assets.filter(a => a.type === 'crypto' || (a.type === 'stock' && left > 0));
  let stockStarts = 0;
  pool.filter(a => !c.holdings[a.sym] && seen_(c, a.sym, (() => {
      const change = c.state.last[a.sym] ? a.price / c.state.last[a.sym] - 1 : null;
      const dip = a.type === 'crypto' ? Math.max(0.006, P.dip) : P.dip;
      return a.tradable && (a.type === 'crypto' || !late) && a.ret1 != null && change != null && a.ret1 >= P.dayUp && change <= -dip && change > -0.03;
    })(), !a.tradable ? 'market closed' : a.type === 'stock' && late ? 'too late in the day for a new stock scalp' : c.state.last[a.sym] == null ? 'first 15-minute look, needs one more round' :
      'up ' + pct_(a.ret1) + ' today, ' + pct_(a.price / c.state.last[a.sym] - 1) + ' in 15 minutes (crypto needs a wider dip to clear fees)'))
    .sort((x, y) => y.ret1 - x.ret1).filter(a => a.type === 'crypto' || stockStarts++ < left).slice(0, slots)
    .forEach(a => o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size,
      why: 'quick dip on ' + a.sym + ' (' + pct_(a.price / c.state.last[a.sym] - 1) + ' in 15 minutes, ' + pct_(a.ret1) + ' on the day)' }));
  c.assets.forEach(a => { if (a.tradable) c.state.last[a.sym] = a.price; });
  return o;
}

// 🐿️ Accumulator: maintain a large core position in one configured asset. After a profitable move,
// harvest only a slice; reinvest the available cash after a fee- and tax-aware pullback, but only if
// the estimated fill leaves the bot with more total asset units than it owned before the harvest.
function stratStack_(c) {
  const P = c.params, sym = String(c.cfg.ACCUM_ASSET || 'BTC').trim().toUpperCase(), a = c.bySym[sym], o = [];
  const st = c.state.stack || (c.state.stack = { pending: false, salePrice: 0, soldQty: 0, beforeQty: 0, cycles: 0, peakQty: 0 });
  if (!a) { seen_(c, sym, false, sym + ' is not in the Universe sheet or has no price data'); return o; }
  const h = c.holdings[sym], qty = h ? h.qty : 0;
  st.peakQty = Math.max(st.peakQty || 0, qty);
  const k = costs_(a.type, c.cfg), roundTrip = 2 * (k.slip + k.rate) + k.sellExtra;

  if (!h) {
    if (!seen_(c, sym, a.tradable && c.cash >= c.cfg.MIN_TRADE_USD, !a.tradable ? 'not tradable this round' :
      'building the first core position: deploy ' + pct_(P.deploy, true) + ' of equity into ' + sym)) return o;
    st.pending = false;
    o.push({ sym, side: 'BUY', usd: c.equity * P.deploy, why: 'started the ' + sym + ' stack; success is measured in units, not idle cash' });
    return o;
  }

  if (st.pending) {
    const taxDrag = P.takeProfit * c.cfg.ST_TAX_RATE / (1 + P.takeProfit);
    const needDip = Math.max(P.reentryDip, roundTrip + taxDrag + 0.003);
    const gross = Math.max(0, c.cash - k.flat) / (1 + k.rate), buyQty = gross / (a.price * (1 + k.slip));
    const afterQty = qty + buyQty, growsStack = afterQty > st.beforeQty * 1.001;
    const dipped = a.price <= st.salePrice * (1 - needDip);
    seen_(c, sym, dipped && growsStack, sym + ' is ' + pct_(a.price / st.salePrice - 1) + ' from the $' + st.salePrice.toFixed(4) +
      ' harvest; reload needs ' + pct_(-needDip) + ' and must exceed the prior ' + st.beforeQty.toPrecision(6) + ' units');
    if (a.tradable && dipped && growsStack && c.cash >= c.cfg.MIN_TRADE_USD) {
      st.pending = false; st.cycles = (st.cycles || 0) + 1;
      o.push({ sym, side: 'BUY', usd: c.cash, why: 'reinvested the harvest near $' + a.price.toFixed(4) + '; estimated stack ' +
        afterQty.toPrecision(6) + ' vs ' + st.beforeQty.toPrecision(6) + ' units before the sale (cycle ' + st.cycles + ')' });
    } else kept_(c, sym, qty.toPrecision(6) + ' core units held while $' + c.cash.toFixed(0) + ' waits for a stack-growing reload');
    return o;
  }

  const gain = a.price / h.avgCost - 1, take = Math.max(P.takeProfit, roundTrip + 0.02);
  seen_(c, sym, gain >= take, qty.toPrecision(6) + ' units, ' + pct_(gain) + ' vs average cost; harvests ' +
    pct_(P.sellSlice, true) + ' at ' + pct_(take, true) + ' profit, then buys back only if total units increase');
  if (a.tradable && gain >= take) {
    st.pending = true; st.salePrice = a.price; st.soldQty = qty * P.sellSlice; st.beforeQty = qty;
    o.push({ sym, side: 'SELL', frac: P.sellSlice, urgent: true, why: 'harvested ' + pct_(P.sellSlice, true) + ' of ' + sym +
      ' at ' + pct_(gain) + ' profit; proceeds are reserved to buy back more than ' + st.beforeQty.toPrecision(6) + ' total units' });
  } else kept_(c, sym, qty.toPrecision(6) + ' units stacked; waiting for ' + pct_(take, true) + ' profit before harvesting a slice');
  return o;
}

// 👻 Ghosts: buy each target once (when its market is open), then hold forever.
function ghost_(weights) {
  return c => {
    c.state.bought = c.state.bought || {};
    return Object.keys(weights).filter(s => c.bySym[s] && c.bySym[s].tradable && !c.state.bought[s]).map(s => {
      c.state.bought[s] = true;
      return { sym: s, side: 'BUY', usd: c.cfg.STARTING_CASH * weights[s] * 0.995, why: 'buys once, then haunts the leaderboard' };
    });
  };
}

// 🪞 Pairs: two assets that usually move together. When the gap between them stretches far past normal,
// buy the one that fell behind and sell once the gap closes. Long only, so she never shorts the leader.
const PAIRS = {
  crypto: [['ETH', 'BTC'], ['SOL', 'ETH'], ['LINK', 'ETH'], ['XRP', 'BTC']],
  stock: [['MSFT', 'AAPL'], ['NVDA', 'CRWV'], ['AMZN', 'MSFT'], ['TSLA', 'SPY']]
};
// How stretched a/b is today: z-score of log(a/b) against its previous n days. null without enough history.
function spreadZ_(a, b, n) {
  n = n || 30;
  if (!a || !b || !a.closes || !b.closes) return null;
  const k = Math.min(a.closes.length, b.closes.length);
  if (k < n + 1) return null;
  const r = [];
  for (let i = k - n - 1; i < k; i++) r.push(Math.log(a.closes[a.closes.length - k + i] / b.closes[b.closes.length - k + i]));
  const now = r.pop(), m = mean_(r), s = stdev_(r);
  return s > 0 ? (now - m) / s : null;
}
function stratMira_(c) {
  const P = c.params, o = [], pos = c.state.pairs = c.state.pairs || {};
  const pool = (c.assets[0] || {}).type || 'crypto', pairs = PAIRS[pool].filter(p => c.bySym[p[0]] && c.bySym[p[1]]);
  Object.keys(pos).forEach(s => { if (!c.holdings[s]) delete pos[s]; });
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s], p = pos[s];
    if (!a) return;
    const g = a.price / c.holdings[s].avgCost - 1;
    if (!p) { o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' is not part of an open pair trade' }); return; }
    const z = spreadZ_(c.bySym[p.cheap], c.bySym[p.rich]), days = daysSince_(p.day, c.today);
    if (g <= -P.stop) o.push({ sym: s, side: 'SELL', frac: 1, why: 'stop on the ' + p.cheap + '/' + p.rich + ' pair at ' + pct_(g), urgent: true });
    else if (z != null && z >= -P.exitZ) o.push({ sym: s, side: 'SELL', frac: 1, why: 'the ' + p.cheap + '/' + p.rich + ' gap closed (z ' + z.toFixed(2) + '), ' + pct_(g) });
    else if (days >= P.maxDays) o.push({ sym: s, side: 'SELL', frac: 1, why: 'gave the ' + p.cheap + '/' + p.rich + ' gap ' + days + ' days; it never closed (' + pct_(g) + ')' });
    else kept_(c, s, p.cheap + ' vs ' + p.rich + ' still stretched (z ' + (z == null ? 'n/a' : z.toFixed(2)) + ', sells at ' + (-P.exitZ).toFixed(2) + '), ' + pct_(g) + ', day ' + days + ' of ' + P.maxDays);
  });
  const slots = Math.max(0, 2 - Object.keys(c.holdings).length), ideas = [];
  pairs.forEach(([x, y]) => {
    const z = spreadZ_(c.bySym[x], c.bySym[y]);
    if (z == null) { seen_(c, x + '/' + y, false, 'not enough shared history for this pair'); return; }
    const cheap = z < 0 ? x : y, rich = z < 0 ? y : x, zc = -Math.abs(z), a = c.bySym[cheap];   // zc: how far the cheap side lags
    const ok = Math.abs(z) >= P.entryZ && a.tradable && !c.holdings[cheap];
    seen_(c, x + '/' + y, ok, x + ' vs ' + y + ' gap z ' + z.toFixed(2) + ' (buys the lagging side past ±' + P.entryZ + ')' + (Math.abs(z) >= P.entryZ ? '; ' + cheap + ' is the cheap side' : ''));
    if (ok) ideas.push({ cheap, rich, z: zc });
  });
  ideas.sort((p, q) => p.z - q.z).slice(0, slots).forEach(p => {
    pos[p.cheap] = { cheap: p.cheap, rich: p.rich, day: c.today };
    o.push({ sym: p.cheap, side: 'BUY', usd: c.equity * P.size, why: p.cheap + ' fell ' + Math.abs(p.z).toFixed(1) + ' standard deviations behind ' + p.rich + '; betting the gap closes' });
  });
  return o;
}

// 🫧 Bollinger bands: price usually stays within two standard deviations of its 20-day average. A dip below
// the lower band is a stretch that tends to snap back; sell back at the middle. Skips anything in free fall.
function stratBea_(c) {
  const P = c.params, o = [], z = a => a.sd20 > 0 ? (a.price - a.sma20) / a.sd20 : null;
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s];
    if (!a) return;
    const g = a.price / c.holdings[s].avgCost - 1, zz = z(a), stop = a.type === 'crypto' ? Math.max(0.1, P.stop) : P.stop;
    if (g <= -stop) o.push({ sym: s, side: 'SELL', frac: 1, why: 'stop-loss on ' + s + ' at ' + pct_(g), urgent: true });
    else if (zz != null && zz >= P.exitZ) o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' snapped back to the middle of its bands (' + pct_(g) + ')' });
    else kept_(c, s, 'band position ' + (zz == null ? 'n/a' : zz.toFixed(2)) + ' (sells at ' + P.exitZ + '), ' + pct_(g));
  });
  const slots = Math.max(0, 2 - Object.keys(c.holdings).length);
  c.assets.filter(a => !c.holdings[a.sym] && seen_(c, a.sym, a.tradable && z(a) != null && z(a) <= -P.entryZ && a.ret20 > -0.15,
    z(a) == null ? 'not enough history' : !a.tradable ? 'market closed' : 'band position ' + z(a).toFixed(2) + ' (buys at −' + P.entryZ + ' or lower)' +
      (a.ret20 <= -0.15 ? ', but down ' + pct_(a.ret20) + ' in 20 days: free fall, not a stretch' : '')))
    .sort((x, y) => z(x) - z(y)).slice(0, slots)
    .forEach(a => o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size, why: a.sym + ' stretched ' + (-z(a)).toFixed(1) + ' standard deviations under its 20-day average' }));
  return o;
}

// 🐢 Slow trend crossover: buy when the fast average crosses above the slow one, ride it with a trailing stop,
// leave when it crosses back. A 0.5% buffer around the cross keeps him from flapping. Few trades by design.
function stratToby_(c) {
  const P = c.params, o = [], peak = c.state.peak = c.state.peak || {};
  const F = Math.round(P.fast), S = Math.max(Math.round(P.slow), F + 5);   // the slow average stays slower
  const avg = (a, n) => a.closes && a.closes.length >= n ? mean_(a.closes.slice(-n)) : null;
  const cross = a => { const f = avg(a, F), s = avg(a, S); return f && s ? f / s - 1 : null; };
  Object.keys(peak).forEach(s => { if (!c.holdings[s]) delete peak[s]; });
  Object.keys(c.holdings).forEach(s => {
    const a = c.bySym[s];
    if (!a) return;
    peak[s] = Math.max(peak[s] || a.price, a.price);
    const x = cross(a), off = a.price / peak[s] - 1;
    if (off <= -P.trail) o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' fell ' + pct_(-off, true) + ' from its high (trailing stop)', urgent: true });
    else if (x != null && x < -0.005) o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' trend crossed down (' + F + '-day under ' + S + '-day)' });
    else kept_(c, s, 'trend ' + (x == null ? 'n/a' : pct_(x)) + ', ' + pct_(off) + ' from its high (trailing stop ' + pct_(P.trail, true) + ')');
  });
  const slots = Math.max(0, Math.round(P.picks) - Object.keys(c.holdings).length);
  c.assets.filter(a => !c.holdings[a.sym] && seen_(c, a.sym, a.tradable && cross(a) != null && cross(a) > 0.005 && a.price > avg(a, S),
    cross(a) == null ? 'not enough history' : !a.tradable ? 'market closed' : F + '-day vs ' + S + '-day average ' + pct_(cross(a)) + ' (buys above +0.5%)'))
    .sort((x, y) => cross(y) - cross(x)).slice(0, slots)
    .forEach(a => { peak[a.sym] = a.price; o.push({ sym: a.sym, side: 'BUY', usd: c.equity * P.size, why: a.sym + ' ' + F + '-day average crossed ' + pct_(cross(a)) + ' above its ' + S + '-day' }); });
  return o;
}

// ⚖️ Volatility targeting: hold the pool's benchmark, but size it so the portfolio's swings stay near a set
// level: more when the market is calm, less when it's wild, and cut further below the 50-day average.
// Resizes at most once a day, and only when the weight has drifted past a band.
function stratStella_(c) {
  const P = c.params, o = [], crypto = (c.assets[0] || {}).type === 'crypto', sym = crypto ? 'BTC' : 'SPY', a = c.bySym[sym];
  if (!a || !a.vol20) { seen_(c, sym, false, 'not enough history to measure its swings'); return o; }
  const annual = a.vol20 * Math.sqrt(crypto ? 365 : 252), target = crypto ? P.cryptoVol : P.stockVol;
  let w = Math.min(0.95, target / annual);
  const below = a.sma50 && a.price < a.sma50;
  if (below) w *= P.trendCut;
  const cur = ((c.holdings[sym] || {}).value || 0) / Math.max(1, c.equity), drift = Math.abs(w - cur);
  const why = sym + ' swings ' + pct_(annual, true) + ' a year; aiming for ' + pct_(target, true) + ' → ' + pct_(w, true) + ' invested' + (below ? ' (cut: under its 50-day average)' : '');
  const due = c.state.lastDay !== c.today && drift >= P.band;
  seen_(c, sym, due && a.tradable, why + (drift < P.band ? '; drift ' + pct_(drift, true) + ' is inside the ' + pct_(P.band, true) + ' band' : c.state.lastDay === c.today ? '; already resized today' : ''));
  Object.keys(c.holdings).filter(s => s !== sym).forEach(s => o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' is not her benchmark' }));
  if (due && a.tradable) {
    const ord = toTarget_(c, sym, w, why);
    if (ord) { o.push(ord); c.state.lastDay = c.today; }
  } else if (c.holdings[sym]) kept_(c, sym, why);
  return o;
}

// 📅 Calendar: money tends to flow into markets around the turn of the month (pay-days, pension and fund
// inflows). Hold the benchmark from the last trading day through the third trading day of the next month,
// but only where this asset's own history shows the habit (or there isn't enough history yet to say).
function stratCal_(c) {
  const P = c.params, o = [], crypto = (c.assets[0] || {}).type === 'crypto', syms = crypto ? ['BTC', 'ETH'] : ['SPY'];
  Object.keys(c.holdings).filter(s => syms.indexOf(s) < 0).forEach(s => o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' is not on the almanac' }));
  syms.forEach(sym => {
    const a = c.bySym[sym];
    if (!a || !a.tom) { seen_(c, sym, false, 'no history for ' + sym); return; }
    const t = a.tom, trusted = t.nIn < 10 || (t.edge != null && t.edge > P.minEdge);
    const habit = t.edge == null ? 'no record yet' : 'turn-of-month days averaged ' + pct_(t.inAvg) + ' vs ' + pct_(t.outAvg) + ' on other days (' + t.nIn + ' days)';
    if (c.holdings[sym]) {
      if (!t.now) o.push({ sym, side: 'SELL', frac: 1, why: 'the turn of the month is over; ' + habit });
      else kept_(c, sym, 'inside the turn-of-month window; ' + habit);
      return;
    }
    if (seen_(c, sym, t.now && trusted && a.tradable, (t.now ? 'inside' : 'outside') + ' the turn-of-month window; ' + habit + (trusted ? '' : ', so the habit does not hold here')))
      o.push({ sym, side: 'BUY', usd: c.equity * P.size / syms.length, why: 'turn of the month: ' + habit });
  });
  return o;
}

const STRATEGIES = {
  G_SPY: ghost_({ SPY: 1 }), G_BTC: ghost_({ BTC: 1 }), G_MIX: ghost_({ SPY: 0.5, BTC: 0.5 }),
  MOMO: stratMomo_, VAL: stratVal_, CASS: stratCass_, HANK: stratHank_,
  QUANT: stratQuant_, DANA: stratDana_, BELLA: stratBella_, WES: stratWes_, GRID: stratGreta_, SCALP: stratNick_, STACK: stratStack_,
  PAIR: stratMira_, BAND: stratBea_, TREND: stratToby_, VOLT: stratStella_, CAL: stratCal_
};

/* ---------- helpers ---------- */

// Order that moves a holding toward w (fraction of equity); ignores drifts under 3% to avoid fee churn.
function toTarget_(c, sym, w, why) {
  const cur = (c.holdings[sym] || {}).value || 0, diff = c.equity * w - cur;
  if (Math.abs(diff) < Math.max(c.cfg.MIN_TRADE_USD, c.equity * 0.03)) {
    if (cur > 0) kept_(c, sym, 'already near its target weight (' + pct_(w, true) + ')');
    return null;
  }
  return diff > 0 ? { sym, side: 'BUY', usd: diff, why } : { sym, side: 'SELL', frac: Math.min(1, -diff / cur), why };
}

// Proof of work: note an asset the bot checked (and whether it passed), or a holding it chose to keep.
function seen_(c, sym, ok, detail) {
  if (c.log) c.log.checks.push({ sym, ok: !!ok, d: detail });
  return !!ok;
}
function kept_(c, sym, detail) {
  if (c.log) c.log.holds.push({ sym, d: detail });
}
function rel_(x, y) { return pct_(x / y - 1); }

function zs_(a) {
  const m = mean_(a), s = stdev_(a) || 1;
  return a.map(x => (x - m) / s);
}

function pct_(x, noSign) {
  return (!noSign && x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
}

function pick_(a) { return a[Math.floor(Math.random() * a.length)]; }
