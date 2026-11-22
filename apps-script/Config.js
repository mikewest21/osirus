/**
 * GAME OF TRADES — config, roster & personalities
 * Editable at runtime: the "Config" and "Universe" sheets (created by setupArena).
 * Optional API keys (Extensions > Apps Script > Project Settings > Script Properties):
 *   CMC_API_KEY        CoinMarketCap: crypto quotes + CMC Fear & Greed
 *   COINGECKO_API_KEY  CoinGecko demo key (works without one, just slower limits)
 *   GEMINI_API_KEY     Gemini reads headlines, scores sentiment and writes the season chronicle
 *                      (otherwise a keyword model is used; ANTHROPIC_API_KEY also works as a fallback)
 */

const SHEETS = {
  BOARD: 'Leaderboard', BOTS: 'Bots', HOLD: 'Holdings', TRADES: 'Trades',
  RESEARCH: 'Research', HISTORY: 'EquityHistory', CONFIG: 'Config', UNIVERSE: 'Universe', LINEAGE: 'Lineage', PLAYERS: '_player_bots', ARCHIVE: '_archive', GF: '_gf', TELEMETRY: 'Telemetry'
};
const TZ = 'America/New_York';

const DEFAULT_CONFIG = [
  ['STARTING_CASH', 10000, 'Paper money per bot (USD)'],
  ['STOCK_COMMISSION', 0, 'Flat $ per stock trade'],
  ['STOCK_FEE_RATE', 0, 'Broker fee as fraction of trade value'],
  ['SEC_FEE_RATE', 0.0000206, 'Regulatory fee on stock SELLS — SEC Section 31 rate $20.60/million, effective Apr 4 2026 (re-check each spring)'],
  ['CRYPTO_FEE_RATE', 0.009, 'Coinbase Advanced US taker fee, entry tier (0.009 = 0.9%, per Sep 2026 schedule). Lower it if your volume tier drops'],
  ['STOCK_SLIPPAGE', 0.0005, 'Price you lose to the spread on stocks'],
  ['CRYPTO_SLIPPAGE', 0.001, 'Price you lose to the spread on crypto'],
  ['ST_TAX_RATE', 0.24, 'Short-term capital gains (held < 365 days)'],
  ['LT_TAX_RATE', 0.15, 'Long-term capital gains (held >= 365 days)'],
  ['MIN_TRADE_USD', 25, 'Ignore orders smaller than this'],
  ['MAX_POSITION_PCT', 0.4, 'Max share of a bot\'s value in one asset. Only the ghost benchmarks are exempt (maxPos: 1 in GHOSTS).'],
  ['DCA_USD', 250, 'Diamond Dana\'s daily buy'],
  ['ACCUM_ASSET', 'BTC', 'Asset Stacker Sam accumulates (must match a Universe symbol, e.g. BTC, TAO, XRP or LINK)'],
  ['SEASON_DAYS', 10, 'Automatically end, review and evolve each season after this many days (1–30)'],
  ['PDT_RULE', true, 'Pattern day trader rule: accounts under PDT_MIN_EQUITY get PDT_MAX day trades (same-day buy + sell of a stock) per 5 business days'],
  ['PDT_MIN_EQUITY', 25000, 'Accounts worth at least this are exempt from the day-trade limit'],
  ['PDT_MAX', 3, 'Day trades allowed per rolling 5 business days under the limit'],
  ['STOP_COOLDOWN_HOURS', 24, 'After a stop-loss, a bot waits this many hours before buying that asset back. 0 = off'],
  ['TAX_WAIT_DAYS', 30, 'Bots hold a winner up to this many extra days if that makes it long-term (lower tax). Stop-losses still sell at once. 0 = off'],
  ['REQUIRE_MARKET_HOURS', true, 'Stocks only trade 9:30–16:00 ET on weekdays (holidays not detected)'],
  ['LLM_MODEL', 'gemini-flash-latest', 'Used only if GEMINI_API_KEY (or ANTHROPIC_API_KEY) is set']
];

// Symbol | Type | GOOGLEFINANCE ticker | Yahoo symbol | CoinGecko id | News search
const DEFAULT_UNIVERSE = [
  ['AAPL', 'stock', 'NASDAQ:AAPL', 'AAPL', '', 'Apple stock'],
  ['MSFT', 'stock', 'NASDAQ:MSFT', 'MSFT', '', 'Microsoft stock'],
  ['NVDA', 'stock', 'NASDAQ:NVDA', 'NVDA', '', 'Nvidia stock'],
  ['TSLA', 'stock', 'NASDAQ:TSLA', 'TSLA', '', 'Tesla stock'],
  ['AMZN', 'stock', 'NASDAQ:AMZN', 'AMZN', '', 'Amazon stock'],
  ['CRWV', 'stock', 'NASDAQ:CRWV', 'CRWV', '', 'CoreWeave stock AI cloud'],
  ['SPY', 'stock', 'NYSEARCA:SPY', 'SPY', '', 'S&P 500 stock market'],
  ['BTC', 'crypto', '', '', 'bitcoin', 'Bitcoin'],
  ['ETH', 'crypto', '', '', 'ethereum', 'Ethereum'],
  ['SOL', 'crypto', '', '', 'solana', 'Solana crypto'],
  ['TAO', 'crypto', '', 'TAO22974-USD', 'bittensor', 'Bittensor TAO crypto'],
  ['SHIB', 'crypto', '', '', 'shiba-inu', 'Shiba Inu crypto'],
  ['XRP', 'crypto', '', '', 'ripple', 'XRP crypto'],
  ['WLFI', 'crypto', '', 'WLFI33251-USD', 'world-liberty-financial', 'World Liberty Financial crypto'],
  ['LINK', 'crypto', '', '', 'chainlink', 'Chainlink crypto']
];

