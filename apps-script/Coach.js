/**
 * GAME OF TRADES — self-improvement: levers, the daily study hall, the coach, and shadow twins.
 *
 * Levers: every bot's rules are driven by named settings (LEVERS below). Defaults reproduce the original rules.
 * Adopted lessons live in the PARAMS script property and persist across seasons.
 *
 * Study hall (daily, ~5 PM New York): each bot gets a report card, then the coach suggests ONE lever change per bot
 * (Gemini, one batched call; a rule-based coach when there's no key or the call fails). Nothing is applied directly:
 * a shadow twin, a private copy of the bot's account with that one change, trades alongside it every round.
 * After 10+ days the twin is judged: adopted if it's ahead of the bot and the sign-flip test gives p < 0.2, else rejected.
 * Every idea goes in the Coach's Notebook sheet with its outcome, and the coach sees each bot's last 5 results.
 */

// [default, min, max, step, what it does, direction that trades more often (+1 up, -1 down, 0 n/a)]
const LEVERS = {
  MOMO: { size: [0.3, 0.1, 0.4, 0.05, 'share of the portfolio per buy', 0], picks: [2, 1, 3, 1, 'uptrends held at once', 1] },
  VAL: { rsiBuy: [32, 20, 40, 2, 'buys when RSI is under this', 1], rsiSell: [55, 45, 70, 5, 'sells once RSI recovers above this', -1],
    takeProfit: [0.08, 0.03, 0.2, 0.01, 'profit target', -1], stopLoss: [0.15, 0.05, 0.25, 0.02, 'stop-loss', -1], size: [0.2, 0.1, 0.35, 0.05, 'share of the portfolio per buy', 0] },
  CASS: { fearBuy: [25, 10, 40, 5, 'buys when Fear & Greed is at or below this', 1], greedTrim: [75, 60, 90, 5, 'trims when Fear & Greed reaches this', -1],
    sizeMult: [1, 0.5, 1.3, 0.1, 'size of every position (×)', 0] },
  HANK: { buyScore: [0.25, 0.1, 0.5, 0.05, 'news score needed to buy', -1], minHeadlines: [5, 3, 10, 1, 'headlines needed to buy', -1],
    sellScore: [-0.15, -0.4, 0, 0.05, 'news score that triggers a sell', 1], size: [0.25, 0.1, 0.35, 0.05, 'share of the portfolio per buy', 0] },
  QUANT: { topN: [3, 2, 5, 1, 'top-ranked assets held', 1], invest: [0.9, 0.6, 1, 0.05, 'share of the portfolio invested', 0],
    overbought: [75, 65, 85, 5, 'RSI above this gets an overbought penalty', 1],
    rankBuffer: [3, 2, 6, 1, 'extra rank places an existing holding may slip before replacement', 0],
    swapEdge: [1.25, 0.5, 2.5, 0.25, 'score advantage a newcomer needs before replacing a holding', -1],
    cooldown: [48, 24, 192, 24, '15-minute rounds between portfolio replacements', -1],
    rebalanceBand: [0.12, 0.08, 0.3, 0.02, 'minimum portfolio-weight drift before resizing a position', -1],
    rebalanceCooldown: [96, 24, 192, 24, '15-minute rounds between routine weight rebalances', -1] },
  DANA: { btcShare: [0.5, 0.2, 0.8, 0.1, 'share of each daily buy that goes to BTC (the rest to SPY)', 0] },
  BELLA: { volNeed: [1.2, 1, 2, 0.1, 'volume (× normal) needed on a breakout', -1], size: [0.25, 0.1, 0.35, 0.05, 'share of the portfolio per buy', 0] },
  WES: { volNeed: [1.8, 1.3, 3, 0.1, 'volume (× normal) needed to buy', -1], exitVol: [2, 1.5, 3, 0.1, 'volume on a red day that triggers a sell', 1],
    size: [0.2, 0.1, 0.35, 0.05, 'share of the portfolio per buy', 0] },
  GRID: { stepSwing: [1, 0.5, 2, 0.25, 'grid step, in days of typical price swing', -1], levels: [4, 2, 6, 1, 'levels below the centre', 1],
    slice: [0.1, 0.05, 0.15, 0.01, 'share of the portfolio bought at each level', 0] },
  SCALP: { take: [0.006, 0.003, 0.015, 0.001, 'stock profit target per scalp (crypto uses a fee-aware minimum)', -1], stop: [0.005, 0.002, 0.015, 0.001, 'stock stop-loss per scalp', -1],
    maxHold: [3, 1, 8, 1, '15-minute rounds before bailing out (crypto gets at least 8)', -1], dip: [0.002, 0.001, 0.008, 0.001, '15-minute dip needed to buy', -1],
    dayUp: [0.004, 0, 0.01, 0.001, 'gain on the day needed to buy', -1], size: [0.2, 0.1, 0.3, 0.05, 'share of the portfolio per scalp', 0] },
  STACK: { takeProfit: [0.06, 0.03, 0.15, 0.01, 'gain that triggers a partial harvest', -1],
    sellSlice: [0.2, 0.1, 0.4, 0.05, 'share of the position harvested at a profit', 0],
    reentryDip: [0.04, 0.02, 0.12, 0.01, 'drop from the sale price required before reinvesting', -1],
    deploy: [0.85, 0.6, 0.95, 0.05, 'initial share of equity placed in the target asset', 0] },
  PAIR: { entryZ: [2, 1.5, 3, 0.25, 'how stretched (z-score) a pair gap must be to buy the lagging side', -1],
    exitZ: [0.5, 0, 1, 0.25, 'gap z-score at which she takes profit (higher = earlier)', 1],
    maxDays: [10, 3, 20, 1, 'days she waits for a gap to close', -1], stop: [0.08, 0.04, 0.15, 0.01, 'stop-loss', -1],
    size: [0.3, 0.1, 0.4, 0.05, 'share of the portfolio per pair trade', 0] },
  BAND: { entryZ: [2, 1.5, 2.5, 0.25, 'standard deviations under the 20-day average needed to buy', -1],
    exitZ: [0, -0.5, 1, 0.25, 'band position where she sells (0 = middle band)', -1],
    stop: [0.08, 0.04, 0.15, 0.01, 'stop-loss (crypto uses at least 10%)', -1], size: [0.25, 0.1, 0.35, 0.05, 'share of the portfolio per buy', 0] },
  TREND: { fast: [10, 5, 20, 1, 'days in the fast average', 1], slow: [30, 20, 60, 5, 'days in the slow average', -1],
    trail: [0.12, 0.06, 0.25, 0.02, 'trailing stop from the high', -1], picks: [2, 1, 3, 1, 'trends ridden at once', 1],
    size: [0.3, 0.1, 0.4, 0.05, 'share of the portfolio per buy', 0] },
  VOLT: { stockVol: [0.12, 0.06, 0.2, 0.02, 'yearly swing size aimed for in stocks', 0], cryptoVol: [0.4, 0.2, 0.6, 0.05, 'yearly swing size aimed for in crypto', 0],
    trendCut: [0.5, 0, 1, 0.25, 'share of the position kept while under the 50-day average', 0],
    band: [0.1, 0.05, 0.25, 0.05, 'weight drift needed before resizing', -1] },
  CAL: { size: [0.9, 0.5, 0.95, 0.05, 'share of the portfolio held in the window', 0],
    minEdge: [0, -0.002, 0.003, 0.001, 'how much better window days must have been (daily) to trust the habit', -1] }
};
// Challengers' levers live in their genome params
const GENOME_LEVERS = {
  buyThreshold: [null, 0.05, 0.6, 0.05, 'conviction needed to buy', -1], sellThreshold: [null, -0.6, 0, 0.05, 'conviction that triggers a sell', 1],
  positionSize: [null, 0.1, 0.4, 0.05, 'share of the portfolio per buy', 0], maxPositions: [null, 1, 5, 1, 'positions held at once', 1],
  stopLoss: [null, 0, 0.3, 0.03, 'stop-loss (0 = none)', -1], takeProfit: [null, 0, 0.4, 0.05, 'profit target (0 = none)', -1]
};
const TWIN_MIN_DAYS = 10, TWIN_P = 0.2;
const NOTEBOOK = "Coach's Notebook", STUDY = 'Study Hall', TWINS = '_twins';
const NB_HEADERS = ['ID', 'Date', 'Bot', 'Lever', 'From', 'To', 'Reason', 'Coach', 'Status', 'Started', 'Ended', 'Bot return', 'Twin return', 'p', 'Result'];

