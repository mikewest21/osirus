/**
 * GAME OF TRADES — the science department.
 *
 * Luck detector: each sleeve's daily return minus its own pool benchmark (SPY for stocks, BTC for crypto).
 * A sign-flip permutation test asks: if the bot had no real edge, how often would random ups and downs
 * produce an average this good? Holm's correction then accounts for testing many bots at once
 * (with 8+ bots, one will look brilliant by chance). Daily, not hourly, returns reduce autocorrelation.
 *
 * Regime performance: each bot's average return per round while stocks/crypto were in each weather regime.
 */

const LUCK_MIN_DAYS = 10;
const LUCK_PERMUTATIONS = 2000;

function readHistory_() {
  const v = getSheet_(SHEETS.HISTORY).getDataRange().getValues();
  return { head: v[0] || [], rows: v.slice(1).filter(r => r[0] instanceof Date) };
}

// Last row of each trading day, preceded by the season's first row as the baseline.
function dailyRows_(rows, pool) {
  if (!rows.length) return [];
  const byDay = {};
  rows.forEach(r => {
    if (pool === 'stock' && Number(Utilities.formatDate(r[0], TZ, 'u')) > 5) return;
    byDay[Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd')] = r;
  });
  return [rows[0]].concat(Object.keys(byDay).sort().map(k => byDay[k]));
}

function luckReport_(roster, hist) {
  hist = hist || readHistory_();
  const out = {};
  const tests = [];
  roster.filter(d => !d.ghost).forEach(d => {
    const benchmark = d.pool === 'stock' ? 'Ghost of SPY — Stocks' : 'Ghost of BTC — Crypto';
    const mCol = hist.head.indexOf(benchmark);
    const col = hist.head.indexOf(d.name);
    if (col < 0 || mCol < 0) return;
    const days = dailyRows_(hist.rows, d.pool);
    const ex = [];
    for (let i = 1; i < days.length; i++) {
      const b0 = +days[i - 1][col], b1 = +days[i][col], g0 = +days[i - 1][mCol], g1 = +days[i][mCol];
      if (b0 > 0 && b1 > 0 && g0 > 0 && g1 > 0) ex.push((b1 / b0 - 1) - (g1 / g0 - 1));
    }
    const r = { days: ex.length, excess: ex.length ? mean_(ex) : 0, p: null, padj: null };
    if (ex.length >= LUCK_MIN_DAYS) { r.p = signFlipP_(ex); tests.push(r); }
    out[d.name] = r;
  });
  // Holm–Bonferroni adjustment
  tests.sort((a, b) => a.p - b.p);
  let running = 0;
  tests.forEach((t, i) => { running = Math.max(running, Math.min(1, t.p * (tests.length - i))); t.padj = running; });
  Object.keys(out).forEach(n => {
    const r = out[n];
    if (r.p == null) { r.verdict = 'Too early'; r.label = 'Too early (' + r.days + '/' + LUCK_MIN_DAYS + ' days)'; return; }
    r.verdict = r.excess <= 0 ? 'Trailing the market' : r.padj < 0.05 ? 'Skill (likely)' : r.padj < 0.2 ? 'Promising' : 'Could be luck';
    r.label = r.verdict + ' (p' + (r.padj < 0.01 ? '<0.01' : '=' + r.padj.toFixed(2)) + ')';
  });
  return out;
}

// One-sided p-value that the mean of x is > 0, by randomly flipping signs.
function signFlipP_(x) {
  const obs = mean_(x);
  let hits = 0;
  for (let k = 0; k < LUCK_PERMUTATIONS; k++) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += Math.random() < 0.5 ? x[i] : -x[i];
    if (s / x.length >= obs) hits++;
  }
  return (hits + 1) / (LUCK_PERMUTATIONS + 1);
}

// { 'crypto:Choppy': {avg, n}, 'stock:Trending up': {...} } — per-round return by the regime in force at the start of the round.
function regimePerf_(name, hist, pool) {
  const col = hist.head.indexOf(name), sCol = hist.head.indexOf('Stock Regime'), cCol = hist.head.indexOf('Crypto Regime');
  const acc = {};
  if (col < 0 || sCol < 0) return acc;
  for (let i = 1; i < hist.rows.length; i++) {
    const a = +hist.rows[i - 1][col], b = +hist.rows[i][col];
    if (!(a > 0 && b > 0)) continue;
    const r = b / a - 1;
    [['stock', hist.rows[i - 1][sCol]], ['crypto', hist.rows[i - 1][cCol]]].filter(x => !pool || x[0] === pool).forEach(([t, reg]) => {
      if (!reg || reg === 'Unknown') return;
      const k = t + ':' + reg, e = acc[k] || (acc[k] = { sum: 0, n: 0 });
      e.sum += r; e.n++;
    });
  }
  Object.keys(acc).forEach(k => acc[k].avg = acc[k].sum / acc[k].n);
  return acc;
}
