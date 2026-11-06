import type { RunReport } from "./run-report";

/**
 * The benchmark file the AnyPS5 runtime writes with `APS5_TRACE_SUMMARY_EVERY=<s> APS5_TRACE_BENCH=1`:
 * `aps5-bench-<commit>-<pid>.json.gz`, format `aps5-bench/1`. It holds the time between every two presents, interval
 * by interval, so the site measures the frame rate itself instead of taking the run report's average. Its layout is
 * upstream's, from `TraceFormat::Bench` in core/libs/prx/libSceAgcDriver/Execution/include/PerformanceTrace.hpp and
 * docs/dev/BUILD.md ("Summaries for a long session"). Shared by the upload form (a preview) and the Worker (the check).
 */

/** The compressed file, as uploaded. A two-hour session at 60 fps is about 1 MB. */
export const MAX_BENCH_BYTES = 8 * 1024 * 1024;
/** The file once unpacked: about 6 bytes per frame, so room for 240 intervals of 30 s at well over 200 fps. */
export const MAX_BENCH_JSON_BYTES = 16 * 1024 * 1024;
/** The runtime keeps at most this many intervals. */
const MAX_INTERVALS = 240;
/**
 * A run that presented frames for this long must come with its benchmark file: with the documented 30 s interval, it
 * has written at least one. A shorter run, a crash soon after the first frame for example, may not have one.
 */
export const BENCH_REQUIRED_AFTER_SECONDS = 60;
/** Variables that add timers to every batch or packet: such a run is slower by design and isn't compared with others. */
const PROFILING = ["APS5_PROFILE_GPU", "APS5_PROFILE_DRAW"];

export interface BenchInterval {
  start_s: number;
  end_s: number;
  first_present: number;
  resolution: string;
  gpu_busy_ms: number;
  frame_us: number[];
}

export interface BenchFile {
  format: "aps5-bench/1";
  commit: string;
  dirty: boolean | null;
  env: Record<string, string>;
  gpu: string;
  driver: string;
  os: string;
  cpu?: string;
  cpu_threads?: number;
  memory_mib?: number;
  title_id?: string;
  title?: string;
  content_version?: string;
  intervals_dropped: number;
  intervals: BenchInterval[];
}

/** Frame-time figures over a stretch of the run. FPS figures are frames per second, times in milliseconds. */
export interface FrameStats {
  seconds: number;
  frames: number;
  /** Presents over the time they took. */
  fps: number;
  /** 1000 over the 99th and 99.9th percentile frame time: the rate of the slowest 1% and 0.1% of frames. */
  low1: number;
  low01: number;
  frameMs: { p50: number; p90: number; p99: number; p999: number; max: number };
  /** Frames at least twice as long as their interval's median, and the time they took past that median. */
  stutters: number;
  stutterSeconds: number;
  /** GPU busy time over the stretch, from the batch timestamps; overlapping queues each count, so it can pass 100. */
  gpuBusyPct: number;
  /** The rate the median frame sits on, when it is within 3% of 30, 60 or 120 fps: a capped or vsynced game. */
  cap: 30 | 60 | 120 | null;
}

/** What the site keeps of a benchmark file: the figures, never the frame times. */
export interface BenchStats {
  version: 1;
  commit: string;
  dirty: boolean | null;
  host: { gpu: string; driver: string; os: string; cpu: string | null; cpuThreads: number | null; memoryMiB: number | null };
  /** Every `APS5_*` variable of the run, paths already replaced by `<path>` by the runtime. */
  env: Record<string, string>;
  /** Profiling variables that were set: the figures aren't comparable with other runs. */
  profiled: string[];
  /** Neither profiled nor built from modified sources. */
  comparable: boolean;
  /** Seconds from the first present to the end of the last interval written. */
  sessionSeconds: number;
  intervalsDropped: number;
  /** The first interval of the session, which includes shader compilation; null when the file no longer holds it. */
  warmup: { seconds: number; fps: number; p99Ms: number } | null;
  /** The whole file but the warm-up, or the warm-up alone when that is all there is (`includesWarmup`). */
  measured: FrameStats;
  includesWarmup: boolean;
  intervals: { start: number; seconds: number; fps: number; p99Ms: number; resolution: string; gpuBusyPct: number }[];
  resolutions: string[];
}

