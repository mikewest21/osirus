/**
 * GAME OF TRADES — engine: runs a round, fills orders with fees + slippage, FIFO tax lots, scores the leaderboard.
 */

function runRound(e) {
  if (isScheduledTrigger_(e, 'runRound')) {
    migrateLegacyRoundTrigger_();
    return runRound_();
  }
  assertOwner_();
  return runRound_();
}

function scheduledRound(e) {
  assertScheduledTrigger_(e, 'scheduledRound');
  return runRound_();
}

// Apps Script kills a run at 6 minutes. A round that is still deciding at ROUND_BUDGET_S is abandoned before it
// writes anything, so a kill can never land halfway through saving holdings and cash. Shadow twins and the luck
// test are skipped when the round is past ROUND_EXTRAS_S.
const ROUND_BUDGET_S = 240, ROUND_EXTRAS_S = 290;

function runRound_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const t0 = Date.now(), phases = {}, lap = k => phases[k] = +((Date.now() - t0) / 1000).toFixed(1);
    CALLS_ = {};
    ensureRosterEnrollment_(); lap('setup');
    processPendingAssets_();
    const cfg = readConfig_(), now = new Date(), today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const mkt = fetchMarket_(cfg); lap('market');
    writeResearch_(mkt, now); lap('research');
    const bots = loadBots_(), lots = loadLots_(), trades = [];
    const closeHm = usMarketCloseHm_(now);

    const roster = getCompetitionRoster_(), work = {};
    roster.forEach(def => {
      const b = bots[def.id];
      if (!b) return;
      const before = liquidationValue_(def.id, b, lots, mkt, cfg, now);
      const ctx = buildCtx_(def, b, lots, mkt, cfg, today);
      ctx.hm = Number(Utilities.formatDate(now, TZ, 'HHmm'));   // time of day, for bots that trade intraday
      ctx.closeHm = closeHm;                                    // today's stock close (1300 on early-close days, 0 if shut)
      ctx.pdt = pdtStatus_(def, b, lots, mkt, cfg, now);      // pattern-day-trader limit: { limited, used, max }
      let orders = [], error = '';
      try { orders = (strategyFor_(def)(ctx) || []).filter(Boolean); }
      catch (e) { error = e.message; mkt.warn.push(def.name + ': ' + e.message); }
      orders.sort((x, y) => (x.side === 'SELL' ? 0 : 1) - (y.side === 'SELL' ? 0 : 1));   // free up cash first
      const log = [];
      orders.forEach(o => {
        const t = execute_(def, b, lots, mkt, cfg, o, now);
        if (t) { trades.push(t); b.lastWords = '"' + t[12] + '" — ' + t[2] + ' ' + t[3]; }
        log.push({ side: o.side, sym: o.sym, usd: o.usd, frac: o.frac, why: o.why, ok: !!t,
          block: t ? '' : EXEC_BLOCK_, gross: t ? t[6] : null, fill: t ? t[5] : null, fees: t ? t[7] : null, pnl: t ? t[8] : null });
      });
      work[def.id] = { before, held: Object.keys(ctx.holdings), checks: ctx.log.checks, holds: ctx.log.holds, orders: log, error };
    });
    lap('decide');

    const secs = (Date.now() - t0) / 1000;
    if (secs > ROUND_BUDGET_S) {
      const note = { at: now.toISOString(), secs, phases, calls: CALLS_ };
      PropertiesService.getScriptProperties().setProperty('LAST_ABORT', JSON.stringify(note));
      console.error('Round abandoned before saving: ' + secs.toFixed(0) + 's', JSON.stringify(note));
      return;
    }
    // Holdings and cash are saved back to back, so the two can't disagree.
    saveLots_(lots, mkt);
    saveBots_(bots);
    appendTrades_(trades);
    try { auditRound_(roster, bots, lots, mkt, cfg, trades).reverse().forEach(w => { console.warn('Audit: ' + w); mkt.warn.unshift('Audit: ' + w); }); }
    catch (e) { mkt.warn.unshift('Audit failed: ' + e.message); }
    const scores = updateBoard_(bots, lots, mkt, cfg, now);
    saveBots_(bots);   // again, with the peak and drawdown the board just updated
    const rg = mkt.macro.regime;
    appendHistoryRow_(roster, scores, now, rg);
    lap('save');
    let twins = [], luck = {};
    if ((Date.now() - t0) / 1000 < ROUND_EXTRAS_S) {
      try { twins = runTwins_(roster, bots, lots, mkt, cfg, now, today, scores); } catch (e) { mkt.warn.push('Shadow twins: ' + e.message); }
      lap('twins');
      luck = luckReport_(roster);
      writeSkill_(luck);
      lap('luck');
    } else mkt.warn.push('Round ran long; shadow twins and the luck test wait for the next round');
    try { writeTelemetry_({ now, t0, cfg, mkt, roster, work, scores, luck, trades, twins, phases }); } catch (e) { console.error('telemetry', e); }
    PropertiesService.getScriptProperties().setProperty('LAST_STATE', JSON.stringify({
      updated: now.toISOString(), macro: mkt.macro, stocksOpen: mkt.stocksOpen, warn: mkt.warn.slice(0, 6) }));
  } finally {
    lock.releaseLock();
  }
}