function leversFor_(def) {
  if (def.ghost) return {};
  if (LEVERS[def.baseId || def.id]) return LEVERS[def.baseId || def.id];
  const out = {};
  Object.keys(GENOME_LEVERS).forEach(k => { const L = GENOME_LEVERS[k].slice(); L[0] = def.dna && def.dna.params ? def.dna.params[k] : 0; out[k] = L; });
  return out;
}

function adopted_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PARAMS') || '{}'); } catch (e) { return {}; }
}

// The settings a bot trades with right now: lever defaults, plus lessons it has adopted.
function paramsFor_(def, overrides) {
  const L = leversFor_(def), p = {};
  Object.keys(L).forEach(k => p[k] = L[k][0]);
  return Object.assign(p, adopted_()[def.id] || {}, overrides || {});
}

/* ---------- shadow twins: run every round alongside their bot ---------- */

function loadTwins_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TWINS), out = {};
  if (!sh || sh.getLastRow() < 1) return out;
  sh.getDataRange().getValues().forEach(r => { if (r[0]) try { out[r[0]] = JSON.parse(r[1]); } catch (e) { /* skip */ } });
  return out;
}

function saveTwins_(twins) {
  const sh = getSheet_(TWINS);
  sh.clearContents();
  const rows = Object.keys(twins).map(id => [id, JSON.stringify(twins[id])]);
  if (rows.length) sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.hideSheet();
}