/** Unpacks a gzip file (or takes plain JSON as it is), refusing output past `limit` bytes. Null when it is too big. */
export async function unpack(bytes: Uint8Array, limit = MAX_BENCH_JSON_BYTES): Promise<Uint8Array | null> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.length > limit ? null : bytes;
  const reader = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const isText = (v: unknown, max = 512): v is string => typeof v === "string" && v.length <= max;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isSeconds = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9;

/**
 * Checks parsed JSON is a benchmark file and that its intervals hold together the way the runtime writes them: each
 * interval opens at the present the previous one closed at, its frame times add up to its span, and its presents
 * continue the count. Returns the file, or up to five readable problems.
 */
export function validateBench(data: unknown): { bench: BenchFile; issues: [] } | { bench: null; issues: string[] } {
  const issues: string[] = [];
  const fail = () => ({ bench: null, issues: issues.slice(0, 5) });
  const d = data as Record<string, unknown> | null;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return (issues.push("The file isn't a JSON object."), fail());
  if (d.format !== "aps5-bench/1") return (issues.push(`format: expected "aps5-bench/1"${isText(d.format, 40) ? `, got "${d.format}"` : ""}.`), fail());
  if (!isText(d.commit, 64)) issues.push("commit: expected text.");
  if (d.dirty !== null && typeof d.dirty !== "boolean") issues.push("dirty: expected true, false or null.");
  const env = d.env as Record<string, unknown> | null;
  if (typeof env !== "object" || env === null || Array.isArray(env)) issues.push("env: expected an object.");
  else if (Object.entries(env).some(([k, v]) => !/^APS5_[A-Z0-9_]{1,64}$/.test(k) || !isText(v, 256)) || Object.keys(env).length > 100) issues.push("env: expected APS5_ variables with text values.");
  for (const k of ["gpu", "driver", "os"] as const) if (!isText(d[k])) issues.push(`${k}: expected text.`);
  if (d.cpu !== undefined && !isText(d.cpu)) issues.push("cpu: expected text.");
  for (const k of ["cpu_threads", "memory_mib"] as const) if (d[k] !== undefined && !isCount(d[k])) issues.push(`${k}: expected a whole number.`);
  for (const k of ["title_id", "title", "content_version"] as const) if (d[k] !== undefined && !isText(d[k])) issues.push(`${k}: expected text.`);
  if (!isCount(d.intervals_dropped)) issues.push("intervals_dropped: expected a whole number.");
  const intervals = d.intervals as unknown[];
  if (!Array.isArray(intervals) || intervals.length === 0) issues.push("intervals: the file holds no intervals. Play for at least one interval before quitting.");
  else if (intervals.length > MAX_INTERVALS) issues.push(`intervals: at most ${MAX_INTERVALS}.`);
  if (issues.length) return fail();

  let previous: BenchInterval | null = null;
  for (const [index, raw] of intervals.entries()) {
    const at = `intervals/${index}`;
    const i = raw as BenchInterval;
    if (typeof i !== "object" || i === null) {
      issues.push(`${at}: expected an object.`);
      break;
    }
    if (!isSeconds(i.start_s) || !isSeconds(i.end_s) || i.end_s < i.start_s) issues.push(`${at}: start_s and end_s must be seconds, the end after the start.`);
    if (!isCount(i.first_present)) issues.push(`${at}: first_present must be a whole number.`);
    if (!isText(i.resolution, 16) || !/^\d{1,5}x\d{1,5}$/.test(i.resolution)) issues.push(`${at}: resolution must look like 1920x1080.`);
    if (!isSeconds(i.gpu_busy_ms)) issues.push(`${at}: gpu_busy_ms must be a number of milliseconds.`);
    if (!Array.isArray(i.frame_us) || i.frame_us.length === 0 || !i.frame_us.every((f) => Number.isInteger(f) && f >= 0 && f <= 0xffffffff))
      issues.push(`${at}: frame_us must be a list of whole microseconds.`);
    if (issues.length) break;
    // Seconds are written to the millisecond and each frame time is truncated to the microsecond.
    let sum = 0;
    for (const f of i.frame_us) sum += f;
    const span = i.end_s - i.start_s;
    if (Math.abs(sum / 1e6 - span) > 0.003 + i.frame_us.length * 1e-6) issues.push(`${at}: its frame times add up to ${(sum / 1e6).toFixed(3)} s, but it spans ${span.toFixed(3)} s.`);
    if (previous) {
      if (Math.abs(i.start_s - previous.end_s) > 0.0015) issues.push(`${at}: it starts at ${i.start_s} s, but the interval before it ended at ${previous.end_s} s.`);
      if (i.first_present !== previous.first_present + previous.frame_us.length) issues.push(`${at}: its first present doesn't follow the presents of the interval before it.`);
    }
    if (issues.length) break;
    previous = i;
  }
  if (issues.length) return fail();
  return { bench: d as unknown as BenchFile, issues: [] };
}

