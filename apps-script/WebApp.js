/**
 * GAME OF TRADES — the Academy web app (HtmlService).
 * Deploy as a web app (see README). The HEAD test deployment (/dev URL) always runs your latest `clasp push`
 * and only opens for editors of the project.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Game of Trades Academy')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// ScriptApp.getService().getUrl() can return a dead /exec link, so the deployment IDs live here.
// Development runs on HEAD (/dev: always the latest clasp push, editors only, uses no versions). The public /exec
// link stays frozen on its last version until you publish: ./publish.sh "description" (updates it in place,
// same URL, one version used). Flip ACADEMY_DEV_MODE to false once the build is final.
const ACADEMY_EXEC_ID = 'AKfycbwmq6q5mX7oe-hbis1Q77u9L2_4y6XjG2c1MzigoEZoN6_aENTrSrqJbp9DPjm0llc9vw';
const ACADEMY_HEAD_ID = 'AKfycbxWVRneAkcCKC-ma-xqzerigjrssP4V7AuZWPmMSJEd';
const ACADEMY_DEV_MODE = true;

function openWebApp() {
  assertOwner_();
  const link = (id, kind) => { const u = 'https://script.google.com/macros/s/' + id + '/' + kind; return '<a href="' + u + '" target="_blank">' + kind + '</a>'; };
  const dev = '<p>' + (ACADEMY_DEV_MODE ? 'Open the Academy: <b>' + link(ACADEMY_HEAD_ID, 'dev') + '</b>' : 'Latest code: ' + link(ACADEMY_HEAD_ID, 'dev')) +
    ' (latest push, editors only)</p>';
  const pub = '<p>' + (ACADEMY_DEV_MODE ? 'Public link: ' + link(ACADEMY_EXEC_ID, 'exec') : 'Open the Academy: <b>' + link(ACADEMY_EXEC_ID, 'exec') + '</b>') +
    (ACADEMY_DEV_MODE ? ' (frozen at the last publish)' : ' (published version)') + '</p>';
  const html = '<div style="font-family:Georgia,serif">' + (ACADEMY_DEV_MODE ? dev + pub : pub + dev) + '</div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(140), '📜 Game of Trades Academy');
}

// Everything the UI needs, as a JSON string (google.script.run cannot return Date objects).
function getDashboard() {
  const state = JSON.parse(PropertiesService.getScriptProperties().getProperty('LAST_STATE') || '{}');
  const iso = v => v instanceof Date ? v.toISOString() : v;
  const clean = rows => rows.map(r => r.map(iso));

  const standings = getSheet_(SHEETS.BOARD).getRange(5, 1, BOARD_ROWS, BOARD_COLS).getValues().filter(r => r[1]).map(r => ({
    rank: r[0], bot: r[1], strategy: r[2], value: r[3], ret: r[4], mark: r[5], cash: r[6], invested: r[7], fees: r[8],
    taxes: r[9], trades: r[10], winRate: r[11], maxDD: r[12], words: r[13], vsMarket: r[14], skill: r[15], pool: r[16], ghost: r[0] === '👻' }));

  const H = readHistory_(), regimeCols = ['Stock Regime', 'Crypto Regime'];
  const names = H.head.slice(1).filter(n => n && regimeCols.indexOf(n) < 0);
  const step = Math.max(1, Math.ceil(H.rows.length / 240));
  const sampled = H.rows.filter((r, i) => i % step === 0 || i === H.rows.length - 1);
  const history = { times: sampled.map(r => iso(r[0])),
    series: names.map(n => ({ name: n, values: sampled.map(r => { const v = r[H.head.indexOf(n)]; return v === '' ? null : +v; }) })) };

  const tradeRows = getSheet_(SHEETS.TRADES).getDataRange().getValues().slice(1);
  // Each bot's most recent move, however long ago, so every pet can say what it picked and why.
  const moves = {};
  tradeRows.forEach(r => { if (r[1]) moves[r[1]] = { time: iso(r[0]), side: r[2], sym: r[3], price: r[5], gross: r[6], pnl: r[8], why: r[11], says: r[12] }; });
  const trades = tradeRows.slice(-60).reverse().map(r => ({
    time: iso(r[0]), bot: r[1], side: r[2], sym: r[3], qty: r[4], price: r[5], gross: r[6], fees: r[7], pnl: r[8], tax: r[9], why: r[11], says: r[12] }));
  const holdingLots = clean(getSheet_(SHEETS.HOLD).getDataRange().getValues().slice(1).filter(r => r[0]))
    .map(r => ({ bot: r[0], sym: r[1], type: r[2], qty: +r[3], cost: +r[4], opened: r[5], price: +r[6], value: +r[7], pnl: +r[8] }));
  const holdingMap = {};
  holdingLots.forEach(h => {
    const k = h.bot + '|' + h.sym, x = holdingMap[k] || (holdingMap[k] = { bot: h.bot, sym: h.sym, type: h.type, qty: 0, costTotal: 0,
      opened: h.opened, price: h.price, value: 0, pnl: 0 });
    x.qty += h.qty; x.costTotal += h.qty * h.cost; x.value += h.value; x.pnl += h.pnl;
    if (new Date(h.opened) < new Date(x.opened)) x.opened = h.opened;
  });
  const holdings = Object.keys(holdingMap).map(k => { const h = holdingMap[k]; h.cost = h.qty ? h.costTotal / h.qty : 0; delete h.costTotal; return h; });
  const research = getSheet_(SHEETS.RESEARCH).getDataRange().getValues().slice(2).filter(r => r[0]).map(r => ({
    sym: r[0], type: r[1], price: r[2], r1: r[3], r5: r[4], r20: r[5], rsi: r[6], vs20: r[7], vs50: r[8], volx: r[10],
    news: r[11], headlines: r[12], headline: r[13], cmc24: r[15], tradable: r[17] }));
  const lineage = lineageRows_().map(r => ({ id: r[0], name: r[1], title: r[2], house: r[3], emoji: r[4], generation: r[5],
    born: r[6], p1: r[7], p2: r[8], foster: r[9], lineage: r[10], strategy: r[11], bio: r[12], lessons: r[13], status: r[16],
    seasons: r[17], best: r[18] }));
  const arch = SpreadsheetApp.getActive().getSheetByName(SHEETS.ARCHIVE);
  const yearbook = arch && arch.getLastRow() > 1
    ? arch.getRange(2, 3, arch.getLastRow() - 1, 1).getValues().map(r => { try { return JSON.parse(r[0]); } catch (e) { return null; } }).filter(Boolean).reverse()
    : [];
  const bios = {}, botState = loadBots_();
  // Which market a bot can trade right now (drives who naps after the stock close). Greta trades whatever her grid is on.
  const marketOf = d => {
    if ((d.baseId || d.id) === 'G_SPY') return 'stock';
    if ((d.baseId || d.id) === 'GRID') { const g = ((botState[d.id] || {}).state || {}).grid; return g ? (g.sym === 'SPY' ? 'stock' : 'crypto') : d.pool || 'all'; }
    return d.pool || (d.dna && d.dna.params && d.dna.params.universe) || 'all';
  };
  const assetStates = {}; universeAssetsForWeb_().forEach(a => assetStates[a.sym] = a.status);
  getCompetitionRoster_().forEach(d => bios[d.name] = { id: d.id, baseId: d.baseId || d.id, baseName: d.baseName || d.name, pool: d.pool, emoji: d.emoji, bio: d.bio, house: d.house, strategy: d.strategy, ghost: !!d.ghost,
    challenger: !!d.challenger, provisional: !!d.provisional, human: !!d.human, player: d.player || '', market: marketOf(d), avatarStyle: d.avatarStyle || '',
    avatarData: d.avatarData || '', avatarStatus: d.avatarStatus || '', assets: (d.dna && d.dna.params && d.dna.params.symbols) || [],
    assetStatus: d.dna && d.dna.params && d.dna.params.symbols && d.dna.params.symbols.length ? assetStates[d.dna.params.symbols[0]] || 'Loading' : '' });

  let warmup = null;
  try { warmup = JSON.parse(PropertiesService.getScriptProperties().getProperty('WARMUP') || 'null'); } catch (e) { /* none */ }
  const telemetry = telemetryForWeb_(12);
  // Trash talk only starts when the standings shift: the rank moves logged by the latest round
  const lastRound = telemetry.rounds[0];
  const shifts = lastRound ? (lastRound.adj || []).filter(a => a.kind === 'rank' && a.from) : [];
  let banter = null;
  try { banter = banter_(state, standings, moves, holdings, warmup, shifts); } catch (e) { banter = { lines: null, note: 'Banter failed: ' + e.message }; }
  if (banter) { banter.shifts = shifts; banter.round = lastRound ? lastRound.t : null; }

  let duels = null;
  try { duels = duels_(H); } catch (e) { duels = { error: e.message }; }
  return JSON.stringify({ season: getSeason_(), seasonClock: seasonClock_(), state, standings, history, duels, trades, moves, holdings, research, lineage, yearbook, bios,
    banter, warmup, telemetry, study: studyOrNull_(), version: APP_VERSION, changelog: CHANGELOG, canEdit: isOwner_(),
    playerSetup: { open: playerEnrollmentOpen_(), templates: playerBotTemplatesForWeb_(), assets: universeAssetsForWeb_() } });
}

