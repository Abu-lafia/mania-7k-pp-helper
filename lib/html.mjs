import { parse } from "parse5";

export function walk(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  for (const child of node.childNodes || []) walk(child, predicate, out);
  return out;
}
export const attr = (node, name) =>
  node?.attrs?.find((a) => a.name === name)?.value;
const hasClass = (node, name) =>
  (attr(node, "class") || "").split(/\s+/).includes(name);
const text = (node) =>
  node.nodeName === "#text"
    ? node.value
    : (node.childNodes || []).map(text).join("");
const number = (value) => Number(String(value).replace(/[^\d.-]/g, ""));

export function parseRanking(html) {
  const doc = parse(html);
  const rows = walk(
    doc,
    (n) => n.tagName === "tr" && hasClass(n, "ranking-page-table__row"),
  );
  if (!rows.length)
    throw new Error(
      "The osu! ranking table is unavailable or its format has changed.",
    );
  return rows.map((row) => {
    const cols = (row.childNodes || []).filter((n) => n.tagName === "td");
    const user = walk(row, (n) =>
      hasClass(n, "ranking-page-table-main__link"),
    )[0];
    const country = walk(
      row,
      (n) => n.tagName === "a" && /[?&]country=/.test(attr(n, "href") || ""),
    )[0];
    const flag = walk(row, (n) => hasClass(n, "flag-country"))[0];
    if (cols.length < 6 || !user)
      throw new Error("An osu! ranking row could not be read.");
    const player = {
      id: Number(attr(user, "data-user-id")),
      username: text(user).trim(),
      rank: number(text(cols[0])),
      country:
        new URL(attr(country, "href") || "https://osu.ppy.sh").searchParams.get(
          "country",
        ) || "",
      country_name: attr(flag, "title") || "",
      accuracy: number(text(cols[2])),
      play_count: number(text(cols[3])),
      ranked_score: number(text(cols[4])),
      rounded_pp: number(text(cols[5])),
      ss: number(text(cols[6] || { childNodes: [] })),
      s: number(text(cols[7] || { childNodes: [] })),
      a: number(text(cols[8] || { childNodes: [] })),
      pp: null,
    };
    if (
      !Number.isInteger(player.id) ||
      player.id <= 0 ||
      player.rank < 1 ||
      !player.username ||
      !Number.isFinite(player.rounded_pp)
    )
      throw new Error("Invalid osu! ranking data.");
    return player;
  });
}

export function parseProfile(html, expectedId) {
  const doc = parse(html);
  for (const node of walk(doc, (n) => attr(n, "data-initial-data"))) {
    try {
      const data = JSON.parse(attr(node, "data-initial-data"));
      if (Number(data.user?.id) !== expectedId) continue;
      const user = data.user;
      const variant = user.statistics?.variants?.find(
        (v) => v.variant === "7k",
      );
      if (!variant || !Number.isFinite(variant.pp))
        throw new Error("7K statistics are missing from this profile.");
      return {
        pp: variant.pp,
        profile_rank: variant.global_rank,
        avatar: user.avatar_url,
        profile_updated_at: new Date().toISOString(),
      };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error("The osu! profile data could not be read.");
}
