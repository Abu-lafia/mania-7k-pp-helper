export function sourceNumber(value) {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 20 })
    : "--";
}
export function duration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "Estimating...";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${seconds % 60}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function flagUrl(country) {
  const code = String(country || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const name = [...code]
    .map((c) => (c.charCodeAt(0) + 127397).toString(16))
    .join("-");
  return `https://osu.ppy.sh/assets/images/flags/${name}.svg`;
}
export function danBadge(label, side = "regular") {
  if (typeof label !== "string") return null;
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[+-]+$/, "")
    .replace(/\s*dan$/, "")
    .trim();
  const suffix = label.trim().match(/[+-]+$/)?.[0] || "";
  const name = base === "kyu" ? "0" : base;
  if (!/^(?:[0-9]|10|gamma|azimuth|zenith|stellium)$/.test(name)) return null;
  return {
    src: `/assets/dans/${side === "ln" ? "ln-" : ""}${name}.svg`,
    suffix,
  };
}
export function histogram(rows, key) {
  const valid = rows.filter((r) => Number.isFinite(r[key]));
  if (!valid.length) return [];
  const values = valid.map((r) => r[key]).sort((a, b) => a - b),
    min = values[0],
    max = values.at(-1);
  if (min === max)
    return [{ min, max, label: String(min), rows: valid, last: true }];
  const quartile = (p) => values[Math.floor((values.length - 1) * p)];
  const fd = (2 * (quartile(0.75) - quartile(0.25))) / Math.cbrt(values.length);
  const count = Math.max(
    4,
    Math.min(
      24,
      Math.ceil((max - min) / (fd || (max - min) / Math.sqrt(values.length))),
    ),
  );
  const raw = (max - min) / count,
    power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= raw) ||
    10 * power;
  const start = Math.floor(min / step) * step;
  const n = Math.max(1, Math.ceil((max - start) / step));
  const bins = Array.from({ length: n }, (_, i) => ({
    min: Number((start + i * step).toPrecision(12)),
    max: Number((start + (i + 1) * step).toPrecision(12)),
    rows: [],
    last: i === n - 1,
  }));
  for (const row of valid)
    bins[
      Math.min(n - 1, Math.max(0, Math.floor((row[key] - start) / step)))
    ].rows.push(row);
  return bins;
}
export function danHistogram(players, side) {
  const groups = new Map();
  for (const p of players)
    if (p[side]?.group) {
      const d = p[side];
      if (!groups.has(d.group))
        groups.set(d.group, { label: d.group, rows: [], order: d.rating });
      groups.get(d.group).rows.push(p);
      groups.get(d.group).order = Math.min(groups.get(d.group).order, d.rating);
    }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
export function sorted(rows, key, direction = 1) {
  const get = (row, path) => path.split(".").reduce((v, p) => v?.[p], row);
  return [...rows].sort((a, b) => {
    const av = get(a, key),
      bv = get(b, key);
    if (av == null) return bv == null ? 0 : 1;
    if (bv == null) return -1;
    return (
      direction *
      (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "en", {
            numeric: true,
            sensitivity: "base",
          }))
    );
  });
}