function buildCtx_(def, b, lots, mkt, cfg, today, params) {
  const holdings = {};
  lots.filter(l => l.bot === def.id && l.qty > 0).forEach(l => {
    const a = mkt.bySym[l.sym], px = a ? a.price : l.cost;
    const h = holdings[l.sym] || (holdings[l.sym] = { qty: 0, value: 0, cost: 0 });
    h.qty += l.qty; h.value += l.qty * px; h.cost += l.qty * l.cost;
  });
  Object.keys(holdings).forEach(s => holdings[s].avgCost = holdings[s].cost / holdings[s].qty);
  const equity = b.cash + Object.keys(holdings).reduce((s, k) => s + holdings[k].value, 0);
  const assets = mkt.assets.filter(a => !def.pool || a.type === def.pool), bySym = {};
  assets.forEach(a => bySym[a.sym] = a);
  return { bot: def, cash: b.cash, equity, holdings, assets, bySym, macro: mkt.macro, cfg, state: b.state, today,
           params: params || paramsFor_(def), log: { checks: [], holds: [] } };
}

function costs_(type, cfg) {
  const s = type === 'stock';
  return { slip: s ? cfg.STOCK_SLIPPAGE : cfg.CRYPTO_SLIPPAGE, rate: s ? cfg.STOCK_FEE_RATE : cfg.CRYPTO_FEE_RATE,
           flat: s ? cfg.STOCK_COMMISSION : 0, sellExtra: s ? cfg.SEC_FEE_RATE : 0 };
}

