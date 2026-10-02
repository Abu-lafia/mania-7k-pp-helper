import { t, statusText, locale, initLanguage } from "./i18n.js";
import { loadPersonalResult, savePersonalResult } from './visitor-storage.js';
initLanguage();
import {
  histogram,
  danHistogram,
  sorted,
  sourceNumber,
  duration,
  flagUrl,
  danBadge,
} from "./core.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (value, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })
    : "--";
const icon = (name) => `<i data-lucide="${name}"></i>`;
const icons = () => window.lucide?.createIcons();
const safeUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      (["a.ppy.sh", "assets.ppy.sh"].includes(u.hostname) ||
        (u.hostname === "osu.ppy.sh" &&
          /^\/assets\/images\/flags\/[a-f0-9-]+\.svg$/.test(u.pathname)))
      ? `/api/image?url=${encodeURIComponent(u.href)}`
      : "";
  } catch {
    return "";
  }
};
const state = {
  token: null,
  result: null,
  view: "players",
  job: null,
  tables: new Map(),
  selected: new Set(),
  charts: new Map(),
  bins: new Map(),
  metric: "pp_max",
  range: { rank: [1, 100], pp: [8500, 10000] },
  polling: false,
  downloadPolling: false,
  progressJob: null,
};
let toastTimer;
function toast(message) {
  $("toast").textContent = t(message);
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}
async function api(url, body) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-App-Token": state.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function errorMessage(error) {
  return error.message === "Failed to fetch"
    ? t("The local server is not reachable. Reopen Start Helper to reconnect.")
    : t(error.message);
}
function mode() {
  return document.querySelector("input[name=mode]:checked").value;
}
function rangeFill() {
  const current = mode(),
    [low, high] = current === "rank" ? [1, 3000] : [2000, 40000],
    a = Number($("slider-min").value),
    b = Number($("slider-max").value);
  $("range-fill").style.left = `${(100 * (a - low)) / (high - low)}%`;
  $("range-fill").style.width = `${(100 * (b - a)) / (high - low)}%`;
  $("slider-min").style.zIndex = a >= high - 1 ? "4" : "2";
  $("slider-max").style.zIndex = "3";
}
function changeMode() {
  const current = mode(),
    rank = current === "rank",
    [low, high] = rank ? [1, 3000] : [2000, 40000];
  const [a, b] = state.range[current];
  for (const name of ["range-min", "range-max", "slider-min", "slider-max"]) {
    $(name).min = low;
    $(name).max = high;
    $(name).step = name.startsWith("slider") || rank ? 1 : 0.01;
  }
  for (const name of ["range-min", "slider-min"]) $(name).value = a;
  for (const name of ["range-max", "slider-max"]) $(name).value = b;
  $("range-label").textContent = rank
    ? t("World rank range")
    : t("7K performance range");
  $("range-caption").textContent = rank ? "#1 - #3,000" : "2,000 - 40,000 pp";
  $("limit-min").textContent = num(low);
  $("limit-max").textContent = num(high);
  $("slider-min").setAttribute(
    "aria-label",
    rank ? t("Minimum world rank") : t("Minimum 7K pp"),
  );
  $("slider-max").setAttribute(
    "aria-label",
    rank ? t("Maximum world rank") : t("Maximum 7K pp"),
  );
  $("form-error").hidden = true;
  rangeFill();
}
document
  .querySelectorAll("input[name=mode]")
  .forEach((input) => input.addEventListener("change", changeMode));
