# Gacha Bot

Discord bot for tracking gacha pull history across multiple games. Currently supports **Infinity Nikki**, **Arknights: Endfield**, **Honkai: Star Rail**, and **Genshin Impact**.

Runs on a Raspberry Pi 4 under PM2. Uses discord.js 14 with slash commands and better-sqlite3 for local SQLite storage.

## Features

- Import pull history directly from game APIs or the publisher's account portal
- Per-banner pity tracking with soft/hard pity awareness
- 50/50 win/loss tracking for HSR and Genshin character banners
- Pull history view per game — 5★/6★ timeline (Endfield, HSR, Genshin) or per-banner outfit-completion (Nikki)
- Deduplication — re-importing is safe, only new pulls are added
- All responses are ephemeral — pull data stays private
- Tokens are never stored — used once during import then discarded

## Commands

| Command | Description |
|---|---|
| `/help` | Step-by-step instructions for getting your token/authkey and importing |
| `/import` | Import your pull history from the game API |
| `/stats` | Pity counters, 50/50 record, pull statistics |
| `/history` | 5★/6★ timeline with pity and 50/50 results (Nikki: per-banner outfit completion) |
| `/gryph` | (Admin) Manage Endfield banner → character mappings |
| `/hoyo` | (Admin) Manage HSR/Genshin banner schedule for 50/50 detection |
| `/delete` | Delete your stored pull data |

`/help` accepts a `game` option and walks you through getting your credentials — a PowerShell one-liner that pulls the token/authkey from your local game cache (Endfield, HSR, Genshin) or a browser-console snippet that grabs your session cookies from `pearpal.infoldgames.com` (Nikki) — then shows the exact `/import` command to run. Start here.

## Supported Games

| Game | ID | Notes |
|---|---|---|
| Arknights: Endfield | `endfield` | Uses token from WebView cache |
| Honkai: Star Rail | `starrail` | Uses authkey from WebView cache |
| Genshin Impact | `genshin` | Uses authkey from WebView cache |
| Infinity Nikki | `nikki` | Uses pearpal cookie / momoToken and Nid |

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

**Tier 1 — `gacha_id_map` table:** The HSR API returns a `gacha_id` per pull (e.g. `2109`), which uniquely identifies a banner instance. The `gacha_id_map` SQLite table maps known gacha_ids to their featured character(s). This is the most accurate method.

**Tier 2 — Banner schedule:** If a gacha_id isn't yet in `gacha_id_map`, the bot falls back to matching the pull's timestamp against the banner schedule DB (`banner_schedule` table). Admins populate this via:

```
/hoyo add game:starrail banner_type:character start_date:YYYY-MM-DD end_date:YYYY-MM-DD featured:"Char1,Char2"
```

**Auto-discovery:** During `/import`, any `gacha_id` not yet in `gacha_id_map` is automatically added with featured characters inferred from the schedule. No manual step needed — new banners populate themselves on first import.

### Genshin Impact — schedule only

Genshin's API uses generic `gacha_type` values (`301`/`400` = character event, `302` = weapon, `200` = standard) rather than per-banner IDs, so a `gacha_id_map` equivalent isn't needed — all disambiguation is done by timestamp. Populate the schedule the same way as HSR:

```
/hoyo add game:genshin banner_type:character start_date:YYYY-MM-DD end_date:YYYY-MM-DD featured:"Nahida"
```

The banner schedule needs to be kept up to date for accurate 50/50 results. If the schedule is missing a banner, affected pulls show as "unknown" rather than won/lost.

## Database

Eight tables:

**`pulls`** — pull history per user/game. PK: `(discord_id, game, seq_id, is_weapon)`. Populated by `/import`.

**`banners`** — Endfield banner→character mappings. PK: `(game, pool_name)`. Seeded on first run, extended via `/gryph add`.

**`banner_schedule`** — HSR/Genshin/Nikki banner schedules. Managed via `/hoyo add/list/remove` for HoYo games; auto-populated from the Pearpal catalog for Nikki. Columns: `game`, `banner_type`, `start_date`, `end_date`, `name`, `featured` (JSON).

**`gacha_id_map`** — HSR gacha_id → featured character mappings. Auto-populated during `/import` for any new gacha_id encountered. Columns: `gacha_id` (PK), `banner_type`, `featured` (JSON array).

**`item_catalog`** — game-agnostic `item_id` → `name`/`rarity`/`slot`/`banner_id` lookup. Used by Nikki to resolve cloth_ids returned by the gacha API. Refreshed at most every 24h from the Pearpal catalog endpoint during `/import`.

**`nikki_lifetime_events`** — per-user lifetime 4★/5★ pull events from Pearpal's `/note/book/info` endpoint. Full-replaced on each `/import`. Powers the lifetime totals shown by `/stats` (overrides the 180-day pull-window data when present).

**`nikki_lifetime_summary`** — per-user lifetime totals from the same Pearpal endpoint: limited/permanent pull counts, cloth/momo/suit collection counts, login days, total playtime. Full-replaced on each `/import`. Drives the `/stats` profile header. PK: `(discord_id)`.

**`imports`** — last-import timestamp per user per game. Updated by `/import` and surfaced as the "last updated" footer on `/stats`, `/history`, and the import-confirmation embed. PK: `(discord_id, game)`.