// Returns a Trades row or null (and the reason in EXEC_BLOCK_).
// Row: Time, Bot, Side, Symbol, Qty, Fill, Gross, Fees, Realized P/L, Tax, Cash After, Reason, Says
let EXEC_BLOCK_ = '';
function execute_(def, b, lots, mkt, cfg, o, now) {
  const a = mkt.bySym[o.sym];
  EXEC_BLOCK_ = '';
  if (!a || !a.price) { EXEC_BLOCK_ = 'no price for ' + o.sym; return null; }
  if (def.pool && a.type !== def.pool) { EXEC_BLOCK_ = o.sym + ' belongs to the ' + a.type + ' pool'; return null; }
  if (!a.tradable) { EXEC_BLOCK_ = a.type === 'stock' ? 'stock market closed' : o.sym + ' not tradable right now'; return null; }
  const k = costs_(a.type, cfg);
  const mine = lots.filter(l => l.bot === def.id && l.sym === o.sym).sort((x, y) => new Date(x.opened) - new Date(y.opened));
  const heldQty = mine.reduce((s, l) => s + l.qty, 0);

  if (o.side === 'BUY') {
    // Re-entry cooldown: after a stop-loss (any urgent risk exit) the bot may not buy that asset back for
    // STOP_COOLDOWN_HOURS. Without it, a signal that was still "on" re-bought on the next 15-minute round and
    // stopped out again — Season 8: Talia and Aldric did buy → stop → buy three times, ~$1,000 of losses and fees.
    const stopAt = b.state && b.state.stopOut && b.state.stopOut[o.sym];
    const coolMs = (+cfg.STOP_COOLDOWN_HOURS || 0) * 36e5;
    if (stopAt && coolMs > 0 && now - new Date(stopAt) < coolMs) {
      const left = Math.ceil((coolMs - (now - new Date(stopAt))) / 36e5);
      EXEC_BLOCK_ = 'stopped out of ' + o.sym + ' recently; cooling off ' + left + ' more hour' + (left === 1 ? '' : 's');
      return null;
    }
    const cap = (def.maxPos || cfg.MAX_POSITION_PCT) * markValue_(def.id, b, lots, mkt) - heldQty * a.price;
    const budget = Math.min(o.usd, b.cash, cap);
    const gross = (budget - k.flat) / (1 + k.rate);
    if (!(gross >= cfg.MIN_TRADE_USD)) {
      EXEC_BLOCK_ = b.cash < cfg.MIN_TRADE_USD ? 'not enough cash ($' + b.cash.toFixed(2) + ')'
        : cap < cfg.MIN_TRADE_USD ? 'position cap: already at the ' + Math.round((def.maxPos || cfg.MAX_POSITION_PCT) * 100) + '% limit for one asset'
        : 'below the $' + cfg.MIN_TRADE_USD + ' minimum trade';
      return null;
    }
    const fill = a.price * (1 + k.slip), qty = gross / fill, fee = gross * k.rate + k.flat;
    b.cash -= gross + fee; b.fees += fee; b.trades++;
    lots.push({ bot: def.id, sym: o.sym, type: a.type, qty, cost: (gross + fee) / qty, opened: now });
    return [now, def.name, 'BUY', o.sym, qty, fill, gross, fee, 0, 0, b.cash, o.why, pick_(def.lines.buy)];
  }

  if (heldQty <= 0) { EXEC_BLOCK_ = 'nothing to sell'; return null; }
  const frac = Math.min(1, o.frac || 0);
  const qty = heldQty * frac;
  if (frac < 1 && qty * a.price < cfg.MIN_TRADE_USD) { EXEC_BLOCK_ = 'sale below the $' + cfg.MIN_TRADE_USD + ' minimum'; return null; }
  const fill = a.price * (1 - k.slip), gross = qty * fill;
  const fee = gross * (k.rate + k.sellExtra) + k.flat;
  const netPerUnit = (gross - fee) / qty;
  // Pattern day trader rule: selling stock bought today is a day trade. Under the equity line, a 4th in 5 business days
  // is refused and the position is held overnight instead (risk exits like stop-losses still go through, as a real trader would).
  const dayTrade = a.type === 'stock' && mine.some(l => l.qty > 0 && sameDay_(l.opened, now));
  if (dayTrade && !o.urgent) {
    const pdt = pdtStatus_(def, b, lots, mkt, cfg, now);
    if (pdt.limited && pdt.used >= pdt.max) {
      EXEC_BLOCK_ = 'PDT rule: ' + pdt.used + ' of ' + pdt.max + ' day trades used in 5 business days, holding ' + o.sym + ' overnight instead';
      return null;
    }
  }
  if (!o.urgent && cfg.TAX_WAIT_DAYS > 0) {
    let need = qty, soon = 0, wait = 0;
    for (const l of mine) {
      if (need <= 1e-12) break;
      const take = Math.min(l.qty, need), gain = (netPerUnit - l.cost) * take, d = daysToLongTerm_(l.opened, now);
      if (gain > 0 && d > 0 && d <= cfg.TAX_WAIT_DAYS) { soon += gain; wait = Math.max(wait, d); }
      need -= take;
    }
    const saves = soon * (cfg.ST_TAX_RATE - cfg.LT_TAX_RATE);
    if (saves >= 1) {
      EXEC_BLOCK_ = 'holding ' + wait + ' more day' + (wait === 1 ? '' : 's') + ' for the long-term tax rate (saves about $' + Math.round(saves) + ')';
      return null;
    }
  }
  let left = qty, st = 0, lt = 0;
  for (const l of mine) {                                   // FIFO: oldest lots first
    if (left <= 1e-12) break;
    const take = Math.min(l.qty, left), gain = (netPerUnit - l.cost) * take;
    if (isLongTerm_(l.opened, now)) lt += gain; else st += gain;
    l.qty -= take; left -= take;
  }
  for (let i = lots.length - 1; i >= 0; i--) if (lots[i].qty <= 1e-10) lots.splice(i, 1);
  const pnl = st + lt, tax = computeTax_(b, st, lt, cfg);
  b.cash += gross - fee - tax; b.fees += fee; b.taxes += tax; b.trades++;
  if (pnl > 0) b.wins++; else b.losses++;
  if (o.urgent) {
    b.state = b.state || {};
    const keep = {}, coolMs = (+cfg.STOP_COOLDOWN_HOURS || 0) * 36e5;
    Object.keys(b.state.stopOut || {}).forEach(k => { if (now - new Date(b.state.stopOut[k]) < coolMs) keep[k] = b.state.stopOut[k]; });
    keep[o.sym] = new Date(now).toISOString();
    b.state.stopOut = keep;
  }
  if (dayTrade) { b.state = b.state || {}; b.state.pdt = (b.state.pdt || []).concat([Utilities.formatDate(now, TZ, 'yyyy-MM-dd')]).slice(-12); }
  return [now, def.name, 'SELL', o.sym, qty, fill, gross, fee, pnl, tax, b.cash, o.why, pick_(def.lines.sell)];
}

