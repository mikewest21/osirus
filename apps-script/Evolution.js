/**
 * GAME OF TRADES — seasons, the reckoning, and the bloodlines.
 * At season's end every bot is judged, the edge of the winners is identified, and a Challenger is bred
 * from the top two (with the third as foster-parent). Its DNA and lineage live in the "Lineage" sheet,
 * and it fights next season. Challengers that finish in the bottom half fall; winners can sire the next generation.
 */

const BOARD_ROWS = 64;
const GENES = ['momentum', 'reversion', 'fear', 'news', 'breakout', 'volume', 'factor', 'dca', 'spread', 'band', 'trend', 'calm', 'calendar', 'scalp', 'grid'];
const GENE_LORE = {
  momentum:  { epithet: 'the Swift',       emoji: '🔥', word: 'momentum' },
  reversion: { epithet: 'the Patient',     emoji: '🕯️', word: 'buying the dip' },
  fear:      { epithet: 'the Unshaken',    emoji: '🌑', word: 'fear & greed' },
  news:      { epithet: 'Whisper-Ear',     emoji: '🪶', word: 'the news' },
  breakout:  { epithet: 'Wallbreaker',     emoji: '⚔️', word: 'breakouts' },
  volume:    { epithet: 'Tidecaller',      emoji: '🌊', word: 'volume' },
  factor:    { epithet: 'the Calculating', emoji: '📜', word: 'multi-factor ranking' },
  dca:       { epithet: 'the Steadfast',   emoji: '🛡️', word: 'steady accumulation' },
  spread:    { epithet: 'the Mirrored',    emoji: '🪞', word: 'pairs spreads' },
  band:      { epithet: 'the Elastic',     emoji: '🫧', word: 'band snap-backs' },
  trend:     { epithet: 'Longstride',      emoji: '🐢', word: 'slow trend crossovers' },
  calm:      { epithet: 'the Even-Keeled', emoji: '⚖️', word: 'calm, low-volatility assets' },
  calendar:  { epithet: 'Almanac-Wise',    emoji: '📅', word: 'the turn of the month' },
  scalp:     { epithet: 'Quickblade',      emoji: '🪙', word: 'quick scalps' },
  grid:      { epithet: 'the Latticed',    emoji: '🧇', word: 'grid ladders' }
};
const FIRST_NAMES = ['Vyra', 'Kaelen', 'Sorrel', 'Maelis', 'Torvin', 'Ysolde', 'Branick', 'Elowen', 'Corvane', 'Isra',
  'Draven', 'Seraphine', 'Aldric', 'Nyxa', 'Rowan', 'Talia', 'Oberic', 'Liora', 'Garrow', 'Anwen'];
const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const PARAM_KEYS = ['buyThreshold', 'sellThreshold', 'positionSize', 'maxPositions', 'stopLoss', 'takeProfit'];

function dna_(genes, params) {
  const g = {};
  GENES.forEach(k => g[k] = genes[k] || 0);
  return { genes: g, params: Object.assign({ buyThreshold: 0.3, sellThreshold: -0.2, positionSize: 0.25,
    maxPositions: 2, stopLoss: 0.12, takeProfit: 0, universe: 'all' }, params) };
}

// The Great Houses: the founders' DNA, written as genes so they can be bred.
const FOUNDERS = {
  MOMO:  { house: 'Ignis',        dna: dna_({ momentum: 1, factor: 0.2 }, { positionSize: 0.3 }) },
  VAL:   { house: 'Woolhall',     dna: dna_({ reversion: 1 }, { positionSize: 0.2, stopLoss: 0.15, takeProfit: 0.08, universe: 'stock' }) },
  CASS:  { house: 'Owlmere',      dna: dna_({ fear: 1 }, { positionSize: 0.35, sellThreshold: -0.4, stopLoss: 0 }) },
  HANK:  { house: 'Inkwell',      dna: dna_({ news: 1 }, { sellThreshold: -0.15 }) },
  QUANT: { house: 'Sigma',        dna: dna_({ factor: 1, momentum: 0.3, news: 0.3 }, { positionSize: 0.3, maxPositions: 3, buyThreshold: 0.2, stopLoss: 0 }) },
  DANA:  { house: 'Adamant',      dna: dna_({ dca: 1 }, { buyThreshold: 0.1, sellThreshold: -1, positionSize: 0.3, stopLoss: 0 }) },
  BELLA: { house: 'Thunderspire', dna: dna_({ breakout: 1, volume: 0.3 }, { stopLoss: 0.1 }) },
  WES:   { house: 'Leviathan',    dna: dna_({ volume: 1, momentum: 0.3 }, { positionSize: 0.2, universe: 'crypto' }) },
  GRID:  { house: 'Latticeholm',  dna: dna_({ grid: 1, reversion: 0.2 }, { positionSize: 0.1, maxPositions: 4, takeProfit: 0.025, stopLoss: 0.12 }) },
  SCALP: { house: 'Quickmint',    dna: dna_({ scalp: 1, momentum: 0.2 }, { positionSize: 0.2, maxPositions: 3, takeProfit: 0.01, stopLoss: 0.01, universe: 'all' }) },
  STACK: { house: 'Hoardwell',    dna: dna_({ dca: 0.7, reversion: 0.6 }, { positionSize: 0.3, maxPositions: 1, takeProfit: 0.06, stopLoss: 0, universe: 'crypto' }) },
  PAIR:  { house: 'Mirrormoor',   dna: dna_({ spread: 1, reversion: 0.3 }, { positionSize: 0.3, maxPositions: 2, stopLoss: 0.08 }) },
  BAND:  { house: 'Elastica',     dna: dna_({ band: 1, reversion: 0.3 }, { positionSize: 0.25, stopLoss: 0.08 }) },
  TREND: { house: 'Longshell',    dna: dna_({ trend: 1, momentum: 0.3 }, { positionSize: 0.3, sellThreshold: -0.1, stopLoss: 0.12 }) },
  VOLT:  { house: 'Evenkeel',     dna: dna_({ calm: 1, dca: 0.5 }, { positionSize: 0.35, maxPositions: 2, stopLoss: 0 }) },
  CAL:   { house: 'Almanac',      dna: dna_({ calendar: 1, dca: 0.3 }, { positionSize: 0.4, stopLoss: 0 }) }
};

// Genomes saved before a gene existed get it at 0, so old Challengers keep trading exactly as before.
function fullDna_(dna) {
  const out = { genes: {}, params: Object.assign({}, (dna && dna.params) || {}) };
  GENES.forEach(k => out.genes[k] = +((dna && dna.genes && dna.genes[k]) || 0));
  return out;
}

const LINEAGE_HEADERS = ['ID', 'Name', 'Title', 'House', 'Emoji', 'Generation', 'Season Born', 'Parent 1', 'Parent 2',
  'Fostered By', 'Lineage', 'Strategy', 'Bio', 'Lessons', 'Genome', 'Lines', 'Status', 'Seasons Fought', 'Best Finish'];