// Called from runRound after the real bots trade. Returns a summary for telemetry.
function runTwins_(roster, bots, lots, mkt, cfg, now, today, scores) {
  const twins = loadTwins_(), out = [];
  if (!Object.keys(twins).length) return out;
  roster.forEach(def => {
    const tw = twins[def.id];
    if (!tw) return;
    if (tw.reseed) {   // a new season reset the bot's account: the twin restarts beside it, keeping its banked days
      if (!bots[def.id]) return;
      const fresh = startTwin_(def, tw, bots, lots);
      tw.acct = fresh.acct; tw.lots = fresh.lots; tw.points = {}; delete tw.reseed;
    }
    const tdef = Object.assign({}, def, { id: 'T_' + def.id }), acct = tw.acct, tlots = tw.lots;
    const ctx = buildCtx_(tdef, acct, tlots, mkt, cfg, today, paramsFor_(def, { [tw.lever]: tw.to }));
    let orders = [];
    try { orders = (strategyFor_(def)(ctx) || []).filter(Boolean); } catch (e) { orders = []; }
    orders.sort((x, y) => (x.side === 'SELL' ? 0 : 1) - (y.side === 'SELL' ? 0 : 1));
    let filled = 0;
    orders.forEach(o => { if (execute_(tdef, acct, tlots, mkt, cfg, o, now)) filled++; });
    const twinVal = liquidationValue_(tdef.id, acct, tlots, mkt, cfg, now), botVal = scores[def.id];
    tw.points = tw.points || {};
    tw.points[today] = [botVal, twinVal];
    tw.trades = (tw.trades || 0) + filled;
    const s = twinSeries_(tw);
    out.push({ bot: def.name, lever: tw.lever, from: tw.from, to: tw.to, days: s.pairs.length, filled, botRet: s.botRet, twinRet: s.twinRet });
  });
  saveTwins_(twins);
  return out;
}

