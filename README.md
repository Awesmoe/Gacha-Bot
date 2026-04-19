# Gacha Bot

Discord bot for tracking gacha pull history across multiple games. Currently supports **Arknights: Endfield**, **Honkai: Star Rail**, and **Genshin Impact**.

Runs on a Raspberry Pi 4 under PM2. Uses discord.js 14 with slash commands and better-sqlite3 for local SQLite storage.

## Features

- Import pull history directly from game APIs (no third-party sites needed)
- Per-banner pity tracking with soft/hard pity awareness
- 50/50 win/loss tracking for HSR and Genshin character banners
- 6★/5★ pull history timeline with pity counts
- Deduplication — re-importing is safe, only new pulls are added
- All responses are ephemeral — pull data stays private
- Tokens are never stored — used once during import then discarded

## Commands

| Command | Description |
|---|---|
| `/help` | Step-by-step instructions for getting your token/authkey and importing |
| `/import` | Import your pull history from the game API |
| `/stats` | Pity counters, 50/50 record, pull statistics |
| `/history` | 5★/6★ timeline with pity and 50/50 results |
| `/gryph` | (Admin) Manage Endfield banner → character mappings |
| `/hoyo` | (Admin) Manage HSR/Genshin banner schedule for 50/50 detection |
| `/delete` | Delete your stored pull data |

`/help` accepts a `game` option and walks you through extracting the token/authkey from your local game cache using a PowerShell one-liner, then shows the exact `/import` command to run. Start here.

## Supported Games

| Game | ID | Notes |
|---|---|---|
| Arknights: Endfield | `endfield` | Uses token from WebView cache |
| Honkai: Star Rail | `starrail` | Uses authkey from WebView cache |
| Genshin Impact | `genshin` | Uses authkey from WebView cache |

## Setup

```bash
npm install
cp config.example.json config.json   # fill in token, clientId, guildId, bannerAdmins
node register-commands.js             # register slash commands with Discord (run once)
pm2 start index.js --name gacha-bot  # or: node index.js
```

`config.json` fields:
- `token` — Discord bot token
- `clientId` — Discord application client ID
- `guildId` — Discord server ID to register commands to
- `bannerAdmins` — array of Discord user IDs allowed to use `/gryph` and `/hoyo`

## Requirements

- Node 18+ (uses native `fetch`)
- better-sqlite3 (requires native build — `npm install` handles this)

## How 50/50 Detection Works

50/50 stats require knowing what the featured item(s) were on each banner. Each game handles this differently.

### Arknights: Endfield

Banner→character mappings live in the `banners` SQLite table and are seeded automatically from `games/endfield/config.js` on first run (contains all banners from launch). When a new banner releases, add it via:

```
/gryph add pool_name:"Banner Name" character:"Character Name"
```

If a 6★ pull lands on a banner not in the DB, it shows as "Unknown banner" instead of Won/Lost.

### Honkai: Star Rail — two-tier system

HSR uses two mechanisms in priority order:

**Tier 1 — `gacha-ids.js`:** The HSR API returns a `gacha_id` per pull (e.g. `2109`), which uniquely identifies a banner instance. `games/starrail/gacha-ids.js` maps known gacha_ids to their featured character(s). This is the most accurate method.

**Tier 2 — Banner schedule:** If a gacha_id isn't yet in `gacha-ids.js`, the bot falls back to matching the pull's timestamp against the banner schedule DB (`banner_schedule` table). Admins populate this via:

```
/hoyo add game:starrail banner_type:character start_date:YYYY-MM-DD end_date:YYYY-MM-DD featured:"Char1,Char2"
```

**Unknown gacha_id logging:** During import, any `gacha_id` not in `gacha-ids.js` is logged to `HSR_UNKNOWN_GACHA_IDS.txt` (in the repo root) with timestamp and inferred featured names. Review this file after new banners appear and add confirmed entries to `gacha-ids.js`.

### Genshin Impact — schedule only

Genshin's API uses generic `gacha_type` values (`301`/`400` = character event, `302` = weapon, `200` = standard) rather than per-banner IDs, so a `gacha-ids.js` equivalent isn't needed — all disambiguation is done by timestamp. Populate the schedule the same way as HSR:

```
/hoyo add game:genshin banner_type:character start_date:YYYY-MM-DD end_date:YYYY-MM-DD featured:"Nahida"
```

The banner schedule needs to be kept up to date for accurate 50/50 results. If the schedule is missing a banner, affected pulls show as "unknown" rather than won/lost.

## Database

Three tables:

**`pulls`** — pull history per user/game. PK: `(discord_id, game, seq_id, is_weapon)`. Populated by `/import`.

**`banners`** — Endfield banner→character mappings. PK: `(game, pool_name)`. Seeded on first run, extended via `/gryph add`.

**`banner_schedule`** — HSR/Genshin banner schedules. Managed via `/hoyo add/list/remove`. Columns: `game`, `banner_type`, `start_date`, `end_date`, `name`, `featured` (JSON array).
