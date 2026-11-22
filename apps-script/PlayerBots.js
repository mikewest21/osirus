/**
 * GAME OF TRADES — human player enrollment and configurable bots.
 *
 * Google requires every visitor to sign in before the web app opens. Each Google
 * account may create one active bot; Apps Script supplies a privacy-preserving
 * temporary user key, so the game never needs the player's email address.
 */

const PLAYER_BOT_HEADERS = ['ID', 'Player', 'Name', 'Emoji', 'Archetype', 'Strategy', 'Bio', 'House',
  'Genome', 'Lines', 'Status', 'Joined', 'Owner Token Hash', 'Avatar Style', 'Avatar Data', 'Avatar Status', 'Google User Key Hash'];
const PLAYER_AVATAR_STYLES = ['classic', 'rocket', 'owl', 'quant', 'whale', 'knight'];

const PLAYER_BOT_TEMPLATES = {
  momentum: { name: 'Momentum rider', emoji: '🚀', summary: 'Follows established uptrends and leaves when momentum fades.',
    genes: { momentum: 1, factor: 0.2 }, defaults: { signal: 0.3, exit: 0.2, size: 0.25, positions: 3, stop: 0.12, profit: 0, market: 'all' } },
  dip: { name: 'Dip buyer', emoji: '🧶', summary: 'Looks for oversold assets that may rebound toward their average.',
    genes: { reversion: 1, factor: 0.1 }, defaults: { signal: 0.3, exit: 0.2, size: 0.2, positions: 3, stop: 0.15, profit: 0.1, market: 'stock' } },
  contrarian: { name: 'Fear contrarian', emoji: '🦉', summary: 'Buys when fear is high and trims as the crowd becomes greedy.',
    genes: { fear: 1, reversion: 0.25 }, defaults: { signal: 0.25, exit: 0.35, size: 0.25, positions: 2, stop: 0.14, profit: 0.16, market: 'all' } },
  news: { name: 'News trader', emoji: '📰', summary: 'Uses the tone and volume of recent headlines as its main signal.',
    genes: { news: 1, momentum: 0.2 }, defaults: { signal: 0.3, exit: 0.2, size: 0.2, positions: 3, stop: 0.12, profit: 0.15, market: 'all' } },
  breakout: { name: 'Breakout hunter', emoji: '⚡', summary: 'Waits for price and volume to break above a recent ceiling.',
    genes: { breakout: 1, volume: 0.35 }, defaults: { signal: 0.35, exit: 0.2, size: 0.25, positions: 3, stop: 0.1, profit: 0.2, market: 'all' } },
  volume: { name: 'Volume tracker', emoji: '🐋', summary: 'Looks for unusually heavy trading that may reveal big-money moves.',
    genes: { volume: 1, momentum: 0.3 }, defaults: { signal: 0.35, exit: 0.2, size: 0.2, positions: 3, stop: 0.13, profit: 0.18, market: 'crypto' } },
  factor: { name: 'Quant analyst', emoji: '🧮', summary: 'Combines trend, relative strength and news into one ranked score.',
    genes: { factor: 1, momentum: 0.35, news: 0.2 }, defaults: { signal: 0.25, exit: 0.2, size: 0.25, positions: 3, stop: 0.12, profit: 0, market: 'all' } },
  steady: { name: 'Steady accumulator', emoji: '💎', summary: 'Favours repeatable accumulation signals over frequent trading.',
    genes: { dca: 1, factor: 0.2 }, defaults: { signal: 0.15, exit: 0.55, size: 0.15, positions: 2, stop: 0.2, profit: 0, market: 'all' } }
};

function playerBotTemplatesForWeb_() {
  return Object.keys(PLAYER_BOT_TEMPLATES).map(id => {
    const t = PLAYER_BOT_TEMPLATES[id];
    return { id, name: t.name, emoji: t.emoji, summary: t.summary, defaults: t.defaults };
  });
}

function universeAssetsForWeb_() {
  const sh = getSheet_(SHEETS.UNIVERSE);
  return sh.getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
    sym: String(r[0]).trim().toUpperCase(), type: String(r[1]).trim().toLowerCase(), status: r[6] || 'Ready'
  }));
}