// A twin's daily [bot return, twin return] pairs: days banked from earlier seasons, then this season's.
function twinSeries_(tw) {
  const pairs = (tw.bank || []).slice(), days = Object.keys(tw.points || {}).sort();
  for (let i = 1; i < days.length; i++) {
    const a = tw.points[days[i - 1]], b = tw.points[days[i]];
    if (a[0] > 0 && a[1] > 0) pairs.push([b[0] / a[0] - 1, b[1] / a[1] - 1]);
  }
  const grow = j => pairs.reduce((m, p) => m * (1 + p[j]), 1) - 1;
  return { pairs, botRet: grow(0), twinRet: grow(1) };
}

// A twin starts as an exact copy of its bot's account right now (cash, holdings, bookkeeping, memory).
function startTwin_(def, idea, bots, lots) {
  const b = bots[def.id];
  return { id: idea.id, lever: idea.lever, from: idea.from, to: idea.to, started: new Date().toISOString(), trades: 0, points: {},
    acct: JSON.parse(JSON.stringify({ start: b.start, cash: b.cash, fees: b.fees, taxes: b.taxes, carry: b.carry, trades: b.trades,
      wins: b.wins, losses: b.losses, peak: b.peak, maxDD: b.maxDD, state: b.state || {} })),
    lots: lots.filter(l => l.bot === def.id).map(l => Object.assign({}, l, { bot: 'T_' + def.id })) };
}

// Adopt or reject once a twin has TWIN_MIN_DAYS daily returns (they may span a season change).
function judgeTwin_(tw) {
  const s = twinSeries_(tw);
  if (s.pairs.length < TWIN_MIN_DAYS) return null;
  const ex = s.pairs.map(p => p[1] - p[0]), botRet = s.botRet, twinRet = s.twinRet;
  const same = ex.every(e => Math.abs(e) < 1e-9);   // the change never came into play
  const p = same ? 1 : signFlipP_(ex), adopt = !same && twinRet > botRet && p < TWIN_P;
  return { adopt, same, p, botRet, twinRet, days: ex.length };
}

/* ---------- the study hall ---------- */

function studyHall(e) {
  if (isScheduledTrigger_(e, 'studyHall')) {
    migrateLegacyStudyHallTrigger_();
    return studyHall_();
  }
  assertOwner_();
  return studyHall_();
}

function scheduledStudyHall(e) {
  assertScheduledTrigger_(e, 'scheduledStudyHall');
  return studyHall_();
}

function studyHall_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { error: 'A round is running. Try again in a minute.' };
  try { return studyHallCore_(); } finally { lock.releaseLock(); }
}

