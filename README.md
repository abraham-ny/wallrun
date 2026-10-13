# Wall Run

A standalone HTML5 tactics game designed for a CrazyGames upload. Open `index.html` in a static server during development; no build step is required.

## Play

- Campaign: race the rival AI through six story chapters.
- Local duel: two players share the keyboard and alternate turns.
- Move with arrow keys or WASD; click a reachable square to move. Use the wall controls, then click an open board gap to place a two-lane blocker.
- Wall placement is rejected if it overlaps another wall, crosses one, or removes every route to either player's goal.
- Each turn has a 30-second clock. Run Tokens unlock one-use match tactics and runner cosmetics.

## CrazyGames

The game loads CrazyGames SDK v3 and initializes it before connecting its data module, rewarded video ads, gameplay lifecycle, user profile, and score submission. Saves use the CrazyGames data module in supported environments and browser local storage elsewhere. The SDK's data module must be enabled in the Developer Portal's progress-save settings.

To enable leaderboard submissions, set `leaderboardEncryptionKey` in `config.js` to the 32-byte base64 key configured for the game in the CrazyGames Developer Portal. Score submission is client-side and is not tamper-proof; use the Leaderboard API and a validating backend for competitive integrity. CrazyGames leaderboards are available to invited games.

Rewarded ads only grant tokens after CrazyGames reports `adFinished`; errors and unavailable inventory never award the reward.

## Multiplayer scope

Local Duel is fully playable on one device. The game detects incoming CrazyGames multiplayer invite parameters, but SDK room/invite functions are platform discovery and invitation tools, not a real-time networking transport. Online PvP matchmaking requires a separate signaling/game server and authoritative state validation; it is not represented as live online play here.

## Publish

Upload the static files (`index.html`, `styles.css`, `game.js`, and `config.js`) to the CrazyGames Developer Portal and complete the portal's SDK, progress-save, ad, and leaderboard setup. The game is ready for browser testing, but publication still requires the CrazyGames review and configuration steps.
