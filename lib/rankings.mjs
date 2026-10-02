export async function ppCandidates(
  source,
  query,
  signal,
  onProgress = () => {},
) {
  const pages = new Map();
  const guard = 1; // Public pages are rounded; verify exact pp before inclusion.
  let read = 0;
  async function page(number) {
    signal?.throwIfAborted();
    if (!pages.has(number)) {
      const task = source.ranking(number, signal, query.refresh).then(rows => {
        onProgress(++read, number); return rows;
      });
      pages.set(number, task);
    }
    return pages.get(number);
  }
  const firstRows = await page(1);
  if (firstRows[0].rounded_pp < query.min - guard)
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
  const firstTask =
    firstRows.at(-1).rounded_pp <= query.max + guard
      ? 1
      : lowerBound(1, (pp) => pp <= query.max + guard);
  const endTask = firstRows.at(-1).rounded_pp < query.min - guard
    ? 1 : lowerBound(1, (pp) => pp < query.min - guard);
  const [first, end] = await Promise.all([firstTask, endTask]);
  if (first > 200) return { players: [], truncated: true, pages: read };
  const last = Math.min(200, end);
  const players = [];
  for (let number = first; number <= last; number++) {
    const rows = await page(number);
    players.push(
      ...rows.filter(
        (p) => p.rounded_pp >= query.min - guard && p.rounded_pp <= query.max + guard,
      ),
    );
    onProgress(read, number, (number - first + 1) / (last - first + 1));
  }
  return { players, truncated: end > 200, pages: read };
}