// Day trades counted over the last 5 business days (weekdays, today included), and whether this account is under the limit.
function pdtStatus_(def, b, lots, mkt, cfg, now) {
  const days = [];
  for (let t = new Date(now); days.length < 5; t = new Date(t.getTime() - 864e5)) {
    const wd = Number(Utilities.formatDate(t, TZ, 'u'));
    if (wd <= 5) days.push(Utilities.formatDate(t, TZ, 'yyyy-MM-dd'));
  }
  const used = ((b.state && b.state.pdt) || []).filter(d => days.indexOf(d) >= 0).length;
  const limited = !!cfg.PDT_RULE && markValue_(def.id, b, lots, mkt) < cfg.PDT_MIN_EQUITY;
  return { limited, used, max: cfg.PDT_MAX };
}
function sameDay_(a, b) { return Utilities.formatDate(new Date(a), TZ, 'yyyy-MM-dd') === Utilities.formatDate(new Date(b), TZ, 'yyyy-MM-dd'); }

// US rule: long-term only when held MORE than one year (sell on the anniversary = still short-term; the day after = long-term).
function isLongTerm_(opened, now) { return daysToLongTerm_(opened, now) <= 0; }
function daysToLongTerm_(opened, now) {
  const key = d => Utilities.formatDate(new Date(d), TZ, 'yyyy-MM-dd');
  const o = key(opened), y = Number(o.slice(0, 4)) + 1, m = Number(o.slice(5, 7)) - 1, d = Number(o.slice(8, 10));
  const day = Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());           // same date next year (Feb 29 → Feb 28)
  const first = Date.UTC(y, m, day, 12) + 864e5;                                    // the day after the anniversary is long-term
  return Math.ceil((first - new Date(key(now) + 'T12:00:00Z').getTime()) / 864e5);
}

// Simplified US-style tax: net short vs long term, bank losses as a carryforward, tax gains when realized.
function computeTax_(b, st, lt, cfg) {
  let carry = b.carry || 0;
  if (st < 0 && lt > 0) { const x = Math.min(-st, lt); lt -= x; st += x; }
  if (lt < 0 && st > 0) { const x = Math.min(-lt, st); st -= x; lt += x; }
  if (st < 0) { carry -= st; st = 0; }
  if (lt < 0) { carry -= lt; lt = 0; }
  const useS = Math.min(carry, st); st -= useS; carry -= useS;
  const useL = Math.min(carry, lt); lt -= useL; carry -= useL;
  b.carry = carry;
  return st * cfg.ST_TAX_RATE + lt * cfg.LT_TAX_RATE;
}

