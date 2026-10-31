import { DISCORD_URL, REPO_URL } from "./site";
import type { Release } from "./upstream";

/** The site itself, so search results show its name. For the home page. */
export const websiteSchema = (site: URL, lang: string, description: string) => ({
  "@type": "WebSite",
  "@id": new URL("/#website", site).href,
  name: "AnyPS5",
  url: site.href,
  description,
  inLanguage: lang,
});

/** AnyPS5 as software: free, open source, for Linux and Windows. For the home and download pages. */
export const softwareSchema = (site: URL, release: Release | null) => ({
  "@type": "SoftwareApplication",
  "@id": new URL("/#software", site).href,
  name: "AnyPS5",
  description: "Relinks PS5 games you own into native Linux and Windows programs.",
  applicationCategory: "GameApplication",
  operatingSystem: "Linux, Windows",
  url: site.href,
  downloadUrl: new URL("/download/", site).href,
  ...(release ? { softwareVersion: release.tag.replace(/^v/, ""), datePublished: release.published } : {}),
  license: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  sameAs: [REPO_URL, DISCORD_URL],
});
