/**
 * people.js — presentation of census-based exposure.
 *
 * Representation rules (see docs/Methodology.md §14):
 * - Counts come from the 2020 Census, whose block populations include
 *   deliberate noise: show them rounded to the nearest 10 with "≈", and
 *   "< 10" for small non-zero values. Never show decimals.
 * - Characteristics (65+, poverty, income) are ACS estimates: label as
 *   "est.", show income with its margin of error and a reliability flag.
 * - Say what isn't covered instead of showing zeros.
 */

import { el, fmt } from "./util.js";

export function fmtPeople(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n <= 0) return "0";
  if (n < 10) return "< 10";
  return `≈ ${fmt(Math.round(n / 10) * 10)}`;
}

export function fmtMoney(n) {
  return Number.isFinite(n) ? `$${fmt(Math.round(n / 100) * 100)}` : "—";
}

export function fmtPct(x, digits = 0) {
  return Number.isFinite(x) ? `${fmt(x * 100, digits)}%` : "—";
}

const REL = { high: "High reliability", medium: "Medium reliability", low: "Low reliability — use with caution", unknown: "Reliability unknown" };

export function incomeCell(t) {
  if (!Number.isFinite(t.median_income)) return el("span", { className: "muted" }, "No data");
  const moe = Number.isFinite(t.median_income_moe) ? ` ± ${fmtMoney(t.median_income_moe)}` : "";
  return el("span", {}, [
    `${fmtMoney(t.median_income)}${t.income_topcoded ? "+" : ""}${moe} `,
    el("span", { className: `rel rel--${t.median_income_reliability || "unknown"}`, title: REL[t.median_income_reliability] || REL.unknown },
      (t.median_income_reliability || "?")[0].toUpperCase()),
  ]);
}

export function feiText(fei) {
  if (!Number.isFinite(fei)) return "—";
  return `${fmt(fei)}`;
}

/** Rows for the Scenario details table. */
export function scenarioPeopleRows(exposure) {
  if (!exposure?.available) return [];
  const li = exposure.low_income || {};
  return [
    ["Residents exposed (2020)", `${fmtPeople(exposure.population_exposed)} · ${fmt(exposure.pct_population_exposed, 2)}% of region`],
    ["Homes exposed (2020)", fmtPeople(exposure.housing_exposed)],
    ["  Aged 65+ (ACS est.)", fmtPeople(exposure.age65_exposed_est)],
    ["  Below poverty (ACS est.)", fmtPeople(exposure.poverty_exposed_est)],
    ["  In low-income tracts", fmtPeople(li.exposed)],
    ["Flood Equity Index", Number.isFinite(li.fei) ? `${feiText(li.fei)} (100 = proportional)` : li.interpretation || "—"],
    ["Low-lying, not connected", `${fmtPeople(exposure.low_lying_population)} residents`],
  ];
}

/** Inspect popup rows from /api/inspect census block. */
export function inspectCensusRows(c, scenarioLabel) {
  if (!c) return [];
  const rows = [["Residents in this cell", c.residents_in_cell > 0 ? fmtPeople(c.residents_in_cell) : "None recorded (2020)"]];
  const t = c.tract;
  if (t) {
    rows.push(["Census tract", `${t.name.split(";")[0]}${c.tract_distance_cells ? " (nearest populated)" : ""}`]);
    rows.push(["Tract residents (2020)", fmtPeople(t.pop_2020)]);
    rows.push(["Median household income", incomeCell(t)]);
    rows.push(["Below poverty · 65+", `${fmtPct(t.poverty_rate)} · ${fmtPct(t.age65_share)} (ACS est.)`]);
    if (t.low_income != null) rows.push(["Low-income tract", t.low_income ? "Yes" : "No"]);
    if (c.tract_exposure) rows.push([`Exposed in tract (${scenarioLabel})`, fmtPeople(c.tract_exposure.exposed)]);
  }
  return rows;
}

export function tractPopup(t, row) {
  const rows = [
    ["Residents (2020)", fmtPeople(t.pop_2020)],
    ["Homes (2020)", fmtPeople(t.housing_2020)],
    ["Exposed in scenario", row ? `${fmtPeople(row.exposed)} (${t.pop_2020 ? fmt(100 * row.exposed / t.pop_2020, 1) : "—"}%)` : "0"],
    ["Median household income", incomeCell(t)],
    ["Below poverty (ACS est.)", fmtPct(t.poverty_rate)],
    ["Aged 65+ (ACS est.)", fmtPct(t.age65_share)],
    ["Low-income tract", t.low_income == null ? "Unknown" : t.low_income ? "Yes" : "No"],
  ];
  return el("div", { className: "tw-popup" }, [
    el("div", { className: "tw-popup-title" }, t.name.split(";")[0]),
    el("div", { className: "tw-popup-sub" }, `${t.name.split(";").slice(1).join(",").trim()} · GEOID ${t.geoid}`),
    el("table", {}, rows.map(([k, v]) => el("tr", {}, [el("th", {}, k), el("td", {}, v)]))),
  ]);
}