const BOTS = [
  { id: 'MOMO', name: 'Momo Max', emoji: '🚀', strategy: 'Momentum trend-rider',
    bio: 'Loud, caffeinated, allergic to red candles. Only buys what is already flying.',
    lines: { buy: ['Number go up. I go in. 🚀', 'Trend is my only friend, bro.', 'Chasing? No. Accelerating.'],
             sell: ['Trend broke. I\'m out, zero feelings.', 'Next rocket, please.'] } },
  { id: 'VAL', name: 'Grandma Val', emoji: '🧶', strategy: 'Mean reversion on oversold stocks',
    bio: 'Survived 1987, 2000 and 2008. Buys quality on sale and knits while she waits.',
    lines: { buy: ['Everything\'s on sale, dears.', 'Panic is just a discount with bad manners.'],
             sell: ['That\'s enough profit for a new cardigan.', 'Never overstay your welcome.'] } },
  { id: 'CASS', name: 'Contrarian Cass', emoji: '🦉', strategy: 'Fear & Greed contrarian',
    bio: 'Reads the room, then does the exact opposite.',
    lines: { buy: ['You\'re scared? Perfect. Hand it over.', 'Blood in the streets smells like opportunity.'],
             sell: ['Everyone\'s euphoric. That\'s my exit sign.', 'Greed is loud. I\'m leaving quietly.'] } },
  { id: 'HANK', name: 'Headline Hank', emoji: '📰', strategy: 'News sentiment trader',
    bio: 'Ex-newsroom intern. Trades whatever the headlines are shouting.',
    lines: { buy: ['EXTRA! EXTRA! I\'m buying!', 'The press loves it, so do I.'],
             sell: ['Bad press. Killing the story.', 'Stop the presses — I\'m out.'] } },
  { id: 'QUANT', name: 'Professor Quant', emoji: '🧮', strategy: 'Patient multi-factor, volatility-weighted allocator',
    bio: 'Speaks only in z-scores—and now makes a factor prove itself before paying another fee.',
    lines: { buy: ['The factors have spoken.', 'Rebalancing toward positive expected value.'],
             sell: ['Signal decayed. Position trimmed.', 'Risk budget reallocated.'] } },
  { id: 'DANA', name: 'Diamond Dana', emoji: '💎', strategy: 'Daily dollar-cost averaging, never sells',
    bio: 'Has never pressed the sell button. Isn\'t sure where it is.',
    lines: { buy: ['Stack. Hold. Repeat.', 'Time in the market > timing the market.'], sell: ['(Dana does not sell.)'] } },
  { id: 'BELLA', name: 'Breakout Bella', emoji: '⚡', strategy: 'Donchian channel breakouts',
    bio: 'Waits for price to smash through the ceiling, then rides it to the roof.',
    lines: { buy: ['Ceiling? What ceiling? ⚡', 'Breakout confirmed, strapping in.'],
             sell: ['Floor gave way. Bailing.', 'Breakout failed — no ego, just exit.'] } },
  { id: 'WES', name: 'Whale Watcher Wes', emoji: '🐋', strategy: 'Crypto volume-anomaly tracker',
    bio: 'Stays up all night staring at volume. Follows the big money.',
    lines: { buy: ['Big splash spotted. Swimming with whales.', 'Someone huge is buying. Me too.'],
             sell: ['Whales are dumping. Surfacing now.', 'The tide went out.'] } },
  { id: 'GRID', name: 'Greta Grid', emoji: '🧇', strategy: 'Grid trader: picks the choppiest market that swings enough to beat its fees, buys each step down, sells each bounce',
    bio: 'Draws a ladder of prices on graph paper and never climbs off it. Loves a market that goes nowhere.',
    lines: { buy: ['Down one step. Buying one slice, precisely.', 'Right on the grid line. Tick.'],
             sell: ['Up one step. Selling that slice. Tock.', 'Bounce collected, exactly as planned.'] } },
  { id: 'SCALP', name: 'Nickel Nick', emoji: '🪙', strategy: '15-minute scalper: buys quick dips in rising stocks, with fee-aware exits', pools: ['stock'],   // crypto's ~1.4% round trip beat every scalp setting; stocks only from Season 6
    bio: 'Picks up nickels around the clock. Uses wider crypto targets so exchange fees do not eat a winning scalp.',
    lines: { buy: ['In-in-in! Quick dip, I\'m buying!', 'Gimme that pullback, sold to me!'],
             sell: ['Out-out-out! Nickel in the pocket!', 'Done and dusted, next!'] } },
  { id: 'STACK', name: 'Stacker Sam', emoji: '🐿️', strategy: 'Asset accumulator: harvests profitable slices and reinvests only when the proceeds increase total units',
    bio: 'Does not dream of a bigger cash pile. Sam keeps a core position, harvests a profitable slice, then waits to buy back more units than were sold.',
    lines: { buy: ['More units in the vault!', 'Cash is temporary. The stack is permanent.'],
             sell: ['Harvesting a slice. I’ll bring back more.', 'Profit secured—now wait for the reload.'] } },
  { id: 'PAIR', name: 'Mirror Mira', emoji: '🪞', strategy: 'Pairs trader: buys whichever of two look-alike assets has fallen unusually far behind the other, sells when the gap closes',
    bio: 'Keeps a mirror for every asset. When one twin wanders off from the other, she bets it comes home.',
    lines: { buy: ['Ja, they always find each other again.', 'One twin wandered off. I bring it home.'],
             sell: ['The gap is closed. Balance, restored.', 'Mirror and twin, side by side again.'] } },
  { id: 'BAND', name: 'Bollinger Bea', emoji: '🫧', strategy: 'Bollinger-band snap-back: buys a price stretched below its normal range, sells at the middle',
    bio: 'Teaches stretching classes. Believes every price, like every hamstring, has a comfortable range.',
    lines: { buy: ['Breathe in. That stretch is too far. Buying.', 'Rubber band says snap back.'],
             sell: ['And release. Back to centre.', 'Lovely stretch. Profit taken, namaste.'] } },
  { id: 'TREND', name: 'Turtle Toby', emoji: '🐢', strategy: 'Slow trend crossover: buys when the 10-day average crosses above the 30-day, rides it with a trailing stop',
    bio: 'A Texas rancher who moves slow and never chases. Waits for the herd to turn, then rides it for weeks.',
    lines: { buy: ['Reckon the herd just turned. Saddlin’ up.', 'Slow and steady, partner. Trend’s on.'],
             sell: ['Herd turned back. No shame in walkin’ home.', 'Trail ran out. Fixin’ to wait a spell.'] } },
  { id: 'VOLT', name: 'Steady Stella', emoji: '⚖️', strategy: 'Volatility targeter: holds the benchmark, sized so the account’s swings stay near a set level',
    bio: 'An airline captain who flies the same route every day and adjusts for turbulence, never for headlines.',
    lines: { buy: ['Smooth air ahead, folks. Adding altitude.', 'Calm market. Bringing her up to cruising weight.'],
             sell: ['Turbulence ahead. Easing back on the throttle.', 'Bumpy skies, folks. Lightening the load.'] } },
  { id: 'CAL', name: 'Almanac Al', emoji: '📅', strategy: 'Calendar trader: holds the benchmark around the turn of each month, when pay-day money tends to flow in',
    bio: 'Keeps a farmer’s almanac for markets. Plants on the last day of the month and harvests three days later.',
    lines: { buy: ['By the almanac, the month is turning. Planting now.', 'Pay-day money’s coming. Always does.'],
             sell: ['Harvest’s in. Back on the porch till month’s end.', 'Window’s closed. The almanac says rest.'] } }
];

