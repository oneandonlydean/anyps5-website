import type { APIContext } from "astro";
import { DOCS } from "../../lib/docs";
import { markdownResponse } from "../../lib/markdown";
import { docText } from "../../lib/text/pages";
import { getRelease } from "../../lib/upstream";

export const getStaticPaths = () => DOCS.map((doc) => ({ params: { slug: doc.slug }, props: { doc } }));

/** An upstream doc as Markdown, for AI tools. */
export async function GET({ site, props }: APIContext) {
  const { doc } = props as { doc: (typeof DOCS)[number] };
  return markdownResponse(await docText(doc, await getRelease(), site));
}
