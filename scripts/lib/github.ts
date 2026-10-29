import { execFileSync } from "node:child_process";

export const REPO = { owner: "boykopovar", name: "AnyPS5" } as const;

let token: string | undefined;

function authToken(): string {
  token ??= process.env.GITHUB_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  return token;
}

/** With `partial`, field-level errors (such as an unknown issue number) are dropped instead of thrown. */
export async function graphql<T>(query: string, variables: Record<string, unknown> = {}, partial = false): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${authToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL ${response.status}: ${await response.text()}`);
  const { data, errors } = (await response.json()) as { data: T; errors?: { message: string }[] };
  if (errors?.length && !(partial && data)) throw new Error(errors.map((e) => e.message).join("; "));
  return data;
}

export async function rest<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `bearer ${authToken()}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub ${path} ${response.status}`);
  return (await response.json()) as T;
}

/** The number of items a list endpoint holds, read from the last page link of a one-item-per-page request. */
export async function restCount(path: string): Promise<number> {
  const response = await fetch(`https://api.github.com${path}${path.includes("?") ? "&" : "?"}per_page=1`, {
    headers: { Authorization: `bearer ${authToken()}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub ${path} ${response.status}`);
  const last = response.headers.get("link")?.match(/[?&]page=(\d+)>;\s*rel="last"/)?.[1];
  return last ? Number(last) : ((await response.json()) as unknown[]).length;
}
