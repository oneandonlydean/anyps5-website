import { describe, expect, it } from "vitest";
import { benchRequired, benchStats, checkBench, readBench, validateBench } from "../src/lib/bench";
import type { RunReport } from "../src/lib/run-report";
import presents from "./fixtures/run-reports/stop-none.json";
import sample from "./fixtures/run-reports/stop-unsupported-shader.json";
import { gzip, makeBench, steady } from "./fixtures/bench";

const report = presents as unknown as RunReport;
// The run presented 303 s and 12580 frames: a 30 s warm-up then nine intervals at 40 fps fits.
const fits = () => makeBench(10, (n) => (n === 0 ? steady(20) : steady(40)));

describe("reading a benchmark file", () => {
  it("unpacks the gzip the runtime writes, and takes plain JSON too", async () => {
    const bench = fits();
    expect((await readBench(await gzip(bench))).bench?.intervals).toHaveLength(10);
    expect((await readBench(new TextEncoder().encode(JSON.stringify(bench)))).bench).not.toBeNull();
    expect((await readBench(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).issues[0]).toMatch(/unpacked/);
    expect((await readBench(new TextEncoder().encode("nope"))).issues[0]).toMatch(/isn't JSON/);
  });

  it("refuses intervals that don't hold together the way the runtime writes them", () => {
    expect(validateBench({ format: "aps5-trace/1" }).issues[0]).toMatch(/aps5-bench\/1/);
    expect(validateBench({ ...fits(), intervals: [] }).issues[0]).toMatch(/no intervals/);

    const gap = fits();
    gap.intervals[3]!.start_s += 2;
    gap.intervals[3]!.end_s += 2;
    expect(validateBench(gap).issues.join()).toMatch(/interval before it ended/);

    const padded = fits();
    padded.intervals[2]!.frame_us.push(16_000);
    expect(validateBench(padded).issues[0]).toMatch(/add up to/);

    const skipped = fits();
    skipped.intervals[5]!.first_present += 10;
    expect(validateBench(skipped).issues[0]).toMatch(/doesn't follow/);

    expect(validateBench({ ...fits(), env: { HOME: "/home/someone" } }).issues[0]).toMatch(/APS5_/);
  });
});

describe("the figures", () => {
  it("measures the frame rate from the frame times, leaving out the warm-up", () => {
    const s = benchStats(fits());
    expect(s.measured).toMatchObject({ fps: 40, frames: 10_800, low1: 40, stutters: 0, cap: null });
    expect(s.measured.seconds).toBeCloseTo(270, 0);
    expect(s.warmup).toMatchObject({ fps: 20 });
    expect(s.includesWarmup).toBe(false);
    expect(s.intervals).toHaveLength(10);
    expect(s.intervals[1]).toMatchObject({ fps: 40, resolution: "1920x1080" });
    expect(s.comparable).toBe(true);
  });

  it("counts stutter, finds a capped rate and reads the lows", () => {
    // 60 fps with one 100 ms hitch every 300 frames.
    const hitchy = (n: number) => steady(60).map((f, i) => (n > 0 && i % 300 === 299 ? 100_000 : f));
    const s = benchStats(makeBench(4, hitchy));
    expect(s.measured.cap).toBe(60);
    expect(s.measured.stutters).toBe(18);
    expect(s.measured.frameMs.max).toBe(100);
    expect(s.measured.low01).toBe(10);
    expect(s.measured.fps).toBeLessThan(60);
  });

  it("keeps the warm-up as the figures when it is all the file holds, and drops it once rotated out", () => {
    expect(benchStats(makeBench(1, () => steady(30))).includesWarmup).toBe(true);
    const rotated = benchStats({ ...makeBench(3, () => steady(30)), intervals_dropped: 2 });
    expect(rotated.warmup).toBeNull();
    expect(rotated.measured.frames).toBe(2700);
  });

  it("marks profiled runs and modified builds as not comparable", () => {
    expect(benchStats(makeBench(2, () => steady(30), { env: { APS5_PROFILE_GPU: "1" } }))).toMatchObject({ profiled: ["APS5_PROFILE_GPU"], comparable: false });
    expect(benchStats(makeBench(2, () => steady(30), { dirty: true })).comparable).toBe(false);
  });
});

describe("matching the report", () => {
  it("is required once a run has presented frames for a minute", () => {
    expect(benchRequired(report)).toBe(true);
    expect(benchRequired(sample as unknown as RunReport)).toBe(false);
    expect(benchRequired({ ...report, run: { ...report.run, seconds: 50 } })).toBe(false);
  });

  it("accepts a file that fits the run", () => {
    expect(checkBench(report, fits())).toEqual({ errors: [], flags: [] });
  });

  it("refuses one from another build, game or version, or with more than the run had", () => {
    expect(checkBench(report, { ...fits(), commit: "aaaaaaaaaaaa" }).errors[0]).toMatch(/AnyPS5 aaaaaaaaaaaa/);
    expect(checkBench(report, { ...fits(), title_id: "PPSA99999" }).errors[0]).toMatch(/PPSA99999/);
    expect(checkBench(report, { ...fits(), content_version: "02.000.000" }).errors[0]).toMatch(/game version/);
    expect(checkBench(report, makeBench(10, () => steady(60))).errors.join()).toMatch(/presents, but the run presented/);
    expect(checkBench(report, makeBench(12, () => steady(10))).errors.join()).toMatch(/longer than the run presented/);
  });

  it("flags a GPU named differently, and takes the runtime's longer name", () => {
    expect(checkBench(report, { ...fits(), gpu: "NVIDIA GeForce RTX 4080" }).flags[0]).toMatch(/GPU/);
    expect(checkBench(report, { ...fits(), gpu: "AMD Radeon RX 6800 (RADV NAVI21)" }).flags).toEqual([]);
  });
});
