import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { unzipSync } from "fflate";
import { generated, readJson, root, writeJson } from "./lib/files";
import { countPeople, type ContributorEntry } from "./lib/contributors";
import { rest, restCount } from "./lib/github";

const CONVERTER = resolve(root, "public/convert/app");
const UPSTREAM_PAGES = "https://boykopovar.github.io/AnyPS5";
/** The converter's core files. Upstream adds modules over time, so others are taken too when they look like web files. */
const WEB_FILES = ["index.html", "app.css", "app.mjs", "archive.mjs", "batch.mjs", "output-directory.mjs", "worker.mjs", "native/relinker_wasm.mjs", "native/relinker_wasm.wasm"];
const DOCS = ["USAGE.md", "INPUT_MAPPING.md"];
const PLATFORMS = ["windows", "linux"] as const;

interface Asset {
  name: string;
  size: number;
  digest?: string | null;
  browser_download_url: string;
}
interface Release {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: Asset[];
}

function asset(release: Release, name: string): Asset {
  const found = release.assets.filter((a) => a.name === name);
  if (found.length !== 1) throw new Error(`Missing or ambiguous release asset: ${name}`);
  return found[0];
}

/** Downloads an asset and checks its size and, when GitHub lists one, its sha256. */
async function download(a: Asset): Promise<{ bytes: Uint8Array; sha256: string }> {
  const response = await fetch(a.browser_download_url);
  if (!response.ok) throw new Error(`${a.name}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== a.size) throw new Error(`${a.name}: incomplete download`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (a.digest && a.digest !== `sha256:${sha256}`) throw new Error(`${a.name}: checksum mismatch`);
  return { bytes, sha256 };
}

async function write(path: string, data: Uint8Array | string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

async function publishConverter(release: Release, withLibraries: boolean) {
  const { bytes } = await download(asset(release, `web-${release.tag_name}.zip`));
  const files = unzipSync(bytes);
  const missing = [...WEB_FILES, "web-release.json"].filter((name) => !files[name]);
  if (missing.length) throw new Error(`Web converter archive is missing ${missing.join(", ")}`);
  const unsafe = Object.keys(files).filter((name) => !/^(?:[\w.-]+\/)*[\w.-]+\.(?:html|css|m?js|wasm|json)$/.test(name) || name.split("/").includes(".."));
  if (unsafe.length) throw new Error(`Unexpected entries in the web converter archive: ${unsafe.join(", ")}`);
  const meta = JSON.parse(new TextDecoder().decode(files["web-release.json"]));
  if (meta.tag !== release.tag_name || !/^[0-9a-f]{40}$/.test(meta.revision)) throw new Error("Web converter does not match the release");

  // Built in a staging folder and swapped in at the end, so a failed run leaves the previous converter intact.
  const staging = `${CONVERTER}.next`;
  await rm(staging, { recursive: true, force: true });
  for (const name of Object.keys(files)) if (name !== "web-release.json") await write(resolve(staging, name), files[name]);
  const embedCss = await readFile(resolve(root, "src/styles/converter-embed.css"));
  await write(resolve(staging, "embed.css"), embedCss);
  // Takes the theme from the embedding page before first paint; /convert keeps it in sync afterwards.
  const theme = `<script>try{document.documentElement.dataset.theme=parent.document.documentElement.dataset.theme==="light"?"light":"dark"}catch{}</script>`;
  const html = new TextDecoder().decode(files["index.html"]).replace("</head>", `<link rel="stylesheet" href="embed.css">${theme}</head>`);
  await write(resolve(staging, "index.html"), html);

  const manifest = withLibraries ? await publishLibraries(release, staging) : await upstreamManifest(release);
  await writeJson(resolve(staging, "release.json"), { ...manifest, revision: meta.revision });
  await rm(CONVERTER, { recursive: true, force: true });
  await rename(staging, CONVERTER);
}

async function publishLibraries(release: Release, dir: string) {
  const platforms: Record<string, unknown> = {};
  for (const platform of PLATFORMS) {
    const { bytes, sha256 } = await download(asset(release, `prx-${platform}-${release.tag_name}.zip`));
    let expandedBytes = 0;
    unzipSync(bytes, {
      filter: (file) => {
        if (!file.name.startsWith("libs/") || file.name.split("/").includes("..")) throw new Error(`Invalid library archive entry: ${file.name}`);
        expandedBytes += file.originalSize;
        return false;
      },
    });
    const path = `libraries/${platform}-${sha256}.zip`;
    await write(resolve(dir, path), bytes);
    platforms[platform] = { path, size: bytes.byteLength, expandedBytes, sha256 };
  }
  return { tag: release.tag_name, url: release.html_url, platforms };
}

/** Without --libraries, reuse the manifest upstream publishes; the dev server proxies the archives it names. */
async function upstreamManifest(release: Release) {
  const manifest = await (await fetch(`${UPSTREAM_PAGES}/release.json`)).json();
  if (manifest.tag !== release.tag_name) console.warn(`upstream converter is on ${manifest.tag}, latest release is ${release.tag_name}`);
  return manifest;
}

async function publishDocs(release: Release) {
  for (const name of DOCS) {
    const response = await fetch(asset(release, name).browser_download_url);
    if (!response.ok) throw new Error(`${name}: ${response.status}`);
    await write(generated(`docs/${name}`), await response.text());
  }
}

async function publishProgress() {
  type Group = {
    name: string;
    label: string;
    done: number;
    todo: number;
    done_names: string[];
    todo_names: string[];
    inert_names?: string[];
    shared_sources?: string;
  };
  type Part = { done: number; total: number; percent: number; groups: Group[] };
  type Day = { date: string; commit: string; libraries: { done: number; total: number }; shaders: { done: number; total: number } };
  // Upstream publishes progress.json only when its Pages deploy succeeds, so it can lag main. The site's CI runs
  // upstream's own tools/progress.py on main and passes the result in UPSTREAM_PROGRESS; that wins when present.
  const local = process.env.UPSTREAM_PROGRESS ? await readJson<Record<"libraries" | "shaders", Part> | null>(process.env.UPSTREAM_PROGRESS, null) : null;
  const [published, history] = await Promise.all([
    local ? Promise.resolve(null) : getJson<Record<"libraries" | "shaders", Part>>(`${UPSTREAM_PAGES}/progress.json`),
    getJson<Day[]>(`${UPSTREAM_PAGES}/history.json`),
  ]);
  const progress = (local ?? published)!;
  if (local) {
    // Today's point comes from main too, so the history ends where the numbers on the page do.
    const today = new Date().toISOString().slice(0, 10);
    const point: Day = {
      date: today,
      commit: process.env.UPSTREAM_PROGRESS_COMMIT ?? "",
      libraries: { done: local.libraries.done, total: local.libraries.total },
      shaders: { done: local.shaders.done, total: local.shaders.total },
    };
    history.splice(0, history.length, ...history.filter((d) => d.date.slice(0, 10) !== today), point);
    console.log(`progress: measured on main${point.commit ? ` (${point.commit.slice(0, 8)})` : ""}: libraries ${local.libraries.done}/${local.libraries.total}`);
  }
  const slim = (part: Part) => ({
    done: part.done,
    total: part.total,
    percent: part.percent,
    groups: part.groups
      .filter((g) => g.done + g.todo > 0)
      .map((g) => ({ name: g.name, label: g.label, done: g.done, total: g.done + g.todo, inert: g.inert_names?.length ?? 0 })),
  });
  await Promise.all([
    writeJson(generated("progress.json"), { libraries: slim(progress.libraries), shaders: slim(progress.shaders) }),
    // Every declared function's library and status, so game pages can tell which functions a blocker names.
    writeJson(
      generated("progress-functions.json"),
      Object.fromEntries(
        progress.libraries.groups.flatMap((g) => [...g.done_names.map((n) => [n, [g.label, 1]]), ...g.todo_names.map((n) => [n, [g.label, 0]])]),
      ),
    ),
    writeJson(
      generated("progress-history.json"),
      history.map((d) => ({ date: d.date, libraries: { done: d.libraries.done, total: d.libraries.total } })),
    ),
  ]);
}

/** Recent releases, for the updates page and feed. */
async function publishReleases() {
  const releases = await rest<Release[]>("/repos/boykopovar/AnyPS5/releases?per_page=10");
  await writeJson(
    generated("releases.json"),
    releases.filter((r) => !r.draft).map((r) => ({ tag: r.tag_name, name: r.name, url: r.html_url, published: r.published_at, prerelease: r.prerelease })),
  );
}

/**
 * Code contributors for the home page: everyone with a GitHub account, with avatars; how many people have authored
 * commits, counting authors without an account once each (see countPeople); and the commit count of the default
 * branch, as GitHub shows it on the repository page.
 */
async function publishContributors() {
  const all: (ContributorEntry & { avatar_url?: string; html_url?: string })[] = [];
  for (let page = 1; ; page++) {
    const batch = await rest<typeof all>(`/repos/boykopovar/AnyPS5/contributors?per_page=100&anon=1&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  await writeJson(generated("contributors.json"), {
    total: countPeople(all),
    commits: await restCount("/repos/boykopovar/AnyPS5/commits"),
    people: all
      .filter((c) => c.type === "User" && !c.login?.endsWith("[bot]"))
      .map((c) => ({ login: c.login!, avatar: c.avatar_url!, url: c.html_url!, contributions: c.contributions })),
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return (await response.json()) as T;
}

async function main() {
  const withLibraries = process.argv.includes("--libraries");
  const release = await rest<Release>("/repos/boykopovar/AnyPS5/releases/latest");
  await writeJson(generated("release.json"), {
    tag: release.tag_name,
    name: release.name,
    url: release.html_url,
    published: release.published_at,
    assets: release.assets.map(({ name, size, digest, browser_download_url }) => ({ name, size, sha256: digest?.replace("sha256:", "") ?? null, url: browser_download_url })),
  });
  await Promise.all([publishConverter(release, withLibraries), publishDocs(release), publishProgress(), publishReleases(), publishContributors()]);
  console.log(`upstream: ${release.tag_name}, converter ${withLibraries ? "with" : "without"} libraries`);
}

await main();
