/**
 * GAME OF TRADES — menu, arena setup, triggers, reset.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('👑 Game of Trades')
    .addItem('1. Set up arena', 'setupArena')
    .addItem('2. Run a round now', 'runRound')
    .addItem('3. Start 15-minute auto-trading', 'startAutoTrading')
    .addItem('🕰️ Warm up: replay the last 30 days', 'warmUp')
    .addItem('📚 Run the study hall now', 'runStudyHallNow')
    .addItem('🧪 Run the backtest lab now', 'runLabNow')
    .addSeparator()
    .addItem('🏁 End season & evolve a Challenger', 'endSeason')
    .addItem('📜 Open the Academy web app', 'openWebApp')
    .addItem('🚪 Open / close player enrollment', 'togglePlayerEnrollment')
    .addItem('🖼️ Review player avatars', 'reviewPlayerAvatars')
    .addItem('🔑 Set API keys', 'setApiKeys')
    .addSeparator()
    .addItem('Stop auto-trading', 'stopAutoTrading')
    .addItem('Reset competition', 'resetCompetition')
    .addToUi();
}

const API_KEYS = [
  ['GEMINI_API_KEY', 'Gemini: news scoring + season chronicle (free key at aistudio.google.com)'],
  ['CMC_API_KEY', 'CoinMarketCap: crypto quotes + CMC Fear & Greed'],
  ['COINGECKO_API_KEY', 'CoinGecko demo key: higher rate limits'],
  ['ANTHROPIC_API_KEY', 'Claude: fallback if no Gemini key']
];

// Prompts for each key and stores it in Script Properties. Blank keeps the current value, "-" removes it.
function setApiKeys() {
  assertOwner_();
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const changed = [];
  for (const [name, what] of API_KEYS) {
    const cur = props.getProperty(name);
    const status = cur ? 'Current: ends in …' + cur.slice(-4) : 'Not set';
    const res = ui.prompt('🔑 ' + name, what + '\n' + status + '\n\nPaste a key, leave blank to keep, or type - to remove.', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) break;
    const v = res.getResponseText().trim();
    if (!v) continue;
    if (v === '-') { props.deleteProperty(name); changed.push(name + ' removed'); }
    else { props.setProperty(name, v); changed.push(name + ' saved'); }
  }
  CacheService.getScriptCache().remove('llm_news');
  let msg = changed.length ? changed.join('\n') : 'No changes.';
  if (changed.some(c => /^(GEMINI|ANTHROPIC)/.test(c)) && llmProvider_()) {
    const cfg = {};
    DEFAULT_CONFIG.forEach(([k, v]) => { cfg[k] = v; });
    const reply = llm_('Reply with exactly: OK', cfg, { maxTokens: 20 });
    msg += '\n\nLLM test (' + llmProvider_() + '): ' + (reply ? '✅ ' + reply.slice(0, 40) : '❌ failed, check the key (details in Executions log)');
  }
  ui.alert('API keys', msg, ui.ButtonSet.OK);
}

function setupArena() {
  assertOwner_();
  const ss = SpreadsheetApp.getActive();
  [SHEETS.BOARD, SHEETS.RESEARCH, SHEETS.TRADES, SHEETS.HOLD, SHEETS.BOTS, SHEETS.HISTORY, SHEETS.CONFIG, SHEETS.UNIVERSE, SHEETS.LINEAGE, SHEETS.ARCHIVE, SHEETS.GF]
    .forEach(getSheet_);
  ensurePlayerBotSheet_();

  // Config: add any missing keys, keep the user's edits
  const cfgSh = ss.getSheetByName(SHEETS.CONFIG);
  if (cfgSh.getLastRow() === 0) cfgSh.appendRow(['Key', 'Value', 'Notes']);
  const have = new Set(cfgSh.getDataRange().getValues().map(r => r[0]));
  DEFAULT_CONFIG.forEach(r => { if (!have.has(r[0])) cfgSh.appendRow(r); });

  ensureUniverseEntries_();

  seedFounders_();
  header_(SHEETS.HOLD, HOLD_HEADERS);
  header_(SHEETS.TRADES, ['Time', 'Bot', 'Side', 'Symbol', 'Qty', 'Fill Price', 'Gross', 'Fees', 'Realized P/L', 'Tax', 'Cash After', 'Reason', 'Says']);
  header_(SHEETS.HISTORY, historyHeader_());
  header_(SHEETS.BOTS, BOT_HEADERS);

  // Enroll any bot not yet in the Bots sheet
  const botSh = ss.getSheetByName(SHEETS.BOTS);
  const enrolled = new Set(botSh.getDataRange().getValues().map(r => r[0]));
  const start = readConfig_().STARTING_CASH;
  getCompetitionRoster_().forEach(d => { if (!enrolled.has(d.id)) botSh.appendRow(freshBotRow_(d, start)); });

  buildBoard_();
  ss.getSheetByName(SHEETS.GF).hideSheet();
  ss.getSheetByName(SHEETS.ARCHIVE).hideSheet();
  ss.setActiveSheet(ss.getSheetByName(SHEETS.BOARD));
  ss.toast('Arena ready. Use 👑 Game of Trades → Run a round now.', 'Game of Trades', 6);
}

function freshBotRow_(d, start) {
  return [d.id, d.emoji + ' ' + d.name, d.strategy, d.bio, start, start, 0, 0, 0, 0, 0, 0, start, 0, 'Ready to rumble.', '{}'];
}

// One-time live migration from shared mixed-market wallets to isolated pool
// sleeves. Preserve the old Season 3 board as an exhibition yearbook entry,
// then restart Season 3's official clock and accounts on equal footing.
function ensurePoolLeagueV1_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('POOL_LEAGUE_VERSION') === '1') return;
  const ss = SpreadsheetApp.getActive(), botSh = getSheet_(SHEETS.BOTS);
  const oldIds = botSh.getLastRow() > 1 ? botSh.getRange(2, 1, botSh.getLastRow() - 1, 1).getValues().flat().filter(Boolean) : [];
  if (oldIds.length && oldIds.every(id => /__(STOCK|CRYPTO)$/.test(String(id)))) {
    props.setProperty('POOL_LEAGUE_VERSION', '1');
    return;
  }

  const board = getSheet_(SHEETS.BOARD), old = board.getRange(5, 1, Math.min(BOARD_ROWS, Math.max(1, board.getLastRow() - 4)), 16).getValues().filter(r => r[1]);
  if (old.length) {
    const standings = old.filter(r => r[0] !== '👻').map(r => {
      const label = String(r[1] || ''), name = label.replace(/^\S+\s+/, '');
      return { emoji: label.slice(0, label.indexOf(' ')), name, house: '', ret: r[4], final: r[3], vsMarket: r[14],
        luck: r[15] || '', edge: [], heel: [] };
    });
    const arch = getSheet_(SHEETS.ARCHIVE);
    if (arch.getLastRow() === 0) arch.appendRow(['Season', 'Ended', 'Review JSON']);
    arch.appendRow([getSeason_(), new Date(), JSON.stringify({ season: getSeason_(), exhibition: true,
      title: 'Pre-division exhibition snapshot', standings, ghosts: [], children: [], fallen: [],
      chronicle: 'The original Season 3 shared-wallet arena was preserved here when the Academy separated Stocks and Crypto into fair, independent pools.' })]);
    arch.hideSheet();
  }

  [SHEETS.HOLD, SHEETS.TRADES, SHEETS.HISTORY, SHEETS.BOTS, SHEETS.TELEMETRY].forEach(name => {
    const sh = getSheet_(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
  });
  header_(SHEETS.HOLD, HOLD_HEADERS);
  header_(SHEETS.TRADES, ['Time', 'Bot', 'Side', 'Symbol', 'Qty', 'Fill Price', 'Gross', 'Fees', 'Realized P/L', 'Tax', 'Cash After', 'Reason', 'Says']);
  header_(SHEETS.BOTS, BOT_HEADERS);
  const hist = getSheet_(SHEETS.HISTORY);
  hist.getRange(1, 1, 1, hist.getMaxColumns()).clearContent();
  header_(SHEETS.HISTORY, historyHeader_());
  const start = readConfig_().STARTING_CASH, entrants = getCompetitionRoster_();
  if (entrants.length) botSh.getRange(2, 1, entrants.length, BOT_HEADERS.length).setValues(entrants.map(d => freshBotRow_(d, start)));
  board.getRange(5, 1, BOARD_ROWS, Math.max(BOARD_COLS, 17)).clearContent();
  board.getCharts().forEach(c => board.removeChart(c));
  buildBoard_();
  try { endTwinsForSeason_(); } catch (e) { console.error('twins', e); }
  ['WARMUP', 'BANTER', 'TELE_PREV', 'LAST_STATE'].forEach(k => props.deleteProperty(k));
  props.setProperty('POOL_LEAGUE_VERSION', '1');
  resetSeasonEndTrigger_();
}

function historyHeader_() {
  return ['Time'].concat(getCompetitionRoster_().map(d => d.name), ['Stock Regime', 'Crypto Regime']);
}

// Safely brings founders added by an update into an existing season. They start
// with the standard paper balance and receive a new history column; existing
// accounts, holdings and results are untouched.
function ensureRosterEnrollment_() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(SHEETS.BOTS);
  if (!sh || sh.getLastRow() === 0) return [];
  const cfgSh = ss.getSheetByName(SHEETS.CONFIG);
  if (cfgSh) {
    const haveCfg = new Set(cfgSh.getDataRange().getValues().map(r => r[0]));
    DEFAULT_CONFIG.forEach(r => { if (!haveCfg.has(r[0])) cfgSh.appendRow(r); });
  }
  ensureUniverseEntries_();
  ensureSeasonEndTrigger_();
  ensureInsightsTrigger_();
  seedFounders_();
  ensureProvisionalSeason3_();
  ROSTER_ = null; ENTRANTS_ = null;
  ensurePoolLeagueV1_();
  const roster = getCompetitionRoster_(), have = new Set(sh.getDataRange().getValues().slice(1).map(r => r[0]).filter(Boolean));
  const start = readConfig_().STARTING_CASH, added = roster.filter(d => !have.has(d.id));
  added.forEach(d => sh.appendRow(freshBotRow_(d, start)));
  if (added.length) addPlayerToHistory_();
  return added;
}

// Updates existing arenas without overwriting any commissioner edits. New default
// assets are appended by symbol; a user can still remove or change them afterward.
function ensureUniverseEntries_() {
  const sh = getSheet_(SHEETS.UNIVERSE);
  const head = ['Symbol', 'Type (stock/crypto)', 'GOOGLEFINANCE ticker', 'Yahoo symbol', 'CoinGecko id', 'News search', 'Status', 'Requested by', 'Last check'];
  if (sh.getLastRow() === 0) sh.appendRow(head);
  else sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  const have = new Set(sh.getDataRange().getValues().slice(1).map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean));
  DEFAULT_UNIVERSE.forEach(r => { if (!have.has(r[0])) sh.appendRow(r); });
  // Yahoo disambiguates some crypto tickers with numeric suffixes. Fill only
  // blank aliases so commissioner-supplied mappings remain authoritative.
  const aliases = { TAO: 'TAO22974-USD', WLFI: 'WLFI33251-USD' };
  sh.getDataRange().getValues().slice(1).forEach((r, i) => {
    const sym = String(r[0] || '').trim().toUpperCase();
    if (aliases[sym] && !r[3]) sh.getRange(i + 2, 4).setValue(aliases[sym]);
  });
}

function header_(name, cols) {
  const sh = getSheet_(name);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function buildBoard_() {
  const sh = getSheet_(SHEETS.BOARD);
  sh.getRange('A1').setValue('🏆 GAME OF TRADES — SEASON ' + getSeason_() + ' LEADERBOARD').setFontSize(18).setFontWeight('bold');
  sh.getRange('A2').setValue('Run a round to start the competition.').setFontColor('#666666');
  sh.getRange('A3').setValue('Ranked by what each bot would walk away with if it cashed out now — after slippage, fees and taxes.')
    .setFontColor('#666666').setFontStyle('italic');
  const head = ['#', 'Bot', 'Strategy', 'Value (after fees & tax)', 'Return', 'Market Value', 'Cash', 'Holdings Value',
    'Fees Paid So Far', 'Taxes Paid So Far', 'Trades', 'Win Rate', 'Max Drawdown', 'Last Words', 'vs Pool Benchmark', 'Skill or luck?', 'Pool',
    'Est. Slippage If Sold Now', 'Est. Sell Fees If Sold Now', 'Est. Tax If Sold Now'];
  sh.getRange(4, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  const n = BOARD_ROWS;
  [4, 6, 7, 8, 9, 10, 18, 19, 20].forEach(c => sh.getRange(5, c, n, 1).setNumberFormat('$#,##0.00'));
  sh.getRange(5, 5, n, 1).setNumberFormat('+0.00%;-0.00%');
  sh.getRange(5, 12, n, 2).setNumberFormat('0.0%');
  sh.getRange(5, 15, n, 1).setNumberFormat('+0.00%;-0.00%');
  sh.setColumnWidth(16, 220);
  sh.getRange(5, 4, n, 1).setFontWeight('bold');
  sh.setFrozenRows(4);
  sh.setColumnWidth(2, 170); sh.setColumnWidth(3, 230); sh.setColumnWidth(14, 380);

  const rules = [];
  const ret = sh.getRange(5, 5, n, 1);
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#0a7d32').setRanges([ret]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor('#c62828').setRanges([ret]).build());
  sh.setConditionalFormatRules(rules);

  if (!sh.getCharts().length) {
    const hist = getSheet_(SHEETS.HISTORY);
    sh.insertChart(sh.newChart().asLineChart()
      .addRange(hist.getRange(1, 1, 5000, getCompetitionRoster_().length + 1))
      .setNumHeaders(1)
      .setOption('title', 'Bot value after fees & taxes')
      .setOption('legend', { position: 'right' })
      .setOption('width', 1000).setOption('height', 420)
      .setPosition(5 + n + 2, 1, 0, 0)
      .build());
  }
}

function startAutoTrading() {
  assertOwner_();
  stopAutoTrading();
  ScriptApp.newTrigger('scheduledRound').timeBased().everyMinutes(15).create();
  startStudyHall_();
  ensureSeasonEndTrigger_(true);
  ensureInsightsTrigger_(true);
  SpreadsheetApp.getActive().toast('Bots trade every 15 minutes. Study hall runs daily at 5 PM, and each season ends automatically after ' + seasonClock_().days + ' days.', 'Game of Trades', 8);
}

function stopAutoTrading() {
  assertOwner_();
  ScriptApp.getProjectTriggers().filter(t => ['runRound', 'scheduledRound', 'studyHall', 'scheduledStudyHall', 'scheduledEndSeason', 'scheduledInsights'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
}

// The insights job (news scores, trash talk) runs every 5 minutes whenever auto-trading is on.
function ensureInsightsTrigger_(force) {
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.some(t => t.getHandlerFunction() === 'scheduledInsights')) return;
  if (!force && !triggers.some(t => t.getHandlerFunction() === 'scheduledRound')) return;
  ScriptApp.newTrigger('scheduledInsights').timeBased().everyMinutes(5).create();
}

function ensureSeasonEndTrigger_(force) {
  const triggers = ScriptApp.getProjectTriggers();
  const props = PropertiesService.getScriptProperties();
  const seasonTriggers = triggers.filter(t => t.getHandlerFunction() === 'scheduledEndSeason');
  // v1 used atHour(0).everyDays(n), which can first fire at the next midnight.
  // Migrate it once to an hourly watcher; scheduledEndSeason itself enforces the
  // full elapsed duration, so even an early or duplicated event cannot end a season.
  if (seasonTriggers.length && props.getProperty('SEASON_TRIGGER_VERSION') === '2') return;
  if (!force && !triggers.some(t => t.getHandlerFunction() === 'scheduledRound')) return;
  seasonTriggers.forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scheduledEndSeason').timeBased().everyHours(1).create();
  props.setProperty('SEASON_TRIGGER_VERSION', '2');
  if (!isFinite(new Date(props.getProperty('SEASON_STARTED')).getTime()))
    props.setProperty('SEASON_STARTED', new Date().toISOString());
}

function resetSeasonEndTrigger_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'scheduledEndSeason').forEach(t => ScriptApp.deleteTrigger(t));
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SEASON_STARTED', new Date().toISOString());
  props.deleteProperty('SEASON_TRIGGER_VERSION');
  ensureSeasonEndTrigger_(true);
}

// A season is measured as elapsed 24-hour days from its recorded start, not as
// calendar midnights. This is the single clock used by the trigger and web app.
function seasonClock_() {
  const props = PropertiesService.getScriptProperties();
  const days = Math.max(1, Math.min(30, Math.round(Number(readConfig_().SEASON_DAYS) || 10)));
  let startedMs = new Date(props.getProperty('SEASON_STARTED')).getTime();
  if (!isFinite(startedMs)) {
    startedMs = Date.now();
    props.setProperty('SEASON_STARTED', new Date(startedMs).toISOString());
  }
  const dueMs = startedMs + days * 864e5;
  return { days, started: new Date(startedMs).toISOString(), due: new Date(dueMs).toISOString(),
    remainingMs: Math.max(0, dueMs - Date.now()), ready: Date.now() >= dueMs };
}

// Existing installations used public-named hourly/daily handlers. On their next legitimate trigger event they
// replace themselves with validated handlers, so upgrading does not require a manual trigger reset.
function migrateLegacyRoundTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.filter(t => t.getHandlerFunction() === 'runRound').forEach(t => ScriptApp.deleteTrigger(t));
  if (!triggers.some(t => t.getHandlerFunction() === 'scheduledRound'))
    ScriptApp.newTrigger('scheduledRound').timeBased().everyMinutes(15).create();
  startStudyHall_();
}

function migrateLegacyStudyHallTrigger_() {
  startStudyHall_();
}

function resetCompetition() {
  assertOwner_();
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset this season?', 'Every bot goes back to starting cash and all trades, holdings and history are wiped. ' +
    'Lineage and past season reviews are kept.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  startFreshSeason_();
}

// Fresh cash for the current roster (founders + living challengers), new history columns, new chart.
function startFreshSeason_() {
  ROSTER_ = null;
  seedFounders_();   // enrols any founder added since the last season (e.g. Greta Grid)
  ENTRANTS_ = null;
  const roster = getCompetitionRoster_();
  [SHEETS.HOLD, SHEETS.TRADES, SHEETS.HISTORY, SHEETS.BOTS].forEach(name => {
    const sh = getSheet_(name);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
  });
  const hist = getSheet_(SHEETS.HISTORY);
  hist.getRange(1, 1, 1, hist.getMaxColumns()).clearContent();
  header_(SHEETS.HISTORY, historyHeader_());
  const start = readConfig_().STARTING_CASH;
  getSheet_(SHEETS.BOTS).getRange(2, 1, roster.length, BOT_HEADERS.length).setValues(roster.map(d => freshBotRow_(d, start)));
  const board = getSheet_(SHEETS.BOARD);
  board.getRange(5, 1, BOARD_ROWS, BOARD_COLS).clearContent();
  board.getCharts().forEach(c => board.removeChart(c));
  buildBoard_();
  CacheService.getScriptCache().removeAll(['llm_news']);
  ['WARMUP', 'BANTER'].forEach(k => PropertiesService.getScriptProperties().deleteProperty(k));
  try { endTwinsForSeason_(); } catch (e) { console.error('twins', e); }
  resetSeasonEndTrigger_();
  SpreadsheetApp.getActive().toast('Season ' + getSeason_() + ' begins. ' + roster.length + ' independent portfolios enter the two pools.', 'Game of Trades', 6);
}