function markValue_(id, b, lots, mkt) {
  return b.cash + lots.filter(l => l.bot === id).reduce((s, l) => {
    const a = mkt.bySym[l.sym]; return s + l.qty * (a ? a.price : l.cost);
  }, 0);
}

// What the bot would walk away with if it sold everything now, after slippage, fees and tax.
function liquidationValue_(id, b, lots, mkt, cfg, now) {
  return liquidationBreakdown_(id, b, lots, mkt, cfg, now).value;
}

// Same math as liquidationValue_, split into the estimated exit costs shown on the leaderboard.
function liquidationBreakdown_(id, b, lots, mkt, cfg, now) {
  let net = b.cash, st = 0, lt = 0, slip = 0, fees = 0;
  lots.filter(l => l.bot === id).forEach(l => {
    const a = mkt.bySym[l.sym], k = costs_(l.type, cfg);
    const mark = l.qty * (a ? a.price : l.cost);
    const gross = mark * (1 - k.slip);
    const fee = gross * (k.rate + k.sellExtra) + k.flat;
    const gain = gross - fee - l.qty * l.cost;
    slip += mark - gross;
    fees += fee;
    net += gross - fee;
    if (isLongTerm_(l.opened, now)) lt += gain; else st += gain;
  });
  const tax = computeTax_({ carry: b.carry }, st, lt, cfg);
  return { value: net - tax, slip: slip, fees: fees, tax: tax };
}

/* ---------- sheets I/O ---------- */

const BOT_HEADERS = ['ID', 'Bot', 'Strategy', 'Personality', 'Start Cash', 'Cash', 'Fees Paid', 'Taxes Paid',
  'Loss Carryforward', 'Trades', 'Wins', 'Losses', 'Peak Value', 'Max Drawdown', 'Last Words', 'State'];

function loadBots_() {
  const out = {};
  getSheet_(SHEETS.BOTS).getDataRange().getValues().slice(1).forEach(r => {
    if (!r[0]) return;
    let state = {};
    try { state = JSON.parse(r[15] || '{}'); } catch (e) { }
    out[r[0]] = { start: +r[4], cash: +r[5], fees: +r[6], taxes: +r[7], carry: +r[8], trades: +r[9], wins: +r[10],
                  losses: +r[11], peak: +r[12], maxDD: +r[13], lastWords: r[14], state };
  });
  return out;
}

function saveBots_(bots) {
  const rows = getCompetitionRoster_().filter(d => bots[d.id]).map(d => {
    const b = bots[d.id];
    return [d.id, d.emoji + ' ' + d.name, d.strategy, d.bio, b.start, b.cash, b.fees, b.taxes, b.carry, b.trades,
            b.wins, b.losses, b.peak, b.maxDD, b.lastWords, JSON.stringify(b.state)];
  });
  if (rows.length) getSheet_(SHEETS.BOTS).getRange(2, 1, rows.length, BOT_HEADERS.length).setValues(rows);
}

const HOLD_HEADERS = ['Bot', 'Symbol', 'Type', 'Qty', 'Cost/Unit (incl. fees)', 'Opened', 'Price', 'Market Value', 'Unrealized P/L'];

function loadLots_() {
  return getSheet_(SHEETS.HOLD).getDataRange().getValues().slice(1).filter(r => r[0] && +r[3] > 0)
    .map(r => ({ bot: r[0], sym: r[1], type: r[2], qty: +r[3], cost: +r[4], opened: r[5] }));
}