/** Horizontal stacked bar of exposed people by depth band. */
function depthBar(exposure, classes, label) {
  const parts = exposure.by_depth_class.map((b) => ({ ...b, spec: classes.find((c) => c.id === b.id) }));
  const total = parts.reduce((a, b) => a + (b.population || 0), 0);
  if (!total) return el("p", { className: "muted small" }, "No residents in flooded cells for this scenario.");
  return el("div", {}, [
    el("div", { className: "hbar", role: "img", "aria-label": `Exposed residents by flood depth: ${parts.map((p) => `${label(p.spec)} ${fmtPeople(p.population)}`).join(", ")}` },
      parts.filter((p) => p.population > 0).map((p) => el("span", {
        className: "hbar-seg", style: `flex:${p.population};background:${p.spec.color}`,
        title: `${label(p.spec)}: ${fmtPeople(p.population)} residents (${fmt(100 * p.population / total, 0)}%)`,
      }))),
    el("div", { className: "chart-legend" }, parts.map((p) => el("span", { className: "chart-legend-item" }, [
      el("span", { className: "tw-swatch", style: `background:${p.spec.color}` }),
      `${label(p.spec)} · ${fmtPeople(p.population)}`,
    ]))),
  ]);
}

/**
 * Render the People tab.
 * @param {HTMLElement} host
 * @param {{region, census, scenario, exposureRows, classes, depthLabel, sort, onSort, onTract, status}} o
 */
