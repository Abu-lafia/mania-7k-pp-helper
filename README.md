# mania 7k player pool helper

**English** | [简体中文](README.zh-CN.md)

A local web tool for exploring osu!mania 7K players and their best-performance beatmaps. "pp" stands for both **performance points** and **player pool**.

## Features

- Search players by global 7K rank **1-3,000** or **7K pp of 2,000 or above**.
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
- BP analysis takes the top **50** combined stable/lazer Mania best performances per player, then filters native 7K maps. Frequency statistics therefore cover this sample, not all BP or a player's entire play history. The public leaderboard ends at rank 10,000, so lower pp ranges may have incomplete coverage.
- PP ceilings are calculated for normalized, perfect osu!stable plays and may differ from current official values after pp updates.
- Cache and batch downloads are stored in the project's `data/` and `downloads/` folders. Switch English/Simplified Chinese at the top right.
- A fixed, bundled Nunito font keeps the interface consistent. Original Mania Tracker dan badges are version-checked and cached locally on first use; their initial download requires access to Mania Tracker.

Data sources: [osu!](https://osu.ppy.sh/) · [Mania Tracker](https://mania-tracker.com/?country=GLOBAL)

Third-party components and remotely loaded assets are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Faster searches and previews

Frequency results appear while BP collection and PP calculation continue. Cached searches can be previewed immediately during refresh. Table filters, sorting and selected downloads are preserved during updates.

Optionally copy `oauth.example.json` to the ignored `oauth.local.json` and enter your own osu! OAuth application client ID and secret. The application uses the public client-credentials grant; API and website queues divide ranking/BP work, rather than requesting each player twice. Without credentials it retains the website route. Exact 7K pp is checked before pp-range inclusion.

Raw beatmap downloads use bounded official/Sayo queues, with fallback and BeatmapID/MD5 validation. Sayo ZIP range requests extract only `.osu` members. `localBeatmapDirectory` can point to files named `<beatmap_id>.osu` or `<checksum>.osu`.

Optional official dated samples are available from [data.ppy.sh](https://data.ppy.sh/). With Python 3 installed, import a downloaded Mania sample once:

```sh
python tools/import-snapshot.py data/snapshot/2026_09_01_performance_mania_top_10000.tar.bz2 data/snapshot/snapshot.sqlite
```

The importer keeps metadata and the top 50 legacy scores per sampled player, publishing the compact database only after a complete import. The sample is the overall Mania top 10,000, not the separate 7K leaderboard, and excludes current lazer scores. Previews retain 7K ranking selection, display the snapshot date and are replaced progressively by live BP. Observe the [snapshot licence](https://data.ppy.sh/LICENCE.txt) and contact its publisher for production use where required. No snapshot data is distributed in this repository.

## Optional hosting

Keep the application bound to loopback and place it behind your own HTTPS reverse proxy. Set `publicOrigin` to the exact external origin (for example `https://helper.example.com`) and forward `Host: 127.0.0.1:7277`. The proxy should preserve Origin and cookies and avoid caching personal/API responses. Hosted mode disables browser-initiated server shutdown. Node 24+ also runs the server on Linux; `--open` is Windows-only.

Anonymous browser cookies isolate jobs, last results and download queues; shared calculation/query caches remain reusable. IndexedDB retains that browser's last result. Different browsers or cleared site data create a new visitor; this is not cross-device account synchronization. Existing global result history is not automatically assigned to new visitors. Saved downloads can be retrieved from the download queue through the authenticated-by-visitor file route.

## Validation

```sh
npm test
python tools/snapshot-check.py
```

The offline checks cover top-50 collection/cache refresh, hybrid routing and cancellation, ZIP validation/fallback/local seeding, pp-range boundaries, progressive replacement, visitor isolation and snapshot import parsing. No OAuth credentials or network access are needed.
