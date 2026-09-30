# mania 7k player pool helper

**English** | [简体中文](README.zh-CN.md)

A local web tool for exploring osu!mania 7K players and their best-performance beatmaps. "pp" stands for both **performance points** and **player pool**.

## Features

- Search players by global 7K rank **1-3,000** or **7K pp of 6,000 or above**.
- Explore pp, regular dan and LN dan distributions with interactive charts and searchable, sortable player lists.
- Analyze **native 7K mania beatmaps only**. Standard-mode converts are excluded.
- Group beatmaps by **HT / NM / DT-NC**. Other mods do not create separate entries.
- View calculated perfect pp ceilings, star ratings and beatmap frequency, counted by distinct players.
- Download beatmapsets without video through osu! or SayoBot, with batch downloads supported through SayoBot.

## Quick Start

Requires **Windows, Node.js 24 or newer, and internet access**.

Download and extract this repository. Open PowerShell in the project folder, then run:

```powershell
npm.cmd install
Copy-Item config.example.json config.json
npm.cmd start -- --open
```

The app opens in your default browser. Select a search mode, set the range and start searching. The default address is [127.0.0.1:7277](http://127.0.0.1:7277/); the terminal shows the actual address if another port is used.

## Notes

- First-time searches over large player groups can take substantial time. Cached data speeds up repeated searches.
- BP analysis uses the best-performance list available from osu!, not a player's entire play history. Public leaderboard limits can affect pp-range coverage.
- PP ceilings are calculated for normalized, perfect osu!stable plays and may differ from current official values after pp updates.
- Cache and batch downloads are stored in the project's `data/` and `downloads/` folders. The application interface is currently English-only.
- A fixed, bundled Nunito font keeps the interface consistent. Original Mania Tracker dan badges are version-checked and cached locally on first use; their initial download requires access to Mania Tracker.

Data sources: [osu!](https://osu.ppy.sh/) · [Mania Tracker](https://mania-tracker.com/?country=GLOBAL)

Third-party components and remotely loaded assets are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