function studyOrNull_() {
  try { return studyForWeb_(); } catch (e) { console.error('study', e); return null; }
}

// How each founder talks (word choice and rhythm, never mocking spellings).
const VOICES = {
  MOMO: 'Aussie hype-man, says "mate", all-caps energy', VAL: 'warm Southern grandma, "sugar", "darlin\'", sweetly savage',
  CASS: 'dry Scottish, "aye", "och", deadpan', HANK: '1940s newsreel announcer, "Extra, extra!", headlines',
  QUANT: 'plummy Oxford don, "old chap", cites statistics', DANA: 'unbothered Irish, "grand", "sure look", never worried',
  BELLA: 'fast-talking Brooklyn, "ay", "c\'mon", impatient', WES: 'New England sea captain, "ayuh", nautical metaphors',
  GRID: 'precise Swiss clockmaker, "precisely", "tick-tock", everything on schedule',
  SCALP: 'rapid-fire auctioneer, "quick-quick", "sold!", short punchy bursts',
  STACK: 'patient vault keeper, talks in units and harvests, quietly confident',
  PAIR: 'calm Scandinavian, "ja", balanced sentences about twins and mirrors', BAND: 'upbeat yoga teacher, "breathe", "stretch", "release"',
  TREND: 'slow-talking Texas rancher, "reckon", "partner", herds and trails', VOLT: 'calm airline captain, "folks", turbulence and cruising altitude',
  CAL: 'folksy farmer with an almanac, "by the almanac", seasons and planting'
};

