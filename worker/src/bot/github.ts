import { baseUrl, type Ctx } from "./env";
import { HttpError } from "./http";

const API = "https://api.github.com";
export interface Pull {
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  merged_at: string;
  /** Null for a deleted account. `id` is null for authors that are not real accounts. */
  user: { id: number | null; login: string; html_url: string; avatar_url: string } | null;
  merged_by: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  labels: string[];
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "gh-discord-roles",
  };
}

export function authorizeUrl({ env }: Ctx, state: string): string {
  const q = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${baseUrl(env)}/github/callback`,
    state,
  });
  return `https://github.com/login/oauth/authorize?${q}`;
}

/** Exchanges an OAuth code and returns the user's id and login. The user token is not kept. */
export async function identify({ env, http }: Ctx, code: string): Promise<{ id: number; login: string }> {
  const token = await http.json<{ access_token?: string }>("github token", "https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json" },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${baseUrl(env)}/github/callback`,
    }),
  });
  // GitHub reports a bad code as 200 with an error body.
  if (!token.access_token) throw new HttpError("github token", 400);
  const { id, login } = await http.json<{ id: number; login: string }>("github user", `${API}/user`, {
    headers: headers(token.access_token),
  });
  return { id, login };
}

/** Merged PRs opened by `login` on the repo, or null if GitHub does not know that login. */
export async function countMergedPrs({ env, http }: Ctx, login: string): Promise<number | null> {
  const q = new URLSearchParams({
    q: `repo:${env.GITHUB_REPO} is:pr is:merged author:${login}`,
    per_page: "1",
  });
  const res = await http.send("github search", `${API}/search/issues?${q}`, { headers: headers(env.GITHUB_TOKEN) });
  if (res.status === 422) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError("github search", res.status);
  }
  const body = await res.json<{ total_count: number; incomplete_results: boolean }>();
  // A timed-out search undercounts; treat it as a failure rather than pushing a wrong number.
  if (body.incomplete_results) throw new HttpError("github search", 503);
  return body.total_count;
}

/** Current login for a GitHub user id, or null if the account no longer exists. */
export async function loginById({ env, http }: Ctx, id: number): Promise<string | null> {
  const res = await http.send("github user by id", `${API}/user/${id}`, { headers: headers(env.GITHUB_TOKEN) });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError("github user by id", res.status);
  }
  return (await res.json<{ login: string }>()).login;
}

// GraphQL, not REST: the REST pulls list is about 18 KB per PR, and parsing a
// page of it exceeds the Workers free plan's CPU limit on a busy repo. This
// asks for only the fields used, merged PRs only, at about 0.5 KB each.
const PULL_FIELDS = `
  number title url updatedAt mergedAt additions deletions changedFiles
  author { __typename login url avatarUrl ... on User { databaseId } ... on Bot { databaseId } }
  mergedBy { login }
  labels(first: 10) { nodes { name } }`;

const RECENT_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage }
      nodes { ${PULL_FIELDS} }
    }
  }
}`;

const SEARCH_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    issueCount
    nodes { ... on PullRequest { ${PULL_FIELDS} } }
  }
}`;

interface PullNode {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { __typename: string; login: string; url: string; avatarUrl: string; databaseId?: number } | null;
  mergedBy: { login: string } | null;
  labels: { nodes: { name: string }[] };
}

const toPull = (n: PullNode): Pull => ({
  number: n.number,
  title: n.title,
  html_url: n.url,
  updated_at: n.updatedAt,
  merged_at: n.mergedAt,
  user: n.author && {
    id: n.author.databaseId ?? null,
    // GraphQL drops the "[bot]" suffix that the rest of GitHub shows.
    login: n.author.__typename === "Bot" ? `${n.author.login}[bot]` : n.author.login,
    html_url: n.author.url,
    avatar_url: n.author.avatarUrl,
  },
  merged_by: n.mergedBy?.login ?? null,
  additions: n.additions,
  deletions: n.deletions,
  changed_files: n.changedFiles,
  labels: n.labels.nodes.map((l) => l.name),
});

async function graphql<T>({ env, http }: Ctx, label: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const body = await http.json<{ data?: T; errors?: unknown[] }>(label, `${API}/graphql`, {
    method: "POST",
    headers: { ...headers(env.GITHUB_TOKEN), "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  // GraphQL reports failures as 200 with an errors array.
  if (!body.data || body.errors?.length) throw new HttpError(label, 502);
  return body.data;
}

/** The 100 most recently updated merged PRs. `more` is false if that is all of them. */
export async function recentMerged(ctx: Ctx): Promise<{ pulls: Pull[]; more: boolean }> {
  const [owner, name] = ctx.env.GITHUB_REPO.split("/");
  const data = await graphql<{
    repository: { pullRequests: { pageInfo: { hasNextPage: boolean }; nodes: PullNode[] } } | null;
  }>(ctx, "github merged pulls", RECENT_QUERY, { owner, name });
  if (!data.repository) throw new HttpError("github merged pulls", 502);
  const page = data.repository.pullRequests;
  return { pulls: page.nodes.map(toPull), more: page.pageInfo.hasNextPage };
}

/**
 * PRs merged in a time window (ISO timestamps, inclusive). Returns at most
 * 100; `total` says how many the window really holds.
 */
export async function mergedBetween(ctx: Ctx, from: string, to: string): Promise<{ pulls: Pull[]; total: number }> {
  const data = await graphql<{ search: { issueCount: number; nodes: PullNode[] } }>(ctx, "github merged search", SEARCH_QUERY, {
    q: `repo:${ctx.env.GITHUB_REPO} is:pr is:merged merged:${from}..${to}`,
  });
  return { pulls: data.search.nodes.filter((n) => n.number).map(toPull), total: data.search.issueCount };
}

export interface Release {
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  published_at: string;
}

/** The newest published release (not a draft or pre-release), or null if there is none. */
export async function latestRelease({ env, http }: Ctx): Promise<Release | null> {
  const res = await http.send("github latest release", `${API}/repos/${env.GITHUB_REPO}/releases/latest`, { headers: headers(env.GITHUB_TOKEN) });
  if (res.status === 404) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError("github latest release", res.status);
  }
  return res.json<Release>();
}

/** The ten most recently updated discussions, with their category, for noticing new reports. */
export async function recentDiscussions(ctx: Ctx, owner: string, name: string): Promise<{ category: string; updatedAt: string }[]> {
  const data = await graphql<{ repository: { discussions: { nodes: { updatedAt: string; category: { name: string } }[] } } | null }>(
    ctx,
    "github discussions",
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
      discussions(first: 10, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { updatedAt category { name } } } } }`,
    { owner, name },
  );
  return data.repository?.discussions.nodes.map((d) => ({ category: d.category.name, updatedAt: d.updatedAt })) ?? [];
}