// Overwrite in place, then clear only the leftover rows: the sheet is never empty mid-save.
function saveLots_(lots, mkt) {
  const sh = getSheet_(SHEETS.HOLD), had = Math.max(0, sh.getLastRow() - 1);
  if (lots.length) sh.getRange(2, 1, lots.length, HOLD_HEADERS.length).setValues(lots.map(l => {
    const px = mkt.bySym[l.sym] ? mkt.bySym[l.sym].price : l.cost;
    return [l.bot, l.sym, l.type, l.qty, l.cost, l.opened, px, l.qty * px, l.qty * (px - l.cost)];
  }));
  if (had > lots.length) sh.getRange(2 + lots.length, 1, had - lots.length, HOLD_HEADERS.length).clearContent();
}

function appendTrades_(rows) {
  if (!rows.length) return;
  const sh = getSheet_(SHEETS.TRADES);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

const BOARD_COLS = 20;   // A–Q original columns, R–T estimated exit costs

function updateBoard_(bots, lots, mkt, cfg, now) {
  const scores = {}, rows = [], ghosts = [];
  getCompetitionRoster_().forEach(d => {
    const b = bots[d.id];
    if (!b) return;
    const exit = liquidationBreakdown_(d.id, b, lots, mkt, cfg, now), liq = exit.value, mark = markValue_(d.id, b, lots, mkt);
    b.peak = Math.max(b.peak || b.start, liq);
    b.maxDD = Math.max(b.maxDD || 0, 1 - liq / b.peak);
    scores[d.id] = liq;
    const row = [d.emoji + ' ' + d.name, d.strategy, liq, liq / b.start - 1, mark, b.cash, mark - b.cash,
      b.fees, b.taxes, b.trades, b.wins + b.losses ? b.wins / (b.wins + b.losses) : '', b.maxDD, b.lastWords || '', d.pool,
      exit.slip, exit.fees, exit.tax];   // r[14..16]: estimated exit costs
    (d.ghost ? ghosts : rows).push(row);
  });
  const benchmark = pool => ghosts.find(r => r[13] === pool);
  const vs = r => { const market = benchmark(r[13]); return market ? r[3] - market[3] : ''; };
  const medals = ['🥇', '🥈', '🥉'];
  const ranked = [];
  // A bot that never trades can never win: zero-trade bots sit below every bot that took the field, marked Unranked.
  const played = r => r[9] > 0 ? 1 : 0;
  ['stock', 'crypto'].forEach(pool => rows.filter(r => r[13] === pool).sort((x, y) => played(y) - played(x) || y[2] - x[2])
    .forEach((r, i) => ranked.push([played(r) ? (pool === 'stock' ? 'S' : 'C') + (medals[i] || i + 1) : 'Unranked']
      .concat(r.slice(0, 13), [vs(r), played(r) ? '' : 'no trades yet', r[13]], r.slice(14, 17)))));
  const out = ranked
    .concat(ghosts.map(r => ['👻'].concat(r.slice(0, 13), [vs(r), 'benchmark', r[13]], r.slice(14, 17))));

  const sh = getSheet_(SHEETS.BOARD), m = mkt.macro;
  const fng = f => f ? f.value + ' ' + f.label : 'n/a';
  const wx = r => r ? r.emoji + ' ' + r.name : 'n/a';
  sh.getRange('A2').setValue('Updated ' + Utilities.formatDate(now, TZ, 'MMM d, h:mm a') + ' ET  •  Stocks: ' + wx(m.regime.stock) +
    ', F&G ' + fng(m.fngStock) + '  •  Crypto: ' + wx(m.regime.crypto) + ', F&G ' + fng(m.fngCrypto) +
    '  •  Stock market ' + (mkt.stocksOpen ? 'OPEN' : 'closed') + (mkt.warn.length ? '  •  ⚠️ ' + mkt.warn.slice(0, 4).join('; ') : ''));
  // Keep headers current on every refresh (older boards were built with "Invested" and 17 columns).
  sh.getRange(4, 8).setValue('Holdings Value');
  sh.getRange(4, 9, 1, 2).setValues([['Fees Paid So Far', 'Taxes Paid So Far']]);
  sh.getRange(4, 18, 1, 3).setValues([['Est. Slippage If Sold Now', 'Est. Sell Fees If Sold Now', 'Est. Tax If Sold Now']])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.getRange(5, 18, BOARD_ROWS, 3).setNumberFormat('$#,##0.00');
  sh.getRange(5, 1, BOARD_ROWS, BOARD_COLS).clearContent();
  if (out.length) sh.getRange(5, 1, out.length, BOARD_COLS).setValues(out);
  return scores;
}

// Checks a round's results in memory before the leaderboard is written. Returns plain-English problems
// (empty when everything adds up). Trade rows: [1] bot name, [2] side, [3] symbol, [10] cash after.
function auditRound_(roster, bots, lots, mkt, cfg, trades) {
  const out = [], byName = {}, eps = 0.01;
  roster.forEach(d => byName[d.name] = d);
  const holdingValue = (id, sym) => lots.filter(l => l.bot === id && l.sym === sym)
    .reduce((s, l) => { const a = mkt.bySym[l.sym]; return s + l.qty * (a ? a.price : l.cost); }, 0);
  // 1. Every bot's cash and lots are real numbers, and cash never goes negative.
  roster.forEach(d => {
    const b = bots[d.id];
    if (!b) return;
    if (!isFinite(b.cash)) out.push(d.name + ': cash is not a number');
    else if (b.cash < -eps) out.push(d.name + ': cash is negative ($' + b.cash.toFixed(2) + ')');
    lots.filter(l => l.bot === d.id).forEach(l => {
      if (!(l.qty > 0) || !isFinite(l.cost)) out.push(d.name + ': bad holding record for ' + l.sym + ' (qty ' + l.qty + ', cost ' + l.cost + ')');
    });
    // 2. The cash-out value can't exceed market value (exit costs and tax only ever subtract).
    const mark = markValue_(d.id, b, lots, mkt), liq = liquidationValue_(d.id, b, lots, mkt, cfg, new Date());
    if (liq > mark + eps) out.push(d.name + ': cash-out value $' + liq.toFixed(2) + ' is above market value $' + mark.toFixed(2));
  });
  // 3. The last "Cash After" this round matches the bot's saved cash.
  const lastCash = {};
  trades.forEach(t => { if (byName[t[1]]) lastCash[byName[t[1]].id] = t[10]; });
  Object.keys(lastCash).forEach(id => {
    const b = bots[id];
    if (b && Math.abs(b.cash - lastCash[id]) > eps)
      out.push(roster.find(d => d.id === id).name + ': ledger cash $' + Number(lastCash[id]).toFixed(2) + ' ≠ saved cash $' + b.cash.toFixed(2));
  });
  // 4. No buy this round pushed a position over the cap (ghosts and other maxPos entries use their own limit).
  trades.filter(t => t[2] === 'BUY').forEach(t => {
    const d = byName[t[1]], b = d && bots[d.id];
    if (!b) return;
    const cap = d.maxPos || cfg.MAX_POSITION_PCT, share = holdingValue(d.id, t[3]) / markValue_(d.id, b, lots, mkt);
    if (share > cap + 0.005) out.push(d.name + ': buy of ' + t[3] + ' left it at ' + (share * 100).toFixed(1) + '% of the account (cap ' + Math.round(cap * 100) + '%)');
  });
  return out;
}

// Writes one EquityHistory row matched to the header BY NAME, so a roster change mid-season (a bot leaving a pool,
// a Challenger joining) can't shift every later column onto the wrong bot. New entrants get a column at the end.
function appendHistoryRow_(roster, scores, now, rg) {
  const sh = getSheet_(SHEETS.HISTORY);
  let head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (!head.length || !head[0]) { head = historyHeader_(); sh.getRange(1, 1, 1, head.length).setValues([head]); }
  const missing = roster.map(d => d.name).filter(n => head.indexOf(n) < 0);
  if (missing.length) { sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]); head = head.concat(missing); }
  const byName = {};
  roster.forEach(d => byName[d.name] = scores[d.id] == null ? null : scores[d.id]);
  const row = head.map(h => h === 'Time' ? now : h === 'Stock Regime' ? rg.stock.name : h === 'Crypto Regime' ? rg.crypto.name
    : (byName.hasOwnProperty(h) ? byName[h] : null));
  sh.appendRow(row);
}