// Adds an unknown player request to a bounded research queue. It is deliberately
// excluded from readUniverse_ until a later round proves that usable history exists.
function requestPlayerAsset_(rawSymbol, rawType, requester) {
  const sym = String(rawSymbol || '').trim().toUpperCase();
  if (!sym) return null;
  if (!/^[A-Z0-9.\-^=]{1,15}$/.test(sym)) throw new Error('Asset symbols may use 1–15 letters, numbers, dots or hyphens.');
  const type = ['stock', 'crypto'].indexOf(rawType) >= 0 ? rawType : '';
  const sh = getSheet_(SHEETS.UNIVERSE), rows = sh.getDataRange().getValues().slice(1);
  const existing = rows.find(r => String(r[0] || '').trim().toUpperCase() === sym);
  if (existing) return { sym, type: String(existing[1]).toLowerCase(), status: existing[6] || 'Ready' };
  if (!type) throw new Error('Choose stock or crypto for a new asset request.');
  if (rows.filter(r => r[0]).length >= 40) throw new Error('The research universe is full. Ask the commissioner to remove an unused asset.');
  sh.appendRow([sym, type, type === 'stock' ? sym : '', type === 'stock' ? sym : '', '', sym + (type === 'crypto' ? ' crypto' : ' stock'),
    'Loading', requester.slice(0, 12), '']);
  return { sym, type, status: 'Loading' };
}

// One queued symbol per round keeps free data APIs healthy. Failed lookups wait
// six hours before retrying; successful symbols become available to all bots.
function processPendingAssets_() {
  const sh = getSheet_(SHEETS.UNIVERSE), rows = sh.getDataRange().getValues();
  const now = new Date();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i], status = String(r[6] || '');
    if (status !== 'Loading' && status !== 'Waiting') continue;
    const last = r[8] instanceof Date ? r[8] : null;
    if (status === 'Waiting' && last && now - last < 6 * 3600 * 1000) continue;
    const sym = String(r[0]).trim().toUpperCase(), type = String(r[1]).toLowerCase();
    let history = null, note = '';
    try {
      if (type === 'crypto') {
        let id = String(r[4] || '');
        if (!id) {
          const found = cgFetch_('/search?query=' + encodeURIComponent(sym));
          const matches = ((found && found.coins) || []).filter(c => String(c.symbol || '').toUpperCase() === sym)
            .sort((a, b) => (a.market_cap_rank || 999999) - (b.market_cap_rank || 999999));
          if (matches.length) { id = matches[0].id; sh.getRange(i + 1, 5).setValue(id); }
        }
        if (id) history = coinGeckoHistory_(id);
        note = id ? 'CoinGecko: ' + id : 'No exact CoinGecko symbol match yet';
      } else if (type === 'stock') {
        history = yahooHistory_(String(r[3] || sym));
        note = 'Yahoo: ' + String(r[3] || sym);
      }
    } catch (e) { note = e.message; }
    const ready = history && history.bars && history.bars.length >= 30;
    sh.getRange(i + 1, 7, 1, 3).setValues([[ready ? 'Ready' : 'Waiting', r[7] || '', now]]);
    sh.getRange(i + 1, 6).setNote((ready ? 'Ready with ' + history.bars.length + ' daily bars. ' : 'Still loading. ') + note);
    return { sym, ready: !!ready };
  }
  return null;
}

function playerBotRows_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.PLAYERS);
  return sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues().slice(1).filter(r => r[0]) : [];
}

