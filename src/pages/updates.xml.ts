import type { APIContext } from "astro";
import { atomFeed } from "../lib/atom";
import { getUpdates } from "../lib/updates";

/** An Atom feed of the newest updates, for feed readers and Discord feed bots. Single merges have their own feed. */
export async function GET({ site }: APIContext) {
  const updates = (await getUpdates()).filter((u) => u.kind !== "merge").slice(0, 60);
  return atomFeed({
    site,
    path: "/updates.xml",
    page: "/updates",
    title: "AnyPS5 updates",
    subtitle: "Releases, compatibility changes and weekly progress.",
    entries: updates.map((u) => ({ id: `/updates#${u.id}`, title: u.title, url: u.url, date: u.date, summary: u.text, category: u.kind })),
  });
}
