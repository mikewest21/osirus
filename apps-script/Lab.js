/**
 * GAME OF TRADES — the backtest lab: bots learn from the past year instead of waiting weeks of live rounds.
 *
 * Every bot replays the last LAB_DAYS days of real daily prices (same indicators, fees, slippage, taxes and Fear &
 * Greed history as the warm-up), once with its current settings and once for each small change to one lever
 * (one or two steps either way). Changes are picked on the older two-thirds of the replay ("training"), then must
 * also win on the most recent third, which they never saw ("the exam"), by at least LAB_MIN_GAIN, with return per
 * unit of risk (daily mean / standard deviation) better in training and no worse in the exam, and the daily
 * edge must pass the same sign-flip luck test the shadow twins use. At most one change per bot is adopted per lab
 * run, so every lesson is small and traceable; it lands in the Coach's Notebook as "Backtest lab".
 *
 * The lab runs inside the insights job, a few bots at a time, and starts again every LAB_EVERY_DAYS days so lessons
 * build on each other. Live shadow twins keep checking ideas on fresh, real-time data.
 * Limits: daily closes only, so Headline Hank (no news history) and Nickel Nick (15-minute moves) sit out, and
 * Professor Quant's cooldowns (counted in 15-minute rounds) are left to the live twins.
 */

const LAB_DAYS = 240;            // calendar days replayed; a year of history leaves ~120 days to warm the indicators
const LAB_TEST_SHARE = 1 / 3;    // the most recent third is the exam
const LAB_MIN_GAIN = 0.005;      // a change must add at least 0.5% over the exam stretch
const LAB_P = 0.2;               // and pass the sign-flip luck test at this level
const LAB_EVERY_DAYS = 7;
const LAB_SKIP = { HANK: 'there is no news history to replay', SCALP: 'he trades 15-minute moves that daily history cannot show' };
const LAB_SKIP_LEVERS = { QUANT: ['cooldown', 'rebalanceCooldown', 'rebalanceBand'] };

function runLabNow() {
  assertOwner_();
  PropertiesService.getScriptProperties().deleteProperty('LAB_STATE');
  const r = labStep_(Date.now() + 300e3, true);
  SpreadsheetApp.getUi().alert('Backtest lab', r, SpreadsheetApp.getUi().ButtonSet.OK);
}

function labState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('LAB_STATE') || 'null'); } catch (e) { return null; }
}

// One slice of lab work, until `deadline` (ms). Starts a new lab run when the last one is a week old.
function labStep_(deadline, force) {
  const props = PropertiesService.getScriptProperties();
  let st = labState_();
  const fresh = !st || (st.done && Date.now() - new Date(st.started).getTime() > LAB_EVERY_DAYS * 864e5);
  if (fresh || force && (!st || st.done)) {
    const ids = getCompetitionRoster_().filter(d => !d.ghost && !LAB_SKIP[d.baseId || d.id]).map(d => d.id);
    st = { started: new Date().toISOString(), ids, i: 0, results: [], done: false, adopted: 0 };
  }
  if (st.done) return 'idle (next run ' + Utilities.formatDate(new Date(new Date(st.started).getTime() + LAB_EVERY_DAYS * 864e5), TZ, 'MMM d') + ')';
  if (Date.now() > deadline - 60e3) return 'waiting for a longer slot';
  const cfg = readConfig_(), tl = labTimeline_(cfg);
  if (tl.days.length < 60) { props.setProperty('LAB_STATE', JSON.stringify(st)); return 'not enough history yet (' + tl.days.length + ' days)'; }
  const roster = getCompetitionRoster_(), twins = loadTwins_();
  let n = 0;
  while (st.i < st.ids.length && Date.now() < deadline - 25e3) {
    const def = roster.find(d => d.id === st.ids[st.i]);
    if (def) {
      let r;
      try { r = labEntrant_(def, tl, cfg, twins[def.id] ? twins[def.id].lever : null); } catch (e) { r = { bot: def.name, note: 'failed: ' + e.message }; }
      if (r.adopt) { labAdopt_(def, r); st.adopted++; }
      st.results.push(labSummary_(r));
      n++;
    }
    st.i++;
    props.setProperty('LAB_STATE', JSON.stringify(st));
  }
  if (st.i >= st.ids.length) { st.done = true; st.finished = new Date().toISOString(); }
  props.setProperty('LAB_STATE', JSON.stringify(st));
  return 'tested ' + n + ' bot(s), ' + st.i + ' of ' + st.ids.length + ' done, ' + st.adopted + ' lesson(s) adopted';
}

