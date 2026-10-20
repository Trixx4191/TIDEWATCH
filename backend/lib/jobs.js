/**
 * lib/jobs.js
 * ===========
 * Runs data operations as child processes of the API, one at a time.
 *
 * - Commands are built from a fixed whitelist: actions map to scripts and
 *   flags, regions must be configured keys, numbers are range-checked. No
 *   shell is involved (spawn with an argument array).
 * - The Python pipeline prints `@@PROGRESS {json}` lines (TIDEWATCH_PROGRESS=1);
 *   they drive `job.progress` (stage, message, overall percent).
 * - History (last 50 jobs, last 300 log lines each) is kept in
 *   <data dir>/.jobs/history.json when the data dir is writable.
 */

"use strict";

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./data");
const { REGIONS } = require("../routes/regions");

const ROOT = path.resolve(__dirname, "../..");
const PYTHON = process.env.TIDEWATCH_PYTHON || (process.platform === "win32" ? "python" : "python3");
const PACKAGES_DIR = path.resolve(process.env.TIDEWATCH_PACKAGES_DIR || path.join(ROOT, "data", "packages"));
const HISTORY_FILE = path.join(DATA_DIR, ".jobs", "history.json");
const MAX_HISTORY = 50;
const MAX_LOG = 300;
const PROGRESS_PREFIX = "@@PROGRESS ";
const ARCSEC = new Set([1, 2, 3, 4, 5, 6, 10]);
const YEARS = new Set([2024, 2030, 2040, 2050, 2060, 2075, 2090, 2100]);

// Share of a region's run spent in each stage, for the overall progress bar.
const STAGE_WEIGHTS = { elevation: 0.30, tides: 0.15, tracks: 0.05, census: 0.10, scenarios: 0.40 };
const STAGE_ORDER = ["elevation", "tides", "tracks", "census", "scenarios"];

const ACTIONS = {
  build: { label: "Build", script: "data/build_dataset.py", flags: [] },
  refresh: { label: "Refresh observations", script: "data/build_dataset.py", flags: ["--skip-srtm"] },
  recompute: {
    label: "Recompute scenarios", script: "data/build_dataset.py",
    flags: ["--skip-srtm", "--skip-tides", "--skip-tracks", "--skip-census"],
  },
  export: { label: "Export package", script: "data/dataset_package.py" },
  import: { label: "Import package", script: "data/dataset_package.py" },
};

/** Validate a request body and return {action, args, spec} or throw. */
function buildCommand(body = {}) {
  const action = String(body.action || "");
  const def = ACTIONS[action];
  if (!def) throw Object.assign(new Error(`Unknown action '${action}'`), { status: 400 });
  const regions = Array.isArray(body.regions) ? [...new Set(body.regions.map(String))] : [];
  if (action !== "import") {
    if (!regions.length) throw Object.assign(new Error("Choose at least one region"), { status: 400 });
    const bad = regions.filter((r) => !REGIONS[r]);
    if (bad.length) throw Object.assign(new Error(`Unknown region(s): ${bad.join(", ")}`), { status: 400 });
  }
  const spec = { action, label: def.label, regions };
  let args;
  if (action === "export") {
    args = [def.script, "export", "--regions", ...regions, "--output", PACKAGES_DIR, "--data-dir", DATA_DIR];
  } else if (action === "import") {
    const source = String(body.source || "");
    if (body.upload_id) {
      if (!/^[a-f0-9-]{36}$/.test(body.upload_id)) throw Object.assign(new Error("Bad upload id"), { status: 400 });
      const file = path.join(PACKAGES_DIR, "uploads", `${body.upload_id}.tar.gz`);
      if (!fs.existsSync(file)) throw Object.assign(new Error("Upload not found"), { status: 404 });
      let label = "uploaded file";
      try { label = fs.readFileSync(file.replace(/\.tar\.gz$/, ".name"), "utf8").trim() || label; } catch { /* unnamed */ }
      spec.source = label;
      spec.upload = file;
      args = [def.script, "import", "--source", file, "--data-dir", DATA_DIR, "--label", label];
    } else if (/^https:\/\/[^\s]+$/i.test(source) && source.length < 2000) {
      spec.source = source;
      args = [def.script, "import", "--source", source, "--data-dir", DATA_DIR];
    } else {
      throw Object.assign(new Error("Provide an https:// package URL or upload a file"), { status: 400 });
    }
  } else {
    args = [def.script, ...def.flags, "--regions", ...regions, "--output-dir", DATA_DIR];
    const arcsec = body.arcsec === undefined ? 3 : Number(body.arcsec);
    if (!ARCSEC.has(arcsec)) throw Object.assign(new Error("arcsec must be 1, 2, 3, 4, 5, 6 or 10"), { status: 400 });
    if (action !== "recompute" || arcsec !== 3) spec.arcsec = arcsec;
    if (action !== "recompute") args.push("--arcsec", String(arcsec));
    if (Array.isArray(body.years) && body.years.length) {
      const years = [...new Set(body.years.map(Number))].sort();
      if (!years.every((y) => YEARS.has(y))) throw Object.assign(new Error("Unsupported year"), { status: 400 });
      spec.years = years;
      args.push("--slr-years", ...years.map(String));
    }
  }
  return { action, args, spec };
}