function writeSkill_(luck) {
  const sh = getSheet_(SHEETS.BOARD), names = sh.getRange(5, 2, BOARD_ROWS, 1).getValues();
  const vals = sh.getRange(5, 16, BOARD_ROWS, 1).getValues();
  names.forEach((r, i) => {
    const key = Object.keys(luck).find(n => String(r[0]).endsWith(' ' + n));
    if (key) vals[i][0] = luck[key].label;
  });
  sh.getRange(5, 16, BOARD_ROWS, 1).setValues(vals);
}

function writeResearch_(mkt, now) {
  const sh = getSheet_(SHEETS.RESEARCH);
  sh.clearContents();
  const f = x => x == null ? '' : x;
  const rows = mkt.assets.map(a => [a.sym, a.type, a.price, f(a.ret1), f(a.ret5), f(a.ret20), a.rsi14 == null ? '' : Math.round(a.rsi14),
    a.sma20 ? a.price / a.sma20 - 1 : '', a.sma50 ? a.price / a.sma50 - 1 : '', f(a.high20), a.volRatio == null ? '' : +a.volRatio.toFixed(2),
    a.news ? +a.news.score.toFixed(2) : '', a.news ? a.news.count : '', a.news ? a.news.top : '', a.news ? a.news.src : '',
    a.cmc ? a.cmc.ch24 : '', a.cmc ? a.cmc.ch7 : '', a.tradable ? 'yes' : 'no']);
  const rg = mkt.macro.regime;
  sh.getRange(1, 1).setValue('Research desk — ' + Utilities.formatDate(now, TZ, 'MMM d, h:mm a') + ' ET   ·   Stocks: ' +
    rg.stock.emoji + ' ' + rg.stock.name + ' (' + rg.stock.why + ')   ·   Crypto: ' + rg.crypto.emoji + ' ' + rg.crypto.name + ' (' + rg.crypto.why + ')');
  const head = ['Symbol', 'Type', 'Price', '1d', '5d', '20d', 'RSI14', 'vs SMA20', 'vs SMA50', '20d High', 'Volume x',
    'News score', '# Headlines', 'Loudest headline', 'Scored by', 'CMC 24h', 'CMC 7d', 'Tradable'];
  sh.getRange(2, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  if (!rows.length) return;
  sh.getRange(3, 1, rows.length, head.length).setValues(rows);
  sh.getRange(3, 3, rows.length, 1).setNumberFormats(mkt.assets.map(a => [
    a.price >= 1000 ? '$#,##0' : a.price >= 1 ? '$#,##0.00' : a.price >= 0.01 ? '$0.0000' : '$0.00000000'
  ]));
  [4, 5, 6, 8, 9, 16, 17].forEach(col => sh.getRange(3, col, rows.length, 1).setNumberFormat('+0.0%;-0.0%'));
}

/* ---------- config ---------- */

function readConfig_() {
  const cfg = {};
  getSheet_(SHEETS.CONFIG).getDataRange().getValues().slice(1).forEach(r => {
    if (!r[0]) return;
    const v = r[1];
    cfg[r[0]] = typeof v === 'boolean' || v === '' || isNaN(Number(v)) ? v : Number(v);
  });
  DEFAULT_CONFIG.forEach(([k, v]) => { if (cfg[k] === undefined || cfg[k] === '') cfg[k] = v; });
  return cfg;
}

function readUniverse_() {
  return getSheet_(SHEETS.UNIVERSE).getDataRange().getValues().slice(1).filter(r => r[0] && (!r[6] || r[6] === 'Ready'))
    .map(r => ({ sym: String(r[0]).trim(), type: String(r[1]).trim().toLowerCase(), gf: r[2], yahoo: r[3], cg: r[4], news: r[5] }));
}

function getSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