// Trash talk for the Arena, written by the LLM once per round and cached.
// Returns { lines, note }: lines is null when there's no key, no round yet, or the call failed, and note says which.
// Only the insights job (BANTER_LLM_ = true) calls the LLM; a page load just reads what it wrote, so nobody waits on Gemini.
let BANTER_LLM_ = false;
const BANTER_V = 4;   // bump when the prompt changes so cached banter is rewritten
function banter_(state, standings, moves, holdings, warmup, shifts) {
  if (!state.updated) return { lines: null, note: 'No round has run yet.' };
  if (!shifts.length) return { lines: null, quiet: true, note: 'Nobody changed places last round.' };
  if (!llmProvider_()) return { lines: null, note: 'No GEMINI_API_KEY in Script Properties.' };
  const props = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache();
  const V = BANTER_V;
  try { const c = JSON.parse(props.getProperty('BANTER') || '{}'); if (c.for === state.updated && c.v === V) return { lines: c.lines }; } catch (e) { /* regenerate */ }
  const failed = cache.get('banter_fail_' + state.updated);
  if (failed) return { lines: null, note: failed };
  if (!BANTER_LLM_) return { lines: null, pending: true, note: 'Gemini is still writing this round’s trash talk; it appears within a few minutes.' };
  const bots = getCompetitionRoster_().filter(d => !d.ghost);
  const pct = v => typeof v === 'number' ? (v * 100).toFixed(1) + '%' : 'n/a';
  const facts = bots.map(d => {
    const s = standings.find(x => String(x.bot).indexOf(d.name) >= 0) || {}, mv = moves[d.name];
    return { name: d.name, house: d.house, strategy: d.strategy, voice: VOICES[d.baseId || d.id] || 'grand and formal, a Challenger bred from champions',
      rank: s.rank, return: pct(s.ret), vsMarket: pct(s.vsMarket), luck: s.skill || 'too early',
      lastMove: mv ? mv.side + ' ' + mv.sym + ' because ' + mv.why : 'no trades yet',
      holding: holdings.filter(h => h.bot === d.id).map(h => h.sym),
      practiceMonth: warmup ? pct((warmup.results.find(r => r.name === d.name) || {}).ret) : undefined };
  });
  const prompt = 'You write playful trash talk between trading bots in a kids-friendly stock-market game.\n' +
    'The standings just changed. These moves happened in the last round: ' + shifts.map(x => x.text).join('; ') + '.\n' +
    'Write 6 to 10 lines as short exchanges about THESE moves only: a bot that climbed brags to a bot it passed, ' +
    'and that bot replies directly to exactly what was said; a bot that slipped may get teased and answer back; ' +
    'a third bot may jump in. Only bots involved in a move speak, plus at most one bystander.\n' +
    'Rules: never the same bot twice in a row; point to the pick or strategy behind the move when the facts show it. ' +
    'practiceMonth is each bot’s return in the 30-day warm-up replay before the season. ' +
    'Use ONLY these facts and real numbers from them. Plain, clear English a 10-year-old can follow: one idea per line, ' +
    'max 20 words. Each bot keeps its voice with just a word or two of flavour, no heavy dialect or misspellings. ' +
    'Address the other bot by first name. Keep it PG: teasing, no slurs, nothing about real people.\n' +
    'Return ONLY a JSON array like [{"bot":"Momo Max","to":"Grandma Val","text":"..."}], in speaking order.\n\n' + JSON.stringify(facts);
  const text = llm_(prompt, readConfig_(), { maxTokens: 8192, json: true, quick: true });
  const m = text && text.match(/\[[\s\S]*\]/);
  const fail = why => {
    const mins = LLM_BUSY_ ? 3 : 10;   // overloads pass quickly; other errors get a longer rest
    const note = why + ' Trying again in ' + mins + ' minutes.';
    cache.put('banter_fail_' + state.updated, note, mins * 60);
    return { lines: null, note };
  };
  if (!m) return fail(LLM_ERROR_ || 'Gemini’s reply had no list of lines.');
  let raw;
  try { raw = JSON.parse(m[0]); } catch (e) { return fail('Gemini’s reply was cut off or malformed' + (LLM_ERROR_ ? ' (' + LLM_ERROR_ + ')' : '') + '.'); }
  const names = bots.map(d => d.name);
  const lines = raw.filter(l => l && names.indexOf(l.bot) >= 0 && l.text).slice(0, 16)
    .map(l => ({ bot: l.bot, to: names.indexOf(l.to) >= 0 ? l.to : '', text: String(l.text).slice(0, 220), by: llmProvider_() }))
    .filter((l, i, a) => i === 0 || l.bot !== a[i - 1].bot);
  if (!lines.length) return fail('Gemini’s lines didn’t name the bots correctly.');
  props.setProperty('BANTER', JSON.stringify({ for: state.updated, v: V, lines }));
  return { lines };
}

