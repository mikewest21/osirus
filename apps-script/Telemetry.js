/**
 * GAME OF TRADES — telemetry: proof of work for every round.
 *
 * One row per round in the Telemetry sheet: how long it took, calls to each data source, what every bot checked
 * (and whether each asset passed its rules), holdings it kept and why, every order and whether it filled or was
 * blocked (with the reason), and what changed since the last round (market conditions, ranks, luck verdicts,
 * stop-losses, rebalances, regime sizing, Config edits). A SHA-256 fingerprint of the round's prices and decisions
 * acts as its receipt. The Academy's Engine room tab reads it.
 */

const TELE_HEADERS = ['Time', 'Seconds', 'Filled', 'Blocked', 'Calls', 'Warnings', 'Fingerprint', 'Details (JSON)'];
const TELE_KEEP = 500;   // rows kept (about five days of 15-minute rounds)
const TELE_FULL = 48;    // only the newest 12 hours keep every check and order; older rows keep a slim summary.
                         // (Full detail for all 500 rows grew the sheet to 11 MB and slowed every round and page load.)

function writeTelemetry_(x) {
  const props = PropertiesService.getScriptProperties();
  let prev = {};
  try { prev = JSON.parse(props.getProperty('TELE_PREV') || '{}'); } catch (e) { prev = {}; }

  const bots = x.roster.map(d => {
    const w = x.work[d.id] || {};
    return { id: d.id, name: d.name, ghost: !!d.ghost, before: w.before, after: x.scores[d.id], held: w.held || [], checks: w.checks || [], holds: w.holds || [],
      orders: w.orders || [], error: w.error || '' };
  });
  const ranks = {};
  ['stock', 'crypto'].forEach(pool => bots.filter(b => !b.ghost && (x.roster.find(d => d.id === b.id) || {}).pool === pool)
    .sort((a, b) => b.after - a.after).forEach((b, i) => ranks[b.name] = i + 1));
  let luck = {}; Object.keys(x.luck).forEach(n => luck[n] = x.luck[n].verdict);
  if (!Object.keys(luck).length && prev.luck) luck = prev.luck;   // the luck test was skipped this round
  const rg = x.mkt.macro.regime, regime = { stock: rg.stock.name, crypto: rg.crypto.name };
  const cfg = {}; Object.keys(x.cfg).forEach(k => cfg[k] = x.cfg[k]);

  // What changed since the last round
  const adj = [], ord = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  ['stock', 'crypto'].forEach(t => {
    if (prev.regime && prev.regime[t] && prev.regime[t] !== regime[t])
      adj.push({ kind: 'conditions', text: (t === 'stock' ? 'Stock' : 'Crypto') + ' market turned ' + regime[t] + ' (was ' + prev.regime[t] + ')' });
  });
  if (prev.ranks) Object.keys(ranks).forEach(n => {
    const was = prev.ranks[n];
    if (was && was !== ranks[n]) adj.push({ kind: 'rank', bot: n, from: was, to: ranks[n], text: n + (ranks[n] < was ? ' climbed from ' : ' slipped from ') + ord(was) + ' to ' + ord(ranks[n]) });
  });
  if (prev.luck) Object.keys(luck).forEach(n => {
    if (prev.luck[n] && prev.luck[n] !== luck[n] && luck[n] !== 'Too early') adj.push({ kind: 'luck', bot: n, text: n + ': luck test now says ' + luck[n] + ' (was ' + prev.luck[n] + ')' });
  });
  if (prev.cfg) Object.keys(cfg).forEach(k => {
    if (prev.cfg[k] !== undefined && String(prev.cfg[k]) !== String(cfg[k])) adj.push({ kind: 'config', text: 'Config ' + k + ' changed: ' + prev.cfg[k] + ' → ' + cfg[k] });
  });
  bots.forEach(b => b.orders.filter(o => o.ok).forEach(o => {
    const why = String(o.why || '');
    if (/stop/i.test(why)) adj.push({ kind: 'risk', bot: b.name, text: b.name + ' hit a stop-loss on ' + o.sym + ': ' + why });
    else if (/profit|banked/i.test(why)) adj.push({ kind: 'risk', bot: b.name, text: b.name + ' took profit on ' + o.sym + ': ' + why });
    else if (/target weight|fell out of the top/i.test(why) && b.held.indexOf(o.sym) >= 0) adj.push({ kind: 'rebalance', bot: b.name, text: b.name + ' rebalanced ' + o.sym + ': ' + why });
    else if (/sized ×/.test(why)) adj.push({ kind: 'sizing', bot: b.name, text: b.name + ' resized for the market: ' + why });
  }));
  let pending = [];
  try { pending = JSON.parse(props.getProperty('TELE_PENDING') || '[]'); } catch (e) { pending = []; }
  pending.forEach(e => adj.push(e));
  props.deleteProperty('TELE_PENDING');
  const abort = props.getProperty('LAST_ABORT');
  if (abort) {
    try { const a = JSON.parse(abort); x.mkt.warn.unshift('A round at ' + Utilities.formatDate(new Date(a.at), TZ, 'MMM d HH:mm') + ' ran ' + Math.round(a.secs) + 's and was abandoned before saving (phases ' + JSON.stringify(a.phases) + ')'); } catch (e) { /* ignore */ }
    props.deleteProperty('LAST_ABORT');
  }
  const warn = x.mkt.warn.slice(0, 10);
  (warn || []).forEach(w => { if (!(prev.warn || []).includes(w)) adj.push({ kind: 'data', text: 'Data: ' + w }); });

  const filled = bots.reduce((s, b) => s + b.orders.filter(o => o.ok).length, 0);
  const blocked = bots.reduce((s, b) => s + b.orders.filter(o => !o.ok).length, 0);
  const calls = CALLS_, nCalls = Object.keys(calls).reduce((s, k) => s + calls[k].n, 0);
  const prices = {}; x.mkt.assets.forEach(a => prices[a.sym] = a.price);
  const receipt = JSON.stringify({ t: x.now.toISOString(), prices, decisions: bots.map(b => [b.id, b.orders.map(o => o.side + ' ' + o.sym + (o.ok ? '' : ' x'))]), scores: x.scores });
  const fp = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, receipt, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0, 16);
  const secs = (Date.now() - x.t0) / 1000;

  const detail = { t: x.now.toISOString(), secs, phases: x.phases || null, fp, calls, regime, stocksOpen: x.mkt.stocksOpen,
    sources: { stocks: x.mkt.assets.filter(a => a.type === 'stock').length, crypto: x.mkt.assets.filter(a => a.type === 'crypto').length,
      news: (x.mkt.assets.find(a => a.news) || {}).news ? x.mkt.assets.find(a => a.news).news.src : 'none',
      fngStock: !!x.mkt.macro.fngStock, fngCrypto: !!x.mkt.macro.fngCrypto },
    warn, adj, bots, twins: x.twins || [] };
  let json = JSON.stringify(detail);
  if (json.length > 45000) { bots.forEach(b => b.checks = b.checks.map(c => ({ sym: c.sym, ok: c.ok, d: String(c.d).slice(0, 60) }))); json = JSON.stringify(detail); }

  const sh = getSheet_(SHEETS.TELEMETRY);
  if (sh.getLastRow() === 0) header_(SHEETS.TELEMETRY, TELE_HEADERS);
  sh.appendRow([x.now, +secs.toFixed(1), filled, blocked, nCalls, warn.length, fp, json]);
  const extra = sh.getLastRow() - 1 - TELE_KEEP;
  if (extra > 0) sh.deleteRows(2, extra);
  const old = sh.getLastRow() - TELE_FULL;   // the row that just aged out of full detail
  if (old >= 2) {
    const cell = sh.getRange(old, 8), v = String(cell.getValue());
    if (v.length > 4000) cell.setValue(slimTelemetry_(v));
  }

  props.setProperty('TELE_PREV', JSON.stringify({ ranks, luck, regime, cfg, warn }));
}

