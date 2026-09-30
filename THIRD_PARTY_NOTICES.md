# Third-party components

The source distribution includes the following browser libraries and their license files:

| Component | Version | Source / license |
| --- | --- | --- |
| Chart.js | 4.5.1 | [chartjs/Chart.js](https://github.com/chartjs/Chart.js); MIT, see `public/vendor/chart-LICENSE.md` |
| Lucide | 0.468.0 | [lucide-icons/lucide](https://github.com/lucide-icons/lucide); ISC, see `public/vendor/lucide-LICENSE.txt` |
| Nunito variable font | Pinned commit `8c6a9bb9732545b9ed53f29ec5e1ab0ff53c4e6f` | [googlefonts/nunito](https://github.com/googlefonts/nunito); SIL Open Font License 1.1, see `public/fonts/OFL.txt` and `public/fonts/SOURCE.json` |

The following dependencies are installed by npm. Their respective license files are included in the installed packages:

| Component | Version | License |
| --- | --- | --- |
| rosu-pp-js | 4.0.1 | MIT |
| parse5 | 7.3.0 | MIT |
| entities | 6.0.1 | BSD-2-Clause |
| @redis/client | 6.2.1 | MIT |
| cluster-key-slot | 1.1.2 | Apache-2.0 |

Node.js must be installed separately; no runtime or Redis server is included in this repository.

## External assets and data

- The interface uses the bundled, unmodified Nunito variable font. Torus is not distributed or requested by this source release.
- Original 7K regular/LN dan artwork is requested from [Mania Tracker](https://mania-tracker.com/dan-estimates) when not already cached locally. These images are not redistributed in this repository and belong to their respective creators. SHA-256 fingerprints in `lib/dan-assets.mjs` pin the same artwork for every installation. If the original site changes an image or becomes unavailable, existing verified caches still work, while new downloads may require an application update. The textual dan label remains visible. See the site's [terms](https://mania-tracker.com/terms).
- Player avatars, country flags, beatmap cover thumbnails, rankings, scores, and beatmap files come from osu!.
- Dan estimates and numerical ratings come from Mania Tracker.
- Beatmap archive downloads are provided by osu! and SayoBot.

Runtime asset caches, user configuration, credentials, collected player data, and downloaded beatmaps are not part of the source distribution.

This project does not claim affiliation with osu!, Mania Tracker, SayoBot, or the authors of its dependencies. Their assets, data, trademarks, and services remain subject to their respective rights and terms.