function labSummary_(r) {
  // Short codes keep the whole run inside one 9 KB script property: won | exam (failed it) | none | error text
  const s = { bot: r.bot, note: r.adopt ? 'won' : r.best ? 'exam' : /^failed/.test(r.note || '') ? String(r.note).slice(0, 80) : 'none' };
  if (r.best) Object.assign(s, { lever: r.best.lever, from: r.best.from, to: r.best.to, train: +r.best.trainGain.toFixed(4), exam: +r.best.testGain.toFixed(4), p: +r.best.p.toFixed(3) });
  if (r.adopt) s.adopted = true;
  return s;
}

// The replayed market: one entry per past day with the assets as they looked at that day's close.
function labTimeline_(cfg) {
  const uni = readUniverse_(), dayKey = t => Utilities.formatDate(new Date(t), TZ, 'yyyy-MM-dd'), hist = {};
  uni.forEach(u => {
    const yahoo = u.type === 'stock' ? (u.yahoo || u.sym) : (u.yahoo || u.sym + '-USD');
    const h = cached_('lab_' + u.sym, 6 * 3600, () => yahooHistory_(yahoo, true, '1y'), 1800);
    if (!h || !h.bars.length) return;
    const key = t => u.type === 'stock' ? dayKey(t) : Utilities.formatDate(new Date(t), 'UTC', 'yyyy-MM-dd');
    hist[u.sym] = h.bars.filter(b => b[4]).map(b => ({ key: key(b[4]), bar: b }));
  });
  const fngC = cached_('lab_fngc', 6 * 3600, () => { const x = fngHistoryCrypto_(LAB_DAYS + 10); return Object.keys(x).length ? x : null; }, 1800) || {};
  const fngS = cached_('lab_fngs', 6 * 3600, () => { const x = fngHistoryStock_('1y'); return Object.keys(x).length ? x : null; }, 1800) || {};
  const days = [];
  for (let i = LAB_DAYS; i >= 1; i--) {
    const key = dayKey(Date.now() - i * 864e5), now = Utilities.parseDate(key + ' 16:00', TZ, 'yyyy-MM-dd HH:mm'), assets = [];
    uni.forEach(u => {
      const h = hist[u.sym];
      if (!h) return;
      let j = 0;
      while (j < h.length && h[j].key < key) j++;
      if (j < 30) return;                                    // not enough history before this day for indicators
      const today = h[j] && h[j].key === key ? h[j] : null;
      const before = h.slice(0, j).map(x => x.bar), live = today ? today.bar[0] : before[before.length - 1][0];
      assets.push(buildAsset_(u, { bars: before }, live, !!today, now));
    });
    if (!assets.length) continue;
    const bySym = {}; assets.forEach(a => bySym[a.sym] = a);
    const macro = { fngCrypto: fngC[key] || null, fngStock: fngS[key] || null };
    const lead = t => bySym[t === 'stock' ? 'SPY' : 'BTC'] || assets.find(a => a.type === t);
    macro.regime = { stock: regime_(lead('stock'), macro.fngStock), crypto: regime_(lead('crypto'), macro.fngCrypto) };
    days.push({ key, now, mkt: { assets, bySym, macro, stocksOpen: assets.some(a => a.type === 'stock' && a.tradable), warn: [] } });
  }
  return { days };
}

// Replay one bot with the given settings; returns its value (after fees and taxes) at each day's close.
function labRun_(def, tl, cfg, params) {
  const start = cfg.STARTING_CASH, b = { start, cash: start, fees: 0, taxes: 0, carry: 0, trades: 0, wins: 0, losses: 0, peak: start, maxDD: 0, state: {} };
  const lots = [], vals = [], strat = strategyFor_(def);
  tl.days.forEach(d => {
    let orders = [];
    try { orders = (strat(buildCtx_(def, b, lots, d.mkt, cfg, d.key, params)) || []).filter(Boolean); } catch (e) { orders = []; }
    orders.sort((x, y) => (x.side === 'SELL' ? 0 : 1) - (y.side === 'SELL' ? 0 : 1));
    orders.forEach(o => execute_(def, b, lots, d.mkt, cfg, o, d.now));
    vals.push(liquidationValue_(def.id, b, lots, d.mkt, cfg, d.now));
  });
  return { vals, trades: b.trades };
}