function ensurePlayerBotSheet_() {
  const sh = getSheet_(SHEETS.PLAYERS);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, PLAYER_BOT_HEADERS.length).setValues([PLAYER_BOT_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else {
    sh.getRange(1, 1, 1, PLAYER_BOT_HEADERS.length).setValues([PLAYER_BOT_HEADERS]).setFontWeight('bold');
  }
  try { sh.hideSheet(); } catch (e) { /* already hidden or only visible sheet */ }
  return sh;
}

function getPlayerBots_() {
  return playerBotRows_().filter(r => r[10] === 'Active').map(r => ({
    id: r[0], player: r[1], name: r[2], emoji: r[3], archetype: r[4], strategy: r[5], bio: r[6], house: r[7],
    dna: JSON.parse(r[8]), lines: JSON.parse(r[9]), generation: 0, human: true, avatarStyle: r[13] || 'classic',
    avatarData: r[15] === 'Approved' ? r[14] : '', avatarStatus: r[15] || 'Built-in'
  }));
}

function togglePlayerEnrollment() {
  assertOwner_();
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties(), open = playerEnrollmentOpen_();
  const action = open ? 'close' : 'open';
  const res = ui.alert((open ? 'Close' : 'Open') + ' player enrollment?',
    open ? 'Signed-in Google users will still be able to view the arena, but no new player bots can join.'
      : 'Any signed-in Google user may create one bot while space remains.', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  if (open) props.setProperty('PLAYER_ENROLLMENT_CLOSED', 'true');
  else props.deleteProperty('PLAYER_ENROLLMENT_CLOSED');
  props.deleteProperty('PLAYER_JOIN_CODE_HASH');
  ui.alert('Player enrollment is now ' + action + '.');
}

function playerEnrollmentOpen_() {
  return PropertiesService.getScriptProperties().getProperty('PLAYER_ENROLLMENT_CLOSED') !== 'true';
}

function hashPlayerSecret_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function cleanPlayerText_(value, label, min, max) {
  const s = String(value == null ? '' : value).replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) throw new Error(label + ' must be ' + min + '–' + max + ' characters.');
  return s;
}

function boundedPlayerNumber_(value, label, min, max, integer) {
  const n = Number(value);
  if (!isFinite(n) || n < min || n > max) throw new Error(label + ' must be between ' + min + ' and ' + max + '.');
  return integer ? Math.round(n) : n;
}

function createPlayerBot_(request) {
  request = request || {};
  if (!playerEnrollmentOpen_()) throw new Error('Player enrollment is currently closed by the commissioner.');
  const googleUserKey = Session.getTemporaryActiveUserKey();
  if (!googleUserKey) throw new Error('Sign in with a Google account before joining the arena.');
  const googleUserKeyHash = hashPlayerSecret_(googleUserKey);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Another player is joining. Please try again in a moment.');
  try {
    const botsSheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.BOTS);
    if (!botsSheet || botsSheet.getLastRow() === 0) throw new Error('The commissioner must run “Set up arena” before players can join.');
    if (playerBotRows_().some(r => r[10] === 'Active' && r[16] === googleUserKeyHash)) {
      throw new Error('This Google account already has a bot in the arena.');
    }
    const liveCount = getCompetitionRoster_().filter(d => !d.ghost).length;
    if (liveCount >= BOARD_ROWS - 4) throw new Error('The arena is full for this season.');

    const player = cleanPlayerText_(request.player, 'Player name', 2, 32);
    const name = cleanPlayerText_(request.name, 'Bot name', 2, 32);
    if (getRoster_().some(d => d.name.toLowerCase() === name.toLowerCase())) throw new Error('A bot with that name is already in the arena.');
    const archetype = String(request.archetype || '').toLowerCase(), template = PLAYER_BOT_TEMPLATES[archetype];
    if (!template) throw new Error('Choose one of the available bot types.');
    let market = ['all', 'stock', 'crypto'].indexOf(request.market) >= 0 ? request.market : template.defaults.market;
    const signal = boundedPlayerNumber_(request.signal, 'Signal strength', 0.1, 0.8, false);
    const exit = boundedPlayerNumber_(request.exit, 'Exit sensitivity', 0.05, 0.6, false);
    const size = boundedPlayerNumber_(request.size, 'Position size', 0.05, 0.4, false);
    const positions = boundedPlayerNumber_(request.positions, 'Maximum positions', 1, 6, true);
    const stop = boundedPlayerNumber_(request.stop, 'Stop loss', 0, 0.3, false);
    const profit = boundedPlayerNumber_(request.profit, 'Take profit', 0, 0.5, false);
    const id = 'P_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
    const ownerToken = Utilities.getUuid() + Utilities.getUuid();
    const house = 'Open Arena';
    const dna = dna_(template.genes, { buyThreshold: signal, sellThreshold: -exit, positionSize: size,
      maxPositions: positions, stopLoss: stop, takeProfit: profit, universe: market });
    const lines = { buy: ['My setup found a trade. I’m in.', 'Signal confirmed. Let the match begin.'],
      sell: ['My exit rule fired. Protect the account.', 'Trade closed. Back to the data.'] };
    const avatarStyle = PLAYER_AVATAR_STYLES.indexOf(request.avatarStyle) >= 0 ? request.avatarStyle : 'classic';
    const avatarData = validatePlayerAvatar_(request.avatarData || '');
    const selected = requestPlayerAsset_(request.asset, request.assetType, googleUserKeyHash);
    if (selected) market = selected.type;
    dna.params.universe = market;
    dna.params.symbols = selected ? [selected.sym] : [];
    const scope = selected ? selected.sym + (selected.status === 'Ready' ? ' only' : ' · loading research')
      : (market === 'all' ? 'stocks + crypto' : market + ' only');
    const strategy = template.name + ' · ' + scope;
    const bio = name + ' was configured by ' + player + ' to use ' + template.name.toLowerCase() + ' rules' +
      (selected ? ' on ' + selected.sym + '.' : '.');
    const row = [id, player, name, template.emoji, archetype, strategy, bio, house, JSON.stringify(dna), JSON.stringify(lines),
      'Active', new Date(), hashPlayerSecret_(ownerToken), avatarStyle, avatarData, avatarData ? 'Pending' : 'Built-in', googleUserKeyHash];
    ensurePlayerBotSheet_().appendRow(row);
    ROSTER_ = null; ENTRANTS_ = null;
    const entrants = getCompetitionRoster_().filter(d => d.baseId === id), start = readConfig_().STARTING_CASH;
    entrants.forEach(def => botsSheet.appendRow(freshBotRow_(def, start)));
    addPlayerToHistory_(name);
    return { id, name, player, emoji: template.emoji, strategy, ownerToken, avatarStatus: avatarData ? 'Pending' : 'Built-in' };
  } finally {
    lock.releaseLock();
  }
}