function studyHallCore_() {
  const roster = getCompetitionRoster_().filter(d => !d.ghost), bots = loadBots_(), lots = loadLots_(), twins = loadTwins_();
  const nb = notebook_(), now = new Date(), date = Utilities.formatDate(now, TZ, 'yyyy-MM-dd'), events = [];
  const params = adopted_();

  // 1. Judge twins that have run long enough
  roster.forEach(def => {
    const tw = twins[def.id];
    if (!tw) return;
    const v = judgeTwin_(tw);
    if (!v) return;
    const gap = ((v.twinRet - v.botRet) * 100).toFixed(2);
    const res = v.same ? 'No difference: the change never came into play in ' + v.days + ' days'
      : (v.adopt ? 'Adopted: ' : 'Rejected: ') + 'twin ' + pct_(v.twinRet) + ' vs bot ' + pct_(v.botRet) + ' (' + (gap > 0 ? '+' : '') + gap + ' pts) over ' + v.days + ' days, p=' + v.p.toFixed(2);
    if (v.adopt) {
      params[def.id] = Object.assign(params[def.id] || {}, { [tw.lever]: tw.to });
      events.push({ kind: 'lesson', bot: def.name, text: def.name + ' adopted a lesson: ' + tw.lever + ' ' + tw.from + ' → ' + tw.to + ' (twin beat it ' + pct_(v.twinRet - v.botRet) + ', p=' + v.p.toFixed(2) + ')' });
    } else events.push({ kind: 'lesson', bot: def.name, text: def.name + (v.same ? ' dropped ' : ' rejected ') + tw.lever + ' ' + tw.from + ' → ' + tw.to + ': ' + res.replace(/^Rejected: /, '') });
    nbUpdate_(nb, tw.id, { Status: v.adopt ? 'adopted' : v.same ? 'no difference' : 'rejected', Ended: now, 'Bot return': v.botRet, 'Twin return': v.twinRet, p: v.p, Result: res });
    delete twins[def.id];
  });
  PropertiesService.getScriptProperties().setProperty('PARAMS', JSON.stringify(params));

  // 2. Report cards
  const trades = getSheet_(SHEETS.TRADES).getDataRange().getValues().slice(1).filter(r => r[0] instanceof Date && now - r[0] < 7 * 864e5 && !/^Warm-up/.test(r[11]));
  const board = {}; getSheet_(SHEETS.BOARD).getRange(5, 1, BOARD_ROWS, BOARD_COLS).getValues().forEach(r => {
    if (r[1]) board[String(r[1]).replace(/^\S+\s/, '')] = { ret: r[4], vsMarket: r[14], fees: r[8], maxDD: r[12], skill: r[15], rank: r[0] };
  });
  const cards = roster.map(def => {
    const mine = trades.filter(r => r[1] === def.name), day = mine.filter(r => now - r[0] < 864e5);
    const s = board[def.name] || {}, tw = twins[def.id];
    return { id: def.id, name: def.name, strategy: def.strategy, trades7: mine.length, tradesToday: day.length,
      realized7: mine.reduce((t, r) => t + (+r[8] || 0), 0), fees7: mine.reduce((t, r) => t + (+r[7] || 0), 0),
      ret: s.ret, vsMarket: s.vsMarket, maxDD: s.maxDD, fees: s.fees, skill: s.skill, rank: s.rank,
      last: day.length ? day[day.length - 1][2] + ' ' + day[day.length - 1][3] + ' (' + day[day.length - 1][11] + ')' : '',
      params: paramsFor_(def), testing: tw ? { lever: tw.lever, from: tw.from, to: tw.to, days: twinSeries_(tw).pairs.length } : null };
  });

  // 3. The coach: one idea for each bot that isn't already testing one
  const free = roster.filter(d => !twins[d.id] && Object.keys(leversFor_(d)).length);
  let ideas = {}, by = 'rules';
  if (free.length && llmProvider_()) {
    const got = llmCoach_(free, cards, nb);
    if (got) { ideas = got; by = llmProvider_() === 'gemini' ? 'Gemini' : 'Claude'; }
  }
  free.forEach(def => {
    let idea = ideas[def.id], coach = by;
    if (!idea) { idea = ruleCoach_(def, cards.find(c => c.id === def.id), nb); coach = 'rules'; }
    if (!idea) return;
    idea.id = 'N' + now.getTime().toString(36) + def.id;
    nb.sh.appendRow([idea.id, now, def.name, idea.lever, idea.from, idea.to, idea.reason, coach, 'testing', now, '', '', '', '', '']);
    twins[def.id] = startTwin_(def, idea, bots, lots);
    const card = cards.find(c => c.id === def.id);
    card.idea = { lever: idea.lever, label: leversFor_(def)[idea.lever][4], from: idea.from, to: idea.to, reason: idea.reason, coach };
    card.testing = { lever: idea.lever, from: idea.from, to: idea.to, days: 0 };
    events.push({ kind: 'coach', bot: def.name, text: 'Coach (' + coach + ') gave ' + def.name + ' an idea to test: ' + idea.lever + ' ' + idea.from + ' → ' + idea.to });
  });
  saveTwins_(twins);

  // 4. File the study hall and hand the events to the next telemetry row
  const sh = getSheet_(STUDY);
  if (sh.getLastRow() === 0) header_(STUDY, ['Date', 'Bot', 'Trades (7d)', 'Return', 'vs market', 'Idea', 'Coach', 'Details (JSON)']);
  const rows = cards.map(c => [now, c.name, c.trades7, c.ret, c.vsMarket, c.idea ? c.idea.lever + ' ' + c.idea.from + ' → ' + c.idea.to : (c.testing ? 'testing ' + c.testing.lever : ''),
    c.idea ? c.idea.coach : '', JSON.stringify(c)]);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  const props = PropertiesService.getScriptProperties();
  let pending = []; try { pending = JSON.parse(props.getProperty('TELE_PENDING') || '[]'); } catch (e) { pending = []; }
  props.setProperty('TELE_PENDING', JSON.stringify(pending.concat(events).slice(-40)));
  props.setProperty('STUDY_LAST', JSON.stringify({ at: now.toISOString(), date, coach: by, ideas: free.length, events }));
  return { summary: 'Study hall done: ' + events.length + ' notes. ' + (free.length ? free.length + ' new experiment(s) started.' : 'Every bot is already testing an idea.') };
}

