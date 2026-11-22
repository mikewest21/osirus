/**
 * GAME OF TRADES — the evolution camp: many generations of natural selection on the past year, between live seasons.
 *
 * Live seasons run on market time, so they can only test one new Challenger per pool every SEASON_DAYS. The camp
 * runs a genetic algorithm on the same replay the backtest lab uses (real daily prices, fees, slippage, taxes):
 *   - each pool keeps a population of CAMP_POP genomes that persists across seasons
 *   - fitness = return per unit of risk (daily mean / standard deviation) on the OLDER part of the replay only;
 *     genomes that barely trade are ranked below every active one
 *   - each generation keeps the CAMP_ELITE fittest, breeds the rest by tournament selection, crossover and mutation,
 *     and lets CAMP_IMMIGRANTS genomes from the live roster in, so the camp keeps tracking real competitors
 *   - the most recent LAB_TEST_SHARE of the replay is never used for selection: at the Reckoning, the camp's elites
 *     and the live-bred siblings are judged on it, and a camp genome is only born if it also holds up there
 *
 * It runs in the 5-minute insights job after the backtest lab (which is idle most of the week), capped at
 * CAMP_MINUTES_PER_DAY of runtime because Apps Script limits total trigger time per day.
 * Population state lives in the hidden _camp sheet (one JSON row per pool).
 */

const CAMP_POP = 12, CAMP_ELITE = 4, CAMP_IMMIGRANTS = 2, CAMP_TOURNAMENT = 3, CAMP_MUTATE = 0.3, CAMP_SHEET = '_camp';

function campLoad_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CAMP_SHEET), out = {};
  if (!sh || sh.getLastRow() < 1) return out;
  sh.getDataRange().getValues().forEach(r => { if (r[0]) try { out[r[0]] = JSON.parse(r[1]); } catch (e) { /* start that pool over */ } });
  return out;
}

function campSave_(state) {
  let sh = SpreadsheetApp.getActive().getSheetByName(CAMP_SHEET);
  if (!sh) { sh = SpreadsheetApp.getActive().insertSheet(CAMP_SHEET); sh.hideSheet(); }
  const rows = Object.keys(state).map(k => [k, JSON.stringify(state[k])]);
  sh.clearContents();
  if (rows.length) sh.getRange(1, 1, rows.length, 2).setValues(rows);
}

// Live genomes a pool can draw immigrants from: every founder's DNA plus each living Challenger's.
function campGenePool_(pool) {
  return getRoster_().filter(d => d.dna && !d.ghost).map(d => ({ dna: JSON.parse(JSON.stringify(fullDna_(d.dna))), from: d.name }))
    .map(x => { x.dna.params.universe = pool; return x; });
}

function campSharpe_(r) { const sd = r.length > 1 ? stdev_(r) : 0; return sd > 0 ? mean_(r) / sd : 0; }

// Replay one genome; fitness uses only the training days, the exam days are recorded but never selected on.
function campScore_(dna, pool, tl, cfg) {
  const def = { id: 'CAMP_' + pool, name: 'Camp ' + pool, emoji: '🥚', pool, challenger: true, dna, lines: { buy: ['…'], sell: ['…'] } };
  const run = labRun_(def, tl, cfg, paramsFor_(def)), v = run.vals;
  const r = v.slice(1).map((x, i) => v[i] > 0 ? x / v[i] - 1 : 0), split = campSplit_(tl);
  const tr = r.slice(0, split - 1), ex = r.slice(split - 1), grow = a => a.reduce((m, x) => m * (1 + x), 1) - 1;
  const active = run.trades >= MIN_PARENT_TRADES;
  return { fit: active ? campSharpe_(tr) : -1 + run.trades * 0.01, exam: campSharpe_(ex), trainRet: grow(tr), examRet: grow(ex), trades: run.trades,
    ret: v[v.length - 1] / v[0] - 1, sharpe: campSharpe_(r) };
}

function campSplit_(tl) { return Math.max(20, Math.floor(tl.days.length * (1 - LAB_TEST_SHARE))); }

function campRand_(a, b) { return a + Math.random() * (b - a); }

function campChild_(p1, p2, pool) {
  const a = campRand_(0.3, 0.7), d1 = fullDna_(p1), d2 = fullDna_(p2), genes = {}, params = {};
  GENES.forEach(k => {
    genes[k] = a * d1.genes[k] + (1 - a) * d2.genes[k];
    if (Math.random() < CAMP_MUTATE) genes[k] += campRand_(-0.2, 0.2);
  });
  PARAM_KEYS.forEach(k => {
    params[k] = a * (+d1.params[k] || 0) + (1 - a) * (+d2.params[k] || 0);
    if (Math.random() < CAMP_MUTATE) params[k] *= 1 + campRand_(-0.2, 0.2);
  });
  params.universe = pool;
  params.regimeBias = Object.assign({}, d1.params.regimeBias || {});
  return normalizeDna_({ genes, params }, d1);
}

