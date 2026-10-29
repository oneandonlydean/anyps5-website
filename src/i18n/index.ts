import en, { type Strings } from "./en";
import es from "./es";
import ptBr from "./pt-br";
import ru from "./ru";
import zhCn from "./zh-cn";
import { DEFAULT_LOCALE, isTranslated, localePath, type Locale } from "./locales";

export * from "./locales";
export type { Strings };

const STRINGS: Record<Locale, Strings> = { en, es, "pt-br": ptBr, "zh-cn": zhCn, ru };

export const strings = (locale: Locale): Strings => STRINGS[locale];

/**
 * Points the internal links in a translated HTML string at that language's pages where they exist. Anchors into
 * translated pages are dropped, since their headings, and so their ids, are translated too.
 */
export const localizeLinks = (html: string, locale: Locale) =>
  html.replace(/href="(\/[^"#]*)(#[^"]*)?"/g, (_, path: string, hash = "") => {
    const keep = locale === DEFAULT_LOCALE || !isTranslated(path);
    return `href="${localePath(locale, path)}${keep ? hash : ""}"`;
  });