/* ---------- roster ---------- */

let ROSTER_ = null;
let ENTRANTS_ = null;

function getRoster_() {
  if (ROSTER_) return ROSTER_;
  const founders = BOTS.map(d => Object.assign({}, d, { house: (FOUNDERS[d.id] || {}).house || d.name,
    dna: (FOUNDERS[d.id] || {}).dna || dna_({ factor: 1 }, {}), generation: 0 }));
  const kids = lineageRows_().filter(r => !FOUNDERS[r[0]] && (r[16] === 'Alive' || String(r[16]).indexOf('Provisional') === 0)).map(r => ({
    id: r[0], name: r[1], title: r[2], house: r[3], emoji: r[4], generation: +r[5], strategy: r[11], bio: r[12],
    dna: fullDna_(JSON.parse(r[14])), lines: JSON.parse(r[15]), challenger: true, provisional: String(r[16]).indexOf('Provisional') === 0 }));
  const players = getPlayerBots_();
  const ghosts = GHOSTS.map(g => Object.assign({}, g, { house: 'the Beyond', generation: 0 }));
  return (ROSTER_ = founders.concat(kids, players, ghosts));
}

// Trading identities expand into isolated competition sleeves. A dual-market
// personality gets its own $10k, holdings, taxes, state and results in each pool.
// The 50/50 ghost is retired from ranked play because pools never cross.
function getCompetitionRoster_() {
  if (ENTRANTS_) return ENTRANTS_;
  const out = [];
  getRoster_().forEach(d => {
    let pools;
    if (d.id === 'G_SPY') pools = ['stock'];
    else if (d.id === 'G_BTC') pools = ['crypto'];
    else if (d.id === 'G_MIX') pools = [];
    else if (Array.isArray(d.pools)) pools = d.pools;   // a founder limited to certain pools (e.g. Nickel Nick: stocks only)
    else {
      const u = d.dna && d.dna.params ? d.dna.params.universe : 'all';
      pools = u === 'stock' || u === 'crypto' ? [u] : ['stock', 'crypto'];
    }
    pools.forEach(pool => {
      const e = Object.assign({}, d), suffix = pool === 'stock' ? 'Stocks' : 'Crypto';
      e.baseId = d.id; e.baseName = d.name; e.pool = pool;
      e.id = d.id + '__' + pool.toUpperCase();
      e.name = d.name + ' — ' + suffix;
      e.strategy = d.strategy + ' · ' + suffix + ' Pool';
      if (d.dna) e.dna = { genes: Object.assign({}, d.dna.genes), params: Object.assign({}, d.dna.params, { universe: pool }) };
      out.push(e);
    });
  });
  return (ENTRANTS_ = out);
}

function strategyFor_(def) {
  return STRATEGIES[def.baseId || def.id] || (c => stratGenome_(c, Object.assign({}, def.dna, { params: Object.assign({}, def.dna.params, c.params || {}) })));
}

function lineageRows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.LINEAGE);
  return sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1).filter(r => r[0]) : [];
}

function seedFounders_() {
  const sh = getSheet_(SHEETS.LINEAGE);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, LINEAGE_HEADERS.length).setValues([LINEAGE_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const have = new Set(lineageRows_().map(r => r[0]));
  BOTS.forEach(d => {
    const f = FOUNDERS[d.id];
    if (!f || have.has(d.id)) return;
    sh.appendRow([d.id, d.name, d.name + ', Founder of House ' + f.house, f.house, d.emoji, 0, 'Founding', '', '', '',
      'Founder of House ' + f.house, d.strategy, d.bio, '', JSON.stringify(f.dna), JSON.stringify(d.lines), 'Founder', 0, '']);
  });
}

// v1.30 exposed that the first two Reckonings were caused by an early clock
// trigger. Preserve those characters, but make Season 3 a real qualifying trial
// instead of pretending their short birth seasons proved an edge.
function ensureProvisionalSeason3_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('PROVISIONAL_SEASON3_MIGRATED') === '1') return;
  const sh = getSheet_(SHEETS.LINEAGE), data = sh.getDataRange().getValues();
  let changed = false;
  data.slice(1).forEach((r, j) => {
    if (!FOUNDERS[r[0]] && r[16] === 'Alive' && Number(r[6]) <= 3) {
      data[j + 1][16] = 'Provisional — Season 3 trial';
      data[j + 1][13] = (data[j + 1][13] ? data[j + 1][13] + ' ' : '') +
        '⚠️ Born during an abbreviated exhibition season; must beat the market and earn Skill (likely) in Season 3 to qualify.';
      changed = true;
    }
  });
  if (changed) sh.getRange(1, 1, data.length, data[0].length).setValues(data);
  props.setProperty('PROVISIONAL_SEASON3_MIGRATED', '1');
  ROSTER_ = null; ENTRANTS_ = null;
}

/* ---------- the genome strategy (how every Challenger trades) ---------- */

// pool: { lead, medVol } for the relative genes: the pool's benchmark (BTC or SPY) and its median volatility.
function geneSignals_(a, c, fac, pool) {
  const f = a.type === 'crypto' ? c.macro.fngCrypto : c.macro.fngStock;
  pool = pool || {};
  const bz = a.sd20 > 0 ? (a.price - a.sma20) / a.sd20 : null;
  const sz = pool.lead && pool.lead !== a ? spreadZ_(a, pool.lead) : null;
  return {
    spread: sz == null ? 0 : clamp_(-sz / 2),                                     // lagging its benchmark → buy, running ahead → sell
    band: bz == null ? 0 : bz < -1 ? clamp_((-bz - 1) / 1.5) : bz > 1 ? -clamp_((bz - 1) / 1.5) : 0,
    trend: a.sma10 && a.sma30 ? clamp_((a.sma10 / a.sma30 - 1) * 15) : 0,
    calm: a.vol20 && pool.medVol ? clamp_((pool.medVol - a.vol20) / pool.medVol * 2) : 0,
    calendar: a.tom && a.tom.now && (a.tom.edge == null || a.tom.edge > 0) ? (a.tom.edge == null ? 0.5 : clamp_(a.tom.edge * 300)) : 0,
    momentum: !a.sma50 ? 0 : a.price < a.sma20 ? -1 : (a.price > a.sma20 && a.sma20 > a.sma50 && a.ret5 > 0 ? clamp_(a.ret20 * 5) : 0),
    reversion: a.rsi14 == null ? 0 : a.rsi14 < 35 ? clamp_((50 - a.rsi14) / 20) : a.rsi14 > 60 ? -clamp_((a.rsi14 - 50) / 25) : 0,
    fear: f ? clamp_((50 - f.value) / 25) : 0,
    news: a.news && a.news.count >= 3 ? clamp_(a.news.score * 3) : 0,
    breakout: a.high20 && a.price > a.high20 && a.volRatio > 1.2 ? 1 : (a.low10 && a.price < a.low10 ? -1 : 0),
    volume: a.volRatio >= 1.8 && a.ret1 != null ? Math.sign(a.ret1) * clamp_((a.volRatio - 1) / 2) : 0,
    factor: fac[a.sym] != null ? clamp_(fac[a.sym] / 2) : 0,
    dca: a.sym === 'BTC' || a.sym === 'SPY' ? 1 : 0,
    scalp: scalpSignal_(a, c),
    grid: gridSignal_(a, c)
  };
}