/* ---------- the insights job ---------- */

// Every 5 minutes, separate from the trading round: LLM news scores, the Arena's trash talk and housekeeping.
// Before v1.34 these Gemini calls ran inside the round (up to 5 minutes each when Google was busy), pushing
// rounds toward the 6-minute kill.
function scheduledInsights(e) {
  assertScheduledTrigger_(e, 'scheduledInsights');
  return insights_();
}

function runInsightsNow() {
  assertOwner_();
  return insights_();
}

function insights_() {
  const cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  if (cache.get('insights_busy')) return { busy: true };
  cache.put('insights_busy', '1', 330);
  const t0 = Date.now(), out = { at: new Date().toISOString() };
  try {
    const lock = LockService.getScriptLock();   // the telemetry cleanup must not overlap a round's writes
    if (props.getProperty('TELE_SLIM_V') !== '1' && lock.tryLock(1000)) {
      try { out.tele = slimOldTelemetry_(); } catch (e) { out.tele = 'failed: ' + e.message; } finally { lock.releaseLock(); }
    }
    try { out.news = refreshNewsScores_(readConfig_()); } catch (e) { out.news = 'failed: ' + e.message; }
    try { out.banter = writeBanterNow_(); } catch (e) { out.banter = 'failed: ' + e.message; }
    try { out.lab = labStep_(t0 + 270e3); } catch (e) { out.lab = 'failed: ' + e.message; }   // the backtest lab uses what's left of the slot
  } finally { cache.remove('insights_busy'); }
  props.setProperty('INSIGHTS_LAST', JSON.stringify(out));
  return out;
}

function writeBanterNow_() {
  const props = PropertiesService.getScriptProperties();
  let state = {}; try { state = JSON.parse(props.getProperty('LAST_STATE') || '{}'); } catch (e) { state = {}; }
  if (!state.updated) return 'no round yet';
  if (!llmProvider_()) return 'no key';
  try { const c = JSON.parse(props.getProperty('BANTER') || '{}'); if (c.for === state.updated && c.v === BANTER_V) return 'already written'; } catch (e) { /* write it */ }
  if (CacheService.getScriptCache().get('banter_fail_' + state.updated)) return 'resting after a failure';
  BANTER_LLM_ = true;
  try {
    const b = JSON.parse(getDashboard()).banter || {};
    return b.lines ? 'written' : b.quiet ? 'nobody moved' : 'not written: ' + (b.note || '');
  } finally { BANTER_LLM_ = false; }
}