/* ---------- coaches ---------- */

function llmCoach_(free, cards, nb) {
  const brief = free.map(def => {
    const L = leversFor_(def), card = cards.find(c => c.id === def.id), cur = paramsFor_(def);
    return { bot: def.id, name: def.name, strategy: def.strategy,
      report: { tradesLast7Days: card.trades7, return: card.ret, vsMarket: card.vsMarket, maxDrawdown: card.maxDD, fees: card.fees, luckTest: card.skill },
      levers: Object.keys(L).map(k => ({ lever: k, now: cur[k], min: L[k][1], max: L[k][2], step: L[k][3], means: L[k][4] })),
      pastIdeas: nb.rows.filter(r => r.Bot === def.name).slice(-5).map(r => ({ lever: r.Lever, from: r.From, to: r.To, status: r.Status, result: r.Result })) };
  });
  const prompt = 'You coach trading bots in a paper-trading game. For EACH bot below, suggest exactly ONE small change to ONE of its levers ' +
    'that you expect to improve its return versus the market, based on its report and what happened to its past ideas (do not repeat rejected ideas). ' +
    'Stay within min/max, move by one or two steps, keep the bot true to its strategy. Give a one-sentence reason a 10-year-old can follow.\n' +
    'Taxes: gains on anything held one year or less are short-term, taxed at ' + Math.round(readConfig_().ST_TAX_RATE * 100) + '%; held more than a year, ' +
    Math.round(readConfig_().LT_TAX_RATE * 100) + '%. Frequent traders pay the higher rate on every win, so weigh trading less against catching more moves.\n' +
    'Return ONLY a JSON array like [{"bot":"MOMO","lever":"size","to":0.25,"reason":"..."}].\n\n' + JSON.stringify(brief);
  const text = llm_(prompt, readConfig_(), { maxTokens: 4096, json: true });
  const m = text && text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  let raw; try { raw = JSON.parse(m[0]); } catch (e) { return null; }
  const out = {};
  raw.forEach(x => {
    const def = free.find(d => d.id === x.bot);
    if (!def) return;
    const idea = validIdea_(def, x.lever, x.to, String(x.reason || '').slice(0, 240));
    if (idea) out[def.id] = idea;
  });
  return out;
}