// 🪙 Scalp gene (Nickel Nick's edge): an asset that is up on the day but just dipped since the last 15-minute round
// is a buy; a quick pop since the last round on something held is a sell. The dip has to be big enough to clear
// the round-trip trading cost, so crypto needs a wider dip than stocks. Needs the previous round's price
// (c.state.genePx); in the daily backtest lab there is no intraday tick, so the gene stays silent there.
function scalpSignal_(a, c) {
  const last = c.state && c.state.genePx ? c.state.genePx[a.sym] : null;
  if (!last || a.ret1 == null) return 0;
  const k = costs_(a.type, c.cfg), cost = 2 * (k.slip + k.rate) + k.sellExtra;
  const dip = Math.max(a.type === 'crypto' ? 0.006 : 0.002, cost / 2), change = a.price / last - 1;
  if (a.ret1 >= 0.003 && change <= -dip && change > -0.03) return clamp_(-change / (dip * 2) + 0.5);
  if (change >= Math.max(dip, cost)) return -clamp_(change / (cost * 2 || 0.01));
  return 0;
}

// 🧇 Grid gene (Greta Grid's edge): in a sideways market, buy when price sits well below its 20-day mean and sell
// when it is well above, scaled by how sideways the market is. Silent when daily swings are too small to beat
// the round-trip cost, which is what kept the real grid churning fees before the Nov 2026 fix.
function gridSignal_(a, c) {
  if (a.er20 == null || !a.vol20 || !a.sma20) return 0;
  const k = costs_(a.type, c.cfg), cost = 2 * (k.slip + k.rate) + k.sellExtra;
  if (a.vol20 < cost * 1.5) return 0;
  const sideways = clamp_(1 - a.er20 / 0.4, 0, 1);             // efficiency ratio 0 = pure chop, ≥0.4 = trending
  const dev = (a.price / a.sma20 - 1) / a.vol20;                 // distance from the mean, in daily swings
  return clamp_(-dev / 2) * sideways;
}

function stratGenome_(c, dna) {
  const p = dna.params, g = dna.genes;
  const chosen = Array.isArray(p.symbols) ? p.symbols : [];
  const pool = c.assets.filter(a => (p.universe === 'all' || a.type === p.universe) && (!chosen.length || chosen.indexOf(a.sym) >= 0));
  const fac = {}, fp = pool.filter(a => a.sma50 && a.ret20 != null);
  if (fp.length >= 3) {
    const zm = zs_(fp.map(a => a.ret20)), zt = zs_(fp.map(a => a.price / a.sma50 - 1));
    fp.forEach((a, i) => fac[a.sym] = (zm[i] + zt[i]) / 2);
  }
  const vols = pool.map(a => a.vol20).filter(v => v > 0);
  const rel = { lead: c.bySym[pool.length && pool[0].type === 'stock' ? 'SPY' : 'BTC'], medVol: vols.length ? median_(vols) : null };
  const wsum = GENES.reduce((s, k) => s + (g[k] || 0), 0) || 1, score = {}, lead = {};
  pool.forEach(a => {
    const sig = geneSignals_(a, c, fac, rel);
    let tot = 0, best = null;
    GENES.forEach(k => { const v = (g[k] || 0) * (sig[k] || 0); tot += v; if (!best || Math.abs(v) > Math.abs(best[1])) best = [k, v]; });
    score[a.sym] = tot / wsum; lead[a.sym] = best[0];
  });

  const o = [], held = Object.keys(c.holdings);
  if (c.state && (g.scalp || 0) > 0) {   // the scalp gene compares against the previous round, so remember this one's prices after scoring
    const px = {}; pool.forEach(a => { if (a.tradable) px[a.sym] = a.price; });
    c.state.genePx = px;
  }
  held.forEach(s => {
    const a = c.bySym[s];
    if (!a) return;
    const gain = a.price / c.holdings[s].avgCost - 1;
    if (p.stopLoss && gain <= -p.stopLoss) o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' hit its ' + pct_(p.stopLoss, true) + ' stop', urgent: true });
    else if (p.takeProfit && gain >= p.takeProfit) o.push({ sym: s, side: 'SELL', frac: 1, why: 'banked ' + pct_(gain) + ' on ' + s });
    else if (score[s] != null && score[s] < p.sellThreshold)
      o.push({ sym: s, side: 'SELL', frac: 1, why: s + ' conviction ' + score[s].toFixed(2) + ' — ' + GENE_LORE[lead[s]].word + ' turned against it' });
    else kept_(c, s, 'conviction ' + (score[s] == null ? 'n/a' : score[s].toFixed(2)) + ', ' + pct_(gain) + ' so far (sells below ' + p.sellThreshold + ')');
  });
  const slots = Math.max(0, Math.round(p.maxPositions) - held.length);
  const bias = a => {   // learned weather sense: size up or stand down depending on the market regime
    const rg = c.macro.regime && c.macro.regime[a.type], m = rg && (p.regimeBias || {})[a.type + ':' + rg.name];
    return m == null ? 1 : m;
  };
  pool.filter(a => !c.holdings[a.sym] && seen_(c, a.sym, score[a.sym] > p.buyThreshold && bias(a) > 0,
    'conviction ' + score[a.sym].toFixed(2) + ' led by ' + GENE_LORE[lead[a.sym]].word + ' (buys above ' + p.buyThreshold + ')' +
    (bias(a) !== 1 ? ', ' + (bias(a) > 0 ? 'sized ×' + bias(a) : 'stands down') + ' in ' + c.macro.regime[a.type].name + ' markets' : '')))
    .sort((x, y) => score[y.sym] - score[x.sym]).slice(0, slots)
    .forEach(a => o.push({ sym: a.sym, side: 'BUY', usd: c.equity * p.positionSize * bias(a),
      why: a.sym + ' conviction ' + score[a.sym].toFixed(2) + ', led by ' + GENE_LORE[lead[a.sym]].word +
        (bias(a) !== 1 ? ' (sized ×' + bias(a) + ' for ' + c.macro.regime[a.type].name + ')' : '') }));
  return o;
}

/* ---------- end of season ---------- */