const round = (v: number, places = 1) => Math.round(v * 10 ** places) / 10 ** places;

/** The nearest-rank percentile of sorted values. */
const percentile = (sorted: Uint32Array, p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;

function median(values: number[]): number {
  const sorted = Uint32Array.from(values).sort();
  return percentile(sorted, 0.5);
}

function frameStats(intervals: BenchInterval[]): FrameStats {
  const frames = Uint32Array.from(intervals.flatMap((i) => i.frame_us));
  let sum = 0;
  for (const f of frames) sum += f;
  let stutters = 0;
  let lost = 0;
  for (const i of intervals) {
    const m = median(i.frame_us);
    for (const f of i.frame_us)
      if (m > 0 && f >= 2 * m) {
        stutters++;
        lost += f - m;
      }
  }
  frames.sort();
  const seconds = sum / 1e6;
  const ms = (us: number) => round(us / 1000, 2);
  const fpsOf = (us: number) => (us > 0 ? round(1e6 / us) : 0);
  const p50 = percentile(frames, 0.5);
  const busy = intervals.reduce((a, i) => a + i.gpu_busy_ms, 0);
  const cap = ([30, 60, 120] as const).find((t) => Math.abs(p50 - 1e6 / t) <= 0.03 * (1e6 / t)) ?? null;
  return {
    seconds: round(seconds, 3),
    frames: frames.length,
    fps: seconds > 0 ? round(frames.length / seconds) : 0,
    low1: fpsOf(percentile(frames, 0.99)),
    low01: fpsOf(percentile(frames, 0.999)),
    frameMs: { p50: ms(p50), p90: ms(percentile(frames, 0.9)), p99: ms(percentile(frames, 0.99)), p999: ms(percentile(frames, 0.999)), max: ms(frames[frames.length - 1]!) },
    stutters,
    stutterSeconds: round(lost / 1e6, 2),
    gpuBusyPct: seconds > 0 ? round((busy / 1000 / seconds) * 100) : 0,
    cap,
  };
}

/** The figures the site keeps and shows, from a validated file. */
export function benchStats(bench: BenchFile): BenchStats {
  const all = bench.intervals;
  // The session's first interval starts at its first present and includes shader compilation.
  const first = bench.intervals_dropped === 0 && all[0]!.start_s === 0 ? all[0]! : null;
  const rest = first ? all.slice(1) : all;
  const measured = frameStats(rest.length ? rest : all);
  const env = Object.fromEntries(Object.entries(bench.env).slice(0, 100));
  const profiled = PROFILING.filter((k) => env[k] !== undefined && env[k] !== "" && env[k] !== "0");
  const warm = first ? frameStats([first]) : null;
  return {
    version: 1,
    commit: bench.commit,
    dirty: bench.dirty,
    host: { gpu: bench.gpu, driver: bench.driver, os: bench.os, cpu: bench.cpu ?? null, cpuThreads: bench.cpu_threads ?? null, memoryMiB: bench.memory_mib ?? null },
    env,
    profiled,
    comparable: profiled.length === 0 && bench.dirty !== true,
    sessionSeconds: round(all[all.length - 1]!.end_s, 3),
    intervalsDropped: bench.intervals_dropped,
    warmup: warm ? { seconds: warm.seconds, fps: warm.fps, p99Ms: warm.frameMs.p99 } : null,
    measured,
    includesWarmup: rest.length === 0 && first !== null,
    intervals: all.map((i) => {
      const s = frameStats([i]);
      return { start: round(i.start_s, 3), seconds: s.seconds, fps: s.fps, p99Ms: s.frameMs.p99, resolution: i.resolution, gpuBusyPct: s.gpuBusyPct };
    }),
    resolutions: [...new Set(all.map((i) => i.resolution))],
  };
}

/** Reads uploaded bytes (gzip or plain) as a benchmark file. */
export async function readBench(bytes: Uint8Array): Promise<{ bench: BenchFile; text: string; issues: [] } | { bench: null; text: null; issues: string[] }> {
  let unpacked: Uint8Array | null;
  try {
    unpacked = await unpack(bytes);
  } catch {
    return { bench: null, text: null, issues: ["The file couldn't be unpacked. Upload the aps5-bench-….json.gz AnyPS5 wrote, unchanged."] };
  }
  if (!unpacked) return { bench: null, text: null, issues: ["The frame-time file is too big once unpacked."] };
  let text: string;
  let data: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(unpacked);
    data = JSON.parse(text);
  } catch {
    return { bench: null, text: null, issues: ["The frame-time file isn't JSON. Upload the aps5-bench-….json.gz AnyPS5 wrote."] };
  }
  const { bench, issues } = validateBench(data);
  return bench ? { bench, text, issues: [] } : { bench: null, text: null, issues };
}