function campNextGen_(P, pool) {
  const ranked = P.pop.slice().sort((x, y) => y.s.fit - x.s.fit);
  const pick = () => { let best = null; for (let i = 0; i < CAMP_TOURNAMENT; i++) { const c = ranked[Math.floor(Math.random() * ranked.length)]; if (!best || c.s.fit > best.s.fit) best = c; } return best; };
  const next = ranked.slice(0, CAMP_ELITE);
  while (next.length < CAMP_POP - CAMP_IMMIGRANTS) next.push({ dna: campChild_(pick().dna, pick().dna, pool), s: null, born: P.gen + 1 });
  const gp = campGenePool_(pool);
  for (let i = 0; i < CAMP_IMMIGRANTS && gp.length; i++) {
    const m = gp[Math.floor(Math.random() * gp.length)];
    next.push({ dna: m.dna, s: null, born: P.gen + 1, from: m.from });
  }
  P.best = ranked[0] ? { fit: ranked[0].s.fit, exam: ranked[0].s.exam, trainRet: ranked[0].s.trainRet, gen: P.gen } : P.best;
  P.pop = next; P.gen++;
}

// One slice of camp work until `deadline`. Returns a short status for the insights log.
function campStep_(deadline) {
  const props = PropertiesService.getScriptProperties(), cfg = readConfig_();
  const capMs = Math.max(0, +cfg.CAMP_MINUTES_PER_DAY || 0) * 60e3;
  if (!capMs) return 'off (CAMP_MINUTES_PER_DAY is 0)';
  const day = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  let use = {}; try { use = JSON.parse(props.getProperty('CAMP_USAGE') || '{}'); } catch (e) { use = {}; }
  if (use.day !== day) use = { day, ms: 0 };
  if (use.ms >= capMs) return 'daily budget used (' + Math.round(use.ms / 60e3) + ' min)';
  const t0 = Date.now(), stop = Math.min(deadline - 20e3, t0 + capMs - use.ms);
  if (stop - t0 < 45e3) return 'waiting for a longer slot';
  const tl = labTimeline_(cfg);
  if (tl.days.length < 60) return 'not enough history yet (' + tl.days.length + ' days)';
  const state = campLoad_();
  let evals = 0, gens = 0;
  const pools = ['stock', 'crypto'];
  if (state._turn === 'crypto') pools.reverse();
  try {
    for (const pool of pools) {
      const P = state[pool] || (state[pool] = { gen: 0, pop: campGenePool_(pool).sort(() => Math.random() - 0.5).slice(0, CAMP_POP).map(m => ({ dna: m.dna, s: null, born: 0, from: m.from })), best: null });
      while (Date.now() < stop) {
        const todo = P.pop.find(x => !x.s);
        if (!todo) { campNextGen_(P, pool); gens++; continue; }
        try { todo.s = campScore_(todo.dna, pool, tl, cfg); } catch (e) { todo.s = { fit: -9, exam: 0, trades: 0, error: String(e.message).slice(0, 80) }; }
        evals++;
        if (!P.pop.some(x => !x.s) && Date.now() < stop) { campNextGen_(P, pool); gens++; break; }   // finished a generation: give the other pool a turn
      }
      state._turn = pool === 'stock' ? 'crypto' : 'stock';
      if (Date.now() >= stop) break;
    }
  } finally {
    state.updated = new Date().toISOString();
    campSave_(state);
    use.ms += Date.now() - t0;
    props.setProperty('CAMP_USAGE', JSON.stringify(use));
  }
  return evals + ' genome(s) replayed, ' + gens + ' generation(s) bred; stock gen ' + ((state.stock || {}).gen || 0) + ', crypto gen ' + ((state.crypto || {}).gen || 0) +
    ', ' + Math.round(use.ms / 60e3) + ' of ' + Math.round(capMs / 60e3) + ' min used today';
}

// At the Reckoning: the camp's elites for a pool (already scored), best first.
function campElites_(pool) {
  const P = campLoad_()[pool];
  if (!P || !P.pop) return { gen: 0, elites: [] };
  return { gen: P.gen, elites: P.pop.filter(x => x.s && x.s.trades >= MIN_PARENT_TRADES).sort((x, y) => y.s.fit - x.s.fit).slice(0, CAMP_ELITE) };
}

// After the Reckoning, the live-bred siblings join the camp so the champions' blood keeps flowing into it.
function campAdopt_(pool, dnas) {
  const state = campLoad_(), P = state[pool];
  if (!P || !P.pop) return;
  P.pop.sort((x, y) => (y.s ? y.s.fit : -99) - (x.s ? x.s.fit : -99));
  P.pop.splice(Math.max(CAMP_ELITE, P.pop.length - dnas.length));   // the newcomers replace the weakest, never an elite
  dnas.forEach(d => P.pop.push({ dna: d, s: null, born: P.gen, from: 'live Reckoning' }));
  campSave_(state);
}

// For the Academy's Study hall.
function campForWeb_() {
  const st = campLoad_(), out = {};
  ['stock', 'crypto'].forEach(p => { const P = st[p]; if (P) out[p] = { gen: P.gen, best: P.best || null, size: (P.pop || []).length }; });
  return Object.keys(out).length ? Object.assign(out, { updated: st.updated || null }) : null;
}