function endSeason() {
  assertOwner_();
  const ui = SpreadsheetApp.getUi(), season = getSeason_();
  if (ui.alert('End Season ' + season + '?', 'Each pool is judged and breeds its own Challenger from its winners, ' +
    'and Season ' + (season + 1) + ' starts with fresh cash.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const r = endSeasonCore_();
  if (r.error) { ui.alert('Season not ended', r.error, ui.ButtonSet.OK); return; }
  ui.alert('🐉 Two Challengers rise', r.children.map(c => c.emoji + ' ' + c.title + ' [' + c.pool + ']').join('\n') +
    (r.fallen.length ? '\n\n⚰️ Fallen: ' + r.fallen.join(', ') : ''), ui.ButtonSet.OK);
}

// Shared by the sheet menu and the web app. Each independent pool breeds one child.
function endSeasonCore_() {
  const lock = LockService.getScriptLock();
  // Rounds can take 3+ minutes; wait for one to finish instead of bouncing the click (Nov 8, 2026).
  if (!lock.tryLock(240000)) return { error: 'A trading round is still running after 4 minutes. Try again shortly.' };
  try {
    const season = getSeason_();
    seedFounders_();
    const review = reviewSeason_(getCompetitionRoster_());
    if (review.stats.length < 3 || review.stats.every(s => s.trades === 0))
      return { error: 'Run some trading rounds before ending the season.' };
    // Idempotent: if an earlier attempt at this Reckoning was cut off after the births, reuse those Challengers
    // (and their records) instead of breeding a second set.
    const props = PropertiesService.getScriptProperties();
    let done = {}; try { done = JSON.parse(props.getProperty('RECKONING_DONE') || '{}'); } catch (e) { done = {}; }
    if (done.season !== season) done = { season, children: {}, recorded: false };
    let camp = null;   // the backtest lab's replay of the past year, built once for both pools' training camps
    const children = ['stock', 'crypto'].map(pool => {
      if (done.children[pool]) return done.children[pool];
      const eligible = breedingReview_(poolReview_(review, pool));
      if (eligible.stats.length < 2) throw new Error('The ' + pool + ' pool needs at least two competitors to breed.');
      if (!camp) camp = trainingCamp_();
      const child = birthChallenger_(eligible, season, pool, trainChallenger_(eligible, pool, camp));
      done.children[pool] = { id: child.id, name: child.name, title: child.title, house: child.house, emoji: child.emoji, lineage: child.lineage,
        strategy: child.strategy, lessons: child.lessons, dna: child.dna, pool };
      props.setProperty('RECKONING_DONE', JSON.stringify(done));
      return child;
    });
    const fallen = done.recorded ? (done.fallen || []) : recordSeason_(review, season, children.map(c => c.id));
    if (!done.recorded) { done.recorded = true; done.fallen = fallen; props.setProperty('RECKONING_DONE', JSON.stringify(done)); }
    const chronicle = maesterChronicle_(review, children, readConfig_());
    // The review tab is the one step Google has timed out on; retry it, and if it still fails, finish the
    // season anyway (the review is archived next) rather than leaving the Reckoning stuck halfway.
    let reviewWarning = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { writeReview_(review, children, fallen, chronicle, season); reviewWarning = ''; break; }
      catch (e) {
        reviewWarning = 'The Season ' + season + ' Review tab could not be written (' + e.message + '). The review is saved in the archive.';
        console.warn('writeReview_ attempt ' + attempt + ': ' + e.message);
        if (attempt < 3) { Utilities.sleep(5000 * attempt); try { SpreadsheetApp.flush(); } catch (e2) {} }
      }
    }
    archiveReview_(review, children, fallen, chronicle, season);
    PropertiesService.getScriptProperties().setProperty('SEASON', String(season + 1));
    startFreshSeason_();
    return { season, fallen, warning: reviewWarning || undefined, children: children.map(c => ({ title: c.title, lineage: c.lineage, strategy: c.strategy,
      lessons: c.lessons, emoji: c.emoji, pool: c.pool })) };
  } finally {
    lock.releaseLock();
  }
}

function scheduledEndSeason(e) {
  assertScheduledTrigger_(e, 'scheduledEndSeason');
  const clock = seasonClock_();
  if (!clock.ready) {
    const waiting = { at: new Date().toISOString(), waiting: true, started: clock.started, due: clock.due };
    PropertiesService.getScriptProperties().setProperty('LAST_AUTO_SEASON_CHECK', JSON.stringify(waiting));
    return waiting;
  }
  const result = endSeasonCore_();
  PropertiesService.getScriptProperties().setProperty('LAST_AUTO_SEASON', JSON.stringify({ at: new Date().toISOString(), result }));
  return result;
}

// Compact JSON of each season for the web app's yearbook.
function archiveReview_(review, children, fallen, chronicle, season) {
  const sh = getSheet_(SHEETS.ARCHIVE);
  if (sh.getLastRow() === 0) sh.appendRow(['Season', 'Ended', 'Review JSON']);
  const lite = s => ({ name: s.def.name, emoji: s.def.emoji, house: s.def.house, pool: s.def.pool, rank: s.rank, ret: s.ret, final: s.final,
    vsMarket: s.vsMarket, luck: s.luck ? s.luck.label : '', edge: s.edge, heel: s.heel });
  sh.appendRow([season, new Date(), JSON.stringify({ season, standings: review.stats.map(lite), ghosts: review.ghosts.map(lite),
    children: children.map(c => ({ title: c.title, emoji: c.emoji, lineage: c.lineage, strategy: c.strategy, lessons: c.lessons, pool: c.pool })),
    fallen, chronicle: chronicle || '' })]);
  sh.hideSheet();
}

function getSeason_() {
  return Number(PropertiesService.getScriptProperties().getProperty('SEASON') || 1);
}

// Judge every bot from the Trades, Holdings, Bots and EquityHistory sheets.
function reviewSeason_(roster) {
  const bots = loadBots_(), types = {};
  readUniverse_().forEach(u => types[u.sym] = u.type);
  const H = readHistory_(), luck = luckReport_(roster, H);
  const head = H.head, last = H.rows.length ? H.rows[H.rows.length - 1] : [];
  const trades = getSheet_(SHEETS.TRADES).getDataRange().getValues().slice(1);
  const holds = getSheet_(SHEETS.HOLD).getDataRange().getValues().slice(1);

  const all = roster.filter(d => bots[d.id]).map(d => {
    const b = bots[d.id], col = head.indexOf(d.name);
    const final = col > 0 && last[col] !== '' && last[col] != null ? +last[col] : b.cash;
    const mine = trades.filter(t => t[1] === d.name), sells = mine.filter(t => t[2] === 'SELL');
    const wins = sells.filter(t => +t[8] > 0).map(t => +t[8]), losses = sells.filter(t => +t[8] <= 0).map(t => -t[8]);
    const pnl = {};
    sells.forEach(t => pnl[t[3]] = (pnl[t[3]] || 0) + +t[8]);
    holds.filter(h => h[0] === d.id).forEach(h => pnl[h[1]] = (pnl[h[1]] || 0) + +h[8]);
    let crypto = 0, stock = 0;
    Object.keys(pnl).forEach(s => { if (types[s] === 'crypto') crypto += pnl[s]; else stock += pnl[s]; });
    const pos = Math.max(crypto, 0) + Math.max(stock, 0);
    const syms = Object.keys(pnl).sort((x, y) => pnl[y] - pnl[x]);
    const sumW = sum_(wins), sumL = sum_(losses);
    return {
      def: d, start: b.start, final, ret: final / b.start - 1, fees: b.fees, taxes: b.taxes,
      feeDrag: b.fees / b.start, taxDrag: b.taxes / b.start, trades: mine.length, sells: sells.length,
      winRate: sells.length ? wins.length / sells.length : null,
      profitFactor: sumL > 0 ? sumW / sumL : (sumW > 0 ? 99 : null),
      avgWin: wins.length ? sumW / wins.length : 0, avgLoss: losses.length ? sumL / losses.length : 0,
      bestAsset: syms.length && pnl[syms[0]] > 0 ? syms[0] : '', crypto, stock,
      cryptoShare: pos > 0 ? Math.max(crypto, 0) / pos : null, maxDD: b.maxDD || 0,
      luck: luck[d.name] || null, regimes: regimePerf_(d.name, H, d.pool)
    };
  });
  const stats = all.filter(s => !s.def.ghost), ghosts = all.filter(s => s.def.ghost);
  ['stock', 'crypto'].forEach(pool => {
    // A bot that never traded can't be crowned: it ranks below every bot that did, whatever its cash is worth.
    const market = ghosts.find(g => g.def.pool === pool), group = stats.filter(s => s.def.pool === pool)
      .sort((x, y) => (y.trades > 0) - (x.trades > 0) || y.final - x.final);
    group.forEach((s, i) => { s.vsMarket = market ? s.ret - market.ret : null; s.rank = i + 1; });
    const med = mediansFor_(group);
    group.forEach(s => { const e = edgeNotes_(s, med); s.edge = e.edge; s.heel = e.heel; });
  });
  stats.sort((a, b) => ['stock', 'crypto'].indexOf(a.def.pool) - ['stock', 'crypto'].indexOf(b.def.pool) || a.rank - b.rank);
  return { stats, ghosts, med: mediansFor_(stats) };
}

function mediansFor_(stats) {
  return {
    feeDrag: median_(stats.map(s => s.feeDrag)), maxDD: median_(stats.map(s => s.maxDD)),
    winRate: median_(stats.map(s => s.winRate)), trades: median_(stats.map(s => s.trades)),
    profitFactor: median_(stats.map(s => s.profitFactor).filter(x => x != null && x < 99)), ret: median_(stats.map(s => s.ret))
  };
}

function poolReview_(review, pool) {
  const stats = review.stats.filter(s => s.def.pool === pool), ghosts = review.ghosts.filter(s => s.def.pool === pool);
  return { stats, ghosts, med: mediansFor_(stats), pool };
}

// What set a bot apart from the field median — and what dragged it down.
function edgeNotes_(s, med) {
  const edge = [], heel = [], P = x => pct_(x, true);
  if (s.trades === 0) return { edge: [], heel: ['never took the field'] };
  if (s.vsMarket != null && s.vsMarket > 0) edge.push('beat the market ghost by ' + P(s.vsMarket));
  if (s.vsMarket != null && s.vsMarket < 0) heel.push('trailed the market ghost by ' + P(-s.vsMarket));
  if (s.luck && s.luck.verdict === 'Skill (likely)') edge.push('edge passed the luck test (' + s.luck.label + ')');
  if (s.luck && s.luck.verdict === 'Could be luck') heel.push('edge did not pass the luck test (' + s.luck.label + ')');
  const rk = Object.keys(s.regimes || {}).filter(k => s.regimes[k].n >= 24).sort((a, b) => s.regimes[b].avg - s.regimes[a].avg);
  if (rk.length && s.regimes[rk[0]].avg > 0) edge.push('thrived in ' + rk[0].replace(':', ' ') + ' markets');
  if (rk.length > 1 && s.regimes[rk[rk.length - 1]].avg < 0) heel.push('struggled in ' + rk[rk.length - 1].replace(':', ' ') + ' markets');
  if (med.ret != null && s.ret > med.ret) edge.push('beat the field median by ' + P(s.ret - med.ret));
  if (med.feeDrag != null && s.feeDrag < med.feeDrag * 0.6) edge.push('lean on fees (' + P(s.feeDrag) + ' vs field ' + P(med.feeDrag) + ')');
  if (med.feeDrag != null && s.feeDrag > med.feeDrag * 1.5) heel.push('fees bled ' + P(s.feeDrag) + ' of capital');
  if (s.profitFactor != null && med.profitFactor && s.profitFactor > med.profitFactor * 1.3)
    edge.push('profit factor ' + (s.profitFactor >= 99 ? '∞' : s.profitFactor.toFixed(2)) + ' vs field ' + med.profitFactor.toFixed(2));
  if (s.profitFactor != null && s.profitFactor < 1) heel.push('lost more on losers than it made on winners');
  if (s.avgLoss > 0 && s.avgWin / s.avgLoss >= 2) edge.push('let winners run (avg win ' + (s.avgWin / s.avgLoss).toFixed(1) + '× avg loss)');
  if (s.winRate != null && med.winRate != null && s.winRate > med.winRate + 0.1) edge.push('win rate ' + P(s.winRate) + ' vs ' + P(med.winRate));
  if (s.maxDD < med.maxDD * 0.7) edge.push('shallow drawdown (' + P(s.maxDD) + ' vs ' + P(med.maxDD) + ')');
  if (s.maxDD > Math.max(med.maxDD * 1.3, 0.1)) heel.push('deep drawdown of ' + P(s.maxDD));
  if (med.trades && s.trades < med.trades * 0.6) edge.push('patience (' + s.trades + ' trades vs ' + med.trades + ')');
  if (s.cryptoShare != null && s.cryptoShare >= 0.75) edge.push('crypto carried it (' + P(s.cryptoShare) + ' of profit)');
  if (s.cryptoShare != null && s.cryptoShare <= 0.25) edge.push('stocks carried it (' + P(1 - s.cryptoShare) + ' of profit)');
  if (s.bestAsset) edge.push('best weapon: ' + s.bestAsset);
  if (s.taxDrag > 0.02) heel.push('taxes took ' + P(s.taxDrag));
  if (s.sells < 5) heel.push('only ' + s.sells + ' closed trades — result may be luck');
  return { edge, heel };
}

/* ---------- breeding ---------- */

function provisionalPass_(s) {
  return s.vsMarket > 0 && s.luck && s.luck.verdict === 'Skill (likely)';
}

// A bot must actually trade to pass anything on: before v1.34 a bot that sat in cash all season could finish
// on top in a falling market, parent the next Challenger, and hand down its idleness. Bots with fewer than
// MIN_PARENT_TRADES fills rank below every active bot for breeding (they still keep their place in the standings).
const MIN_PARENT_TRADES = 4;
function activeEnough_(s) { return s.trades >= MIN_PARENT_TRADES; }

// Provisional challengers compete normally, but cannot parent or foster the next
// generation unless this complete season validates them first.
function breedingReview_(review) {
  const ok = review.stats.filter(s => !s.def.provisional || provisionalPass_(s));
  const stats = ok.filter(activeEnough_).concat(ok.filter(s => !activeEnough_(s)));   // stable: rank order kept within each group
  return Object.assign({}, review, { stats });
}

// Pure function: crossover of the top two, foster gene from third place, lessons from the champion's edge, then mutation.
function breed_(review, rng) {
  rng = rng || Math.random;
  const st = review.stats, c1 = st[0], c2 = st[1] || st[0], c3 = st[2], med = review.med;
  const d1 = fullDna_(c1.def.dna), d2 = fullDna_(c2.def.dna), lessons = [];
  const lucky = c1.sells < 5 || !c1.luck || c1.luck.verdict !== 'Skill (likely)';
  const amp = lucky ? 0.35 : 0.2;   // less proof of skill → more experimentation
  const alpha = clamp_(0.5 + (c1.ret - c2.ret) * 2, 0.5, 0.8);
  const genes = {}, params = {};
  GENES.forEach(k => genes[k] = clamp_(alpha * d1.genes[k] + (1 - alpha) * d2.genes[k] + (rng() - 0.5) * amp, 0, 1));
  PARAM_KEYS.forEach(k => params[k] = (alpha * d1.params[k] + (1 - alpha) * d2.params[k]) * (1 + (rng() - 0.5) * amp));
  params.universe = d1.params.universe === d2.params.universe || alpha >= 0.65 ? d1.params.universe : 'all';
  lessons.push(Math.round(alpha * 100) + '% of its blood from ' + c1.def.name + ', ' + Math.round((1 - alpha) * 100) + '% from ' + c2.def.name + '.');

  if (c3) {
    const d3 = fullDna_(c3.def.dna), fg = dominantGene_(d3);
    genes[fg] = clamp_(genes[fg] + 0.5 * d3.genes[fg], 0, 1);
    lessons.push('Fostered by ' + c3.def.name + ', who taught it ' + GENE_LORE[fg].word + '.');
  }
  if (c1.cryptoShare != null && c1.cryptoShare >= 0.75) {
    params.universe = 'crypto'; lessons.push('The champion made its fortune in crypto, so it fights only in crypto.');
  } else if (c1.cryptoShare != null && c1.cryptoShare <= 0.25) {
    params.universe = 'stock'; lessons.push('Stocks carried the champion, so it fights only in stocks.');
  }
  // Low fees only count as discipline when the champion still traded about as much as the field. Paying no
  // fees because it never traded used to raise every child's buy bar, generation after generation.
  if (med.feeDrag != null && c1.feeDrag < med.feeDrag && med.trades != null && c1.trades >= med.trades * 0.75) {
    params.buyThreshold += 0.05; lessons.push('The champion paid less in fees than most while trading as often, so it demands more conviction before trading.');
  } else if (!activeEnough_(c1)) {
    params.buyThreshold -= 0.05; lessons.push('The champion barely traded, so the child lowers its bar to make sure it takes the field.');
  }
  if (c1.maxDD > 0.2) {
    params.stopLoss = Math.min(params.stopLoss || 0.15, 0.1); lessons.push('The champion survived a ' + pct_(c1.maxDD, true) + ' drawdown; the child carries a 10% stop.');
  }
  if (c1.avgLoss > 0 && c1.avgWin / c1.avgLoss >= 2) {
    params.takeProfit = 0; lessons.push('Winners ran twice as far as losers, so it sets no profit cap.');
  }
  const dana = st.find(s => (s.def.baseId || s.def.id) === 'DANA');
  if (dana && st.filter(s => s.final < dana.final).length > st.length / 2) {
    genes.dca = clamp_(genes.dca + 0.25, 0, 1); lessons.push('Buy-and-hold beat most of the field, so the child keeps a steady accumulation streak.');
  }
  if (lucky) lessons.push('⚠️ The champion\'s edge is not yet proven to be skill (' + (c1.luck ? c1.luck.label : 'too few trades') + '), so the child mutated more freely.');
  else lessons.push('The champion\'s edge passed the luck test, so the child stays close to its blood.');

  // A human-configured champion can contribute one auditable wild-card lesson. Its full genome already enters
  // normal crossover; this preserves the most distinctive control exactly, but only after beating the market
  // and passing the same luck test used for every other bot.
  if (c1.def.human && c1.vsMarket > 0 && c1.luck && c1.luck.verdict === 'Skill (likely)') {
    const base = { buyThreshold: 0.3, sellThreshold: -0.2, positionSize: 0.25, maxPositions: 2, stopLoss: 0.12, takeProfit: 0 };
    const scale = { buyThreshold: 0.25, sellThreshold: 0.4, positionSize: 0.2, maxPositions: 4, stopLoss: 0.2, takeProfit: 0.35 };
    const trait = PARAM_KEYS.reduce((best, k) => Math.abs((d1.params[k] - base[k]) / scale[k]) > Math.abs((d1.params[best] - base[best]) / scale[best]) ? k : best, PARAM_KEYS[0]);
    params[trait] = d1.params[trait];
    params.wildcard = { source: c1.def.name, player: c1.def.player || '', trait, value: d1.params[trait] };
    lessons.push('🃏 Wild-card lesson from human champion ' + c1.def.name + ': preserve ' + trait + ' at ' + d1.params[trait] + ', the most distinctive part of the proven setup.');
  }

  // Weather sense: inherit the senior parent's, then learn from where the champion thrived or suffered.
  params.regimeBias = Object.assign({}, d1.params.regimeBias || {});
  const reg = Object.keys(c1.regimes || {}).filter(k => c1.regimes[k].n >= 24);
  reg.forEach(k => {
    const avg = c1.regimes[k].avg, [t, name] = k.split(':');
    if (avg < 0) { params.regimeBias[k] = 0.5; lessons.push('The champion lost ground in ' + name + ' ' + t + ' markets, so the child trades half-size there.'); }
  });
  if (reg.length) {
    const best = reg.sort((a, b) => c1.regimes[b].avg - c1.regimes[a].avg)[0], [t, name] = best.split(':');
    if (c1.regimes[best].avg > 0) { params.regimeBias[best] = 1.25; lessons.push('The champion was strongest in ' + name + ' ' + t + ' markets, so the child presses harder there.'); }
  }

  normalizeDna_({ genes, params }, d1);
  return { dna: { genes, params }, lessons, alpha };
}

// Keep a genome inside the ranges a bot can trade with (shared by breeding and the evolution camp).
function normalizeDna_(dna, fallback) {
  const g = dna.genes, params = dna.params;
  GENES.forEach(k => g[k] = clamp_(+g[k] || 0, 0, 1));
  params.buyThreshold = clamp_(params.buyThreshold, 0.05, 0.6);
  params.sellThreshold = clamp_(params.sellThreshold, -0.9, -0.05);
  params.positionSize = clamp_(params.positionSize, 0.05, 0.4);
  params.maxPositions = Math.round(clamp_(params.maxPositions, 1, 4));
  params.stopLoss = params.stopLoss < 0.03 ? 0 : clamp_(params.stopLoss, 0.03, 0.3);
  params.takeProfit = params.takeProfit < 0.03 ? 0 : clamp_(params.takeProfit, 0.03, 0.5);
  if (!GENES.some(k => g[k] > 0.05)) g[fallback ? dominantGene_(fallback) : 'dca'] = 1;   // never born empty
  return dna;
}

function birthChallenger_(review, season, pool, trained) {
  const rows = lineageRows_(), byId = {};
  rows.forEach(r => byId[r[0]] = r);
  const st = review.stats, p1 = st[0].def, p2 = (st[1] || st[0]).def, foster = st[2] ? st[2].def : null;
  const bred = trained || breed_(review), g = bred.dna.genes, dom = dominantGene_(bred.dna), lore = GENE_LORE[dom];
  bred.dna.params.universe = pool;

  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const ord = Math.min(rows.filter(r => String(r[1]).split(' ')[0] === first).length, 9);
  const name = first + ' ' + lore.epithet + (ord ? ' ' + ROMAN[ord] : '');
  const house = p1.house, gen = Math.max(p1.generation || 0, p2.generation || 0) + 1;
  const title = name + ', ' + ORDINALS[ord] + ' of Their Name, of House ' + house;

  const blood = [p1.house, p2.house].filter((h, i, a) => h && a.indexOf(h) === i);
  const walk = (id, depth) => {
    const r = byId[id];
    if (!r || depth > 4) return;
    if (blood.indexOf(r[3]) < 0) blood.push(r[3]);
    walk(r[7], depth + 1); walk(r[8], depth + 1);
  };
  walk(p1.baseId || p1.id, 0); walk(p2.baseId || p2.id, 0);

  const lineage = 'Born of ' + p1.emoji + ' ' + p1.name + ' (House ' + p1.house + ') and ' + p2.emoji + ' ' + p2.name +
    ' (House ' + p2.house + ')' + (foster ? ', fostered by ' + foster.emoji + ' ' + foster.name : '') +
    '. Generation ' + gen + '. Blood of the Houses ' + blood.join(', ') + '.';
  const top = GENES.filter(k => g[k] > 0.05).sort((x, y) => g[y] - g[x]).slice(0, 3);
  const wsum = GENES.reduce((s, k) => s + g[k], 0);
  const strategy = 'Evolved: ' + top.map(k => Math.round(100 * g[k] / wsum) + '% ' + GENE_LORE[k].word).join(', ') +
    ' · ' + pool + ' pool';
  const bio = 'Forged in the ' + pool + ' pool at the end of Season ' + season + ' from the champions\' edge. ' + st[0].def.name + ' won by: ' +
    (st[0].edge.slice(0, 2).join('; ') || 'grit') + '.';
  const lines = {
    buy: [pick_(p1.lines.buy), pick_(p2.lines.buy), 'For House ' + house + '!'],
    sell: [pick_(p1.lines.sell), 'A retreat is not a defeat.', lore.epithet.replace(/^the /, 'The ') + ' does not linger.']
  };
  const id = 'CH' + (rows.filter(r => !FOUNDERS[r[0]]).length + 1);

  getSheet_(SHEETS.LINEAGE).appendRow([id, name, title, house, lore.emoji, gen, season + 1, p1.baseId || p1.id, p2.baseId || p2.id, foster ? (foster.baseId || foster.id) : '',
    lineage, strategy, bio, bred.lessons.join(' '), JSON.stringify(bred.dna), JSON.stringify(lines), 'Alive', 0, '']);
  ROSTER_ = null; ENTRANTS_ = null;
  return { id, name, title, house, emoji: lore.emoji, lineage, strategy, lessons: bred.lessons, dna: bred.dna, pool };
}

// Update records; provisional challengers either graduate after a proven trial or
// are archived. Ordinary challengers in the bottom half (except the newborn) fall.
function recordSeason_(review, season, newbornIds) {
  const sh = getSheet_(SHEETS.LINEAGE), data = sh.getDataRange().getValues(), fallen = [];
  const poolSizes = {};
  ['stock', 'crypto'].forEach(p => poolSizes[p] = review.stats.filter(s => s.def.pool === p).length);
  const grouped = {};
  review.stats.forEach(s => { const id = s.def.baseId || s.def.id; (grouped[id] = grouped[id] || []).push(s); });
  Object.keys(grouped).forEach(id => {
    const entries = grouped[id], s = entries[0];
    const i = data.findIndex((r, k) => k > 0 && r[0] === id);
    if (i < 1) return;
    data[i][17] = (+data[i][17] || 0) + 1;
    const best = Math.min.apply(null, entries.map(x => x.rank));
    data[i][18] = data[i][18] === '' ? best : Math.min(+data[i][18], best);
    entries.filter(x => x.rank === 1).forEach(x => data[i][13] = (data[i][13] ? data[i][13] + ' ' : '') +
      '👑 Crowned ' + x.def.pool + ' champion in Season ' + season + '.');
    if (s.def.provisional) {
      const passed = entries.filter(provisionalPass_).map(x => x.def.pool);
      const tooEarly = entries.some(x => !x.luck || x.luck.verdict === 'Too early');
      if (passed.length) {
        data[i][16] = 'Alive';
        try {
          const dna = JSON.parse(data[i][14]);
          dna.params.universe = passed.length === 2 ? 'all' : passed[0];
          data[i][14] = JSON.stringify(dna);
        } catch (e) { /* keep original genome if malformed */ }
        data[i][13] = (data[i][13] ? data[i][13] + ' ' : '') + '✅ Qualified for Tier 2 in Season ' + season +
          ' in the ' + passed.join(' and ') + ' pool' + (passed.length > 1 ? 's' : '') + ' by beating the benchmark and earning Skill (likely).';
      } else if (tooEarly) {
        data[i][16] = 'Provisional — trial continues';
        data[i][13] = (data[i][13] ? data[i][13] + ' ' : '') + 'Trial continued after Season ' + season + ' because fewer than ' + LUCK_MIN_DAYS + ' eligible sessions were available.';
      } else {
        data[i][16] = 'Archived after Season ' + season + ' trial';
        data[i][13] = (data[i][13] ? data[i][13] + ' ' : '') + 'Did not qualify from the provisional trial.';
        fallen.push((s.def.baseName || s.def.name) + ' (provisional trial)');
      }
      return;
    }
    const lostEveryPool = entries.every(x => x.rank > poolSizes[x.def.pool] / 2);
    if (s.def.challenger && newbornIds.indexOf(id) < 0 && lostEveryPool) {
      data[i][16] = 'Fallen in Season ' + season; fallen.push(s.def.baseName || s.def.name);
    }
  });
  sh.getRange(1, 1, data.length, data[0].length).setValues(data);
  ROSTER_ = null; ENTRANTS_ = null;
  return fallen;
}

function writeReview_(review, children, fallen, chronicle, season) {
  const ss = SpreadsheetApp.getActive(), name = 'Season ' + season + ' Review';
  // Reuse the tab if it exists (an earlier, cut-off attempt may have made it): clearing is far lighter than
  // delete + insert, which timed out twice on Nov 8, 2026.
  let sh = ss.getSheetByName(name);
  if (sh) { sh.clear(); sh.getCharts().forEach(c => sh.removeChart(c)); sh.setFrozenRows(0); }
  else sh = ss.insertSheet(name, 1);
  SpreadsheetApp.flush();
  const st = review.stats, champs = ['stock', 'crypto'].map(p => st.find(s => s.def.pool === p && s.rank === 1));
  const row = (r, text, style) => { const c = sh.getRange(r, 1).setValue(text); if (style) style(c); };
  row(1, '🏁 SEASON ' + season + ' — THE RECKONING', c => c.setFontSize(18).setFontWeight('bold'));
  row(2, champs.filter(Boolean).map(champ => (champ.def.pool === 'stock' ? '📈' : '₿') + ' ' + champ.def.name + ' wins ' + champ.def.pool + ' at ' + pct_(champ.ret)).join('  •  '), c => c.setFontWeight('bold'));
  const gl = review.ghosts.map(g => g.def.name + ' ' + pct_(g.ret) + ' (beaten by ' + st.filter(s => s.def.pool === g.def.pool && s.final > g.final).length + ')').join('; ');
  if (gl) row(3, '👻 Pool benchmarks: ' + gl + '.');

  const head = ['#', 'Bot', 'House', 'Strategy', 'Final Value', 'Return', 'Fee Drag', 'Tax Drag', 'Trades', 'Win Rate',
    'Profit Factor', 'Crypto P/L', 'Stock P/L', 'Max Drawdown', 'vs Pool Benchmark', 'Skill or luck?', 'What gave it the edge', 'What held it back'];
  sh.getRange(5, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  const rows = st.map(s => [s.rank, s.def.emoji + ' ' + s.def.name, s.def.house, s.def.strategy, s.final, s.ret, s.feeDrag, s.taxDrag,
    s.trades, s.winRate == null ? '' : s.winRate, s.profitFactor == null ? '' : Math.min(s.profitFactor, 99),
    s.crypto, s.stock, s.maxDD, s.vsMarket == null ? '' : s.vsMarket, s.luck ? s.luck.label : '', s.edge.join('; '), s.heel.join('; ')]);
  sh.getRange(6, 1, rows.length, head.length).setValues(rows);
  sh.getRange(6, 5, rows.length, 1).setNumberFormat('$#,##0.00');
  sh.getRange(6, 12, rows.length, 2).setNumberFormat('$#,##0.00;-$#,##0.00');
  [6, 7, 8, 10, 14, 15].forEach(c => sh.getRange(6, c, rows.length, 1).setNumberFormat('0.0%'));
  sh.getRange(6, 11, rows.length, 1).setNumberFormat('0.00');

  let r = 6 + rows.length + 2;
  row(r++, '🐉 TWO CHALLENGERS RISE', c => c.setFontSize(14).setFontWeight('bold'));
  children.forEach(child => {
    row(r++, (child.pool === 'stock' ? '📈 ' : '₿ ') + child.emoji + ' ' + child.title, c => c.setFontWeight('bold'));
    row(r++, child.lineage); row(r++, child.strategy);
    child.lessons.forEach(l => row(r++, '• ' + l));
    row(r++, 'Genome: ' + JSON.stringify(child.dna), c => c.setFontColor('#666666'));
  });
  if (fallen.length) row(r++, '⚰️ Fallen this season: ' + fallen.join(', '));
  if (chronicle) { r++; row(r++, '📜 The Maester\'s Chronicle', c => c.setFontWeight('bold')); row(r++, chronicle, c => c.setWrap(true)); }
  sh.setColumnWidth(1, 60); sh.setColumnWidth(2, 190); sh.setColumnWidth(4, 260); sh.setColumnWidth(16, 200); sh.setColumnWidth(17, 380); sh.setColumnWidth(18, 300);
  sh.setFrozenRows(5);
}

// Optional: an LLM writes the season up as a chronicle (needs GEMINI_API_KEY or ANTHROPIC_API_KEY).
function maesterChronicle_(review, children, cfg) {
  if (!llmProvider_()) return null;
  try {
    const facts = { standings: review.stats.map(s => ({ bot: s.def.name, house: s.def.house, return: pct_(s.ret), luckTest: s.luck ? s.luck.label : 'n/a', edge: s.edge, weaknesses: s.heel })),
      benchmarks: review.ghosts.map(g => ({ name: g.def.name, return: pct_(g.ret) })),
      challengers: children.map(child => ({ pool: child.pool, title: child.title, lineage: child.lineage, lessons: child.lessons })) };
    const prompt = 'Write a 150-word chronicle of this trading-bot season in the voice of a medieval court historian. ' +
      'Original prose only. Name each pool champion, why they won, who fell short and why, and end by announcing both challengers ' +
      'and their lineages. Use only these facts:\n' + JSON.stringify(facts);
    return llm_(prompt, cfg, { maxTokens: 500, quick: true });
  } catch (e) { return null; }
}

/* ---------- utils ---------- */

function dominantGene_(dna) { return GENES.reduce((b, k) => (dna.genes[k] || 0) > (dna.genes[b] || 0) ? k : b, GENES[0]); }
function clamp_(x, lo, hi) { lo = lo == null ? -1 : lo; hi = hi == null ? 1 : hi; return Math.max(lo, Math.min(hi, x)); }
function sum_(a) { return a.reduce((s, x) => s + x, 0); }
function median_(a) {
  const v = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
}
