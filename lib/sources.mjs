import { setTimeout as delay } from "node:timers/promises";
import { parseRanking, parseProfile } from "./html.mjs";
import { compactScore, trackerFields } from "./domain.mjs";

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
export class Sources {
  constructor(
    cache,
    { fetcher = fetch, osuGap = 400, trackerGap = 300, timeout = 45000 } = {},
  ) {
    this.cache = cache;
    this.hosts = new Map();
    this.fetcher = fetcher;
    this.gaps = { "osu.ppy.sh": osuGap, "api.mania-tracker.com": trackerGap };
    this.timeout = timeout;
    this.requests = 0;
    this.hits = 0;
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
          Math.max(state.next, state.blocked) - Date.now(),
          undefined,
          { signal },
        );
      state.next = Date.now() + state.gap;
    } finally {
      release();
    }
  }
  async request(url, { signal, type = "json" } = {}) {
    const host = new URL(url).hostname;
    for (let attempt = 0; attempt < 4; attempt++) {
      signal?.throwIfAborted();
      await this.slot(host, signal);
      try {
        this.requests++;
        const response = await this.fetcher(url, {
          headers: {
            "User-Agent": "mania-7k-pp-helper/1.0 (local research tool)",
            Accept: type === "json" ? "application/json" : "*/*",
          },
          signal: AbortSignal.any([
            ...(signal ? [signal] : []),
            AbortSignal.timeout(this.timeout),
          ]),
        });
        if (!response.ok) {
          if (
            [429, 500, 502, 503, 504].includes(response.status) &&
            attempt < 3
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
            const state = this.host(host);
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
        const state = this.host(host);
        state.gap = Math.max(state.base, state.gap * 0.98);
        if (type === "bytes") return Buffer.from(await response.arrayBuffer());
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
        if (error instanceof HttpError || attempt === 3) throw error;
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
  tracker(id, signal, refresh) {
    return this.cached(`tracker-v1:${id}`, refresh ? 0 : 21600000, async () =>
      trackerFields(
        await this.request(
          `https://api.mania-tracker.com/api/profiles/${id}/skills`,
          { signal },
        ),
      ),
    );
  }
  async best(id, signal, refresh, onPage = () => {}) {
    const completeKey = `best-collection-native7-v1:${id}`;
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
      for (let offset = 0; offset < 100000; offset += 100) {
        signal?.throwIfAborted();
        const rows = await this.cached(
          `best-native7-v1:${id}:${offset}`,
          refresh ? 0 : 21600000,
          async () => {
            const scores = await this.request(
              `https://osu.ppy.sh/users/${id}/scores/best?mode=mania&limit=100&offset=${offset}`,
              { signal },
            );
            if (!Array.isArray(scores))
              throw new Error(
                "The osu! best-performance response is unavailable.",
              );
            return scores.map(compactScore);
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
        if (rows.length < 100) {
          const result = { scores: all, bp_complete: true, bp_pages: pages };
          this.cache.set?.(completeKey, result);
          return result;
        }
      }
      throw new Error(
        "The source exceeded 100,000 best performances for one player.",
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