// A row's summary once it is older than TELE_FULL rounds: timings, calls, warnings and what changed.
function slimTelemetry_(json) {
  try {
    const d = JSON.parse(json);
    return JSON.stringify({ t: d.t, secs: d.secs, phases: d.phases || null, fp: d.fp, calls: d.calls, regime: d.regime, stocksOpen: d.stocksOpen,
      warn: d.warn, adj: (d.adj || []).slice(0, 30), slim: true,
      orders: (d.bots || []).reduce((s, b) => s + (b.orders || []).length, 0) });
  } catch (e) { return '{"slim":true}'; }
}

// One-time cleanup (run by the insights job): slim every row older than TELE_FULL.
function slimOldTelemetry_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TELE_SLIM_V') === '1') return 'done before';
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.TELEMETRY);
  if (sh && sh.getLastRow() - TELE_FULL > 1) {
    const n = sh.getLastRow() - TELE_FULL - 1, rg = sh.getRange(2, 8, n, 1);
    rg.setValues(rg.getValues().map(r => [String(r[0]).length > 4000 ? slimTelemetry_(String(r[0])) : r[0]]));
  }
  props.setProperty('TELE_SLIM_V', '1');
  return 'slimmed';
}

// For the Academy: the last `n` rounds in full, plus a light heartbeat for the last 200.
function telemetryForWeb_(n) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.TELEMETRY);
  let auto = null;
  try { auto = ScriptApp.getProjectTriggers().some(t => ['runRound', 'scheduledRound'].indexOf(t.getHandlerFunction()) >= 0); } catch (e) { /* not allowed here */ }
  if (!sh || sh.getLastRow() < 2) return { rounds: [], beats: [], auto };
  const last = sh.getLastRow(), from = Math.max(2, last - 199);
  const rows = sh.getRange(from, 1, last - from + 1, 7).getValues();   // the heartbeat columns only; JSON just for the newest
  const iso = v => v instanceof Date ? v.toISOString() : v;
  const beats = rows.map(r => ({ t: iso(r[0]), secs: r[1], filled: r[2], blocked: r[3], calls: r[4], warn: r[5], fp: r[6] }));
  const k = Math.min(n, last - 1), json = sh.getRange(last - k + 1, 8, k, 1).getValues();
  const rounds = json.reverse().map(r => { try { return JSON.parse(r[0]); } catch (e) { return null; } }).filter(d => d && !d.slim);
  return { rounds, beats, auto };
}
