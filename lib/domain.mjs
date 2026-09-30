export const SPEEDS = {
  HT: { mods: 256, rate: 0.75 },
  NM: { mods: 0, rate: 1 },
  DT: { mods: 64, rate: 1.5 },
};
export function validateQuery(input) {
  const { mode, min, max } = input || {};
  if (!["rank", "pp"].includes(mode))
    throw new Error("Choose world rank or performance.");
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(min) ||
    !Number.isFinite(max)
  )
    throw new Error("Enter two valid numbers.");
  const [low, high] = mode === "rank" ? [1, 3000] : [6000, 40000];
  if (
    min < low ||
    max > high ||
    min > max ||
    (mode === "rank" && (!Number.isInteger(min) || !Number.isInteger(max)))
  )
    throw new Error(`Enter an inclusive range between ${low} and ${high}.`);
  return { mode, min, max, refresh: input.refresh === true };
}
export function modNames(mods) {
  if (typeof mods === "number")
    return [
      [256, "HT"],
      [64, "DT"],
      [512, "NC"],
      [65536, "4K"],
      [131072, "5K"],
      [262144, "6K"],
      [524288, "7K"],
      [32768, "9K"],
      [16777216, "8K"],
      [67108864, "3K"],
      [134217728, "2K"],
      [268435456, "1K"],
    ]
      .filter(([bit]) => (mods & bit) !== 0)
      .map(([, name]) => name);
  return (mods || [])
    .map((m) => (typeof m === "string" ? m : m.acronym))
    .filter(Boolean);
}
export function speedGroup(mods) {
  const names = modNames(mods);
  if (names.includes("DT") || names.includes("NC")) return "DT";
  return names.includes("HT") ? "HT" : "NM";
}
export function compactScore(score) {
  const b = score.beatmap,
    s = score.beatmapset;
  if (!b || !s) return { score_id: score.id, invalid: true };
  if (b.convert === true)
    return { score_id: score.id, is7: false, converted: true };
  const names = modNames(score.mods);
  const key = names.find((x) => /^[1-9]K$/.test(x));
  const is7 =
    Number(b.mode_int ?? (b.mode === "mania" ? 3 : -1)) === 3 &&
    Number(b.cs) === 7 &&
    (!key || key === "7K");
  if (!is7) return { score_id: score.id, is7: false };
  const custom = (score.mods || []).find?.(
    (m) =>
      typeof m === "object" &&
      ["DT", "NC", "HT"].includes(m.acronym) &&
      m.settings?.speed_change &&
      Math.abs(m.settings.speed_change - SPEEDS[speedGroup([m])].rate) > 0.001,
  );
  return {
    score_id: score.id,
    is7,
    mod: speedGroup(score.mods),
    custom_speed: !!custom,
    beatmap_id: b.id,
    beatmapset_id: s.id,
    checksum: b.checksum || "",
    artist: s.artist,
    title: s.title,
    creator: s.creator,
    difficulty: b.version,
    bpm: b.bpm,
    length: b.total_length,
    status: b.status,
    nsfw: s.nsfw === true,
    cover:
      s.covers?.list ||
      `https://assets.ppy.sh/beatmaps/${s.id}/covers/list.jpg`,
    achieved_pp: score.pp,
    updated_at: b.last_updated,
  };
}
export function createAggregation() {
  return {
    entries: new Map(),
    scoreCount: 0,
    non7: 0,
    converted: 0,
    invalid: 0,
    custom: 0,
  };
}
export function addPlayerScores(aggregation, player) {
  const { entries } = aggregation;
  const seen = new Set();
  for (const score of player.scores || []) {
    if (score.invalid) {
      aggregation.invalid++;
      continue;
    }
    if (score.converted) {
      aggregation.converted++;
      continue;
    }
    if (!score.is7) {
      aggregation.non7++;
      continue;
    }
    aggregation.scoreCount++;
    if (score.custom_speed) aggregation.custom++;
    const key = `${score.beatmap_id}:${score.mod}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!entries.has(key)) {
      const { score_id, is7, custom_speed, achieved_pp, ...map } = score;
      entries.set(key, {
        ...map,
        key,
        frequency: 0,
        player_ids: [],
        stars: null,
        pp_max: null,
        osu_url: `https://osu.ppy.sh/beatmapsets/${score.beatmapset_id}#mania/${score.beatmap_id}`,
        download_osu: `https://osu.ppy.sh/beatmapsets/${score.beatmapset_id}/download?noVideo=1`,
        download_sayo: `https://dl.sayobot.cn/beatmaps/download/novideo/${score.beatmapset_id}`,
      });
    }
    const entry = entries.get(key);
    entry.frequency++;
    entry.player_ids.push(player.id);
  }
}
export function finishAggregation(aggregation) {
  const { entries, scoreCount, non7, converted, invalid, custom } = aggregation;
  return {
    maps: [...entries.values()].sort(
      (a, b) =>
        b.frequency - a.frequency ||
        a.beatmap_id - b.beatmap_id ||
        a.mod.localeCompare(b.mod),
    ),
    scoreCount,
    non7,
    converted,
    invalid,
    custom,
  };
}
export function aggregateScores(players) {
  const aggregation = createAggregation();
  for (const player of players) addPlayerScores(aggregation, player);
  return finishAggregation(aggregation);
}
export function wholeDan(label) {
  if (typeof label !== "string" || !label.trim() || label === "-") return null;
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[+-]+$/, "")
    .replace(/\s*dan$/, "")
    .trim();
  return /^\d+$/.test(base) ? `${Number(base)}dan` : base;
}
export function trackerFields(data) {
  const mode = data?.modes?.find((m) => m.keyCount === 7);
  const field = (side) => {
    const dan = mode?.dan?.[side];
    return dan && typeof dan.label === "string" && Number.isFinite(dan.rawDan)
      ? { label: dan.label, rating: dan.rawDan, group: wholeDan(dan.label) }
      : null;
  };
  return {
    regular: field("rc"),
    ln: field("ln"),
    tracker_updated_at: data?.computedAt || null,
    tracker_status: data?.status || "unavailable",
  };
}
export function summary(players, maps) {
  const values = players.map((p) => p.pp).filter(Number.isFinite);
  const ranks = players.map((p) => p.rank).filter(Number.isFinite);
  return {
    players: players.length,
    rank_min: ranks.length ? Math.min(...ranks) : null,
    rank_max: ranks.length ? Math.max(...ranks) : null,
    pp_min: values.length ? Math.min(...values) : null,
    pp_max: values.length ? Math.max(...values) : null,
    maps: maps.length,
    unique_maps: new Set(maps.map((m) => m.beatmap_id)).size,
    sets: new Set(maps.map((m) => m.beatmapset_id)).size,
    calculated_maps: maps.filter((m) => Number.isFinite(m.pp_max)).length,
    regular: players.filter((p) => p.regular).length,
    ln: players.filter((p) => p.ln).length,
    bp_complete: players.filter((p) => p.bp_complete).length,
  };
}
