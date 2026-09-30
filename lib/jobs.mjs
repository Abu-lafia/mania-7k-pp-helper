import { randomUUID } from "node:crypto";
import {
  validateQuery,
  createAggregation,
  addPlayerScores,
  finishAggregation,
  summary,
} from "./domain.mjs";
import { calculateEntry, calculationKey, ENGINE } from "./calculator.mjs";
import { ppCandidates } from "./rankings.mjs";
import { createSteps, stepProgress, estimateRemaining } from "./progress.mjs";

export async function pool(items, count, callback, signal) {
  let index = 0;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(count, items.length) }, async () => {
      while (index < items.length) {
        signal?.throwIfAborted();
        const i = index++;
        await callback(items[i], i);
        if (i % 16 === 0) await new Promise(setImmediate);
      }
    }),
  );
  const rejected = results.find((x) => x.status === "rejected");
  if (rejected) throw rejected.reason;
}
async function settle(tasks) {
  const result = await Promise.allSettled(tasks);
  const failure = result.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
}
export class SearchJobs {
  constructor(sources, cache) {
    this.sources = sources;
    this.cache = cache;
    this.jobs = new Map();
    this.latest = cache.get("last-result-native7-v1");
  }
  start(input) {
    if ([...this.jobs.values()].some((j) => j.status === "running"))
      throw new Error(
        "A search is already running. Cancel it before starting another.",
      );
    const query = validateQuery(input);
    const job = {
      id: randomUUID(),
      query,
      status: "running",
      stage: "rankings",
      progress: 0,
      message: "Reading the global 7K rankings...",
      started_at: new Date().toISOString(),
      controller: new AbortController(),
      players: [],
      maps: [],
      issues: [],
      log: [],
      counts: {},
      steps: createSteps(),
      start_requests: this.sources.requests,
      start_hits: this.sources.hits,
    };
    for (const [id, old] of this.jobs)
      if (old.status !== "running") this.jobs.delete(id);
    this.jobs.set(job.id, job);
    job.task = this.run(job).catch((error) => {
      job.status = job.controller.signal.aborted ? "cancelled" : "error";
      job.message =
        job.status === "cancelled"
          ? "Search cancelled. Cached data can be reused."
          : error.message;
      job.error = job.status === "error" ? error.message : null;
      job.completed_at = new Date().toISOString();
    });
    return this.status(job.id);
  }
  status(id) {
    const j = this.jobs.get(id);
    if (!j) return null;
    const {
      controller,
      players,
      maps,
      issues,
      task,
      result,
      start_requests,
      start_hits,
      ...safe
    } = j;
    const now = j.completed_at
      ? new Date(j.completed_at).getTime()
      : Date.now();
    return {
      ...safe,
      issue_count: issues.length,
      recent_issues: issues.slice(-3),
      has_result: !!result,
      elapsed_ms: Math.max(0, now - new Date(j.started_at).getTime()),
      estimated_remaining_ms: estimateRemaining(j, now),
      metrics: {
        requests: this.sources.requests - start_requests,
        cache_hits: this.sources.hits - start_hits,
      },
    };
  }
  cancel(id) {
    const j = this.jobs.get(id);
    if (j?.status === "running") j.controller.abort();
    return this.status(id);
  }
  step(job, name, total, done, message) {
    const step = job.steps[name];
    if (!step.started_at) step.started_at = Date.now();
    Object.assign(step, {
      total,
      done,
      status: total != null && done >= total ? "complete" : "running",
    });
    if (step.status === "complete" && !step.completed_at)
      step.completed_at = Date.now();
    job.stage = name;
    job.progress = Math.max(
      job.progress,
      Math.min(99, stepProgress(job.steps)),
    );
    if (message) {
      job.message = message;
      job.log.push(message);
      if (job.log.length > 12) job.log.shift();
    }
  }
  issue(job, stage, player, message) {
    job.issues.push({
      stage,
      player_id: player?.id,
      username: player?.username,
      message,
    });
  }
  async run(job) {
    const { query: q, controller } = job,
      signal = controller.signal,
      src = this.sources;
    let candidates = [];
    if (q.mode === "rank") {
      const first = Math.ceil(q.min / 50),
        last = Math.ceil(q.max / 50);
      const pages = Array.from(
        { length: last - first + 1 },
        (_, i) => first + i,
      );
      let done = 0;
      this.step(job, "rankings", pages.length, 0);
      await pool(
        pages,
        4,
        async (page) => {
          const rows = await src.ranking(page, signal, q.refresh);
          candidates.push(
            ...rows.filter((p) => p.rank >= q.min && p.rank <= q.max),
          );
          this.step(
            job,
            "rankings",
            pages.length,
            ++done,
            `Ranking pages: ${done} / ${pages.length}`,
          );
        },
        signal,
      );
      if (candidates.length !== q.max - q.min + 1)
        throw new Error(
          "The requested rank range was not fully returned by osu!. Please refresh and retry.",
        );
    } else {
      this.step(job, "rankings", null, 0);
      const found = await ppCandidates(
        src,
        q,
        signal,
        (read, page, fraction) => {
          this.step(
            job,
            "rankings",
            null,
            read,
            `Locating pp range: ${read} pages checked (page ${page})`,
          );
          job.progress = Math.max(
            job.progress,
            fraction == null ? Math.min(8, read * 0.5) : 8 + 6 * fraction,
          );
        },
      );
      candidates = found.players;
      this.step(job, "rankings", found.pages, found.pages);
      if (found.truncated)
        this.issue(
          job,
          "rankings",
          null,
          "The public leaderboard ends at rank 10,000. The pp range may contain additional players beyond that source limit.",
        );
    }
    if (new Set(candidates.map((p) => p.id)).size !== candidates.length)
      throw new Error(
        "The rankings changed during pagination and returned duplicate players. Please refresh and retry.",
      );
    candidates.sort((a, b) => a.rank - b.rank);
    const total = candidates.length,
      aggregation = createAggregation(),
      knownMaps = new Set();
    const ready = candidates.map(() => Promise.withResolvers());
    let profilesDone = 0,
      trackerDone = 0,
      bestDone = 0;
    for (const name of ["profiles", "tracker", "best"])
      this.step(job, name, total, 0);

    // Per-player readiness pipelines osu! profiles/BP alongside the independent tracker host.
    const profilesTask = pool(
      candidates,
      6,
      async (player, i) => {
        try {
          Object.assign(
            player,
            await src.profile(player.id, signal, q.refresh),
          );
        } catch (error) {
          signal.throwIfAborted();
          this.issue(job, "profile", player, error.message);
        }
        const included =
          q.mode === "rank" ||
          (Number.isFinite(player.pp) &&
            player.pp >= q.min &&
            player.pp <= q.max);
        if (included) job.players.push(player);
        ready[i].resolve(included ? player : null);
        this.step(
          job,
          "profiles",
          total,
          ++profilesDone,
          `Exact 7K pp: ${profilesDone} / ${total}`,
        );
      },
      signal,
    ).finally(() => {
      for (const item of ready) item.resolve(null);
    });

    const trackerTask = pool(
      candidates,
      4,
      async (_, i) => {
        const player = await ready[i].promise;
        signal.throwIfAborted();
        if (player) {
          try {
            Object.assign(
              player,
              await src.tracker(player.id, signal, q.refresh),
            );
            if (!player.regular || !player.ln)
              this.issue(
                job,
                "tracker",
                player,
                `Missing ${!player.regular && !player.ln ? "regular and LN" : !player.regular ? "regular" : "LN"} dan (${player.tracker_status}).`,
              );
          } catch (error) {
            signal.throwIfAborted();
            this.issue(job, "tracker", player, error.message);
          }
        }
        this.step(
          job,
          "tracker",
          total,
          ++trackerDone,
          `Mania Tracker: ${trackerDone} / ${total}`,
        );
      },
      signal,
    );

    const bestTask = pool(
      candidates,
      4,
      async (_, i) => {
        const player = await ready[i].promise;
        signal.throwIfAborted();
        if (player) {
          Object.assign(
            player,
            await src.best(player.id, signal, q.refresh, (count) => {
              job.counts.current_player = player.username;
              job.counts.current_scores = count;
            }),
          );
          player.bp_count = player.scores.length;
          player.bp_7k_count = player.scores.filter((s) => s.is7).length;
          addPlayerScores(aggregation, player);
          for (const score of player.scores) {
            if (!score.is7) continue;
            const key = calculationKey(score);
            if (knownMaps.has(key)) continue;
            knownMaps.add(key);
            if (!this.cache.has?.(key))
              job.counts.uncached_maps = (job.counts.uncached_maps || 0) + 1;
          }
          delete player.scores;
          if (!player.bp_complete)
            this.issue(job, "best", player, player.bp_error);
        }
        this.step(
          job,
          "best",
          total,
          ++bestDone,
          `Best performances: ${bestDone} / ${total} players`,
        );
      },
      signal,
    );

    let grouped;
    const calculationsTask = (async () => {
      await settle([profilesTask, bestTask]);
      signal.throwIfAborted();
      grouped = finishAggregation(aggregation);
      job.maps = grouped.maps;
      if (grouped.invalid)
        this.issue(
          job,
          "best",
          null,
          `${grouped.invalid} scores had no beatmap metadata and could not be classified.`,
        );
      if (grouped.custom)
        this.issue(
          job,
          "normalization",
          null,
          `${grouped.custom} scores used a custom clock rate. They are grouped into their requested standard HT / NM / DT-NC speed bucket.`,
        );
      let done = 0;
      this.step(job, "calculation", job.maps.length, 0);
      await pool(
        job.maps,
        4,
        async (map) => {
          try {
            Object.assign(map, await calculateEntry(map, src, signal));
          } catch (error) {
            signal.throwIfAborted();
            map.calculation_error = error.message;
            if (error.code === "NOT_NATIVE_7K") map.excluded = true;
            this.issue(
              job,
              "calculation",
              null,
              `${map.artist} - ${map.title} [${map.difficulty}] (${map.mod}): ${error.message}`,
            );
          }
          this.step(
            job,
            "calculation",
            job.maps.length,
            ++done,
            `7K stars and perfect pp: ${done} / ${job.maps.length}`,
          );
        },
        signal,
      );
      job.maps = job.maps.filter((map) => !map.excluded);
    })();
    await settle([profilesTask, trackerTask, bestTask, calculationsTask]);
    signal.throwIfAborted();
    job.players.sort((a, b) => a.rank - b.rank);
    const players = job.players;
    job.result = {
      id: job.id,
      query: q,
      started_at: job.started_at,
      completed_at: new Date().toISOString(),
      players,
      maps: job.maps,
      issues: job.issues,
      summary: summary(players, job.maps),
      coverage: {
        total_scores: players.reduce((sum, p) => sum + p.bp_count, 0),
        seven_key_scores: grouped.scoreCount,
        non_seven_key_scores: grouped.non7,
        converted_scores: grouped.converted,
        invalid_scores: grouped.invalid,
      },
      sources: {
        rankings:
          "https://osu.ppy.sh/rankings/mania/global/performance?variant=7k",
        tracker: "https://mania-tracker.com/?country=GLOBAL",
        calculator: ENGINE,
        calculation:
          "100% perfect, full combo; osu!stable; only HT (0.75x), NM (1x), DT/NC (1.5x).",
        bp: "All available osu!mania best-performance pages, including stable and lazer scores. Only native 7K maps; standard-mode converts are excluded.",
        requests: src.requests - job.start_requests,
        cache_hits: src.hits - job.start_hits,
      },
    };
    this.cache.set("last-result-native7-v1", job.result);
    this.latest = job.result;
    job.status = "complete";
    job.progress = 100;
    job.message = job.issues.length
      ? "Complete with source notes."
      : "Search complete.";
    job.completed_at = job.result.completed_at;
  }
}