function validatePlayerAvatar_(data) {
  if (!data) return '';
  const m = String(data).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Avatar must be a PNG, JPEG or WebP image.');
  if (m[2].length > 44000) throw new Error('Avatar is too large after resizing. Choose a smaller image.');
  let bytes;
  try { bytes = Utilities.base64Decode(m[2]); } catch (e) { throw new Error('Avatar image data is invalid.'); }
  if (!bytes.length || bytes.length > 33000) throw new Error('Avatar must be no more than 32 KB after resizing.');
  return data;
}

function updatePlayerAvatar_(request) {
  request = request || {};
  const rows = playerBotRows_(), i = rows.findIndex(r => r[0] === request.id);
  if (i < 0 || !request.ownerToken || hashPlayerSecret_(request.ownerToken) !== rows[i][12]) throw new Error('This browser does not own that player bot.');
  const googleUserKey = Session.getTemporaryActiveUserKey();
  if (!googleUserKey || (rows[i][16] && hashPlayerSecret_(googleUserKey) !== rows[i][16])) throw new Error('Sign in with the Google account that created this bot.');
  const style = PLAYER_AVATAR_STYLES.indexOf(request.avatarStyle) >= 0 ? request.avatarStyle : 'classic';
  const changingImage = Object.prototype.hasOwnProperty.call(request, 'avatarData');
  const data = changingImage ? validatePlayerAvatar_(request.avatarData || '') : rows[i][14];
  const status = changingImage ? (data ? 'Pending' : 'Built-in') : rows[i][15];
  const sh = ensurePlayerBotSheet_(), row = i + 2;
  sh.getRange(row, 14, 1, 3).setValues([[style, data, status]]);
  ROSTER_ = null; ENTRANTS_ = null;
  return { id: request.id, avatarStatus: status };
}

function reviewPlayerAvatars() {
  assertOwner_();
  const pending = playerBotRows_().filter(r => r[15] === 'Pending');
  if (!pending.length) { SpreadsheetApp.getUi().alert('No player avatars are waiting for review.'); return; }
  const items = pending.map(r => ({ id: r[0], player: r[1], name: r[2], data: r[14] }));
  const safe = JSON.stringify(items).replace(/</g, '\\u003c');
  const html = '<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:14px system-ui;padding:16px;background:#0d1830;color:#eef}img{width:180px;height:180px;object-fit:cover;border-radius:18px;background:#223}button{margin:8px 8px 0 0;padding:9px 14px}small{color:#abc}</style>' +
    '<div id="app"></div><script>const q=' + safe + ',a=document.getElementById("app");function show(){if(!q.length){a.innerHTML="<h3>All reviewed.</h3>";return}const x=q[0];a.innerHTML=`<h3>${esc(x.name)}</h3><p>Uploaded by ${esc(x.player)}</p><img src="${x.data}" alt="Pending avatar"><p><small>Approve only images suitable for a general audience and owned by the player.</small></p><button onclick="go(true)">Approve</button><button onclick="go(false)">Reject</button>`}function esc(s){return String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}function go(ok){google.script.run.withSuccessHandler(()=>{q.shift();show()}).withFailureHandler(e=>alert(e.message)).decidePlayerAvatar(q[0].id,ok)}show();</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(430), 'Review player avatars');
}

function decidePlayerAvatar(id, approve) {
  assertOwner_();
  const rows = playerBotRows_(), i = rows.findIndex(r => r[0] === id);
  if (i < 0) throw new Error('Player bot not found.');
  const sh = ensurePlayerBotSheet_(), row = i + 2;
  sh.getRange(row, 15, 1, 2).setValues([[approve ? rows[i][14] : '', approve ? 'Approved' : 'Rejected']]);
  ROSTER_ = null; ENTRANTS_ = null;
}

function addPlayerToHistory_(name) {
  const sh = getSheet_(SHEETS.HISTORY);
  if (sh.getLastRow() === 0) { header_(SHEETS.HISTORY, historyHeader_()); return; }
  const data = sh.getDataRange().getValues(), oldHead = data[0], nextHead = historyHeader_();
  if (oldHead.length === nextHead.length && oldHead.every((x, i) => x === nextHead[i])) return;
  const rows = data.slice(1).map(r => nextHead.map(h => { const i = oldHead.indexOf(h); return i >= 0 ? r[i] : ''; }));
  sh.clearContents();
  sh.getRange(1, 1, 1, nextHead.length).setValues([nextHead]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, nextHead.length).setValues(rows);
  const board = getSheet_(SHEETS.BOARD);
  board.getCharts().forEach(c => board.removeChart(c));
  buildBoard_();
}
