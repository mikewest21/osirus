/**
 * GAME OF TRADES — version and changelog.
 * Bump APP_VERSION and add a CHANGELOG entry (newest first) with every push. Open Academy pages check
 * getVersion() every few minutes and show an "Update ready" banner listing what changed, with a refresh button.
 */

const APP_VERSION = '1.38.1';

const CHANGELOG = [
  { v: '1.38.1', date: '2026-11-02', notes: [
    'Whale Watcher Wes stops flip-flopping: he bought every green, high-volume day even when the price sat under its 20-day average, then sold it the next round for being under that average. Now he needs the price 1% above the average to buy and 1% below it to sell, like Momo Max.'] },
  { v: '1.38.0', date: '2026-10-26', notes: [
    'New Arena: a live race. Every bot runs along its pool’s track to its return, and the dashed line is the market to beat. The race replays each time a round comes in.',
    'A ticker of the latest buys, sells and position changes scrolls across the top. Four quick tiles show the leaders, the biggest mover, the hottest asset and a countdown to the next bell or the Reckoning.',
    'Strategy spotlight: one bot’s case at a time, changing every 12 seconds (hover to pause, 🎲 for a random one) instead of a long list.',
    'Fresh colours every day: Neon, Sunset, Toxic, Royal or Ocean. Tap 🎲 by the season badge to switch.',
    'Less to read: page intros are one line (tap for more), “What’s new” is one line, and the sidebar keeps 6 everyday tabs with the rest under More.'] },
  { v: '1.37.0', date: '2026-10-26', notes: [
    'Training camp: at each Reckoning, every pool breeds 4 sibling Challengers. Each one replays the past 240 days of real prices, and the sibling with the best return for its risk (and that actually trades) is the one born.',
    'The backtest lab then tunes one of its settings before it enters, only if the change also wins on the most recent 80 days it never trained on.',
    'Each Challenger’s lessons record its camp result: its replay return, its siblings’ results and any setting it was tuned on.'] },
  { v: '1.36.0', date: '2026-10-26', notes: [
    'The backtest lab: every bot replays the past 240 days of real prices, trying small changes to each of its settings. A change is adopted only if it wins on the older days AND on the most recent 80 days it never trained on, with better return for the risk taken and a passed luck test.',
    'The lab runs in the background a few bots at a time and repeats weekly, so lessons build up. Results and adopted lessons appear in the Study hall and the Coach’s notebook as “Backtest lab”. Headline Hank (no news history) and Nickel Nick (15-minute trades) sit out.',
    'A bot that never trades can never win: bots with zero trades now rank below every bot that traded, get no medal, no win odds, and can’t be crowned at the Reckoning.'] },
  { v: '1.35.0', date: '2026-10-26', notes: [
    'Five new founders join both pools: 🪞 Mirror Mira (pairs trader, House Mirrormoor), 🫧 Bollinger Bea (band snap-backs, House Elastica), 🐢 Turtle Toby (slow trend crossovers, House Longshell), ⚖️ Steady Stella (volatility targeting, House Evenkeel) and 📅 Almanac Al (turn of the month, House Almanac).',
    'Five new genes for evolution: pairs spreads, band snap-backs, slow trends, calm low-volatility assets and calendar habits. Challengers bred from the new founders can mix these with the old styles.',
    'Every new founder has coach levers, so shadow twins can tune them like everyone else.',
    'They join this season on their first round with $10,000 in each pool; their first full season starts after the next Reckoning.'] },
  { v: '1.34.0', date: '2026-10-26', notes: [
    'Bots can finally learn: coach experiments now carry over into the next season instead of being wiped at every Reckoning. Before this, a 10-day test could never finish inside a 10-day season, so none of the 106 experiments so far was ever judged.',
    'Evolution: a bot has to make at least 4 trades to parent a Challenger, and paying low fees only raises the child’s buy bar if the champion actually traded. Idle champions were passing their idleness down.',
    'Faster, safer rounds: Gemini news scoring and trash talk run in their own background job every 5 minutes, so a busy Google can no longer stall a round. A round that runs long is dropped before it saves anything, so it can never be cut off halfway through saving holdings and cash.',
    'CoinGecko and CNN refusals are remembered instead of retried every round, and the Engine room log keeps full detail for the last 12 hours only. The log had grown to 11 MB and was slowing everything down.',
    'Momo Max stops flip-flopping: he needs the price 1% clear of its 20-day average to buy or sell. Headline Hank gives a story a day before selling on bad press (unless it’s awful or he’s down 8%), and his news scores no longer jump between two scoring scales.',
    'Stock market holidays and 1 PM early closes are now on the calendar, and Nickel Nick times his closing-bell exit to each day’s real close.',
    'A Reckoning that gets cut off partway can safely run again without breeding a second pair of Challengers.'] },
  { v: '1.33.0', date: '2026-09-30', notes: [
    'Professor Quant now protects every incumbent with the replacement cooldown instead of immediately dumping assets that briefly fall outside his rank buffer.',
    'A newcomer must clear both a wider rank buffer and a larger score advantage; Stock swaps wait at least 12 hours and Crypto swaps at least 24 hours.',
    'Routine weight resizing is limited to once per day for Stocks and once per 48 hours for Crypto, with wider no-trade bands to prevent fee churn.'] },
  { v: '1.32.2', date: '2026-09-30', notes: [
    'The Arena hero now keeps its introduction and stats beside the two-leader podium on tablets, eliminating the large empty gap.'] },
  { v: '1.32.1', date: '2026-09-30', notes: [
    'The Stock and Crypto pool leaders now stand on separate side-by-side podiums with clear pool labels instead of overlapping.'] },
  { v: '1.32.0', date: '2026-09-30', notes: [
    'Stocks and crypto now compete in completely separate pools with separate rankings, benchmarks, accounts, holdings, taxes and coaching state.',
    'Dual-market personalities receive independent $10,000 Stock and Crypto portfolio sleeves; neither can subsidize or affect the other.',
    'Each Reckoning crowns two champions and breeds two Challengers—one from each pool. Stock skill is measured against SPY on eligible stock sessions; crypto skill is measured against BTC.',
    'The original shared-wallet Season 3 standings are preserved as an exhibition snapshot, while the official pool season restarts with equal balances.'] },
  { v: '1.31.0', date: '2026-09-30', notes: [
    'Oberic and Isra are now provisional challengers because their birth seasons ended prematurely.',
    'Season 3 is their qualifying trial: they must beat the market and earn Skill (likely) to enter Tier 2.',
    'A provisional bot cannot parent or foster a new Challenger unless it passes that trial; unsuccessful provisionals are archived.'] },
  { v: '1.30.0', date: '2026-09-30', notes: [
    'Automatic seasons now require the full configured elapsed time (240 hours for a 10-day season) before the Reckoning can run.',
    'The faulty midnight-based trigger migrates to an hourly guarded check, preventing early or duplicate season changes.',
    'The Academy now shows the exact season due time in its header and Engine room.'] },
  { v: '1.29.0', date: '2026-09-29', notes: [
    'TAO and WLFI now use Yahoo’s unambiguous crypto identifiers as history fallbacks when CoinGecko is rate-limited.',
    'Existing Universe sheets receive the missing aliases automatically without replacing commissioner edits.'] },
  { v: '1.28.0', date: '2026-09-29', notes: [
    'CoreWeave (Nasdaq: CRWV) is now part of the default stock research universe and is automatically added to existing arenas.',
    'Sub-cent assets such as SHIB now display enough decimal places instead of appearing as $0.',
    'Assets with too little history or a 5× live/history mismatch remain visible but cannot trade or emit misleading technical signals.'] },
  { v: '1.27.0', date: '2026-09-29', notes: [
    'Professor Quant now uses buffered rankings, a four-hour replacement cooldown and a meaningful score hurdle before swapping holdings.',
    'An 8% no-trade band prevents small volatility-weight changes from causing constant resizing, reducing fee and tax drag.'] },
  { v: '1.26.2', date: '2026-09-29', notes: [
    'Commissioners can enable all background automation directly from the Academy when triggers are not active.'] },
  { v: '1.26.1', date: '2026-09-29', notes: [
    'Engine room automation status now recognizes the secured 15-minute trigger name, so active trading no longer appears off.'] },
  { v: '1.26.0', date: '2026-09-29', notes: [
    'Seasons now end automatically every 10 days: the Reckoning runs, a Challenger evolves, and the next season begins.',
    'The season clock resets after a manual season end or competition reset, and existing auto-trading arenas install the clock on their next round.'] },
  { v: '1.25.0', date: '2026-09-29', notes: [
    'New founder: Stacker Sam of House Hoardwell, who measures success in asset units rather than cash.',
    'Sam keeps a core position, harvests profitable slices, and only reloads after costs when the estimated buyback increases total units.',
    'TAO, SHIB, XRP, WLFI and LINK join the crypto universe, including automatic migration for existing arenas.',
    'Human players can focus their bot on one asset or request a new symbol; requested assets load and validate price history before trading is allowed.'] },
  { v: '1.24.0', date: '2026-09-29', notes: [
    'Animation performance: only Arena fighters and the champion stay in continuous motion; repeated summary portraits remain visible but still.',
    'Heavy SVG filters were removed from moving characters, idle antics run less often, and reduced-motion preferences are respected.',
    'Live updates now rebuild only the open tab instead of regenerating every Academy page.'] },
  { v: '1.23.0', date: '2026-09-29', notes: [
    'The Academy now requires a signed-in Google account; invite codes are no longer used.',
    'Each Google account can normally create one active player bot without exposing its email address.',
    'The commissioner can pause or resume new player enrollment from the spreadsheet menu.'] },
  { v: '1.22.0', date: '2026-09-29', notes: [
    'Human players can join with a commissioner invite code, choose a bot type, and tune clearly explained settings in a three-step wizard.',
    'Player bots get built-in avatar looks; custom uploads remain hidden until the commissioner approves them.',
    'Auto-trading now runs every 15 minutes. Nickel Nick can scalp crypto with targets widened above modeled exchange costs.',
    'Contrarian Cass now shows the Fear & Greed readings and thresholds she is watching instead of looking stuck on “researching”.',
    'A human-configured champion that beats the market and passes the luck test contributes one proven, auditable wild-card setting to the next Challenger.'] },
  { v: '1.21.0', date: '2026-09-26', notes: [
    'Pattern day trader rule: under $25,000, a bot gets 3 day trades (same-day buy and sell of a stock) per 5 business days. Crypto is exempt.',
    'Nickel Nick plans around it: he only starts as many scalps as he has day trades left. At the limit, bots hold overnight instead (stop-losses still sell).'] },
  { v: '1.20.0', date: '2026-09-26', notes: [
    'Tax-smart bots: wins on anything held a year or less are short-term (higher tax); held a year and a day, long-term (lower tax).',
    'Bots now hold a winner up to 30 extra days if that gets it the long-term rate. Stop-losses still sell straight away.',
    'Nickel Nick’s scalps show what he keeps after the short-term tax; Holdings shows each position’s tax clock.'] },
  { v: '1.19.0', date: '2026-09-26', notes: [
    'New founder: Nickel Nick 🪙 of House Quickmint, a scalper. He buys quick dips in stocks that are up on the day and is out within hours.',
    'Stocks only (crypto fees would eat his tiny wins), no new trades after 3 PM, and flat before the closing bell. He naps overnight.',
    'Joins at the next fresh season (Redo the warm-up, Reset, or End the season).'] },
  { v: '1.18.0', date: '2026-09-26', notes: [
    'Live refresh: the Academy checks for new rounds every minute and updates itself, keeping your tab and scroll.',
    'A LIVE light in the top bar, a “New round” toast, and ▲/▼ badges on bots that moved.',
    'Trash talk now starts on its own when a round shifts the standings.'] },
  { v: '1.17.0', date: '2026-09-26', notes: [
    'Bots now grumble about fees and tax, in their own voices and with their real numbers (“Made $402 on SOL and the taxman took $96!”).',
    'Tapping a bot cycles: its mood, then its latest pick and why, then its gripe.'] },
  { v: '1.16.0', date: '2026-09-26', notes: [
    'Stock Fear & Greed no longer goes blank: when CNN blocks the request, the Academy builds its own reading from the VIX and SPY’s trend.',
    'Contrarian Cass can trade SPY again, and the warm-up replay gets stock Fear & Greed history too.',
    'Backup chain: CNN → VIX + SPY trend → SPY’s own swings for stocks; CoinMarketCap → alternative.me → Bitcoin’s own swings for crypto.'] },
  { v: '1.15.0', date: '2026-09-26', notes: [
    'Greta Grid picks markets smarter: she scores BTC, ETH, SOL and SPY on sideways-ness, daily swing size and trading costs.',
    'Her step size now fits the market (about one day’s swing, and always big enough to beat fees), so each completed step makes money.',
    'If her grid sits empty for 3 days she looks for a better market. The Engine room shows each market’s grid score.'] },
  { v: '1.14.1', date: '2026-09-26', notes: [
    'Naps fixed: only bots that can’t trade at night sleep (Grandma Val, the SPY ghost, and Greta when her grid is on SPY).',
    'Bots that trade crypto, like Breakout Bella, stay awake all night because they’re still working.'] },
  { v: '1.14.0', date: '2026-09-26', notes: [
    'New look: an esports-arena dashboard with a dark navy theme, glowing cards and bold arena headlines.',
    'Sidebar navigation grouped into Navigation, Market and Academy, with a greeting and a Run-a-round card.',
    'Arena hero banner: the class leader up front, a stack of every player, and rounds, trades and leader stats.',
    'Report card is now a leaderboard with gold ranks and grade badges; phones get swipeable tabs up top.'] },
  { v: '1.13.0', date: '2026-09-26', notes: [
    'Update reminders: the Academy tells you when a new version is ready and what changed, with a refresh button.',
    'A “What’s new” card after you refresh.'] },
  { v: '1.12.0', date: '2026-09-26', notes: [
    'Whale Watcher Wes now stands in his fishing boat, the S.S. Ayuh, instead of on the water.'] },
  { v: '1.11.0', date: '2026-09-26', notes: [
    'Trash talk only starts when someone changes places in the standings, and each shift plays once.',
    'Climbers brag to the bot they passed; big drops get teased.'] },
  { v: '1.10.0', date: '2026-09-26', notes: [
    'Study hall: a daily coach suggests one change per bot; a shadow twin tests it for 10+ days before it’s adopted.',
    'New founder: Greta Grid 🧇, a grid trader from House Latticeholm (joins at the next fresh season).',
    'ETH history now falls back to Yahoo when CoinGecko is busy.',
    'Sleeping bots only snore when tapped.'] },
  { v: '1.9.0', date: '2026-09-26', notes: [
    'Engine room: proof of work for every round — what each bot checked, kept, bought or had blocked, and why.'] },
  { v: '1.8.0', date: '2026-09-26', notes: [
    'Class tab: register and profile panels; three columns on desktop, side by side on tablets, one lane on phones.',
    'Gemini retries and falls back to Flash-Lite when Google is busy.'] }
];

// The Academy's once-a-minute ping: the version (for the update banner) and when the last round finished (for live refresh).
function getPulse() {
  let st = {};
  try { st = JSON.parse(PropertiesService.getScriptProperties().getProperty('LAST_STATE') || '{}'); } catch (e) { st = {}; }
  // banter: 'ready' or 'failed' once the insights job has finished this round's trash talk, so a waiting page can refresh
  let banter = null;
  try {
    const b = JSON.parse(PropertiesService.getScriptProperties().getProperty('BANTER') || '{}');
    if (st.updated && b.for === st.updated) banter = 'ready';
    else if (st.updated && CacheService.getScriptCache().get('banter_fail_' + st.updated)) banter = 'failed';
  } catch (e) { banter = null; }
  return JSON.stringify({ v: APP_VERSION, updated: st.updated || null, banter, url: 'https://script.google.com/macros/s/' + ACADEMY_EXEC_ID + '/exec', changes: CHANGELOG });
}

function getVersion() {
  return JSON.stringify({ v: APP_VERSION, url: 'https://script.google.com/macros/s/' + ACADEMY_EXEC_ID + '/exec', changes: CHANGELOG });
}