// Benchmark ghosts: SPY judges the Stock Pool and BTC judges the Crypto Pool. The legacy 50/50 ghost is retained
// for old yearbook compatibility but is no longer entered in ranked seasons.
const GHOSTS = [
  { id: 'G_SPY', name: 'Ghost of SPY', emoji: '👻', strategy: 'Benchmark: buy & hold the S&P 500', ghost: true, maxPos: 1,
    bio: 'Bought the market once and went to sleep.', lines: { buy: ['Boo. Buying the index.'], sell: ['Ghosts do not sell.'] } },
  { id: 'G_BTC', name: 'Ghost of BTC', emoji: '👻', strategy: 'Benchmark: buy & hold Bitcoin', ghost: true, maxPos: 1,
    bio: 'Bought Bitcoin once and went to sleep.', lines: { buy: ['Boo. Buying Bitcoin.'], sell: ['Ghosts do not sell.'] } },
  { id: 'G_MIX', name: 'Ghost of 50/50', emoji: '👻', strategy: 'Benchmark: half SPY, half BTC — "the market"', ghost: true, maxPos: 1,
    bio: 'The yardstick for skill: half stocks, half crypto, never touched.', lines: { buy: ['Boo. Half and half.'], sell: ['Ghosts do not sell.'] } }
];
const MARKET_GHOST = 'Ghost of 50/50';