for (const side of ["min", "max"]) {
  $(`slider-${side}`).addEventListener("input", () => {
    let value = Number($(`slider-${side}`).value),
      other = Number($(`slider-${side === "min" ? "max" : "min"}`).value);
    value = side === "min" ? Math.min(value, other) : Math.max(value, other);
    $(`slider-${side}`).value = value;
    $(`range-${side}`).value = value;
    state.range[mode()] = [
      Number($("range-min").value),
      Number($("range-max").value),
    ];
    rangeFill();
  });
  $(`range-${side}`).addEventListener("input", () => {
    const input = $(`range-${side}`);
    if (input.value !== "" && input.validity.valid) {
      $(`slider-${side}`).value = input.value;
      state.range[mode()] = [
        Number($("range-min").value),
        Number($("range-max").value),
      ];
      rangeFill();
    }
  });
}
$("search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const min = Number($("range-min").value),
    max = Number($("range-max").value);
  if (min > max) {
    $("form-error").textContent =
      t("The minimum must be less than or equal to the maximum.");
    $("form-error").hidden = false;
    return;
  }
  $("form-error").hidden = true;
  $("search-button").disabled = true;
  try {
    const job = await api("/api/search", {
      mode: mode(),
      min,
      max,
      refresh: $("refresh").checked,
    });
    state.job = job.id;
    state.resultRevision = null;
    state.selected.clear();
    state.tables.clear();
    showProgress(job);
    watchJob();
  } catch (error) {
    $("form-error").textContent = errorMessage(error);
    $("form-error").hidden = false;
    $("search-button").disabled = false;
  }
});
$("cancel-search").addEventListener("click", async () => {
  if (!state.job) return;
  $("cancel-search").disabled = true;
  try {
    await api("/api/cancel", { id: state.job });
  } catch (error) {
    toast(errorMessage(error));
    $("cancel-search").disabled = false;
  }
});
function showProgress(job) {
  state.progressJob = { ...job, received_at: Date.now() };
  $("progress-section").hidden = false;
  $("progress-stage").textContent =
    job.status === "running" ? t("Collecting data") : statusText(job.status);
  $("progress-message").textContent = t(job.message);
  $("progress-percent").textContent = `${Math.floor(job.progress)}%`;
  $("progress-fill").style.width = `${job.progress}%`;
  const steps = ["rankings", "profiles", "tracker", "best", "calculation"];
  document.querySelectorAll("[data-stage]").forEach((el) => {
    const i = steps.indexOf(el.dataset.stage),
      current = steps.indexOf(job.stage);
    const step = job.steps?.[el.dataset.stage];
    el.classList.toggle(
      "active",
      step ? step.status === "running" : i === current,
    );
    el.classList.toggle(
      "done",
      step ? step.status === "complete" : i < current,
    );
    if (step) el.title = `${step.done} / ${step.total ?? "?"}`;
  });
  $("cancel-search").hidden = job.status !== "running";
  if (job.status === "running") $("search-button").disabled = true;
  renderTiming();
}
function renderTiming() {
  const job = state.progressJob;
  if (!job) return;
  const elapsed =
    job.elapsed_ms ?? Date.now() - new Date(job.started_at).getTime();
  const since = job.status === "running" ? Date.now() - job.received_at : 0;
  $("progress-elapsed").textContent = duration(elapsed + since);
  $("progress-remaining").textContent =
    job.status === "complete"
      ? "0s"
      : job.status !== "running"
        ? "--"
        : Number.isFinite(job.estimated_remaining_ms)
          ? `~ ${duration(Math.max(1000, job.estimated_remaining_ms - since))}`
          : t("Estimating...");
  $("progress-remaining").title =
    t("Approximate full-search time; updated as cache hits, map counts and response times become known.");
  $("progress-cache").textContent = job.metrics
    ? `${num(job.metrics.cache_hits)} ${t("cached")} / ${num(job.metrics.requests)} ${t("requests")}`
    : "";
}
setInterval(renderTiming, 1000);
async function watchJob() {
  if (state.polling) return;
  state.polling = true;
  try {
    while (state.job) {
      const job = await api(`/api/jobs/${state.job}`);
      showProgress(job);
      if (job.status === 'running' && job.has_result && state.resultRevision !== job.result_revision) {
        const result = await api('/api/results/latest');
        if (result?.id === state.job) {
          state.result = result; state.resultRevision = job.result_revision;
          void savePersonalResult(result);
          renderResult(true);
        }
      }
      if (job.status !== "running") {
        $("search-button").disabled = false;
        $("cancel-search").disabled = false;
        state.job = null;
        if (job.status === "complete") {
          state.result = await api("/api/results/latest");
          void savePersonalResult(state.result);
          renderResult(true);
          $("progress-section").hidden = true;
          toast(job.message);
        } else if (job.status === "error") {
          toast(job.message);
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
  } catch (error) {
    toast(errorMessage(error));
    $("search-button").disabled = false;
  } finally {
    state.polling = false;
  }
}
function selectView(view) {
  state.view = view;
  document
    .querySelectorAll("[data-view]")
    .forEach((button) =>
      button.setAttribute(
        "aria-selected",
        String(button.dataset.view === view),
      ),
    );
  for (const name of ["players", "dans", "maps"])
    $(`view-${name}`).hidden = name !== view;
  requestAnimationFrame(() => {
    for (const chart of state.charts.values()) chart.resize();
  });
}
document
  .querySelectorAll("[data-view]")
  .forEach((button) =>
    button.addEventListener("click", () => selectView(button.dataset.view)),
  );
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const views = ["players", "dans", "maps"];
  selectView(
    views[
      (views.indexOf(state.view) + (event.key === "ArrowRight" ? 1 : 2)) % 3
    ],
  );
  $(`tab-${state.view}`).focus();
});
function renderResult(preserveSelection = false) {
  const r = state.result;
  if (!r) return;
  if (!preserveSelection) state.selected.clear();
  if (!preserveSelection) state.tables.clear();
  for (const name of ["pp-detail", "dan-detail", "map-detail"])
    $(name).hidden = true;
  const s = r.summary;
  $("stat-players").textContent = num(s.players);
  $("stat-rank").textContent =
    s.rank_min == null
      ? "--"
      : s.rank_min === s.rank_max
        ? `#${num(s.rank_min)}`
        : `#${num(s.rank_min)} - ${num(s.rank_max)}`;
  $("stat-pp").textContent =
    s.pp_min == null
      ? "--"
      : s.pp_min === s.pp_max
        ? sourceNumber(s.pp_min)
        : `${sourceNumber(s.pp_min)} - ${sourceNumber(s.pp_max)}`;
  $("stat-maps").textContent = num(s.maps);
  $("stat-map-note").textContent =
    `${num(s.unique_maps)} ${t("unique maps")} / ${num(s.sets)} ${t("sets")}`;
  $("stat-player-note").textContent =
    `${num(s.bp_complete)} complete BP collection${s.bp_complete === 1 ? "" : "s"}`;
  $("players-count").textContent = num(s.players);
  $("maps-count").textContent = num(s.maps);
  $("all-players").disabled = !s.players;
  $("dan-players").disabled = !s.players;
  const when = new Date(r.completed_at).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  $("result-time").textContent =
    `${r.query.mode === "rank" ? t("World rank") : "7K pp"} ${sourceNumber(r.query.min)} - ${sourceNumber(r.query.max)} / ${when}` +
    (r.partial ? ` / ${r.phase === 'snapshot' ? t('Snapshot preview') + ' ' + r.snapshot_date : t('Quick result')} · ${t('Updating in background')}` : '');
  $("notes-open").hidden = !r.issues.length;
  $("notes-open").innerHTML =
    `${icon("circle-alert")} ${num(r.issues.length)} ${t("source notes")}`;
  $("pp-subtitle").textContent =
    `${num(r.players.filter((p) => Number.isFinite(p.pp)).length)} ${t("players with exact 7K pp")}`;
  $("map-subtitle").textContent =
    `${num(s.maps)} ${t("entries")} / ${num(r.coverage.total_scores)} ${t("best performances checked")}`;
  $("frequency-subtitle").textContent =
    `Distinct players out of ${num(s.players)} in this pool`;
  r.maps.forEach((map, index) => {
    map.frequency_rank = index + 1;
    const rate = { HT: 0.75, NM: 1, DT: 1.5 }[map.mod];
    map.display_bpm = map.bpm * rate;
    map.display_length = map.length / rate;
  });
  renderCharts();
  renderMissing("regular");
  renderMissing("ln");
  createTable("players-table", r.players, "players");
  createTable("dans-table", r.players, "dan");
  $("players-roster-count").textContent = `${num(s.players)} ${t("players")}`;
  $("dans-roster-count").textContent = `${num(s.players)} ${t("players")}`;
  createTable("frequency-table", r.maps, "maps", { bulk: true });
  icons();
}
const rangeLabel = (bin, unit = "pp") =>
  bin.min === bin.max
    ? `${sourceNumber(bin.min)} ${unit}`
    : `${sourceNumber(bin.min)} - ${sourceNumber(bin.max)} ${unit}`;
function drawChart(
  name,
  bins,
  {
    color = "#e9659a",
    unit = "pp",
    axis = "7K pp",
    kind = "players",
    onSelect,
    categorical = false,
  } = {},
) {
  state.charts.get(name)?.destroy();
  state.charts.delete(name);
  state.bins.set(name, bins);
  const empty = $(`${name}-empty`);
  empty.hidden = bins.length > 0;
  $(`${name}-chart`).hidden = !bins.length;
  $(`${name}-bin-controls`).hidden = !bins.length;
  if (!bins.length) return;
  const labels = bins.map((b) => (categorical ? b.label : rangeLabel(b, unit)));
  const select = $(`${name}-bins`);
  select.innerHTML =
    '<option value="">Choose an interval</option>' +
    bins
      .map(
        (b, i) =>
          `<option value="${i}">${esc(labels[i])} (${b.rows.length})</option>`,
      )
      .join("");
  select.onchange = () => {
    if (select.value !== "")
      onSelect(bins[Number(select.value)], labels[Number(select.value)]);
  };
  const chart = new Chart($(`${name}-chart`), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          data: bins.map((b) => b.rows.length),
          backgroundColor: color,
          borderRadius: 4,
          borderSkipped: "bottom",
          hoverBackgroundColor: color === "#e9659a" ? "#ffadd0" : "#aff6e2",
          barPercentage: 0.92,
          categoryPercentage: 0.94,
          maxBarThickness: 84,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      onHover: (event, points) => {
        event.native.target.style.cursor = points.length
          ? "pointer"
          : "default";
      },
      onClick: (event, elements) => {
        if (!elements.length) return;
        const index = elements[0].index;
        select.value = String(index);
        onSelect(bins[index], labels[index]);
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#171318",
          borderColor: "#67515e",
          borderWidth: 1,
          titleColor: "#fff1f8",
          bodyColor: "#e2cbd7",
          padding: 12,
          displayColors: false,
          callbacks: {
            title: (items) => {
              const b = bins[items[0].dataIndex];
              return categorical
                ? b.label
                : b.min === b.max
                  ? labels[items[0].dataIndex]
                  : `${sourceNumber(b.min)} <= ${unit} ${b.last ? " <=" : " <"} ${sourceNumber(b.max)}`;
            },
            label: (item) => `${num(item.raw)} ${t(kind === "players" ? "Players" : "Beatmap entries")}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: "#4b3c45" },
          ticks: {
            color: "#b5a6af",
            maxRotation: categorical ? 45 : 0,
            autoSkip: true,
            maxTicksLimit: categorical ? 18 : 10,
            font: { family: "Helper Nunito", size: 11 },
            callback: (value, index) =>
              categorical ? bins[index]?.label : sourceNumber(bins[index]?.min),
          },
          title: {
            display: true,
            text: t(axis),
            color: "#ad9ca7",
            padding: { top: 12 },
            font: { family: "Helper Nunito", size: 12 },
          },
        },
        y: {
          beginAtZero: true,
          grace: "12%",
          grid: { color: "#43373f77" },
          border: { display: false },
          ticks: {
            precision: 0,
            color: "#aa97a2",
            maxTicksLimit: 6,
            font: { family: "Helper Nunito", size: 11 },
          },
          title: {
            display: true,
            text: kind === "players" ? t("Players") : t("Beatmap entries"),
            color: "#ad9ca7",
            font: { family: "Helper Nunito", size: 12 },
          },
        },
      },
    },
  });
  state.charts.set(name, chart);
}
function renderCharts() {
  const r = state.result;
  if (!r) return;
  drawChart("pp", histogram(r.players, "pp"), {
    onSelect: (bin, label) =>
      openPlayerDetail("pp-detail", bin.rows, label, false),
  });
  for (const side of ["regular", "ln"]) {
    $(`${side}-coverage`).textContent =
      `${num(r.summary[side])} / ${num(r.summary.players)} ${t("players")}`;
    drawChart(side, danHistogram(r.players, side), {
      color: side === "ln" ? "#7cddc3" : "#e9659a",
      categorical: true,
      axis: side === "ln" ? t("LN dan") : t("Regular dan"),
      onSelect: (bin, label) =>
        openPlayerDetail(
          "dan-detail",
          bin.rows,
          `${side === "ln" ? "LN" : t("Regular")} / ${label}`,
          true,
        ),
    });
  }
  drawMapsChart();
}
function drawMapsChart() {
  if (!state.result) return;
  drawChart("maps", histogram(state.result.maps, state.metric), {
    color: "#7cddc3",
    unit: state.metric === "stars" ? "stars" : "pp",
    axis:
      state.metric === "stars" ? t("osu!mania star rating") : t("Perfect pp ceiling"),
    kind: "beatmap entries",
    onSelect: (bin, label) => openMapDetail(bin.rows, label),
  });
  $("maps-chart").setAttribute(
    "aria-label",
    state.metric === "stars"
      ? t("7K beatmap star rating histogram")
      : t("7K beatmap perfect pp histogram"),
  );
}
document.querySelectorAll("input[name=map-metric]").forEach((el) =>
  el.addEventListener("change", () => {
    state.metric = el.value;
    $("map-detail").hidden = true;
    drawMapsChart();
  }),
);
function renderMissing(side) {
  const players = state.result.players.filter((p) => !p[side]);
  const host = $(`${side}-missing`);
  host.innerHTML = players.length
    ? `<details><summary>${num(players.length)} ${t("players without")} ${side === "ln" ? "LN" : "regular"} ${t("dan data")}</summary><div>${players.map((p) => `<a href="https://osu.ppy.sh/users/${p.id}/mania" target="_blank" rel="noreferrer">${esc(p.username)}</a>`).join("")}</div></details>`
    : "";
}
function detailHeader(title, count) {
  return `<div class="detail-header"><div><h3>${esc(title)}</h3><span>${num(count)} ${t("results")}</span></div><button class="icon-button collapse-detail" title="${t("Collapse list")}" aria-label="${t("Collapse list")}">${icon("chevron-up")}</button></div><div class="detail-table"></div>`;
}
function openPlayerDetail(id, rows, title, dan) {
  const host = $(id);
  host.hidden = false;
  host.innerHTML = detailHeader(title, rows.length);
  host.querySelector(".collapse-detail").onclick = () => (host.hidden = true);
  host.querySelector(".detail-table").id = id + "-table";
  createTable(id + "-table", rows, dan ? "dan" : "players");
  icons();
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function openMapDetail(rows, title) {
  const host = $("map-detail");
  host.hidden = false;
  host.innerHTML = detailHeader(title, rows.length);
  host.querySelector(".collapse-detail").onclick = () => (host.hidden = true);
  host.querySelector(".detail-table").id = "map-detail-table";
  createTable("map-detail-table", rows, "maps");
  icons();
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function focusRoster(id) {
  const search = $(id).querySelector(".search-input");
  search.focus({ preventScroll: true });
  $(id).scrollIntoView({ behavior: "smooth", block: "start" });
}
$("all-players").onclick = () => focusRoster("players-table");
$("dan-players").onclick = () => focusRoster("dans-table");
function playerColumns(dan) {
  return [
    { key: "rank", name: t("Rank"), numeric: true },
    { key: "username", name: t("Player") },
    { key: "country", name: t("Country") },
    { key: "pp", name: "7K pp", numeric: true },
    { key: "accuracy", name: t("Accuracy"), numeric: true },
    ...(dan
      ? [
          { key: "regular.rating", name: t("Regular dan") },
          { key: "regular.rating", name: t("Regular rating"), numeric: true },
          { key: "ln.rating", name: t("LN dan") },
          { key: "ln.rating", name: t("LN rating"), numeric: true },
        ]
      : [
          { key: "play_count", name: t("Play count"), numeric: true },
          { key: "ranked_score", name: t("Ranked score"), numeric: true },
          { key: "ss", name: "SS", numeric: true },
          { key: "s", name: "S", numeric: true },
          { key: "a", name: "A", numeric: true },
        ]),
  ];
}
const mapColumns = [
  { key: "frequency_rank", name: "#", numeric: true },
  { key: "title", name: t("Beatmap") },
  { key: "mod", name: t("Speed") },
  { key: "stars", name: t("Stars"), numeric: true },
  { key: "pp_max", name: t("PP ceiling"), numeric: true },
  { key: "frequency", name: t("Players"), numeric: true },
  { key: "display_bpm", name: "BPM", numeric: true },
  { key: "display_length", name: t("Length"), numeric: true },
  { name: t("No-video download") },
];
function createTable(id, rows, type, { bulk = false } = {}) {
  const host = $(id);
  const previous = state.tables.get(id);
  const table = {
    id,
    rows,
    type,
    bulk,
    query: "",
    page: 1,
    size: 25,
    key: type === "maps" ? "frequency" : "rank",
    direction: type === "maps" ? -1 : 1,
  };
  if (previous) for (const key of ['query','page','size','key','direction']) table[key]=previous[key];
  state.tables.set(id, table);
  host.innerHTML = `<div class="table-toolbar"><input type="search" class="search-input" placeholder="${type === "maps" ? t("Filter title, artist or mapper") : type === "dan" ? t("Filter player, country or dan") : t("Filter player, country or pp")}" aria-label="${type === "maps" ? t("Filter beatmaps") : t("Filter players")}"><div class="table-actions">${
    type === "maps"
      ? `<label class="small muted">Sort <select class="sort-select" aria-label="${t("Sort beatmaps")}">${[
          { key: "frequency", name: t("Players") },
          { key: "title", name: t("Title") },
          { key: "artist", name: t("Artist") },
          { key: "creator", name: t("Mapper") },
          { key: "difficulty", name: t("Difficulty") },
          { key: "status", name: t("Status") },
          { key: "mod", name: t("Speed") },
          { key: "stars", name: t("Stars") },
          { key: "pp_max", name: t("PP ceiling") },
          { key: "display_bpm", name: "BPM" },
          { key: "display_length", name: t("Length") },
        ]
          .map((c) => `<option value="${c.key}">${c.name}</option>`)
          .join(
            "",
          )}</select></label><button class="icon-button reverse-sort" title="${t("Reverse sort")}" aria-label="${t("Reverse sort")}">${icon("arrow-down-up")}</button>`
      : ""
  }${bulk ? '<span class="selection-count"></span><button class="secondary compact batch-download" disabled>' + icon("download") + "Download selected</button>" : ""}</div></div><div class="table-scroll"></div><div class="pagination"></div>`;
  host.querySelector(".search-input").value = table.query;
  host.querySelector(".search-input").oninput = (event) => {
    table.query = event.target.value.toLowerCase();
    table.page = 1;
    renderTable(table);
  };
  const select = host.querySelector(".sort-select");
  if (select) select.value = table.key;
  if (select)
    select.onchange = () => {
      table.key = select.value;
      table.page = 1;
      renderTable(table);
    };
  const reverse = host.querySelector(".reverse-sort");
  if (reverse)
    reverse.onclick = () => {
      table.direction *= -1;
      renderTable(table);
    };
  host
    .querySelector(".batch-download")
    ?.addEventListener("click", startDownloads);
  host.onclick = (event) => {
    const sort = event.target.closest("[data-sort]");
    if (sort) {
      const key = sort.dataset.sort;
      table.direction = table.key === key ? -table.direction : 1;
      table.key = key;
      table.page = 1;
      if (select && [...select.options].some((o) => o.value === key))
        select.value = key;
      renderTable(table);
    }
    const page = event.target.closest("[data-page]");
    if (page) {
      table.page = Number(page.dataset.page);
      renderTable(table);
    }
  };
  host.onchange = (event) => {
    if (event.target.matches(".page-size")) {
      table.size = Number(event.target.value);
      table.page = 1;
      renderTable(table);
    }
    if (event.target.matches(".select-row")) {
      const key = event.target.dataset.key;
      if (event.target.checked) state.selected.add(key);
      else state.selected.delete(key);
      refreshSelections();
    }
    if (event.target.matches(".select-all")) {
      for (const row of filtered(table))
        if (event.target.checked) state.selected.add(row.key);
        else state.selected.delete(row.key);
      refreshSelections();
    }
  };
  renderTable(table);
}
function filtered(table) {
  const { rows, query, type } = table;
  return query
    ? rows.filter((r) =>
        (type === "maps"
          ? [r.title, r.artist, r.creator, r.difficulty, r.mod]
          : [
              r.username,
              r.country,
              countryName(r),
              String(r.pp ?? ""),
              sourceNumber(r.pp),
              ...(type === "dan"
                ? [r.regular?.label, r.regular?.group, r.ln?.label, r.ln?.group]
                : []),
            ]
        ).some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(query),
        ),
      )
    : rows;
}
function playerRow(p, dan) {
  const avatar = safeUrl(p.avatar || `https://a.ppy.sh/${p.id}`);
  const flag = flagUrl(p.country);
  return `<td class="numeric rank-cell">#${num(p.rank)}</td><td><a class="player-link" href="https://osu.ppy.sh/users/${p.id}/mania" target="_blank" rel="noreferrer"><img class="avatar" src="${esc(avatar)}" alt="" loading="lazy">${esc(p.username)}</a></td><td><span class="country" title="${esc(countryName(p))}">${flag ? `<img class="country-flag" src="${esc(safeUrl(flag))}" alt="${esc(countryName(p))}" loading="lazy">` : ""}${esc(p.country)}</span></td><td class="numeric pp-value">${sourceNumber(p.pp)}</td><td class="numeric">${num(p.accuracy, 2)}%</td>${dan ? `<td class="dan-value">${danCell(p.regular, "regular")}</td><td class="numeric">${num(p.regular?.rating, 2)}</td><td class="ln-value">${danCell(p.ln, "ln")}</td><td class="numeric">${num(p.ln?.rating, 2)}</td>` : `<td class="numeric">${num(p.play_count)}</td><td class="numeric">${num(p.ranked_score)}</td><td class="numeric">${num(p.ss)}</td><td class="numeric">${num(p.s)}</td><td class="numeric">${num(p.a)}</td>`}`;
}
const countries = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(player) {
  if (player.country_name) return player.country_name;
  return /^[A-Z]{2}$/.test(player.country || "")
    ? countries.of(player.country)
    : player.country || "Unknown";
}
function danCell(dan, side) {
  if (!dan) return '<span class="muted small">Not available</span>';
  const badge = danBadge(dan.label, side);
  if (!badge) return esc(dan.label);
  const tone =
    { "--": "low", "-": "mid-low", "+": "mid-high", "++": "high" }[
      badge.suffix
    ] || "mid";
  return `<span class="dan-badge" title="${esc(dan.label)}"><span class="dan-badge-art"><img src="${badge.src}" alt="${esc(dan.label)}" loading="lazy">${badge.suffix ? `<b class="dan-suffix ${tone}">${esc(badge.suffix)}</b>` : ""}</span><span class="dan-label">${esc(dan.label)}</span></span>`;
}
function mapRow(map, bulk) {
  const ratio = state.result.summary.players
    ? (map.frequency / state.result.summary.players) * 100
    : 0;
  const rate = { HT: 0.75, NM: 1, DT: 1.5 }[map.mod];
  const seconds = Math.round(map.length / rate);
  return `${bulk ? `<td><input type="checkbox" class="select-row" data-key="${esc(map.key)}" aria-label="Select ${esc(map.title)} ${map.mod}" ${state.selected.has(map.key) ? "checked" : ""}></td>` : ""}<td class="numeric rank-cell">${num(map.frequency_rank)}</td><td><div class="map-cell"><img class="map-cover" src="${esc(safeUrl(map.cover))}" alt="" loading="lazy"><div class="map-copy"><div class="artist">${esc(map.artist)}</div><a href="${esc(map.osu_url)}" target="_blank" rel="noreferrer">${esc(map.title)}</a><div class="difficulty">${esc(map.difficulty)}</div><div class="creator">${esc(map.creator)} / ${esc(map.status)}</div></div></div></td><td><span class="speed-badge speed-${map.mod}">${map.mod === "DT" ? "DT/NC" : map.mod}</span></td><td class="numeric star-value" title="${esc(map.calculation_error || t("osu!mania stars at this speed"))}">${num(map.stars, 2)}</td><td class="numeric pp-value" title="${esc(map.calculation_error || t("100% perfect pp ceiling"))}">${num(map.pp_max, 2)}</td><td class="numeric"><span class="freq-number">${num(map.frequency)}</span><span class="freq-percent">${num(ratio, 1)}%</span></td><td class="numeric">${num(map.bpm * rate, 0)}</td><td class="numeric">${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}</td><td><div class="download-links"><a class="download-link" href="${esc(map.download_osu)}" target="_blank" rel="noreferrer" title="${t("osu! download without video (sign-in may be required)")}" aria-label="${t("osu! no-video download")}">${icon("download")}osu!</a><a class="download-link" href="${esc(map.download_sayo)}" target="_blank" rel="noreferrer" title="${t("SayoBot download without video")}" aria-label="${t("SayoBot no-video download")}">${icon("download")}Sayo</a></div></td>`;
}
function renderTable(table) {
  const host = $(table.id);
  if (!host) return;
  const rows = sorted(filtered(table), table.key, table.direction),
    pages = Math.max(1, Math.ceil(rows.length / table.size));
  table.page = Math.min(table.page, pages);
  const begin = (table.page - 1) * table.size,
    visible = rows.slice(begin, begin + table.size),
    cols =
      table.type === "maps" ? mapColumns : playerColumns(table.type === "dan");
  const markup = `<table class="${table.type === "maps" ? "map-table" : "player-table"}"><thead><tr>${table.bulk ? ("<th><input type=\"checkbox\" class=\"select-all\" aria-label=\""+t("Select all filtered beatmaps")+"\" title=\""+t("Select all filtered beatmaps across all pages")+"\"></th>") : ""}${cols.map((c) => `<th class="${c.numeric ? "numeric" : ""}" ${c.key === table.key ? `aria-sort="${table.direction === 1 ? "ascending" : "descending"}"` : ""}>${c.key ? `<button data-sort="${c.key}">${esc(c.name)}${icon(c.key === table.key ? (table.direction === 1 ? "arrow-up" : "arrow-down") : "arrow-up-down")}</button>` : esc(c.name)}</th>`).join("")}</tr></thead><tbody>${visible.length ? visible.map((row) => `<tr class="${table.bulk && state.selected.has(row.key) ? "selected-row" : ""}">${table.type === "maps" ? mapRow(row, table.bulk) : playerRow(row, table.type === "dan")}</tr>`).join("") : `<tr><td colspan="${cols.length + (table.bulk ? 1 : 0)}" class="empty-table">${t("No matching")} ${table.type === "maps" ? "beatmaps" : "players"}</td></tr>`}</tbody></table>`;
  host.querySelector(".table-scroll").innerHTML = markup;
  host.querySelector(".pagination").innerHTML =
    `<span>${rows.length ? num(begin + 1) : 0} - ${num(Math.min(begin + table.size, rows.length))} of ${num(rows.length)}</span><div class="pagination-controls"><select class="page-size" aria-label="${t("Rows per page")}">${[25, 50, 100].map((size) => `<option value="${size}" ${table.size === size ? "selected" : ""}>${size} ${t("rows")}</option>`).join("")}</select><button class="icon-button" data-page="${table.page - 1}" ${table.page <= 1 ? "disabled" : ""} title="${t("Previous page")}" aria-label="${t("Previous page")}">${icon("chevron-left")}</button><span>${num(table.page)} / ${num(pages)}</span><button class="icon-button" data-page="${table.page + 1}" ${table.page >= pages ? "disabled" : ""} title="${t("Next page")}" aria-label="${t("Next page")}">${icon("chevron-right")}</button></div>`;
  if (table.bulk) {
    const master = host.querySelector(".select-all"),
      selected = rows.filter((r) => state.selected.has(r.key)).length;
    master.checked = !!rows.length && selected === rows.length;
    master.indeterminate = selected > 0 && selected < rows.length;
    host.querySelector(".selection-count").textContent =
      `${num(state.selected.size)} ${t("selected")}`;
    host.querySelector(".batch-download").disabled = !state.selected.size;
  }
  icons();
}
function refreshSelections() {
  for (const table of state.tables.values()) if (table.bulk) renderTable(table);
}
function openDialog(id) {
  $(id).showModal();
  icons();
}
$("about-open").onclick = () => openDialog("about-dialog");
$("notes-open").onclick = () => {
  const r = state.result;
  $("notes-body").innerHTML =
    `<p class="small muted">${num(r.summary.calculated_maps)} / ${num(r.summary.maps)} entries calculated. ${num(r.summary.bp_complete)} / ${num(r.summary.players)} BP collections complete.</p>` +
    r.issues
      .map(
        (note) =>
          `<div class="source-note"><div class="note-stage">${esc(statusText(note.stage))}</div>${note.player_id ? `<a href="https://osu.ppy.sh/users/${note.player_id}/mania" target="_blank" rel="noreferrer">${esc(note.username)}</a>` : ""}<p>${esc(t(note.message))}</p></div>`,
      )
      .join("");
  openDialog("notes-dialog");
};
document
  .querySelectorAll("[data-close]")
  .forEach(
    (button) => (button.onclick = () => button.closest("dialog").close()),
  );
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  }),
);
async function startDownloads() {
  const ids = [
    ...new Set(
      state.result.maps
        .filter((m) => state.selected.has(m.key))
        .map((m) => m.beatmapset_id),
    ),
  ];
  try {
    const queue = await api("/api/downloads", { ids });
    renderDownloads(queue);
    openDialog("downloads-dialog");
    watchDownloads();
  } catch (error) {
    toast(errorMessage(error));
  }
}
$("downloads-open").onclick = async () => {
  try {
    renderDownloads(await api("/api/downloads"));
    openDialog("downloads-dialog");
    watchDownloads();
  } catch (error) {
    toast(errorMessage(error));
  }
};
$("cancel-downloads").onclick = async () => {
  try {
    await api("/api/downloads/cancel", {});
  } catch (error) {
    toast(errorMessage(error));
  }
};
function renderDownloads(queue) {
  if (!queue) {
    $("download-summary").textContent = t("No downloads");
    $("download-items").innerHTML = "";
    $("cancel-downloads").hidden = true;
    return;
  }
  $("download-summary").textContent =
    `${queue.items.filter((i) => i.status === "saved").length} / ${queue.items.length} ${t("saved")} / ${statusText(queue.status)}`;
  $("cancel-downloads").hidden = queue.status !== "running";
  $("download-items").innerHTML = queue.items
    .map(
      (item) =>
        `<div class="download-item"><div><a href="${item.status==='saved'?`/api/downloads/files/${item.id}`:`https://osu.ppy.sh/beatmapsets/${item.id}`}" target="_blank" rel="noreferrer">${item.id}-novideo.osz</a>${item.error ? `<span class="download-error">${esc(item.error)}</span>` : ""}</div><span class="${item.status}">${statusText(item.status)} ${item.bytes ? " / " + num(item.bytes / 1048576, 1) + " MB" : ""}</span></div>`,
    )
    .join("");
}
async function watchDownloads() {
  if (state.downloadPolling) return;
  state.downloadPolling = true;
  try {
    while (true) {
      const queue = await api("/api/downloads");
      renderDownloads(queue);
      if (!queue || queue.status !== "running") break;
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch (error) {
    toast(errorMessage(error));
  } finally {
    state.downloadPolling = false;
  }
}
$("shutdown").onclick = async () => {
  if (state.job) {
    toast(t("Cancel the active search before stopping the server."));
    return;
  }
  try {
    await api("/api/shutdown", {});
    document.querySelector("main").innerHTML =
      ("<section class=\"stopped\"><h2>"+t("Local server stopped")+"</h2><p class=\"muted\">"+t("Reopen Start Helper to continue.")+"</p></section>");
    document
      .querySelectorAll(".header-actions button")
      .forEach((b) => (b.disabled = true));
  } catch (error) {
    toast(errorMessage(error));
  }
};
document.addEventListener(
  "error",
  (event) => {
    if (event.target instanceof HTMLImageElement)
      event.target.style.visibility = "hidden";
  },
  true,
);
async function boot() {
  changeMode();
  icons();
  try {
    const info = await api("/api/info");
    state.token = info.token;
    $("shutdown").hidden = !!info.hosted;
    $("storage-path").textContent = info.root;
    $("download-path").textContent = info.download_directory;
    await document.fonts.ready;
    Chart.defaults.font.family = "Helper Nunito";
    Chart.defaults.color = "#b5a6af";
    state.result = info.latest ? await api('/api/results/latest') : await loadPersonalResult();
    if (state.result) {
      const query = state.result.query;
      state.range[query.mode] = [query.min, query.max];
      document.querySelector(`input[name=mode][value=${query.mode}]`).checked =
        true;
      changeMode();
      renderResult();
    }
    if (info.active_job) {
      state.job = info.active_job;
      watchJob();
    }
  } catch (error) {
    toast(errorMessage(error));
  }
}
boot();