// Snap to the lever's step, clamp to bounds, and refuse no-ops.
function validIdea_(def, lever, to, reason) {
  const L = leversFor_(def)[lever];
  if (!L || typeof to !== 'number' || !isFinite(to)) return null;
  const from = paramsFor_(def)[lever];
  let v = Math.min(L[2], Math.max(L[1], to));
  v = +(Math.round((v - L[1]) / L[3]) * L[3] + L[1]).toFixed(4);
  if (v === from) return null;
  return { lever, from, to: v, reason: reason || 'Try a small change.' };
}

// No key, or the model failed: pick a change from the report card.
function ruleCoach_(def, card, nb) {
  const L = leversFor_(def), cur = paramsFor_(def), keys = Object.keys(L);
  const mine = nb.rows.filter(r => r.Bot === def.name);
  const skip = mine.filter(r => r.Status === 'rejected' || r.Status === 'no difference').map(r => r.Lever + '=' + r.To)
    .concat(mine.filter(r => r.Status === 'adopted').map(r => r.Lever + '=' + r.From));   // don't undo a lesson just learned
  const tryKeys = (list, dirFor, reason) => {
    for (const k of list.slice().sort(() => Math.random() - 0.5)) {
      const idea = validIdea_(def, k, cur[k] + dirFor(k) * L[k][3], reason);
      if (idea && skip.indexOf(k + '=' + idea.to) < 0) return idea;
    }
    return null;
  };
  const entry = keys.filter(k => L[k][5] !== 0), sizing = keys.filter(k => L[k][5] === 0);
  const pctOf = v => typeof v === 'number' ? (v * 100).toFixed(1) + '%' : 'n/a';
  let idea = null;
  if (card.trades7 === 0 && entry.length)
    idea = tryKeys(entry, k => L[k][5], 'No trades in a week, so loosen one rule a notch and see if it finds more chances.');
  else if (card.maxDD > 0.08)
    idea = tryKeys(sizing.length ? sizing : entry, k => L[k][5] === 0 ? -1 : -L[k][5], 'A ' + pctOf(card.maxDD) + ' drawdown is too deep, so try smaller or pickier bets.');
  else if (card.fees > 100 && entry.length)
    idea = tryKeys(entry, k => -L[k][5], 'Fees are eating into returns, so be a little pickier and trade less.');
  if (idea) return idea;
  const reason = typeof card.vsMarket === 'number' && card.vsMarket < 0
    ? 'Trailing the market by ' + pctOf(-card.vsMarket) + ', so test a different setting.'
    : 'Doing fine, so test whether a small tweak does even better.';
  return tryKeys(keys, () => 1, reason) || tryKeys(keys, () => -1, reason);
}

/* ---------- the notebook ---------- */

function notebook_() {
  const sh = getSheet_(NOTEBOOK);
  if (sh.getLastRow() === 0) header_(NOTEBOOK, NB_HEADERS);
  const v = sh.getDataRange().getValues();
  const rows = v.slice(1).map((r, i) => { const o = { _row: i + 2 }; NB_HEADERS.forEach((h, j) => o[h] = r[j]); return o; }).filter(o => o.ID);
  return { sh, rows };
}

function nbUpdate_(nb, id, fields) {
  const r = nb.rows.find(x => x.ID === id);
  if (!r) return;
  Object.keys(fields).forEach(k => { const col = NB_HEADERS.indexOf(k); if (col >= 0) { nb.sh.getRange(r._row, col + 1).setValue(fields[k]); r[k] = fields[k]; } });
}

// New season: experiments carry on. Each twin banks its daily results so far and restarts beside its bot's
// fresh account on the next round. (Ending them here meant a 10-day test could never finish inside a 10-day
// season, so no lesson was ever adopted.) Twins of bots that left the arena end; adopted lessons stay.
function endTwinsForSeason_() {
  const twins = loadTwins_(), ids = Object.keys(twins);
  if (!ids.length) return;
  const live = new Set(getCompetitionRoster_().map(d => d.id)), gone = [];
  ids.forEach(id => {
    const tw = twins[id];
    if (!live.has(id)) { gone.push(tw.id); delete twins[id]; return; }
    tw.bank = twinSeries_(tw).pairs;
    tw.points = {}; tw.reseed = true;
  });
  if (gone.length) {
    const nb = notebook_(), now = new Date();
    gone.forEach(nid => nbUpdate_(nb, nid, { Status: 'ended', Ended: now, Result: 'The bot left the arena before the test finished' }));
  }
  saveTwins_(twins);
}

