import type { APIContext } from "astro";
import { atomFeed } from "../../lib/atom";
import { getUpdates, type Update } from "../../lib/updates";

/** One feed per kind of update, so each can go to its own Discord channel or reader folder. */
export const FEEDS = {
  releases: { title: "AnyPS5 releases", subtitle: "New AnyPS5 releases.", pick: (u: Update) => u.kind === "release", limit: 30 },
  progress: { title: "AnyPS5 progress", subtitle: "Every feature, fix and speed-up merged upstream.", pick: (u: Update) => u.kind === "merge", limit: 300 },
  "progress-daily": { title: "AnyPS5 daily progress", subtitle: "One summary per day of what was merged upstream.", pick: (u: Update) => u.kind === "digest" || u.kind === "week", limit: 60 },
  games: { title: "AnyPS5 game compatibility", subtitle: "Games that reached a new stage.", pick: (u: Update) => u.kind === "stage", limit: 100 },
} as const;

export function getStaticPaths() {
  return Object.keys(FEEDS).map((feed) => ({ params: { feed } }));
}

export async function GET({ params, site }: APIContext) {
  const feed = FEEDS[params.feed as keyof typeof FEEDS];
  const updates = (await getUpdates()).filter(feed.pick).slice(0, feed.limit);
  return atomFeed({
    site,
    path: `/feeds/${params.feed}.xml`,
    page: "/updates",
    title: feed.title,
    subtitle: feed.subtitle,
    entries: updates.map((u) => ({ id: `/updates#${u.id}`, title: u.title, url: u.url, date: u.date, summary: u.text, category: u.kind })),
  });
}
