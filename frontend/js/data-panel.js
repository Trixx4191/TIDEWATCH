/**
 * data-panel.js — the "Data" dialog and first-run screen.
 *
 * Lets an authorized user (local mode, or admin token on a deployment)
 * build / refresh / recompute regions, import or export ready-made dataset
 * packages, watch job progress and logs, and run environment checks.
 * Everyone else sees read-only dataset status.
 */

import { admin, fetchDatasets, setAdminToken, getAdminToken } from "./api.js";
import { debounce, el, fmt, toast } from "./util.js";

const YEARS = [2024, 2030, 2040, 2050, 2060, 2075, 2090, 2100];
const ACTIONS = {
  build: {
    title: "Build",
    text: "Download everything (elevation, tide gauges, storm tracks, census) and model all scenarios. Use for a region that isn't built yet.",
  },
  refresh: {
    title: "Refresh observations",
    text: "Re-download tide gauges, storm tracks and census data, then recompute scenarios. Keeps the existing elevation.",
  },
  recompute: {
    title: "Recompute scenarios",
    text: "No downloads. Re-run the flood and exposure model, e.g. after a model update. Fastest.",
  },
};
const STAGES = [
  ["elevation", "Elevation"], ["tides", "Tide gauges"], ["tracks", "Storm tracks"],
  ["census", "Census"], ["scenarios", "Scenarios"],
];
const STATUS_TEXT = {
  queued: "Queued", running: "Running", succeeded: "Done", completed_with_warnings: "Done with warnings",
  failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted",
};

const ui = {
  datasets: null,
  selection: new Set(),
  action: "build",
  arcsec: 3,
  years: new Set(YEARS),
  estimate: null,
  jobs: [],
  current: null,
  logOpen: false,
  preflight: null,
  packages: [],
  pollTimer: null,
  lastActive: new Set(),
  onDataChanged: null,
  onDatasets: null,
};

const dialog = () => document.getElementById("dataDialog");
const pane = (name) => dialog().querySelector(`[data-data-pane="${name}"]`);

function session() {
  return ui.datasets?.admin || { data_operations: "disabled", authorized: false };
}

function fmtDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function fmtMb(mb) {
  if (!Number.isFinite(mb)) return "—";
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function since(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

// ── Load / refresh ──────────────────────────────────────────────────────────
export async function refreshDatasets() {
  const data = await fetchDatasets();
  if (data.available === false) return ui.datasets;
  ui.datasets = data;
  for (const key of [...ui.selection]) if (!data.regions.some((r) => r.key === key)) ui.selection.delete(key);
  ui.onDatasets?.(data);
  renderHeaderBadge();
  if (dialog().open) render();
  renderFirstRun();
  return data;
}

// ── Header badge ────────────────────────────────────────────────────────────
function renderHeaderBadge() {
  const badge = document.getElementById("dataBadge");
  const running = ui.jobs.find((j) => j.status === "running");
  const outdated = ui.datasets?.regions?.some((r) => r.outdated);
  if (running) {
    badge.textContent = `${Math.round(running.progress?.percent || 0)}%`;
    badge.className = "data-badge is-running";
    badge.title = `${running.label}: ${running.progress?.message || ""}`;
  } else if (outdated && session().authorized) {
    badge.textContent = "!";
    badge.className = "data-badge is-warn";
    badge.title = "Some regions were built with an older model version";
  } else {
    badge.textContent = "";
    badge.className = "data-badge";
    badge.title = "";
  }
}

// ── Dialog shell ────────────────────────────────────────────────────────────
export function openData(tab = "regions") {
  setTab(tab);
  if (!dialog().open) dialog().showModal();
  refreshDatasets().then(() => {
    if (session().authorized) {
      pollJobs();
      if (tab === "setup") runPreflight();
      if (tab === "transfer") loadPackages();
    }
  });
}

function setTab(tab) {
  dialog().querySelectorAll("[data-data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.dataTab === tab)));
  dialog().querySelectorAll("[data-data-pane]").forEach((p) => { p.hidden = p.dataset.dataPane !== tab; });
  ui.tab = tab;
  render();
  if (session().authorized) {
    if (tab === "setup" && !ui.preflight) runPreflight();
    if (tab === "transfer") loadPackages();
  }
}

function render() {
  renderMode();
  if (ui.tab === "regions" || !ui.tab) renderRegions();
  if (ui.tab === "jobs") renderJobs();
  if (ui.tab === "transfer") renderTransfer();
  if (ui.tab === "setup") renderSetup();
}

function renderMode() {
  const s = session();
  const badge = document.getElementById("dataMode");
  const authBox = document.getElementById("dataAuth");
  let text;
  let cls;
  if (s.authorized && s.mode === "local") { text = "Local mode · you can build data on this computer"; cls = "ok"; }
  else if (s.authorized) { text = "Signed in as admin"; cls = "ok"; }
  else if (s.data_operations === "disabled") { text = "Read-only · data operations are disabled on this site"; cls = "muted"; }
  else { text = "Read-only · sign in to manage data"; cls = "muted"; }
  badge.textContent = text;
  badge.className = `data-mode data-mode--${cls}`;
  authBox.replaceChildren();
  if (s.admin_sign_in && !s.authorized) {
    const input = el("input", { type: "password", className: "tw-input", placeholder: "Admin token", autocomplete: "current-password", "aria-label": "Admin token" });
    const form = el("form", { className: "data-signin", onsubmit: async (e) => {
      e.preventDefault();
      setAdminToken(input.value.trim());
      const data = await refreshDatasets();
      if (data?.admin?.authorized) {
        toast("Signed in as admin");
        pollJobs();
      } else {
        setAdminToken("");
        toast(data?.admin?.reason || "Sign-in failed", "warn");
        refreshDatasets();
      }
    } }, [input, el("button", { type: "submit", className: "btn btn--primary" }, "Sign in")]);
    authBox.append(form);
  } else if (s.authorized && s.mode === "admin" && getAdminToken()) {
    authBox.append(el("button", { type: "button", className: "btn", onclick: async () => {
      setAdminToken("");
      await refreshDatasets();
      toast("Signed out");
    } }, "Sign out"));
  }
}

// ── Regions tab ─────────────────────────────────────────────────────────────
function statusPill(r) {
  if (r.state === "missing") return el("span", { className: "pill pill--muted" }, "Not built");
  if (r.outdated) return el("span", { className: "pill pill--warn", title: `Built with model ${r.model_version}; this server's code is ${ui.datasets.code_model_version}` }, "Outdated");
  if (r.state === "partial") return el("span", { className: "pill pill--warn", title: (r.errors || []).join("\n") }, "Partial");
  return el("span", { className: "pill pill--ok" }, "Ready");
}

function componentIcons(c) {
  const item = (label, ok, title) => el("span", { className: `comp ${ok === true ? "comp--ok" : ok === "not covered" ? "comp--na" : "comp--missing"}`, title: title || label }, label);
  return el("span", { className: "comp-list" }, [
    item("DEM", c.elevation, "Elevation"),
    item("Tides", c.tides, "NOAA tide gauges"),
    item("Storms", c.tracks, "Storm tracks"),
    item("Census", c.census, c.census === "not covered" ? "Outside U.S. Census coverage" : "Census (2020 + ACS)"),
    item(`${c.scenarios}/40`, c.scenarios >= 40 ? true : c.scenarios > 0 ? "partial" : false, "Scenarios built"),
    item("Inspect", c.inspect, "Point-lookup grids"),
  ]);
}

function renderRegions() {
  const host = pane("regions");
  const data = ui.datasets;
  if (!data) { host.textContent = "Loading…"; return; }
  const s = session();
  const rows = data.regions.map((r) => {
    const checked = ui.selection.has(r.key);
    const box = el("input", {
      type: "checkbox", checked: checked || null, disabled: s.authorized ? null : true,
      "aria-label": `Select ${r.name}`,
      onchange: (e) => { if (e.target.checked) ui.selection.add(r.key); else ui.selection.delete(r.key); renderRegions(); },
    });
    return el("tr", { className: checked ? "is-selected" : "" }, [
      el("td", {}, box),
      el("td", {}, [el("b", {}, r.short), el("div", { className: "muted small" }, r.name)]),
      el("td", {}, statusPill(r)),
      el("td", {}, componentIcons(r.components)),
      el("td", { className: "small" }, r.state === "missing" ? "—" : [
        since(r.built_at), el("div", { className: "muted" }, `model ${r.model_version || "?"}${r.imported_from ? " · imported" : ""}`)]),
      el("td", { className: "small num" }, r.size_mb ? fmtMb(r.size_mb) : "—"),
    ]);
  });
  const allBox = el("input", {
    type: "checkbox", "aria-label": "Select all regions", disabled: s.authorized ? null : true,
    checked: ui.selection.size === data.regions.length ? true : null,
    onchange: (e) => { data.regions.forEach((r) => (e.target.checked ? ui.selection.add(r.key) : ui.selection.delete(r.key))); renderRegions(); },
  });
  const table = el("table", { className: "data-table region-status" }, [
    el("thead", {}, el("tr", {}, [el("th", {}, allBox), el("th", {}, "Region"), el("th", {}, "Status"), el("th", {}, "Contents"), el("th", {}, "Built"), el("th", {}, "Size")])),
    el("tbody", {}, rows),
  ]);
  host.replaceChildren(table, renderActions());
  if (s.authorized) requestEstimate();
}

function renderActions() {
  const s = session();
  if (!s.authorized) {
    return el("div", { className: "data-note" }, s.data_operations === "disabled"
      ? "This deployment is read-only. Data is published by the site administrator."
      : s.admin_sign_in ? "Sign in with the admin token (top right) to build or import data."
        : "Building data is available when TIDEWATCH runs on your own computer (open it at http://localhost).");
  }
  const cards = Object.entries(ACTIONS).map(([key, a]) => el("label", { className: `action-card${ui.action === key ? " is-active" : ""}` }, [
    el("input", { type: "radio", name: "dataAction", value: key, checked: ui.action === key ? true : null,
      onchange: () => { ui.action = key; renderRegions(); } }),
    el("span", { className: "action-title" }, a.title),
    el("span", { className: "action-text" }, a.text),
  ]));
  const detail = el("select", { className: "tw-select", id: "dataArcsec", disabled: ui.action === "recompute" ? true : null,
    onchange: (e) => { ui.arcsec = Number(e.target.value); requestEstimate(); } }, [
    [3, "Standard · ~90 m (recommended)"], [2, "Detailed · ~60 m (≈2× slower)"], [1, "Fine · ~30 m (≈9× slower, large)"],
  ].map(([v, t]) => el("option", { value: v, selected: ui.arcsec === v ? true : null }, t)));
  const years = el("div", { className: "year-checks" }, YEARS.map((y) => el("label", { className: "tw-check" }, [
    el("input", { type: "checkbox", checked: ui.years.has(y) ? true : null,
      onchange: (e) => { if (e.target.checked) ui.years.add(y); else ui.years.delete(y); requestEstimate(); renderRegions(); } }),
    String(y),
  ])));
  const subset = ui.years.size < YEARS.length;
  const advanced = el("details", { className: "data-advanced", open: (ui.advancedOpen || ui.arcsec !== 3 || subset) ? true : null,
    ontoggle: (e) => { ui.advancedOpen = e.target.open; } }, [
    el("summary", {}, "Advanced options"),
    el("label", { className: "select-label", for: "dataArcsec" }, "Map detail (elevation grid)"),
    detail,
    ui.action === "recompute" ? el("p", { className: "muted small" }, "Recompute keeps the existing grid detail.") : null,
    el("div", { className: "select-label" }, "Sea-level years to build"),
    years,
    subset ? el("p", { className: "data-warn small" }, `Only ${ui.years.size} of 8 years will exist for the selected regions; the others are removed so Inspect stays consistent.`) : null,
  ]);
  const needsDem = ui.action !== "build"
    && [...ui.selection].some((k) => !ui.datasets.regions.find((r) => r.key === k)?.components.elevation);
  const start = el("button", {
    type: "button", className: "btn btn--primary", id: "dataStart",
    disabled: !ui.selection.size || !ui.years.size || needsDem ? true : null,
    onclick: startJob,
  }, ui.selection.size ? `${ACTIONS[ui.action].title} ${ui.selection.size} region${ui.selection.size > 1 ? "s" : ""}` : "Select regions above");
  return el("div", { className: "data-actions" }, [
    el("div", { className: "action-cards", role: "radiogroup", "aria-label": "Operation" }, cards),
    advanced,
    el("div", { className: "estimate", id: "dataEstimate", "aria-live": "polite" }, estimateContent()),
    needsDem ? el("p", { className: "data-warn small" }, "Some selected regions have no elevation yet; use Build first.") : null,
    el("div", { className: "data-start-row" }, [start]),
  ]);
}

const requestEstimate = debounce(async () => {
  if (!session().authorized || !ui.selection.size) { ui.estimate = null; updateEstimate(); return; }
  try {
    ui.estimate = await admin("/estimate", { method: "POST", body: payload() });
  } catch (error) {
    ui.estimate = { error: error.message };
  }
  updateEstimate();
}, 250);

function updateEstimate() {
  const host = document.getElementById("dataEstimate");
  if (host) host.replaceChildren(...[].concat(estimateContent()));
}

function estimateContent() {
  const e = ui.estimate;
  if (!ui.selection.size) return el("span", { className: "muted" }, "Select one or more regions to see an estimate.");
  if (!e) return el("span", { className: "muted" }, "Estimating…");
  if (e.error) return el("span", { className: "data-warn" }, `Estimate unavailable: ${e.error}`);
  const t = e.totals;
  return [
    el("div", { className: "estimate-figures" }, [
      el("span", {}, [el("b", {}, `≈ ${fmtDuration(t.seconds)}`), " total"]),
      el("span", {}, [el("b", {}, fmtMb(t.download_mb)), " download"]),
      el("span", {}, [el("b", {}, fmtMb(t.disk_mb)), " disk"]),
      el("span", {}, [el("b", {}, fmtMb(t.peak_memory_mb)), " peak memory"]),
    ]),
    el("div", { className: "muted small" }, e.regions.map((r) => `${r.name.split(" (")[0]}: ${r.grid}, ~${r.resolution_m} m, ≈ ${fmtDuration(r.seconds)}${r.srtm_tiles_cached ? ` (${r.srtm_tiles_cached}/${r.srtm_tiles} elevation tiles cached)` : ""}`).join(" · ")),
    e.warning ? el("div", { className: "data-warn small" }, e.warning) : null,
    el("div", { className: "muted small" }, "Estimates are approximate; downloads depend on your connection."),
  ];
}

function payload() {
  const years = ui.years.size === YEARS.length ? [] : [...ui.years].sort();
  return { action: ui.action, regions: [...ui.selection], arcsec: ui.arcsec, years };
}

/** Submit a job and focus the Jobs tab on it straight away (no stale card). */
async function submitJob(body, message) {
  const job = await admin("/jobs", { method: "POST", body });
  toast(message || `${job.label} queued`);
  ui.current = job.id;
  ui.currentDetail = { ...job, log: [], log_lines: 0 };
  setTab("jobs");
  pollJobs();
  return job;
}

async function startJob() {
  const e = ui.estimate;
  const big = (e?.totals?.seconds || 0) > 900 || ui.arcsec < 3;
  if (big && !window.confirm(`This will take about ${fmtDuration(e?.totals?.seconds)} and use ${fmtMb(e?.totals?.disk_mb)} of disk. Start now?`)) return;
  try {
    await submitJob(payload());
  } catch (error) {
    toast(error.message, "warn");
  }
}

// ── Jobs tab ────────────────────────────────────────────────────────────────
export async function pollJobs() {
  window.clearTimeout(ui.pollTimer);
  if (!session().authorized) return;
  try {
    const { jobs } = await admin("/jobs");
    ui.jobs = jobs;
    const active = jobs.filter((j) => j.status === "running" || j.status === "queued");
    const focus = jobs.find((j) => j.id === ui.current) || active[0] || jobs[0];
    if (focus) {
      ui.current = focus.id;
      ui.currentDetail = await admin(`/jobs/${focus.id}?tail=200`);
    }
    // Jobs that just finished → reload data in the app.
    const nowActive = new Set(active.map((j) => j.id));
    for (const id of ui.lastActive) {
      if (!nowActive.has(id)) {
        const job = jobs.find((j) => j.id === id);
        if (job) finished(job);
      }
    }
    ui.lastActive = nowActive;
    renderHeaderBadge();
    if (dialog().open && ui.tab === "jobs") renderJobs();
    if (active.length) ui.pollTimer = window.setTimeout(pollJobs, 1500);
  } catch (error) {
    if (error.status === 401 || error.status === 403) return;
    ui.pollTimer = window.setTimeout(pollJobs, 5000);
  }
}

async function finished(job) {
  const ok = job.status === "succeeded" || job.status === "completed_with_warnings";
  toast(`${job.label}: ${STATUS_TEXT[job.status] || job.status}${job.error ? ` — ${job.error}` : ""}`, ok ? "info" : "warn");
  await refreshDatasets();
  if (ok) ui.onDataChanged?.(job.regions?.length ? job.regions : job.result?.regions || []);
  if (job.action === "export") loadPackages();
}

function renderJobs() {
  const host = pane("jobs");
  if (!session().authorized) { host.replaceChildren(el("p", { className: "data-note" }, "Sign in to see jobs.")); return; }
  const d = ui.currentDetail;
  const blocks = [];
  if (d) {
    const p = d.progress || {};
    const active = d.status === "running" || d.status === "queued";
    const elapsed = d.started_at ? ((d.finished_at ? new Date(d.finished_at) : new Date()) - new Date(d.started_at)) / 1000 : null;
    const stageIdx = STAGES.findIndex(([k]) => k === p.stage);
    const isBuild = ["build", "refresh", "recompute"].includes(d.action);
    const logBox = el("details", { className: "job-log", open: ui.logOpen ? true : null,
      ontoggle: (e) => { ui.logOpen = e.target.open; } }, [
      el("summary", {}, `Log (${d.log_lines} lines)`),
      el("pre", {}, (d.log || []).join("\n") || "No output yet."),
    ]);
    blocks.push(el("section", { className: `job-card job--${d.status}` }, [
      el("div", { className: "job-head" }, [
        el("div", {}, [
          el("b", {}, d.label),
          el("span", { className: "muted" }, ` · ${d.regions?.length ? d.regions.join(", ") : d.source || ""}${d.arcsec && d.arcsec !== 3 ? ` · ${d.arcsec}″` : ""}${d.years ? ` · years ${d.years.join(", ")}` : ""}`),
        ]),
        el("span", { className: `pill ${d.status === "failed" ? "pill--bad" : active ? "pill--run" : d.status === "succeeded" ? "pill--ok" : "pill--warn"}` }, STATUS_TEXT[d.status] || d.status),
      ]),
      el("div", { className: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(p.percent || 0)) },
        el("div", { className: "progress-fill", style: `width:${Math.max(2, p.percent || 0)}%` })),
      el("div", { className: "job-meta" }, [
        el("span", {}, `${Math.round(p.percent || 0)}%`),
        el("span", {}, p.message || ""),
        el("span", {}, elapsed != null ? `elapsed ${fmtDuration(elapsed)}` : ""),
      ]),
      isBuild ? el("ol", { className: "stage-steps" }, STAGES.map(([k, label], i) => el("li", {
        className: !active && d.status === "succeeded" ? "done" : i < stageIdx ? "done" : i === stageIdx && active ? "now" : "",
      }, label))) : null,
      d.error ? el("p", { className: "data-warn" }, d.error) : null,
      d.warnings?.length ? el("details", { className: "small" }, [el("summary", {}, `${d.warnings.length} warning(s)`), el("ul", {}, d.warnings.slice(-10).map((w) => el("li", {}, w)))]) : null,
      d.result?.package ? el("p", {}, ["Package ready: ", el("button", { type: "button", className: "link-btn", onclick: () => downloadPackage(d.result.package) }, d.result.package)]) : null,
      el("div", { className: "job-actions" }, [
        active ? el("button", { type: "button", className: "btn btn--danger", onclick: async () => {
          if (!window.confirm("Cancel this job? Existing data for the region is kept.")) return;
          await admin(`/jobs/${d.id}/cancel`, { method: "POST" });
          pollJobs();
        } }, "Cancel job") : null,
      ]),
      logBox,
    ]));
  } else {
    blocks.push(el("p", { className: "data-note" }, "No jobs yet. Choose regions and an operation on the Regions tab."));
  }
  if (ui.jobs.length) {
    blocks.push(el("h3", {}, "History"));
    blocks.push(el("table", { className: "data-table job-history" }, [
      el("thead", {}, el("tr", {}, ["Operation", "Regions / source", "Status", "Started", "Duration"].map((h) => el("th", {}, h)))),
      el("tbody", {}, ui.jobs.slice(0, 20).map((j) => el("tr", {
        className: j.id === ui.current ? "is-selected" : "", tabindex: 0,
        onclick: () => { ui.current = j.id; pollJobs(); },
      }, [
        el("td", {}, j.label),
        el("td", { className: "small" }, j.regions?.length ? j.regions.join(", ") : j.source || "—"),
        el("td", {}, el("span", { className: `pill ${j.status === "failed" ? "pill--bad" : j.status === "succeeded" ? "pill--ok" : j.status === "running" ? "pill--run" : "pill--warn"}` }, STATUS_TEXT[j.status] || j.status)),
        el("td", { className: "small" }, since(j.started_at || j.created_at)),
        el("td", { className: "small" }, j.started_at && j.finished_at ? fmtDuration((new Date(j.finished_at) - new Date(j.started_at)) / 1000) : "—"),
      ]))),
    ]));
  }
  host.replaceChildren(...blocks);
  const pre = host.querySelector(".job-log pre");
  if (pre) pre.scrollTop = pre.scrollHeight;
}

// ── Import & export tab ─────────────────────────────────────────────────────
async function loadPackages() {
  if (!session().authorized) return;
  try {
    ui.packages = (await admin("/packages")).packages;
  } catch {
    ui.packages = [];
  }
  if (ui.tab === "transfer") renderTransfer();
}

async function downloadPackage(name) {
  try {
    const { url } = await admin(`/packages/${encodeURIComponent(name)}/link`, { method: "POST" });
    const a = el("a", { href: url, download: name, style: "display:none" });
    document.body.append(a);
    a.click();
    a.remove();
  } catch (error) {
    toast(error.message, "warn");
  }
}

function renderTransfer() {
  const host = pane("transfer");
  if (!session().authorized) { host.replaceChildren(el("p", { className: "data-note" }, "Sign in to import or export data packages.")); return; }
  const url = el("input", { type: "url", className: "tw-input", placeholder: "https://…/tidewatch-data-….tar.gz", "aria-label": "Package URL" });
  const file = el("input", { type: "file", accept: ".gz,.tgz,application/gzip", "aria-label": "Package file" });
  const bar = el("div", { className: "progress", hidden: true }, el("div", { className: "progress-fill", style: "width:0%" }));
  const importUrl = el("form", { className: "transfer-row", onsubmit: async (e) => {
    e.preventDefault();
    if (!/^https:\/\//i.test(url.value.trim())) { toast("Enter an https:// link to a .tar.gz package", "warn"); return; }
    try {
      await submitJob({ action: "import", source: url.value.trim() }, "Import queued");
    } catch (error) { toast(error.message, "warn"); }
  } }, [url, el("button", { type: "submit", className: "btn btn--primary" }, "Import from link")]);
  const upload = el("div", { className: "transfer-row" }, [file, el("button", { type: "button", className: "btn btn--primary", onclick: async () => {
    const f = file.files?.[0];
    if (!f) { toast("Choose a .tar.gz package first", "warn"); return; }
    bar.hidden = false;
    try {
      const { upload_id: uploadId } = await admin("/uploads", {
        method: "POST", raw: f, headers: { "Content-Type": "application/gzip", "X-Filename": f.name },
        onUploadProgress: (r) => { bar.firstChild.style.width = `${Math.round(r * 100)}%`; },
      });
      await submitJob({ action: "import", upload_id: uploadId }, "Uploaded; import queued");
    } catch (error) { toast(error.message, "warn"); } finally { bar.hidden = true; }
  } }, "Upload & import")]);

  const built = (ui.datasets?.regions || []).filter((r) => r.state !== "missing");
  const exportSel = new Set(built.map((r) => r.key));
  const exportList = el("div", { className: "year-checks" }, built.map((r) => el("label", { className: "tw-check" }, [
    el("input", { type: "checkbox", checked: true, onchange: (e) => { if (e.target.checked) exportSel.add(r.key); else exportSel.delete(r.key); } }),
    r.short,
  ])));
  const exportBtn = el("button", { type: "button", className: "btn btn--primary", disabled: built.length ? null : true, onclick: async () => {
    if (!exportSel.size) { toast("Select at least one region", "warn"); return; }
    try {
      await submitJob({ action: "export", regions: [...exportSel] }, "Export queued");
    } catch (error) { toast(error.message, "warn"); }
  } }, "Create package");
  const list = ui.packages.length
    ? el("table", { className: "data-table" }, [
      el("thead", {}, el("tr", {}, ["Package", "Size", "Created", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, ui.packages.map((p) => el("tr", {}, [
        el("td", { className: "small" }, p.name), el("td", { className: "small" }, fmtMb(p.bytes / 1e6)),
        el("td", { className: "small" }, since(p.created_at)),
        el("td", {}, el("button", { type: "button", className: "link-btn", onclick: () => downloadPackage(p.name) }, "Download")),
      ]))),
    ])
    : el("p", { className: "muted small" }, "No packages created yet.");
  host.replaceChildren(
    el("h3", {}, "Import a ready-made dataset"),
    el("p", { className: "muted small" }, "Load a package built elsewhere (for example one attached to a GitHub release). Files are checked (checksums, format, model version) before anything is replaced; the regions in the package are swapped in as a whole."),
    importUrl, upload, bar,
    el("h3", {}, "Export a dataset package"),
    el("p", { className: "muted small" }, "Bundle built regions into one .tar.gz with checksums, to publish or move to another server."),
    built.length ? exportList : el("p", { className: "muted small" }, "No built regions to export yet."),
    el("div", { className: "data-start-row" }, exportBtn),
    el("h3", {}, "Packages on this server"),
    list,
  );
}

// ── Setup tab ───────────────────────────────────────────────────────────────
async function runPreflight() {
  if (!session().authorized) return;
  ui.preflight = { loading: true };
  renderSetup();
  try {
    ui.preflight = await admin("/preflight");
  } catch (error) {
    ui.preflight = { error: error.message };
  }
  renderSetup();
}

function renderSetup() {
  const host = pane("setup");
  if (!session().authorized) { host.replaceChildren(el("p", { className: "data-note" }, "Sign in to run setup checks.")); return; }
  const p = ui.preflight;
  const again = el("button", { type: "button", className: "btn", onclick: runPreflight }, "Run checks again");
  if (!p || p.loading) { host.replaceChildren(el("p", { className: "muted" }, "Checking Python, disk, keys and source websites…")); return; }
  if (p.error) { host.replaceChildren(el("p", { className: "data-warn" }, p.error), again); return; }
  const icon = { ok: "✓", warn: "!", fail: "✕" };
  host.replaceChildren(
    el("p", { className: `data-mode data-mode--${p.status === "ok" ? "ok" : p.status === "warn" ? "warn" : "bad"}` },
      p.status === "ok" ? "Everything needed to build data is in place." : p.status === "warn" ? "Builds will work, with the limitations below." : "Some checks failed; builds may not work until they are fixed."),
    el("ul", { className: "check-list" }, p.checks.map((c) => el("li", { className: `check check--${c.status}` }, [
      el("span", { className: "check-icon", "aria-hidden": "true" }, icon[c.status]),
      el("div", {}, [el("b", {}, c.label), el("div", { className: "small" }, c.detail), c.fix ? el("div", { className: "small muted" }, `Fix: ${c.fix}`) : null]),
    ]))),
    el("div", { className: "data-start-row" }, [el("span", { className: "muted small" }, `Checked ${since(p.checked_at)}`), again]),
  );
}

// ── First-run screen ────────────────────────────────────────────────────────
function renderFirstRun() {
  const host = document.getElementById("firstRun");
  const data = ui.datasets;
  if (!data || data.any_ready) { host.hidden = true; return; }
  const s = data.admin || {};
  host.hidden = false;
  const content = [
    el("h2", {}, "Welcome to TIDEWATCH"),
    el("p", {}, "No flood data has been built yet. TIDEWATCH models coastal flooding from storm surge and sea-level rise using NASA elevation, NOAA tide gauges and storm tracks, and U.S. Census population."),
  ];
  if (s.authorized) {
    let pick = data.regions[0]?.key;
    const est = el("p", { className: "muted small" }, "");
    const updateEst = async () => {
      try {
        const e = await admin("/estimate", { method: "POST", body: { action: "build", regions: [pick], arcsec: 3 } });
        est.textContent = `About ${fmtDuration(e.totals.seconds)} · ${fmtMb(e.totals.download_mb)} download · ${fmtMb(e.totals.disk_mb)} disk`;
      } catch { est.textContent = ""; }
    };
    const chips = el("div", { className: "region-chips first-run-chips", role: "radiogroup", "aria-label": "Region to build" }, data.regions.map((r) => el("button", {
      type: "button", className: `region-chip${r.key === pick ? " active" : ""}`, role: "radio", "aria-checked": String(r.key === pick),
      onclick: (e) => {
        pick = r.key;
        chips.querySelectorAll("button").forEach((b) => { b.classList.toggle("active", b === e.currentTarget); b.setAttribute("aria-checked", String(b === e.currentTarget)); });
        updateEst();
      },
    }, r.short)));
    updateEst();
    content.push(
      el("p", {}, el("b", {}, "Pick a region to build first:")), chips, est,
      el("div", { className: "first-run-actions" }, [
        el("button", { type: "button", className: "btn btn--primary", onclick: async () => {
          try {
            ui.selection = new Set([pick]);
            openData("jobs");
            await submitJob({ action: "build", regions: [pick] }, "Build started — progress is shown here");
          } catch (error) { toast(error.message, "warn"); }
        } }, "Build this region"),
        el("button", { type: "button", className: "btn", onclick: () => openData("transfer") }, "Import a ready-made package"),
        el("button", { type: "button", className: "btn", onclick: () => openData("setup") }, "Check setup"),
      ]),
    );
  } else if (s.admin_sign_in) {
    content.push(el("p", {}, "Administrators can sign in to build or import data."),
      el("div", { className: "first-run-actions" }, el("button", { type: "button", className: "btn btn--primary", onclick: () => openData("regions") }, "Sign in")));
  } else {
    content.push(el("p", {}, "This site hasn't published any data yet. Please check back later."));
  }
  host.replaceChildren(el("div", { className: "first-run-card", role: "dialog", "aria-label": "Getting started" }, content));
}

// ── Init ────────────────────────────────────────────────────────────────────
export function initDataPanel({ onDataChanged, onDatasets }) {
  ui.onDataChanged = onDataChanged;
  ui.onDatasets = onDatasets;
  document.getElementById("dataBtn").addEventListener("click", () => openData("regions"));
  document.getElementById("dataClose").addEventListener("click", () => dialog().close());
  dialog().addEventListener("click", (e) => { if (e.target === dialog()) dialog().close(); });
  dialog().querySelectorAll("[data-data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.dataTab)));
  ui.tab = "regions";
  return refreshDatasets().then((data) => {
    if (data?.admin?.authorized) pollJobs();
    return data;
  });
}

export { fmt };
