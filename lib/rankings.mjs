export async function ppCandidates(
  source,
  query,
  signal,
  onProgress = () => {},
) {
  const pages = new Map();
  let read = 0;
  async function page(number) {
    signal?.throwIfAborted();
    if (!pages.has(number)) {
      const rows = await source.ranking(number, signal, query.refresh);
      pages.set(number, rows);
      onProgress(++read, number);
    }
    return pages.get(number);
  }
  const firstRows = await page(1);
  if (firstRows[0].rounded_pp < query.min - 1)
    return { players: [], truncated: false, pages: read };
  // Rankings are descending. Keep a one-pp guard for rounded leaderboard cells.
  async function lowerBound(low, predicate) {
    let high = 201;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const rows = await page(mid);
      if (predicate(rows.at(-1).rounded_pp) || rows.length < 50) high = mid;
      else low = mid + 1;
    }
    return low;
  }
  const first =
    firstRows.at(-1).rounded_pp <= query.max + 1
      ? 1
      : await lowerBound(1, (pp) => pp <= query.max + 1);
  if (first > 200) return { players: [], truncated: true, pages: read };
  const firstPage = await page(first);
  const end =
    firstPage.at(-1).rounded_pp < query.min - 1 || firstPage.length < 50
      ? first
      : await lowerBound(first, (pp) => pp < query.min - 1);
  const last = Math.min(200, end);
  const players = [];
  for (let number = first; number <= last; number++) {
    const rows = await page(number);
    players.push(
      ...rows.filter(
        (p) => p.rounded_pp >= query.min - 1 && p.rounded_pp <= query.max + 1,
      ),
    );
    onProgress(read, number, (number - first + 1) / (last - first + 1));
  }
  return { players, truncated: end > 200, pages: read };
}
