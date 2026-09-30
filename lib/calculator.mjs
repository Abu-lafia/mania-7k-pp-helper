import rosu from "rosu-pp-js";
import { SPEEDS } from "./domain.mjs";
export const ENGINE = "rosu-pp-js 4.0.1";
export const calculationKey = (entry) =>
  `calc:${ENGINE}:native7:stable:${entry.beatmap_id}:${entry.checksum}:${entry.mod}`;
export function calculate(bytes, mod) {
  let map, perf, attrs, diff;
  try {
    map = new rosu.Beatmap(bytes);
    if (map.mode !== rosu.GameMode.Mania || Math.round(map.cs) !== 7) {
      const error = new Error(
        "Excluded: the original .osu file is not native 7K mania.",
      );
      error.code = "NOT_NATIVE_7K";
      throw error;
    }
    if (map.isSuspicious())
      throw new Error(
        "The beatmap exceeds the calculation engine safety limits.",
      );
    perf = new rosu.Performance({
      mods: SPEEDS[mod].mods,
      lazer: false,
      accuracy: 100,
      misses: 0,
    });
    attrs = perf.calculate(map);
    diff = attrs.difficulty;
    if (!Number.isFinite(attrs.pp) || !Number.isFinite(diff.stars))
      throw new Error("The calculation returned invalid attributes.");
    return { stars: diff.stars, pp_max: attrs.pp, rate: SPEEDS[mod].rate };
  } finally {
    diff?.free();
    attrs?.free();
    perf?.free();
    map?.free();
  }
}
export async function calculateEntry(entry, sources, signal) {
  const key = calculationKey(entry);
  return sources.cached(key, Infinity, async () => {
    const encoded = await sources.cached(
      `osu-v1:${entry.beatmap_id}:${entry.checksum}`,
      entry.checksum ? Infinity : 86400000,
      async () => {
        const bytes = await sources.request(
          `https://osu.ppy.sh/osu/${entry.beatmap_id}`,
          { signal, type: "bytes" },
        );
        if (!bytes.subarray(0, 100).toString().includes("osu file format"))
          throw new Error(
            "The beatmap download returned an invalid .osu file.",
          );
        return bytes.toString("base64");
      },
    );
    return calculate(Buffer.from(encoded, "base64"), entry.mod);
  });
}