// Try one- and two-step changes to every lever; return the best change picked on training days and checked on the exam.
function labEntrant_(def, tl, cfg, testingLever) {
  const L = leversFor_(def), base = paramsFor_(def), skip = LAB_SKIP_LEVERS[def.baseId || def.id] || [];
  const split = Math.max(20, Math.floor(tl.days.length * (1 - LAB_TEST_SHARE)));
  const rets = v => v.slice(1).map((x, i) => v[i] > 0 ? x / v[i] - 1 : 0);
  const grow = a => a.reduce((m, r) => m * (1 + r), 1) - 1;
  // Return per unit of risk: without it, "buy bigger" wins every rising market just by taking more risk.
  const sharpe = a => { const sd = a.length > 1 ? stdev_(a) : 0; return sd > 0 ? mean_(a) / sd : 0; };
  const b0 = labRun_(def, tl, cfg, base), br = rets(b0.vals);
  const out = { bot: def.name, id: def.id, baseRet: grow(br), baseTrades: b0.trades, best: null };
  const picks = [];
  Object.keys(L).filter(k => skip.indexOf(k) < 0 && k !== testingLever && typeof base[k] === 'number').forEach(k => {
    let bestK = null;
    [-2, -1, 1, 2].forEach(s => {
      const idea = validIdea_(def, k, base[k] + s * L[k][3], '');
      if (!idea || (bestK && bestK.to === idea.to)) return;
      const run = labRun_(def, tl, cfg, Object.assign({}, base, { [k]: idea.to })), vr = rets(run.vals);
      const ex = vr.map((r, i) => r - br[i]);
      if (ex.every(e => Math.abs(e) < 1e-12)) return;          // the change never came into play
      const trainGain = grow(vr.slice(0, split - 1)) - grow(br.slice(0, split - 1));
      const testGain = grow(vr.slice(split - 1)) - grow(br.slice(split - 1));
      const trainRisk = sharpe(vr.slice(0, split - 1)) - sharpe(br.slice(0, split - 1)), testRisk = sharpe(vr.slice(split - 1)) - sharpe(br.slice(split - 1));
      if (trainGain > 0 && trainRisk > 0 && (!bestK || trainGain > bestK.trainGain))
        bestK = { lever: k, from: base[k], to: idea.to, trainGain, testGain, testRisk, ex, ret: grow(vr), trades: run.trades };
    });
    if (bestK) picks.push(bestK);
  });
  if (!picks.length) { out.note = 'no change beat the current settings on the training days'; return out; }
  // Judge only the training winners on the exam, then pick by training strength (the exam is a pass/fail check)
  picks.forEach(p => p.p = signFlipP_(p.ex));
  const passed = picks.filter(p => p.testGain >= LAB_MIN_GAIN && p.testRisk >= 0 && p.p < LAB_P).sort((a, b) => b.trainGain - a.trainGain);
  out.best = passed[0] || picks.sort((a, b) => b.testGain - a.testGain)[0];
  out.adopt = !!passed.length;
  out.note = out.adopt ? 'won the training days and the exam' : 'best idea failed the exam (needs +' + pct_(LAB_MIN_GAIN, true) + ', no worse return per unit of risk, and p<' + LAB_P + ')';
  out.days = tl.days.length; out.examDays = tl.days.length - split;
  return out;
}

function labAdopt_(def, r) {
  const b = r.best, props = PropertiesService.getScriptProperties(), params = adopted_();
  params[def.id] = Object.assign(params[def.id] || {}, { [b.lever]: b.to });
  props.setProperty('PARAMS', JSON.stringify(params));
  const L = leversFor_(def)[b.lever] || [], nb = notebook_(), now = new Date();
  const res = 'Adopted from a ' + r.days + '-day replay: training ' + pct_(b.trainGain) + ', exam (last ' + r.examDays + ' days, unseen) ' + pct_(b.testGain) +
    ' vs current settings, p=' + b.p.toFixed(2) + '. Replay return ' + pct_(b.ret) + ' vs ' + pct_(r.baseRet) + '.';
  nb.sh.appendRow(['L' + now.getTime().toString(36) + def.id, now, def.name, b.lever, b.from, b.to,
    'Backtest: ' + (L[4] || b.lever) + ' ' + b.from + ' → ' + b.to + ' did better over the past ' + r.days + ' days, for the risk taken.', 'Backtest lab', 'adopted', now, now, r.baseRet, b.ret, b.p, res]);
  let pending = []; try { pending = JSON.parse(props.getProperty('TELE_PENDING') || '[]'); } catch (e) { pending = []; }
  pending.push({ kind: 'lesson', bot: def.name, text: def.name + ' learned from the past ' + r.days + ' days: ' + b.lever + ' ' + b.from + ' → ' + b.to + ' (exam ' + pct_(b.testGain) + ')' });
  props.setProperty('TELE_PENDING', JSON.stringify(pending.slice(-40)));
}

