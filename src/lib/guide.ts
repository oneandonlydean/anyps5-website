import { getCollection, type CollectionEntry } from "astro:content";
import { DEFAULT_LOCALE, localePath, strings, type Locale } from "../i18n";

export interface Step {
  entry: CollectionEntry<"guide">;
  /** The URL slug, the same in every language: "run". */
  slug: string;
  /** False when this language has no translation of the step yet and the English one stands in. */
  translated: boolean;
}

/** The guide's steps in a language, in order. Untranslated steps fall back to English. */
export async function getSteps(locale: Locale = DEFAULT_LOCALE): Promise<Step[]> {
  const entries = await getCollection("guide");
  const english = entries.filter((e) => !e.id.includes("/"));
  return english
    .map((entry) => {
      const translation = locale === DEFAULT_LOCALE ? undefined : entries.find((e) => e.id === `${locale}/${entry.id}`);
      return { entry: translation ?? entry, slug: entry.id, translated: locale === DEFAULT_LOCALE || Boolean(translation) };
    })
    .sort((a, b) => a.entry.data.step - b.entry.data.step);
}

export function guideNav(steps: Step[], locale: Locale = DEFAULT_LOCALE) {
  const t = strings(locale).guide;
  return [
    {
      title: t.title,
      links: [
        { href: localePath(locale, "/guide"), label: t.overview },
        ...steps.map((s) => ({ href: localePath(locale, `/guide/${s.slug}`), label: `${s.entry.data.step}. ${s.entry.data.title}` })),
      ],
    },
    { title: t.reference, links: [{ href: "/docs/usage", label: t.usage }, { href: "/docs/input-mapping", label: t.inputMapping }] },
  ];
}