export function renderPeople(host, o) {
  const { census, scenario } = o;
  if (o.status === "not_covered") {
    host.replaceChildren(el("p", { className: "empty-note" }, `Population data isn't available for this region (${o.coverage || "outside U.S. Census coverage"}). Flood extent and depth are still shown.`));
    return;
  }
  if (census === null || scenario === null) { host.replaceChildren(el("p", { className: "empty-note" }, "Loading census data…")); return; }
  if (!census || census.available === false) {
    host.replaceChildren(el("p", { className: "empty-note" }, "Census data hasn't been built for this region yet. An administrator can add it from Data → Refresh observations."));
    return;
  }
  const exposure = scenario?.exposure;
  if (!exposure?.available) {
    host.replaceChildren(el("p", { className: "empty-note" }, "This scenario was built without population data. Recompute the region (Data panel) to add exposure."));
    return;
  }
  const li = exposure.low_income || {};
  const tiles = el("div", { className: "stat-tiles" }, [
    ["Residents exposed", fmtPeople(exposure.population_exposed), "2020 Census, in flooded cells"],
    ["Homes exposed", fmtPeople(exposure.housing_exposed), "housing units, 2020 Census"],
    ["Share of region", `${fmt(exposure.pct_population_exposed, 2)}%`, `of ${fmtPeople(exposure.population_total)} residents`],
    ["Flood Equity Index", Number.isFinite(li.fei) ? feiText(li.fei) : "n/a",
      Number.isFinite(li.fei) ? li.interpretation : (li.interpretation || "not computed")],
  ].map(([label, value, note]) => el("div", { className: "stat-tile" }, [
    el("div", { className: "stat-label" }, label), el("div", { className: "stat-value" }, value), el("div", { className: "stat-note" }, note),
  ])));

  const groups = el("table", { className: "data-table" }, [
    el("thead", {}, el("tr", {}, ["Group", "Exposed", "Share of exposed", "Basis"].map((h) => el("th", { scope: "col" }, h)))),
    el("tbody", {}, [
      ["All residents", exposure.population_exposed, "2020 Census count"],
      ["Aged 65+", exposure.age65_exposed_est, `ACS share × exposed (covers ${fmt(exposure.age65_coverage_pct, 0)}%)`],
      ["Below poverty line", exposure.poverty_exposed_est, `ACS rate × exposed (covers ${fmt(exposure.poverty_coverage_pct, 0)}%)`],
      ["In low-income tracts", li.exposed, `tract median income < ${fmtMoney(li.threshold_usd)}`],
    ].map(([g, v, basis]) => el("tr", {}, [
      el("td", {}, g), el("td", {}, fmtPeople(v)),
      el("td", {}, exposure.population_exposed ? `${fmt(100 * (v || 0) / exposure.population_exposed, 0)}%` : "—"),
      el("td", { className: "muted small" }, basis),
    ]))),
  ]);

  // Full tract table (from the exposure file), joined with census tracts.
  const byIndex = new Map((o.exposureRows || []).map((r) => [r.i, r]));
  const rows = [...byIndex.entries()].map(([i, r]) => ({ t: census.tracts[i], r, i })).filter((x) => x.t);
  const sort = o.sort || { key: "exposed", dir: -1 };
  const val = {
    name: (x) => x.t.name, exposed: (x) => x.r.exposed, pct: (x) => (x.t.pop_2020 ? x.r.exposed / x.t.pop_2020 : 0),
    homes: (x) => x.r.housing, income: (x) => x.t.median_income ?? -1, poverty: (x) => x.t.poverty_rate ?? -1,
    age: (x) => x.t.age65_share ?? -1, low: (x) => (x.t.low_income ? 1 : 0),
  };
  rows.sort((a, b) => {
    const va = val[sort.key](a);
    const vb = val[sort.key](b);
    return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * sort.dir;
  });
  const cols = [["name", "Tract"], ["exposed", "Exposed"], ["pct", "% of tract"], ["homes", "Homes"],
    ["income", "Median income (± MOE)"], ["poverty", "Poverty"], ["age", "65+"], ["low", "Low-income"]];
  const tractTable = rows.length ? el("table", { className: "data-table tract-table" }, [
    el("caption", {}, `${rows.length} tract${rows.length === 1 ? "" : "s"} with exposed residents · click a row to locate it`),
    el("thead", {}, el("tr", {}, cols.map(([k, label]) => el("th", { scope: "col", "aria-sort": sort.key === k ? (sort.dir > 0 ? "ascending" : "descending") : "none" },
      el("button", { type: "button", className: "sort-btn", onclick: () => o.onSort({ key: k, dir: sort.key === k ? -sort.dir : (k === "name" ? 1 : -1) }) },
        `${label}${sort.key === k ? (sort.dir > 0 ? " ▲" : " ▼") : ""}`))))),
    el("tbody", {}, rows.slice(0, 300).map((x) => el("tr", { tabindex: 0, onclick: () => o.onTract(x.t, x.r),
      onkeydown: (e) => { if (e.key === "Enter") o.onTract(x.t, x.r); } }, [
      el("td", {}, x.t.name.split(";")[0].replace("Census Tract ", "")),
      el("td", {}, fmtPeople(x.r.exposed)),
      el("td", {}, x.t.pop_2020 ? `${fmt(100 * x.r.exposed / x.t.pop_2020, 0)}%` : "—"),
      el("td", {}, fmtPeople(x.r.housing)),
      el("td", {}, incomeCell(x.t)),
      el("td", {}, fmtPct(x.t.poverty_rate)),
      el("td", {}, fmtPct(x.t.age65_share)),
      el("td", {}, x.t.low_income == null ? "—" : x.t.low_income ? "Yes" : "No"),
    ]))),
  ]) : el("p", { className: "muted small" }, "No tracts have exposed residents in this scenario.");

  const notes = el("details", { className: "people-notes" }, [
    el("summary", {}, "About these numbers"),
    el("ul", { className: "small" }, [
      el("li", {}, "Where people live: 2020 Census block counts (P.L. 94-171) from the Census Bureau's TIGERweb service. Block counts include deliberate privacy noise, so totals are rounded to the nearest 10."),
      el("li", {}, "Blocks are placed at their Census internal point. Large blocks are spread over the land within their area, so a big rural block isn't counted as entirely flooded or entirely dry."),
      el("li", {}, `Characteristics: ${census.acs_dataset || "ACS unavailable"} tract estimates. Aged 65+ and poverty figures apply each tract's ACS share to its exposed 2020 residents. Income is shown with its 90% margin of error; reliability is H ≤ 12%, M ≤ 40%, L > 40% coefficient of variation.`),
      el("li", {}, `Flood Equity Index = (share of exposed residents living in low-income tracts) ÷ (share of all residents living in low-income tracts) × 100. Low-income = tract median household income below ${fmtMoney(census.summary?.low_income_threshold)} (80% of the regional median of ${fmtMoney(census.summary?.regional_median_income)}). 100 means proportional; above 100 means low-income tracts carry more than their share.`),
      exposure.unreliable_income_tracts_exposed ? el("li", {}, `${exposure.unreliable_income_tracts_exposed} exposed tract(s) have low-reliability income estimates.`) : null,
      ...(census.notes || []).map((n) => el("li", {}, n)),
    ]),
  ]);

  host.replaceChildren(
    tiles,
    el("h4", { className: "people-h" }, "Exposed residents by flood depth"),
    depthBar(exposure, o.classes, (spec) => o.depthLabel(spec, { short: true })),
    exposure.low_lying_population > 0 ? el("p", { className: "muted small" }, `A further ${fmtPeople(exposure.low_lying_population)} residents live on low-lying land below the water level that isn't connected to the sea in the model; they are not counted as exposed.`) : null,
    el("h4", { className: "people-h" }, "Who is exposed"),
    groups,
    el("h4", { className: "people-h" }, "Census tracts"),
    tractTable,
    notes,
  );
}
