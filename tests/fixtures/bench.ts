import type { BenchFile } from "../../src/lib/bench";

/**
 * A benchmark file the way the runtime writes one (TraceFormat::Bench): intervals that follow each other without a
 * gap, each opening at the present the previous one closed at, its frame times adding up to its span.
 * `frames(interval)` gives each interval's frame times in microseconds.
 */
export function makeBench(intervals: number, frames: (interval: number) => number[], extra: Partial<BenchFile> = {}): BenchFile {
  const out: BenchFile["intervals"] = [];
  let start = 0;
  let present = 0;
  for (let n = 0; n < intervals; n++) {
    const frame_us = frames(n);
    // Seconds are written to the millisecond, from the exact time of the present.
    const end = start + frame_us.reduce((a, b) => a + b, 0) / 1e6;
    out.push({ start_s: Number(start.toFixed(3)), end_s: Number(end.toFixed(3)), first_present: present, resolution: "1920x1080", gpu_busy_ms: 12_000, frame_us });
    start = end;
    present += frame_us.length;
  }
  return {
    format: "aps5-bench/1",
    commit: "40f2a9c3d1b7",
    dirty: false,
    env: { APS5_TRACE_BENCH: "1", APS5_TRACE_SUMMARY_EVERY: "30", APS5_TRACE_DIR: "<path>" },
    gpu: "AMD Radeon RX 6800 (RADV NAVI21)",
    driver: "Mesa 24.2.3",
    os: "Linux 6.11",
    cpu: "AMD Ryzen 7 5800X 8-Core Processor",
    cpu_threads: 16,
    memory_mib: 32000,
    title_id: "PPSA12345",
    title: "Ejemplo",
    content_version: "01.002.000",
    intervals_dropped: 0,
    intervals: out,
    ...extra,
  };
}

/** 30 s at a steady rate: `fps` frames per second. */
export const steady = (fps: number, seconds = 30) => Array.from({ length: Math.round(fps * seconds) }, () => Math.round(1e6 / fps));

/** Gzips JSON the way the runtime's file is compressed. */
export async function gzip(value: unknown): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
