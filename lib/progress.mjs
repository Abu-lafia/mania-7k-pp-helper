const WEIGHTS = {
  rankings: 15,
  profiles: 15,
  tracker: 10,
  best: 30,
  calculation: 30,
};
export function createSteps() {
  return Object.fromEntries(
    Object.keys(WEIGHTS).map((name) => [
      name,
      {
        done: 0,
        total: null,
        status: "pending",
        started_at: null,
        completed_at: null,
      },
    ]),
  );
}
export function stepProgress(steps) {
  return Object.entries(steps).reduce(
    (n, [key, step]) =>
      n +
      WEIGHTS[key] *
        (step.status === "complete"
          ? 1
          : step.total
            ? Math.min(0.99, step.done / step.total)
            : 0),
    0,
  );
}
export function estimateRemaining(job, now = Date.now()) {
  if (job.status === "complete") return 0;
  if (job.status !== "running" || job.steps.rankings.status !== "complete")
    return null;
  const steps = job.steps;
  const elapsed = now - new Date(job.started_at).getTime();
  if (elapsed < 3000) return null;
  function remaining(name, fallback) {
    const step = steps[name];
    if (step.status === "complete") return 0;
    const perUnit =
      step.done > 0 && step.started_at
        ? (now - step.started_at) / step.done
        : fallback;
    return Math.max(0, (step.total || 0) - step.done) * perUnit;
  }
  if (steps.calculation.status === "running")
    return Math.max(remaining("calculation", 650), remaining("tracker", 600));
  if (steps.calculation.status === "complete") return remaining("tracker", 600);
  const collection = Math.max(
    remaining("profiles", 700),
    remaining("best", 2100),
    remaining("tracker", 600),
  );
  const completed = steps.best.done;
  const known = job.counts.uncached_maps || 0;
  // Unknown future maps make early ETAs approximate. Recompute as unique maps arrive.
  const maps =
    completed > 0
      ? known * Math.sqrt((steps.best.total || 1) / completed)
      : (steps.best.total || 0) * 20;
  const perMap = job.calculation_ms_per_map || 650;
  return Math.max(0, collection + maps * perMap);
}