/** Whether a report must come with its benchmark file: it presented frames long enough for one to be written. */
export function benchRequired(report: RunReport): boolean {
  if (report.run.stage !== "presents") return false;
  const since = report.run.milestones.firstPresent ?? 0;
  return report.run.seconds - since >= BENCH_REQUIRED_AFTER_SECONDS;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|[^a-z0-9]+/g, " ").trim();

/**
 * Whether a benchmark file can be the same run as the report. Nothing links the two files, so a file from another run
 * of the same game on the same build can't be told apart; a different build, game, version, or more frames or time
 * than the run had, can. A GPU named differently only flags the upload, as the two files may spell it differently.
 */
export function checkBench(report: RunReport, bench: BenchFile): { errors: string[]; flags: string[] } {
  const errors: string[] = [];
  const flags: string[] = [];
  const commit = report.anyps5.commit;
  if (commit && bench.commit !== "unknown" && !commit.startsWith(bench.commit)) errors.push(`The frame-time file is from AnyPS5 ${bench.commit}, the report from ${commit.slice(0, 12)}.`);
  if (report.game.titleId && bench.title_id && bench.title_id !== report.game.titleId) errors.push(`The frame-time file is from ${bench.title_id}, the report from ${report.game.titleId}.`);
  if (report.game.contentVersion && bench.content_version && bench.content_version !== report.game.contentVersion)
    errors.push(`The frame-time file is from game version ${bench.content_version}, the report from ${report.game.contentVersion}.`);
  const last = bench.intervals[bench.intervals.length - 1]!;
  const presents = last.first_present + last.frame_us.length;
  if (presents > report.run.framesPresented + 1) errors.push(`The frame-time file holds ${presents} presents, but the run presented ${report.run.framesPresented}.`);
  const presenting = report.run.seconds - (report.run.milestones.firstPresent ?? 0);
  if (last.end_s > presenting + 1) errors.push(`The frame-time file covers ${Math.round(last.end_s)} s of frames, longer than the run presented them (${Math.round(presenting)} s).`);
  const gpu = report.system.gpu?.name;
  if (gpu && bench.gpu && !norm(bench.gpu).includes(norm(gpu)) && !norm(gpu).includes(norm(bench.gpu))) flags.push(`The frame-time file names the GPU "${bench.gpu}", the report "${gpu}".`);
  if (bench.dirty === true && report.anyps5.modified === false) flags.push("The frame-time file is from modified sources, the report says unmodified.");
  return { errors, flags };
}
