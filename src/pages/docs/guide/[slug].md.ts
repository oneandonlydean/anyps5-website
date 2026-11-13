import type { APIContext } from "astro";
import { getSteps, type Step } from "../../../lib/guide";
import { header, join, link, markdownResponse } from "../../../lib/markdown";
import { guideMarkdown } from "../../../lib/text/guide";

export async function getStaticPaths() {
  const steps = await getSteps();
  return steps.map((step, i) => ({ params: { slug: step.slug }, props: { step, next: steps[i + 1] ?? null } }));
}

/** A setup guide step as Markdown, in English, for AI tools. */
export function GET({ site, props }: APIContext) {
  const { step, next } = props as { step: Step; next: Step | null };
  const { title, summary, step: number } = step.entry.data;
  return markdownResponse(
    join([
      header(site, `Step ${number}: ${title}`, `/docs/guide/${step.slug}`, summary),
      guideMarkdown(step.entry.body ?? "", site),
      next && `Next step: [${next.entry.data.title}](${link(site, `/docs/guide/${next.slug}.md`)})`,
    ]),
  );
}
