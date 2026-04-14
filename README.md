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