/* ---------- triggers and the Academy ---------- */

function startStudyHall_() {
  ScriptApp.getProjectTriggers().filter(t => ['studyHall', 'scheduledStudyHall'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scheduledStudyHall').timeBased().atHour(17).everyDays(1).inTimezone(TZ).create();
}

function runStudyHallNow() {
  assertOwner_();
  const r = studyHall();
  SpreadsheetApp.getUi().alert('Study hall', r.error || r.summary, SpreadsheetApp.getUi().ButtonSet.OK);
}

function webStudyHall() {
  assertOwner_();
  return JSON.stringify(studyHall_());
}

function studyForWeb_() {
  let last = null; try { last = JSON.parse(PropertiesService.getScriptProperties().getProperty('STUDY_LAST') || 'null'); } catch (e) { last = null; }
  const ss = SpreadsheetApp.getActive(), nbSh = ss.getSheetByName(NOTEBOOK), stSh = ss.getSheetByName(STUDY);
  const iso = v => v instanceof Date ? v.toISOString() : v;
  const notebook = nbSh && nbSh.getLastRow() > 1 ? nbSh.getRange(Math.max(2, nbSh.getLastRow() - 59), 1, Math.min(60, nbSh.getLastRow() - 1), NB_HEADERS.length).getValues()
    .map(r => ({ id: r[0], date: iso(r[1]), bot: r[2], lever: r[3], from: r[4], to: r[5], reason: r[6], coach: r[7], status: r[8], ended: iso(r[10]), botRet: r[11], twinRet: r[12], p: r[13], result: r[14] })).reverse() : [];
  let cards = [];
  if (stSh && stSh.getLastRow() > 1) {
    const n = Math.min(40, stSh.getLastRow() - 1), rows = stSh.getRange(stSh.getLastRow() - n + 1, 1, n, 8).getValues();
    const newest = rows.length ? +rows[rows.length - 1][0] : 0;
    cards = rows.filter(r => +r[0] === newest).map(r => { try { return JSON.parse(r[7]); } catch (e) { return null; } }).filter(Boolean);
  }
  const twins = loadTwins_(), live = {};
  getCompetitionRoster_().forEach(d => {
    const tw = twins[d.id];
    if (!tw) return;
    const s = twinSeries_(tw);
    live[d.name] = { lever: tw.lever, label: (leversFor_(d)[tw.lever] || [])[4] || tw.lever, from: tw.from, to: tw.to, started: tw.started, days: s.pairs.length,
      need: TWIN_MIN_DAYS, trades: tw.trades || 0, botRet: s.pairs.length ? s.botRet : null, twinRet: s.pairs.length ? s.twinRet : null };
  });
  const lessons = {}, P = adopted_();
  getCompetitionRoster_().forEach(d => { if (P[d.id]) lessons[d.name] = Object.keys(P[d.id]).map(k => ({ lever: k, label: (leversFor_(d)[k] || [])[4] || k, to: P[d.id][k], was: (leversFor_(d)[k] || [])[0] })); });
  const decided = notebook.filter(r => r.status === 'adopted' || r.status === 'rejected');
  let lab = null; try { lab = labForWeb_(); } catch (e) { lab = null; }
  let camp = null; try { camp = campForWeb_(); } catch (e) { camp = null; }
  return { last, cards, live, notebook, lessons, lab, camp, hitRate: decided.length ? decided.filter(r => r.status === 'adopted').length / decided.length : null, decided: decided.length };
}