// For the Academy's Study hall.
function labForWeb_() {
  const st = labState_();
  if (!st) return null;
  return { started: st.started, finished: st.finished || null, done: !!st.done, i: st.i, total: st.ids.length, adopted: st.adopted, results: st.results };
}

/* ---------- training camp: new Challengers are trained in the lab before they enter ---------- */

const CAMP_BROOD = 4;           // sibling candidates bred per pool; the best one in the replay is born
const CAMP_BUDGET_MS = 150e3;   // the Reckoning has to fit in Apps Script's 6 minutes, so tuning stops after this

function trainingCamp_() {
  const t0 = Date.now(), cfg = readConfig_();
  try {
    const tl = labTimeline_(cfg);
    return tl.days.length >= 60 ? { tl, cfg, t0 } : { error: 'only ' + tl.days.length + ' days of history came back' };
  } catch (e) { return { error: e.message }; }
}

// Breed CAMP_BROOD siblings, replay each over the past year, keep the best one that actually trades (best return per
// unit of risk), then let the lab tune one of its settings. Returns the bred result for birthChallenger_.
function trainChallenger_(review, pool, camp) {
  const brood = [];
  for (let i = 0; i < CAMP_BROOD; i++) { const b = breed_(review); b.dna.params.universe = pool; brood.push(b); }
  if (!camp || camp.error) {
    brood[0].lessons.push('🏕️ Training camp was skipped (' + ((camp && camp.error) || 'no replay') + '), so it enters untrained.');
    return brood[0];
  }
  const st = review.stats, mkDef = (b, i) => ({ id: 'CAMP_' + pool + i, name: 'Camp ' + pool + ' ' + i, emoji: '🥚', pool, challenger: true, dna: b.dna,
    lines: { buy: [pick_(st[0].def.lines.buy)], sell: [pick_(st[0].def.lines.sell)] } });
  const sharpe = v => { const r = v.slice(1).map((x, i) => v[i] > 0 ? x / v[i] - 1 : 0), sd = r.length > 1 ? stdev_(r) : 0; return sd > 0 ? mean_(r) / sd : 0; };
  const scored = brood.map((b, i) => {
    const def = mkDef(b, i), run = labRun_(def, camp.tl, camp.cfg, paramsFor_(def)), v = run.vals;
    return { b, def, trades: run.trades, ret: v[v.length - 1] / v[0] - 1, sharpe: sharpe(v) };
  });
  // A bot that never trades can never win: siblings that sat out the replay are only picked if all of them did
  const field = scored.filter(x => x.trades >= MIN_PARENT_TRADES);
  const best = (field.length ? field : scored).sort((x, y) => y.sharpe - x.sharpe)[0], P = x => pct_(x);
  const lessons = best.b.lessons;
  lessons.push('🏕️ Training camp: picked from ' + CAMP_BROOD + ' siblings after a ' + camp.tl.days.length + '-day replay of real prices (' +
    P(best.ret) + ', ' + best.trades + ' trades; siblings ' + scored.filter(x => x !== best).map(x => P(x.ret)).join(', ') + ').' +
    (field.length ? '' : ' None of them traded much, so it may need the coach.'));
  if (Date.now() - camp.t0 < CAMP_BUDGET_MS) {
    const r = labEntrant_(best.def, camp.tl, camp.cfg, null);
    if (r.adopt) {
      best.b.dna.params[r.best.lever] = r.best.to;
      lessons.push('🏕️ Tuned in the lab: ' + r.best.lever + ' ' + +(+r.best.from).toFixed(3) + ' → ' + r.best.to + ' (won the training days and the unseen last ' + r.examDays + ' days by ' + P(r.best.testGain) + ').');
    } else lessons.push('🏕️ The lab found no setting change that passed its exam, so it keeps its bred settings.');
  } else lessons.push('🏕️ Lab tuning skipped to keep the Reckoning on time; the weekly lab will tune it.');
  return best.b;
}