class JobManager {
  constructor() {
    this.jobs = new Map();
    this.queue = [];
    this.running = null;
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
      for (const job of saved) {
        if (job.status === "running" || job.status === "queued") {
          job.status = "interrupted";
          job.error = "The server restarted while this job was running";
        }
        this.jobs.set(job.id, job);
      }
    } catch { /* no history yet */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
      const list = [...this.jobs.values()].slice(-MAX_HISTORY).map((j) => ({ ...j, log: j.log.slice(-MAX_LOG) }));
      const tmp = `${HISTORY_FILE}.part`;
      fs.writeFileSync(tmp, JSON.stringify(list));
      fs.renameSync(tmp, HISTORY_FILE);
    } catch { /* read-only data dir: keep history in memory only */ }
  }

  list() {
    return [...this.jobs.values()].reverse().map((j) => this.summary(j));
  }

  summary(job) {
    const { log, process: _p, ...rest } = job;
    return { ...rest, log_lines: log.length };
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  create(body, by) {
    const { args, spec } = buildCommand(body);
    const active = [...this.jobs.values()].filter((j) => j.status === "queued" || j.status === "running");
    if (active.length >= 5) throw Object.assign(new Error("Too many queued jobs; wait for some to finish"), { status: 429 });
    const job = {
      id: crypto.randomUUID(),
      ...spec,
      args,
      requested_by: by,
      status: "queued",
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      exit_code: null,
      progress: { percent: 0, stage: null, region: null, message: "Waiting to start", done: null, total: null },
      region_index: 0,
      warnings: [],
      error: null,
      result: null,
      log: [],
    };
    this.jobs.set(job.id, job);
    while (this.jobs.size > MAX_HISTORY) this.jobs.delete(this.jobs.keys().next().value);
    this.queue.push(job.id);
    this.save();
    this.next();
    return job;
  }

  next() {
    if (this.running || !this.queue.length) return;
    const job = this.jobs.get(this.queue.shift());
    if (!job || job.status !== "queued") return this.next();
    this.running = job.id;
    job.status = "running";
    job.started_at = new Date().toISOString();
    job.progress.message = "Starting";
    const env = {
      ...process.env,
      TIDEWATCH_PROGRESS: "1",
      TIDEWATCH_DATA_DIR: DATA_DIR,
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    };
    let child;
    try {
      child = spawn(PYTHON, job.args, { cwd: ROOT, env, detached: process.platform !== "win32" });
    } catch (error) {
      return this.finish(job, null, `Could not start Python (${PYTHON}): ${error.message}`);
    }
    Object.defineProperty(job, "process", { value: child, enumerable: false, writable: true, configurable: true });
    const onData = (chunk, stream) => {
      const text = (job[`_${stream}`] || "") + chunk.toString("utf8");
      const lines = text.split(/\r?\n/);
      job[`_${stream}`] = lines.pop();
      for (const line of lines) this.line(job, line, stream);
    };
    child.stdout.on("data", (c) => onData(c, "out"));
    child.stderr.on("data", (c) => onData(c, "err"));
    child.on("error", (error) => this.finish(job, null, `Could not start Python (${PYTHON}): ${error.message}`));
    child.on("close", (code) => this.finish(job, code));
    this.save();
    return undefined;
  }

  line(job, raw, stream) {
    const line = raw.replace(/\s+$/, "");
    if (!line) return;
    if (line.startsWith(PROGRESS_PREFIX)) {
      try {
        this.progress(job, JSON.parse(line.slice(PROGRESS_PREFIX.length)));
      } catch { /* ignore malformed progress */ }
      return;
    }
    job.log.push(`${stream === "err" ? "! " : ""}${line}`);
    if (job.log.length > MAX_LOG * 4) job.log.splice(0, job.log.length - MAX_LOG * 2);
    if (/^\s*(✗|⚠)/.test(line) || /^\s+- /.test(line)) job.warnings.push(line.trim());
    if (job.warnings.length > 50) job.warnings.shift();
    const pkg = line.match(/✓ Package: (.+?) \(/);
    if (pkg) job.result = { package: path.basename(pkg[1]) };
    const imported = line.match(/✓ Imported (\d+) files for (.+)$/);
    if (imported) job.result = { files: Number(imported[1]), regions: imported[2].split(", ") };
  }

  progress(job, ev) {
    const p = job.progress;
    if (ev.stage === "region") {
      job.region_index = Number(ev.done) || 0;
      p.region = ev.region;
    } else {
      p.stage = ev.stage;
      p.region = ev.region || p.region;
    }
    p.message = ev.message || p.message;
    p.done = ev.done;
    p.total = ev.total;
    let percent;
    if (["export", "import", "download"].includes(ev.stage)) {
      percent = ev.total ? (100 * ev.done) / ev.total : p.percent;
    } else {
      const nRegions = Math.max(1, job.regions.length);
      const i = STAGE_ORDER.indexOf(ev.stage);
      const before = STAGE_ORDER.slice(0, Math.max(0, i)).reduce((a, s) => a + STAGE_WEIGHTS[s], 0);
      const within = i >= 0 && ev.total ? (STAGE_WEIGHTS[ev.stage] * Math.min(ev.done, ev.total)) / ev.total : 0;
      const regionFraction = ev.stage === "region" ? 0 : before + within;
      percent = (100 * (job.region_index + regionFraction)) / nRegions;
    }
    p.percent = Math.max(p.percent || 0, Math.min(99, Math.round(percent * 10) / 10));
  }

  finish(job, code, error = null) {
    if (job.finished_at) return;
    for (const stream of ["out", "err"]) {
      if (job[`_${stream}`]) this.line(job, job[`_${stream}`], stream);
      delete job[`_${stream}`];
    }
    job.finished_at = new Date().toISOString();
    job.exit_code = code;
    if (job.cancel_requested) job.status = "cancelled";
    else if (error) { job.status = "failed"; job.error = error; }
    else if (code === 0) job.status = "succeeded";
    else if (code === 2) job.status = "completed_with_warnings";
    else {
      job.status = "failed";
      // Python's last traceback line is "ExceptionType: message"; show that, not the stack.
      const exc = [...job.log].reverse().find((l) => /^! ?[A-Za-z_.]*(Error|Exception|Unavailable|Interrupt)\b:?/.test(l));
      const cross = [...job.log].reverse().find((l) => /✗/.test(l));
      job.error = (exc ? exc.replace(/^! ?/, "").replace(/^[A-Za-z_.]*(Error|Exception|Unavailable):\s*/, "") : null)
        || (cross ? cross.replace(/^.*✗\s*/, "") : null) || `Exited with code ${code}`;
    }
    if (job.status === "succeeded" || job.status === "completed_with_warnings") job.progress.percent = 100;
    job.progress.message = { succeeded: "Finished", completed_with_warnings: "Finished with warnings",
      cancelled: "Cancelled", failed: "Failed" }[job.status];
    if (job.upload) {
      fs.rm(job.upload, { force: true }, () => {});
      fs.rm(job.upload.replace(/\.tar\.gz$/, ".name"), { force: true }, () => {});
    }
    this.running = null;
    this.save();
    this.next();
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === "queued") {
      job.status = "cancelled";
      job.finished_at = new Date().toISOString();
      job.progress.message = "Cancelled";
      this.queue = this.queue.filter((q) => q !== id);
      this.save();
    } else if (job.status === "running" && job.process) {
      job.cancel_requested = true;
      try {
        if (process.platform !== "win32") process.kill(-job.process.pid, "SIGTERM");
        else job.process.kill("SIGTERM");
      } catch { job.process.kill("SIGTERM"); }
      setTimeout(() => { if (!job.finished_at) try { process.kill(-job.process.pid, "SIGKILL"); } catch { /* gone */ } }, 8000);
    }
    return job;
  }
}

const manager = new JobManager();

module.exports = { manager, buildCommand, PACKAGES_DIR, PYTHON, ACTIONS, ROOT };