function webRunRound() {
  assertOwner_();
  runRound_();
  return getDashboard();
}

// ⚔️ Duels: every round that something moved, each pool's bots pair off (pairings rotate round-robin so everyone
// meets everyone; with an odd number, the odd one out fights the pool's ghost). The bigger gain since the last
// round wins the bout; equal moves (both sitting in cash) are a draw. Built from the full EquityHistory.
function duels_(H) {
  const roster = getCompetitionRoster_(), out = {}, EPS = 1e-7;
  const col = {}; H.head.forEach((h, i) => { if (h) col[h] = i; });
  ['stock', 'crypto'].forEach(pool => {
    const fighters = roster.filter(d => d.pool === pool && !d.ghost && col[d.name] != null).map(d => d.name).sort();
    const g = roster.find(d => d.ghost && d.pool === pool && col[d.name] != null), ghost = g ? g.name : null;
    const rec = {};
    fighters.forEach(n => rec[n] = { w: 0, l: 0, d: 0, last: [] });
    let round = 0, latest = null;
    for (let t = 1; t < H.rows.length; t++) {
      const a = H.rows[t - 1], b = H.rows[t];
      const ret = n => { const x = +a[col[n]], y = +b[col[n]]; return x > 0 && y > 0 ? y / x - 1 : null; };
      const rets = {};
      fighters.forEach(n => rets[n] = ret(n));
      if (ghost) rets[ghost] = ret(ghost);
      if (!fighters.some(n => rets[n] !== null && Math.abs(rets[n]) > EPS)) continue;   // nothing moved: not a round
      round++;
      const list = fighters.slice();
      if (list.length % 2) list.push(ghost);
      const k = list.length;
      if (k < 2) continue;
      const rest = list.slice(1), r = (round - 1) % (k - 1);
      const order = [list[0]].concat(rest.slice(r), rest.slice(0, r));
      const bouts = [];
      for (let i = 0; i < k / 2; i++) {
        const p = order[i], q = order[k - 1 - i];
        if (!p || !q) continue;
        const rp = rets[p], rq = rets[q];
        const win = rp !== null && rq !== null && Math.abs(rp - rq) > EPS ? (rp > rq ? p : q) : null;
        [p, q].forEach(n => {
          if (!rec[n]) return;   // the ghost keeps no record
          const res = win === null ? 'D' : win === n ? 'W' : 'L';
          rec[n][res === 'W' ? 'w' : res === 'L' ? 'l' : 'd']++;
          rec[n].last.push(res);
          if (rec[n].last.length > 5) rec[n].last.shift();
        });
        bouts.push({ a: p, b: q, ra: rp, rb: rq, win: win });
      }
      latest = { round: round, time: b[0] instanceof Date ? b[0].toISOString() : b[0], bouts: bouts };
    }
    out[pool] = { rounds: round, latest: latest, ghost: ghost,
      records: fighters.map(n => Object.assign({ name: n }, rec[n])).sort((x, y) => (y.w - y.l) - (x.w - x.l) || y.w - x.w || x.name.localeCompare(y.name)) };
  });
  return out;
}

function webEndSeason() {
  assertOwner_();
  return JSON.stringify(endSeasonCore_());
}

// Google-sign-in-gated enrollment endpoint. The server validates the account key
// and every range; callers never get direct sheet access or commissioner controls.
function webCreatePlayerBot(request) {
  const bot = createPlayerBot_(request);
  return JSON.stringify({ bot, dashboard: JSON.parse(getDashboard()) });
}

function webUpdatePlayerAvatar(request) {
  const result = updatePlayerAvatar_(request);
  return JSON.stringify({ result, dashboard: JSON.parse(getDashboard()) });
}

function webEnableAutomation() {
  startAutoTrading();
  return getDashboard();
}

function isOwner_() {
  try {
    const a = Session.getActiveUser().getEmail(), e = Session.getEffectiveUser().getEmail();
    return !!a && a === e;
  } catch (err) { return false; }
}

function assertOwner_() {
  if (!isOwner_()) throw new Error('Only the arena owner can run rounds or end the season.');
}

function assertScheduledTrigger_(e, handler) {
  if (!isScheduledTrigger_(e, handler)) throw new Error('This scheduled function can only be run by its installed trigger.');
}

function isScheduledTrigger_(e, handler) {
  const uid = e && e.triggerUid ? String(e.triggerUid) : '';
  return !!uid && ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === handler && String(t.getUniqueId()) === uid);
}

