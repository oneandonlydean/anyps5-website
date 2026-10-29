/** The languages the site's main pages are written in. English is the default and has no URL prefix. */
export const LOCALES = {
  en: { name: "English", lang: "en" },
  es: { name: "Español", lang: "es" },
  "pt-br": { name: "Português (Brasil)", lang: "pt-BR" },
  "zh-cn": { name: "简体中文", lang: "zh-CN" },
  ru: { name: "Русский", lang: "ru" },
} as const;

export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = "en";
export const TRANSLATED_LOCALES = (Object.keys(LOCALES) as Locale[]).filter((l) => l !== DEFAULT_LOCALE);

/** Paths that exist in every language: the home page, the setup guide and the FAQ. Everything else is English. */
const TRANSLATED_PATHS = [/^\/$/, /^\/docs\/guide(\/[^/]+)?\/?$/, /^\/faq\/?$/];

export const isTranslated = (path: string) => TRANSLATED_PATHS.some((p) => p.test(path));

/** A path in a language: "/docs/guide" becomes "/es/docs/guide". Paths without translations stay English. */
export function localePath(locale: Locale, path: string): string {
  if (locale === DEFAULT_LOCALE || !isTranslated(path)) return path;
  return path === "/" ? `/${locale}/` : `/${locale}${path}`;
}

/** Splits a URL path into its language and the path it would have in English. */
export function parsePath(pathname: string): { locale: Locale; path: string } {
  const [, first, ...rest] = pathname.split("/");
  if ((TRANSLATED_LOCALES as string[]).includes(first)) return { locale: first as Locale, path: `/${rest.join("/")}` };
  return { locale: DEFAULT_LOCALE, path: pathname };
}
