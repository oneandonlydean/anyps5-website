import { generated, readJson, writeJson } from "./lib/files";
import { graphql, REPO } from "./lib/github";
import { formSections, parseReport, titleIds, type PostMeta } from "../src/lib/parse";
import type { Report, Thread } from "../src/lib/schema";

const CATEGORY = "Game bring-up";
const OUT = generated("threads.json");

interface Post {
  url: string;
  createdAt: string;
  body: string;
  author: { login: string } | null;
}
interface Comment extends Post {
  replies: { nodes: Post[] };
}
interface Discussion extends Post {
  number: number;
  title: string;
  updatedAt: string;
  comments: { totalCount: number; nodes: Comment[] };
}

const POST = "url createdAt body author { login }";
const PAGE = `
  query($owner: String!, $name: String!, $category: ID!, $after: String) {
    repository(owner: $owner, name: $name) {
      discussions(first: 10, after: $after, categoryId: $category, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number title updatedAt ${POST}
          comments(first: 100) { totalCount nodes { ${POST} replies(first: 50) { nodes { ${POST} } } } }
        }
      }
    }
  }`;

async function categoryId(): Promise<string> {
  const data = await graphql<{ repository: { discussionCategories: { nodes: { id: string; name: string }[] } } }>(
    `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { discussionCategories(first: 25) { nodes { id name } } } }`,
    REPO,
  );
  const category = data.repository.discussionCategories.nodes.find((c) => c.name === CATEGORY);
  if (!category) throw new Error(`No "${CATEGORY}" discussion category`);
  return category.id;
}

function toThread(d: Discussion): Thread | null {
  const ids = titleIds(`${d.title}\n${formSections(d.body)["title"] ?? ""}`);
  if (!ids.length) return null;

  const meta = (post: Post): PostMeta => ({
    url: post.url,
    discussion: d.number,
    author: post.author?.login ?? null,
    date: post.createdAt,
  });
  const posts = [d, ...d.comments.nodes.flatMap((c) => [c, ...c.replies.nodes])];
  const reports = posts.map((post) => parseReport(post.body, meta(post))).filter((r): r is Report => r !== null);

  return {
    number: d.number,
    title: d.title.trim(),
    url: d.url,
    titleIds: ids,
    created: d.createdAt,
    updated: d.updatedAt,
    comments: d.comments.totalCount,
    reports,
  };
}

async function main() {
  const full = process.argv.includes("--full");
  const previous = full ? [] : await readJson<Thread[]>(OUT, []);
  const known = new Map(previous.map((t) => [t.number, t]));
  const category = await categoryId();
  let after: string | null = null;
  let fetched = 0;

  pages: do {
    const data: { repository: { discussions: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Discussion[] } } } =
      await graphql(PAGE, { ...REPO, category, after });
    const { pageInfo, nodes } = data.repository.discussions;
    for (const discussion of nodes) {
      if (known.get(discussion.number)?.updated === discussion.updatedAt) break pages;
      fetched++;
      const thread = toThread(discussion);
      if (thread) known.set(thread.number, thread);
      else known.delete(discussion.number);
    }
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);

  const threads = [...known.values()].sort((a, b) => a.number - b.number);
  await writeJson(OUT, threads);
  const reports = threads.reduce((n, t) => n + t.reports.length, 0);
  console.log(`threads: ${threads.length} (${fetched} refreshed), reports: ${reports}`);
}

await main();
