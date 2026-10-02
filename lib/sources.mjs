import { setTimeout as delay } from "node:timers/promises";
import { parseRanking, parseProfile } from "./html.mjs";
import { compactScore, trackerFields } from "./domain.mjs";
import { OsuAuth } from "./osu-auth.mjs";
import { BeatmapDownloads } from "./beatmap-download.mjs";

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export class Sources {
  constructor(
    cache,
    { fetcher = fetch, osuGap = 400, trackerGap = 300, timeout = 45000, oauth, localBeatmapDirectory } = {},
  ) {
    this.cache = cache;
    this.hosts = new Map();
    this.fetcher = fetcher;
    this.localBeatmapDirectory = localBeatmapDirectory;
    this.auth = oauth?.clientId && oauth?.clientSecret ? new OsuAuth(oauth, fetcher) : null;
    this.gaps = { "osu.ppy.sh": osuGap, "api.mania-tracker.com": trackerGap };
    this.gaps['osu.ppy.sh:api'] = Math.max(1000, osuGap);
    this.gaps['osu.ppy.sh:maps'] = 200;
    this.timeout = timeout;
    this.requests = 0;
    this.hits = 0;
    this.bpReservations = { api: 0, web: 0 };
    this.bpRequests = { api: 0, web: 0 };
    this.beatmapDownloads = new BeatmapDownloads(this);
  }
  host(name) {
    if (!this.hosts.has(name))
      this.hosts.set(name, {
        tail: Promise.resolve(),
        next: 0,
        blocked: 0,
        base: this.gaps[name] ?? 300,
        gap: this.gaps[name] ?? 300,
      });
    return this.hosts.get(name);
  }
  downloadBeatmap(entry, signal) {
    return this.beatmapDownloads.download(entry, signal);
  }
  async slot(host, signal) {
    const state = this.host(host),
      previous = state.tail;
    let release;
    state.tail = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      signal?.throwIfAborted();
      // Recheck cooldown after waiting: another in-flight request may return 429.
      while (Math.max(state.next, state.blocked) > Date.now())
        await delay(
          Math.max(1, Math.max(state.next, state.blocked) - Date.now()),
          undefined,
          { signal },
        );
      state.next = Date.now() + state.gap;
    } finally {
      release();
    }
  }
  async request(url, { signal, type = "json", headers = {}, partial = false, details = false,
    timeout = this.timeout, attempts = 4 } = {}) {
    const host = new URL(url).hostname;
    const isApi = url.startsWith('https://osu.ppy.sh/api/v2/');
    const queueHost = isApi ? `${host}:api` : url.startsWith('https://osu.ppy.sh/osu/') ? `${host}:maps` : host;
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal?.throwIfAborted();
      await this.slot(queueHost, signal);
      try {
        const authorization = isApi && this.auth ? { Authorization: `Bearer ${await this.auth.token()}` } : {};
        this.requests++;
        const response = await this.fetcher(url, {
          headers: {
            ...authorization,
            ...(isApi ? { 'x-api-version': '20220705' } : {}),
            "User-Agent": "mania-7k-pp-helper/1.0 (local research tool)",
            Accept: type === "json" ? "application/json" : "*/*",
            ...headers,
          },
          signal: AbortSignal.any([
            ...(signal ? [signal] : []),
            AbortSignal.timeout(timeout),
          ]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401 && isApi && this.auth && attempt < attempts - 1) {
            this.auth.expires = 0;
            continue;
          }
          if (
            [429, 500, 502, 503, 504].includes(response.status) &&
            attempt < attempts - 1
          ) {
            const retry = response.headers.get("retry-after");
            const retryMs = retry
              ? Number.isFinite(Number(retry))
                ? Number(retry) * 1000
                : Date.parse(retry) - Date.now()
              : 0;
            const pause = Math.min(
              120000,
              Math.max(1500 * 2 ** attempt, retryMs || 0),
            );
            const state = this.host(queueHost);
            state.blocked = Math.max(state.blocked, Date.now() + pause);
            if (response.status === 429)
              state.gap = Math.min(4000, Math.max(state.gap * 1.5, 650));
            await delay(pause, undefined, { signal });
            continue;
          }
          throw new HttpError(
            `${host} returned HTTP ${response.status}.`,
            response.status,
          );
        }
        const state = this.host(queueHost);
        state.gap = Math.max(state.base, state.gap * 0.98);
        if (partial && response.status !== 206) {
          await response.body?.cancel();
          throw new HttpError('Mirror does not support partial downloads.', response.status);
        }
        if (type === "bytes") {
          const bytes = Buffer.from(await response.arrayBuffer());
          return details ? { bytes, url: response.url, range: response.headers.get('content-range') } : bytes;
        }
        if (type === "text") return await response.text();
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch {
          throw new Error(
            `${host} returned a non-JSON response. Please retry later.`,
          );
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof HttpError || attempt === attempts - 1) throw error;
        await delay(1000 * 2 ** attempt, undefined, { signal });
      }
    }
  }
  cached(key, ttl, loader) {
    const cached = this.cache.get(key, ttl);
    if (cached !== null) {
      this.hits++;
      return Promise.resolve(cached);
    }
    return this.cache.memo(key, ttl, loader);
  }
  ranking(page, signal, refresh) {
    if (this.auth) return this.cached(`ranking-hybrid7-v1:${page}`, refresh ? 0 : 3600000, async () => {
      const route = this.chooseBpRoute();
      if (route === 'web') {
        const rows = parseRanking(await this.request(
          `https://osu.ppy.sh/rankings/mania/global/performance?variant=7k&page=${page}`,
          {signal,type:'text',timeout:12000,attempts:2}));
        if (rows[0].rank !== (page - 1) * 50 + 1) throw new Error('Invalid public ranking page.');
        return rows;
      }
      const data = await this.request(
        `https://osu.ppy.sh/api/v2/rankings/mania/performance?variant=7k&cursor[page]=${page}`, { signal });
      if (!Array.isArray(data.ranking) || !data.ranking.length) throw new Error('The osu! 7K rankings are unavailable.');
      return data.ranking.map((stats, i) => {
        if (!Number.isFinite(stats.pp) || !stats.user?.id) throw new Error('Invalid osu! 7K ranking statistics.');
        return { id: stats.user.id, username: stats.user.username,
          rank: (page - 1) * 50 + i + 1, profile_rank: stats.global_rank,
          pp: stats.pp, rounded_pp: stats.pp, avatar: stats.user.avatar_url,
          country: stats.user.country_code, country_name: stats.user.country?.name || '',
          accuracy: stats.hit_accuracy ?? stats.accuracy * 100, play_count: stats.play_count,
          ranked_score: stats.ranked_score, ss: (stats.grade_counts?.ss || 0) + (stats.grade_counts?.ssh || 0),
          s: (stats.grade_counts?.s || 0) + (stats.grade_counts?.sh || 0), a: stats.grade_counts?.a || 0 };
      });
    });
    return this.cached(
      `ranking-v1:${page}`,
      refresh ? 0 : 3600000,
      async () => {
        const html = await this.request(
          `https://osu.ppy.sh/rankings/mania/global/performance?variant=7k&page=${page}`,
          { signal, type: "text" },
        );
        const rows = parseRanking(html);
        if (rows[0].rank !== (page - 1) * 50 + 1)
          throw new Error(
            `Ranking page ${page} did not contain the requested ranks.`,
          );
        return rows;
      },
    );
  }
  profile(id, signal, refresh) {
    return this.cached(`profile-v1:${id}`, refresh ? 0 : 3600000, async () =>
      parseProfile(
        await this.request(`https://osu.ppy.sh/users/${id}/mania`, {
          signal,
          type: "text",
        }),
        id,
      ),
    );
  }
  async resolveProfiles(players, signal, refresh) {
    if (!this.auth) return;
    const missing = players.filter(p => !Number.isFinite(p.pp));
    const batches = [];
    for (let i=0;i<missing.length;i+=50) batches.push(missing.slice(i,i+50));
    await Promise.all(batches.map(async batch => {
      const ids = batch.map(p=>p.id).sort((a,b)=>a-b);
      try {
        const users = await this.cached(`users-7k-v1:${ids.join(',')}`, refresh ? 0 : 3600000, async () => {
          const query = new URLSearchParams({include_variant_statistics:'true'});
          for (const id of ids) query.append('ids[]',id);
          const data = await this.request(`https://osu.ppy.sh/api/v2/users?${query}`, {signal,timeout:12000,attempts:2});
          if (!Array.isArray(data.users)) throw new Error('Invalid batch user response.');
          return data.users;
        });
        for (const player of batch) {
          const user=users.find(u=>u.id===player.id);
          const stats=user?.statistics_rulesets?.mania?.variants?.find(v=>v.variant==='7k');
          if (Number.isFinite(stats?.pp)) Object.assign(player,{pp:stats.pp,profile_rank:stats.global_rank,avatar:user.avatar_url});
        }
      } catch(error) { signal?.throwIfAborted(); /* Individual profiles remain a fallback. */ }
    }));
  }
  tracker(id, signal, refresh) {
    return this.cached(`tracker-v1:${id}`, refresh ? 0 : 21600000, async () =>
      trackerFields(
        await this.request(
          `https://api.mania-tracker.com/api/profiles/${id}/skills`,
          { signal, timeout: 10000, attempts: 2 },
        ),
      ),
    );
  }
  chooseBpRoute() {
    if (!this.auth) return 'web';
    const available = route => {
      const state = this.host(route === 'api' ? 'osu.ppy.sh:api' : 'osu.ppy.sh');
      return Math.max(Date.now(), state.next, state.blocked, this.bpReservations[route]);
    };
    const api = available('api'), web = available('web');
    const route = api <= web ? 'api' : 'web';
    const state = this.host(route === 'api' ? 'osu.ppy.sh:api' : 'osu.ppy.sh');
    // Reserve before yielding so simultaneous workers choose different capacity.
    this.bpReservations[route] = (route === 'api' ? api : web) + state.gap;
    return route;
  }
  async best(id, signal, refresh, onPage = () => {}) {
    const completeKey = `best-top50-v2:${id}`;
    const cached = refresh ? null : this.cache.get?.(completeKey, 21600000);
    if (cached?.bp_complete) {
      this.hits++;
      onPage(cached.scores.length);
      return cached;
    }
    const all = [],
      seen = new Set();
    let pages = 0;
    try {
      for (let offset = 0; offset < 50; offset += 50) {
        signal?.throwIfAborted();
        const rows = await this.cached(
          `best-page-top50-v2:${id}:${offset}`,
          refresh ? 0 : 21600000,
          async () => {
            signal?.throwIfAborted();
            const route = this.chooseBpRoute();
            this.bpRequests[route]++;
            const scores = await this.request(
              `https://osu.ppy.sh/${route === 'api' ? 'api/v2/' : ''}users/${id}/scores/best?mode=mania&limit=50&legacy_only=0&offset=${offset}`,
              { signal },
            );
            if (!Array.isArray(scores))
              throw new Error(
                "The osu! best-performance response is unavailable.",
              );
            return scores.slice(0, 50).map(compactScore);
          },
        );
        pages++;
        onPage(all.length + rows.length);
        for (const row of rows) {
          if (!row.score_id || seen.has(String(row.score_id)))
            throw new Error(
              "Repeated or invalid BP page; pagination stopped to avoid double counting.",
            );
          seen.add(String(row.score_id));
          all.push(row);
        }
        if (rows.length <= 50) {
          const result = { scores: all, bp_complete: true, bp_pages: pages, bp_limit: 50 };
          this.cache.set?.(completeKey, result);
          return result;
        }
      }
      throw new Error(
        "The source exceeded the requested top 50 best performances.",
      );
    } catch (error) {
      signal?.throwIfAborted();
      return {
        scores: all,
        bp_complete: false,
        bp_pages: pages,
        bp_error: error.message,
      };
    }
  }
}
