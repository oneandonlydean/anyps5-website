/**
 * Automod's built-in filters: scams (crypto, fake giveaways, phishing), piracy requests, hidden links and ETA
 * questions, plus the matching for custom blocked words. Pure functions: events.ts feeds them messages, and
 * /automod test feeds them text to try.
 *
 * Hardened two ways, against the false matches Discord's own keyword rules made and against the dodges spammers use:
 * - Text is read in three forms: as written (lowercase, accents and invisible characters gone), with look-alike letters
 *   swapped for Latin ones (Cyrillic а, Greek ο, fullwidth and fancy fonts) and spaced-out letters joined (f p k g,
 *   a.i.r.d.r.o.p), and the same with leetspeak undone (41rdr0p). A term matches if it matches any form.
 * - Most terms add to a score instead of deciding alone: "bitcoin" in passing is fine, a "presale" with a link isn't.
 *   A term that is part of a quote of the server's rules doesn't count, and one right after "no", "don't" or "beware"
 *   counts half, so "don't ask for PKG links" or a pasted rule is left alone.
 */

export type Filter = "scam" | "piracy" | "hidden" | "eta" | "invites" | "links" | "words" | "mentions" | "caps" | "spam" | "duplicates" | "crosspost";

export interface Verdict {
  filter: Filter;
  /** Why, in words for the member: "your message was removed: <why>". */
  why: string;
  /** A hacked account or a phishing attempt: skip the warning. */
  severe: boolean;
  /** What matched, for moderators (/automod test). */
  evidence: string[];
}

// Reading text.

const INVISIBLE = /[\u00AD\u034F\u061C\u115F-\u1160\u17B4-\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{E0000}-\u{E007F}]/gu;

const CONFUSABLE: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", з: "3", и: "u", к: "k", м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y", х: "x", ь: "b", і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ӏ: "l", ԛ: "q", ԝ: "w",
  α: "a", β: "b", γ: "y", δ: "d", ε: "e", ζ: "z", η: "n", ι: "i", κ: "k", μ: "u", ν: "v", ο: "o", ρ: "p", σ: "o", τ: "t", υ: "u", χ: "x", ω: "w",
};
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s", "!": "i", "|": "i", "€": "e" };

/** Lowercase, compatibility forms (fancy fonts, fullwidth) folded, invisible characters and accents gone. */
const plain = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(INVISIBLE, "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC")
    // "don't" reads as "dont", so a negation stays one word.
    .replace(/n['’]t\b/gu, "nt");
const swap = (s: string, map: Record<string, string>) => s.replace(/./gsu, (c) => map[c] ?? c);
/** Joins letters spelled out one by one: "f p k g", "a.i.r.d.r.o.p", "f-p-k-g". */
const despace = (s: string) =>
  s.replace(/(?<![\p{L}\p{N}])[\p{L}\p{N}](?:[ .\-_*·•|,~+]{1,3}[\p{L}\p{N}](?![\p{L}\p{N}])){2,}/gu, (m) => m.replace(/[^\p{L}\p{N}]/gu, ""));

/** The three forms a message is read in. Terms go through the same steps, so they match like for like. */
const FORMS: ((s: string) => string)[] = [plain, (s) => despace(swap(plain(s), CONFUSABLE)), (s) => despace(swap(swap(plain(s), CONFUSABLE), LEET))];

// Terms.

/** A term as moderators write them, like Discord's: "*air drop*" matches inside words, "nft" only as a whole word. */
interface Term {
  label: string;
  weight: number;
  patterns: RegExp[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function term(spec: string, weight: number): Term {
  const inside = spec.startsWith("*") || spec.endsWith("*");
  const text = spec.replace(/^\*+|\*+$/g, "");
  const patterns = FORMS.map((form) => {
    const words = form(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map(escape);
    // Between words, any punctuation or none: "air drop", "air-drop" and "airdrop" all match.
    const body = words.join("[^\\p{L}\\p{N}]*");
    const plural = /\p{L}$/u.test(text) ? "s?" : "";
    return new RegExp(inside ? body : `(?<![\\p{L}\\p{N}])${body}${plural}(?![\\p{L}\\p{N}])`, "u");
  });
  return { label: text, weight, patterns };
}

const terms = (weight: number, list: string[]) => list.map((t) => term(t, weight));

/** A pattern written for the normalized text (lowercase, no accents), with its weight. */
interface Pattern {
  label: string;
  weight: number;
  re: RegExp;
}

// Scams: crypto promotion, fake giveaways and the like.

const SCAM: Term[] = [
  ...terms(2, [
    "*100x gem*", "*air drop*", "*anyps5 coin*", "*anyps5 nft*", "*anyps5 token*", "buy the coin", "buy the token", "*connect wallet*",
    "*connect your wallet*", "contract address", "crypto project", "*dexscreener*", "*dextools*", "*birdeye*", "*gmgn*", "*free mint*",
    "*gem alert*", "*guaranteed profit*", "*investment opportunity*", "launch a token", "*liquidity pool*", "*meme coin*", "*nft mint*",
    "our token", "*phantom wallet*", "*pre sale*", "*pump fun*", "*raydium*", "*seed phrase*", "*recovery phrase*", "*private key*",
    "*staking rewards*", "token launch", "*tokenomics*", "*trust wallet*", "*wallet address*", "*whitelist spot*", "wl spot", "*yield farm*",
    "*аирдроп*", "*эйрдроп*", "криптовалют*", "*мемкоин*", "*пресейл*",
    // Fake giveaways, the usual hacked-account messages.
    "*free nitro*", "*nitro giveaway*", "*nitro for free*", "*steam gift*", "*gift card giveaway*", "*free robux*", "*skins giveaway*",
    "*claim your reward*", "*claim your prize*", "*claim your gift*", "*double your money*", "*double your crypto*", "*withdraw your*",
    "*onlyfans*", "*nudes*", "*teen leaks*", "*18+ server*", "*free gta 6*", "*free gta vi*", "*gta 6 beta access*", "*gta 6 beta key*",
  ]),
  ...terms(1, [
    "altcoin", "ape in", "*binance*", "bitcoin", "*bybit*", "ethereum", "*hodl*", "ico", "nft", "*passive income*", "*rug pull*", "*shitcoin*",
    "solana", "*to the moon*", "*usdt*", "*wagmi*", "*web3*", "*metamask*", "crypto", "giveaway", "giving away", "dm me", "check my bio",
    "first 10 people", "first 50 people", "first 100 people", "limited spots", "act fast", "investment", "profit", "trading signals",
  ]),
];

const SCAM_PATTERNS: Pattern[] = [
  // "I'm giving away my old PS5 / nitro / 10 steam keys", "free nitro for the first 20".
  { label: "giveaway offer", weight: 2, re: /\b(?:giving away|give ?away|free)\b.{0,30}\b(?:nitro|steam keys?|gift ?cards?|ps5s?|consoles?|skins|robux|gta ?(?:6|vi))\b/u },
  { label: "first n people", weight: 1, re: /\bfirst\s+\d{1,3}\s+(?:people|users|members|persons)\b/u },
  { label: "earn per day", weight: 2, re: /\b(?:earn|make)\s+\$?\d[\d,.]*k?\s*(?:\$|usd|usdt|dollars)?\s*(?:a|per|every)\s+(?:day|week|hour)\b/u },
];

/** Crypto sites and token launchpads. */
const SCAM_DOMAINS = ["dexscreener.com", "dextools.io", "birdeye.so", "gmgn.ai", "jup.ag", "pump.fun", "raydium.io", "photon-sol.tinyastro.io", "bullx.io", "moonshot.cc"];

/** Brands phishing pretends to be, and the real sites, so a look-alike stands out. */
const PHISHED = /(?:st[e3]a?r?[mn]|d[i1l]s[ck]o?r[dcl]|n[i1l]tr[o0]|r[o0]bl[o0]x|r[o0]ckstar|epicgames|playstati[o0]n)/u;
const REAL = [
  "steamcommunity.com", "steampowered.com", "steamstatic.com", "steamgriddb.com", "discord.com", "discord.gg", "discordapp.com", "discordapp.net",
  "discord.media", "discord.new", "discord.gift", "discordstatus.com", "roblox.com", "rockstargames.com", "epicgames.com", "playstation.com", "playstation.net",
  "sonyentertainmentnetwork.com",
];

// Piracy: asking for or sharing games, keys, firmware and the like.

const PIRACY: Term[] = [
  ...terms(2, [
    "cracked game", "cracked games", "cracked version", "dump link", "dumped game link", "firmware link", "game files link", "keys link",
    "magnet link", "pkg dl", "pkg download", "pkg file link", "pkg link", "pkg links", "ps5 games download", "send firmware", "send game files",
    "send keys", "send me a dump", "send me a game", "send me the game", "send me the libs", "send me your dump", "send pkg", "send prx",
    "send sflash", "sflash dump", "share firmware", "share game files", "share keys", "share pkg", "share prx", "share the game", "share your dump",
    "system libs download", "where can i get games", "where do i get games", "where to get games", "games for free", "repack", "repacks",
    "fpkg", "*fpkg*", "fpkgs", "*filecr*", "*linkvertise*", "*lootlabs*",
  ]),
  ...terms(1, [
    "download games", "download pkg", "firmware download", "free games", "game download", "game pkg", "game pkgs", "games download", "pkg files",
    "prx files", "torrent", "*torrent*", "decryption keys", "*softonic*", "*softpedia*", "*softsonic*", "*uptodown*", "*filehippo*", "*filehorse*",
    "*majorgeeks*", "*malavida*",
  ]),
];

/** Files nobody may share. A game by itself isn't one ("give the game a try"); a game's files, download or PKG are. */
const FILES = String.raw`(?:pkgs?|fpkgs?|dumps?|dumped games?|firmwares?|fw|keys|decryption keys?|prx|prxs|sflash|isos?|roms?|game files?|cracks?)`;
const GAME_FILES = String.raw`(?:games?|gta ?(?:6|vi|six))\s+(?:pkgs?|files?|downloads?|dl|links?|isos?|dumps?|for\s+free|copy|copies)`;
const WANTED = String.raw`(?:${GAME_FILES}|${FILES}|free\s+games?)`;
/** Where to get these is rule 1; where to get the libraries or a firmware version isn't. */
const FIND = String.raw`(?:${GAME_FILES}|pkgs?|fpkgs?|dumps?|dumped games?|keys|decryption keys?|prx|sflash|isos?|roms?|games?|gta ?(?:6|vi|six))`;
const NOT_A_FILE = String.raw`(?!\s*(?:logs?|reports?|outputs?|errors?|screenshots?|json|crash|works?|working|runs?|running|progress|compat\w*|to|ids?|names?|titles?|lists?|of\s+my|from\s+my))`;
const SKIP_ADJECTIVE = String.raw`(?:(?!crash|core|memory|log|shader|error|own)[\p{L}\p{N}]+\s+)?`;

const PIRACY_PATTERNS: Pattern[] = [
  // "can you send me the gta 6 pkg", "share your dump pls", "dm me the firmware".
  {
    label: "asking someone to send files",
    weight: 2,
    re: new RegExp(String.raw`\b(?:send|share|give|upload|dm|pm|drop|gimme|hook me up with)\s+(?:me|us|over)?\s*(?:a|an|the|your|ur|some|that|those|this|these|my)?\s*${SKIP_ADJECTIVE}${WANTED}\b${NOT_A_FILE}`, "u"),
  },
  // "where can I download games", "how do i get pkgs for free".
  {
    label: "asking where to get files",
    weight: 2,
    re: new RegExp(String.raw`\b(?:where|how)\s+(?:can|do|could|should|would|to|will|does)?\s*(?:i|we|you|u|one|someone)?\s*(?:get|find|download|dl|grab|obtain)\s+(?:a|an|the|some|any|free)?\s*${SKIP_ADJECTIVE}${FIND}\b${NOT_A_FILE}`, "u"),
  },
  // "anyone got the gta 6 pkg", "someone has a dump link".
  {
    label: "asking who has files",
    weight: 2,
    re: /\b(?:anyone|any1|someone|somebody|who)\s+(?:has|have|got|can share|can send|selling)\s+(?:a|an|the)?\s*(?:[\p{L}\p{N}]+\s+){0,2}(?:pkgs?|fpkgs?|dumps?|torrents?|isos?|roms?|keys|firmware|prx|sflash|(?:pkg|dump|game|gta ?(?:6|vi))\s+(?:links?|downloads?|dl))\b(?!\s*(?:logs?|reports?|that|which|working|works|boots?|running|runs))/u,
  },
  // "gta 6 pkg", "gta vi download", "gta 6 free pc download".
  { label: "GTA 6 download", weight: 2, re: /\bgta\s?-?(?:6|vi|six)\b.{0,20}\b(?:pkgs?|fpkg|downloads?|dl|torrents?|cracks?|cracked|repacks?|leaked build|isos?|for free|pc download|apk)\b/u },
];

/** File hosts: a link to one plus any other sign is enough. */
const FILE_HOSTS = ["mega.nz", "mediafire.com", "gofile.io", "pixeldrain.com", "1fichier.com", "rapidgator.net", "krakenfiles.com", "buzzheavier.com", "terabox.com", "anonfiles.com", "workupload.com", "send.cm", "qiwi.gg"];
const PIRACY_DOMAINS = ["filecr.com", "softonic.com", "softpedia.com", "uptodown.com", "filehippo.com", "filehorse.com", "majorgeeks.com", "malavida.com", "download.cnet.com", "softsonic.com", "fitgirl-repacks.site", "dodi-repacks.site", "steamunlocked.net", "igg-games.com", "nopaystation.com"];

// Hidden links: shorteners, ad lockers and links in disguise.

const SHORTENERS = [
  "bit.ly", "tinyurl.com", "is.gd", "cutt.ly", "rebrand.ly", "shorte.st", "adf.ly", "ouo.io", "ouo.press", "exe.io", "linkvertise.com", "link-to.net",
  "lootlabs.gg", "loot-link.com", "work.ink", "rb.gy", "shorturl.at", "tiny.cc", "v.gd", "t.ly", "goo.gl", "s.id", "sub2unlock.com", "boost.ink",
  "mboost.me", "social-unlock.com", "bitly.com", "shrtco.de", "ln.run", "short.gy", "urlz.fr",
];
/** Base64 of "http://", "https://", "magnet:" and "www.": links spelled so filters can't read them. */
const BASE64_LINKS = ["aHR0cDovL", "aHR0cHM6Ly", "bWFnbmV0Oj", "d3d3Lm"];

// ETA questions: rule 3, answered rather than punished.

const ETA_TARGET = String.raw`(?:ps\s?-?5|playstation\s?5|any\s?ps\s?5|gta\s?-?(?:6|vi|six)|grand\s+theft\s+auto\s+(?:6|vi))`;
const ETA_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\bhow\s+(?:many\s+(?:days?|weeks?|months?|hours?|years?)|long|much\s+longer)\b.{0,40}${ETA_TARGET}`, "u"),
  new RegExp(String.raw`\b(?:days?|weeks?|months?|years?)\s+(?:till|til|until|before|for|left)\b.{0,25}${ETA_TARGET}`, "u"),
  new RegExp(String.raw`\bwhen\b.{0,30}${ETA_TARGET}.{0,30}\b(?:ready|done|back|available|out|release[ds]?|playable|work(?:s|ing)?|run(?:s|ning)?|support(?:ed)?|come|coming)\b`, "u"),
  new RegExp(String.raw`\b(?:any|is|are)\b.{0,15}${ETA_TARGET}(?:'?s)?.{0,20}\b(?:ready|done|yet|available|back|playable)\b`, "u"),
  new RegExp(String.raw`${ETA_TARGET}.{0,40}(?:\b(?:how\s+(?:long|many)|eta|ready\s+yet|when\s+(?:will|is|does))\b|\bwhen\s*\?)`, "u"),
  new RegExp(String.raw`\b(?:eta|timeline|time\s?frame|estimate|release\s+date)\b.{0,30}${ETA_TARGET}`, "u"),
  // "does GTA 6 work yet?", "can anyps5 run gta 6?"
  /\b(?:can|does|will|is|when)\b.{0,30}\bgta\s?-?(?:6|vi|six)\b.{0,30}\b(?:work|run|playable|play|supported|boot|ready)\b/u,
  /\b(?:can|does|will)\b.{0,30}\b(?:any\s?ps\s?5|it|this|emulator)\b.{0,15}\b(?:run|play|work with)\b.{0,15}\bgta\s?-?(?:6|vi|six)\b/u,
];
/**
 * Only short questions are ETA questions: not "when I got my PS5 it was ready to go", nor "how long does the dump
 * take?", which is about using it.
 */
const looksLikeQuestion = (text: string) =>
  text.length <= 300 &&
  (/\?/.test(text) || /^\s*(?:(?:when|how)\s+(?:will|is|are|does|do|can|long|many|much|soon|r)|is|are|will|does|can|eta|any\s+(?:news|update|eta))\b/u.test(text) || /\beta\b/u.test(text)) &&
  !/\b(?:take|takes|took|taking)\b|\bto\s+(?:convert|dump|compile|build|install|download|load|relink)\b/u.test(text);

// Words that turn a match into talk about the rule: "don't ask for pkg links", "beware of airdrop scams".

const NEGATIONS = new Set(["no", "not", "never", "dont", "doesnt", "didnt", "cant", "cannot", "wont", "shouldnt", "mustnt", "stop", "avoid", "beware", "without", "against", "forbidden", "banned", "illegal", "isnt", "arent", "aint", "nor"]);
/** Words after a match that make it about something else: "send me the game report", "share your dump logs". */
const HARMLESS_NEXT = new Set(["report", "reports", "log", "logs", "name", "names", "title", "titles", "id", "ids", "crash", "crashes", "error", "errors", "screenshot", "screenshots", "settings", "config", "json", "output", "version"]);
const AFTERWARDS = new Set(["scam", "scams", "scammer", "scammers", "fake", "phishing", "malware", "virus", "illegal", "banned", "forbidden"]);

// The server's rules, so quoting them never counts.

/** Every run of five words in the rules, in each form. */
export interface RulesIndex {
  grams: Set<string>[];
}

/** A quote is at least this many words of the rules in a row, so a short request that happens to match isn't one. */
const GRAM = 5;
const tokens = (s: string) => [...s.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ word: m[0], start: m.index!, end: m.index! + m[0].length }));

export function indexRules(text: string): RulesIndex {
  return {
    grams: FORMS.map((form) => {
      const words = tokens(form(text)).map((t) => t.word);
      const grams = new Set<string>();
      for (let i = 0; i + GRAM <= words.length; i++) grams.add(words.slice(i, i + GRAM).join(" "));
      return grams;
    }),
  };
}

export const NO_RULES: RulesIndex = { grams: FORMS.map(() => new Set()) };

/** A message in one form, with which of its words are part of a quote of the rules. */
class Reading {
  readonly words: ReturnType<typeof tokens>;
  readonly quoted: boolean[];

  constructor(
    readonly text: string,
    rules: Set<string>,
  ) {
    this.words = tokens(text);
    this.quoted = this.words.map(() => false);
    for (let i = 0; i + GRAM <= this.words.length; i++) {
      const gram = this.words
        .slice(i, i + GRAM)
        .map((t) => t.word)
        .join(" ");
      if (rules.has(gram)) for (let j = i; j < i + GRAM; j++) this.quoted[j] = true;
    }
  }

  /** How much a match from start to end counts: nothing inside a quote of the rules, half after a negation. */
  weigh(start: number, end: number, weight: number, negatable = true, harmlessNext?: Set<string>): number {
    const inside = this.words.map((w, i) => [w, i] as const).filter(([w]) => w.end > start && w.start < end);
    if (inside.length && inside.every(([, i]) => this.quoted[i])) return 0;
    const first = inside[0]?.[1] ?? this.words.findIndex((w) => w.start >= start);
    const last = inside.at(-1)?.[1] ?? first;
    const before = this.words.slice(Math.max(0, first - 3), Math.max(0, first)).map((w) => w.word);
    const after = this.words.slice(last + 1, last + 4).map((w) => w.word);
    if (harmlessNext?.has(after[0] ?? "")) return 0;
    if (negatable && (before.some((w) => NEGATIONS.has(w)) || after.some((w) => AFTERWARDS.has(w)))) return weight / 2;
    return weight;
  }
}

// Links.

const DEFANG = (s: string) => s.replace(/\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/g, ".").replace(/\bhxxp/g, "http");
const HOST = /(?<![\p{L}\p{N}@.-])((?:[a-z0-9-]+\.)+[a-z]{2,24})(?![\p{L}\p{N}-])/gu;
/** Endings that make text a link rather than a file name like anyps5-report.json. */
const LINK_TLD = /\.(?:com|net|org|io|gg|xyz|me|ly|co|ru|top|link|site|online|app|dev|fun|click|info|biz|live|shop|store|club|pro|vip|cc|tk|ml|ga|cf|gq|to|so|ai|fi|finance|money|cash|exchange|gift|gifts|cloud|tech|space|website|icu|buzz|monster|sbs|cfd|tv|us|uk|de|fr)$/u;
const onSite = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const anyOf = (host: string, domains: string[]) => domains.find((d) => onSite(host, d));

/** Markdown links whose text names one site while the link goes to another: [steamcommunity.com](https://evil.example). */
function disguised(content: string): boolean {
  for (const m of content.matchAll(/\[([^\]]{3,100})\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/giu)) {
    const shown = m[1]!.toLowerCase().match(/((?:[a-z0-9-]+\.)+[a-z]{2,24})/)?.[1];
    const real = m[2]!.toLowerCase().match(/^https?:\/\/([^/:?#]+)/)?.[1];
    if (shown && real && !onSite(real, shown.replace(/^www\./, "")) && !onSite(shown, real.replace(/^www\./, ""))) return true;
  }
  return false;
}

/** Base64 that decodes to a link. */
function encodedLink(content: string): string | undefined {
  const prefix = BASE64_LINKS.find((p) => content.includes(p));
  if (prefix) return prefix;
  for (const [token] of content.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)) {
    try {
      const decoded = atob(token.replace(/-/g, "+").replace(/_/g, "/")).toLowerCase();
      if (/^(?:https?:|www\.|magnet:|discord\.gg)/.test(decoded)) return token.slice(0, 12);
    } catch {
      // Not base64.
    }
  }
  return undefined;
}

// Reading a message.

export interface MessageFacts {
  content: string;
  /** Distinct members and roles mentioned, and whether it tried @everyone or @here. */
  mentions: number;
  everyone: boolean;
  /** Joined the server in the last day, or an account under a week old. */
  newcomer: boolean;
}

export interface AutomodOptions {
  enabled: Partial<Record<Filter, { limit?: number }>>;
  words: string[];
  allowedLinks: string[];
  rules: RulesIndex;
}

const INVITE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg|discord\.me|discord\.io|invite\.gg)\/[\w-]+/u;
const URL = /https?:\/\/([^\s/<>"')]+)/gu;

const wordCache = new Map<string, Term[]>();
const customWords = (words: string[]) => {
  const key = words.join("\n");
  let compiled = wordCache.get(key);
  if (!compiled) {
    compiled = words.map((w) => term(w, 2));
    wordCache.clear();
    wordCache.set(key, compiled);
  }
  return compiled;
};

/**
 * Scores terms and patterns against every form of the message. Near-duplicate terms ("pkg link", "pkg links") count
 * once, and matches that talk about the rule ("don't", "beware") count half, at most 1 between them: a warning about
 * scams can mention several scam words.
 */
function score(readings: Reading[], list: Term[], patterns: Pattern[] = [], options: { patternForms?: number[]; negatable?: boolean; harmlessNext?: Set<string> } = {}): { total: number; evidence: string[] } {
  const { patternForms = [0, 1, 2], negatable = true, harmlessNext } = options;
  let full = 0;
  let halved = 0;
  const evidence: string[] = [];
  const seen = new Set<string>();
  const count = (label: string, weight: number, best: number) => {
    const key = label.replace(/s$/, "");
    if (best <= 0 || seen.has(key)) return;
    seen.add(key);
    if (best < weight) halved += best;
    else full += best;
    evidence.push(label);
  };
  for (const t of list) {
    let best = 0;
    t.patterns.forEach((re, i) => {
      const m = re.exec(readings[i]!.text);
      if (m) best = Math.max(best, readings[i]!.weigh(m.index, m.index + m[0].length, t.weight, negatable, harmlessNext));
    });
    count(t.label, t.weight, best);
  }
  for (const p of patterns) {
    let best = 0;
    for (const i of patternForms) {
      const m = p.re.exec(readings[i]!.text);
      if (m) best = Math.max(best, readings[i]!.weigh(m.index, m.index + m[0].length, p.weight, negatable, harmlessNext));
    }
    count(p.label, p.weight, best);
  }
  return { total: full + Math.min(1, halved), evidence };
}

/** The first filter a message breaks, most serious first; undefined if it's fine. */
export function scan(facts: MessageFacts, options: AutomodOptions): Verdict | undefined {
  const on = options.enabled;
  const content = facts.content;
  const readings = FORMS.map((form, i) => new Reading(form(content), options.rules.grams[i]!));
  const hostsIn = (r: Reading) => [...DEFANG(r.text).matchAll(HOST)].map((m) => m[1]!.replace(/^www\./, ""));
  const asWritten = new Set(hostsIn(readings[0]!));
  const hosts = [...new Set(readings.flatMap(hostsIn))];
  const linked = /https?:\/\//u.test(readings[0]!.text) || hosts.some((h) => LINK_TLD.test(h));
  const everyone = facts.everyone || /@(?:everyone|here)\b/u.test(content);

  // Scams first: phishing and wallet drainers are the worst thing a member can click.
  if (on.scam) {
    // A brand's name in a site that isn't the brand's, or spelled with look-alike letters (dіscord.com with a Cyrillic і).
    const phishing = hosts.find((h) => PHISHED.test(h) && (!anyOf(h, REAL) || !asWritten.has(h)));
    if (phishing) return { filter: "scam", why: "it linked to a fake copy of a real site", severe: true, evidence: [`look-alike site ${phishing}`] };
    if (disguised(content)) return { filter: "scam", why: "it had a link pretending to go somewhere else", severe: true, evidence: ["disguised link"] };
    const s = score(readings, SCAM, SCAM_PATTERNS);
    const domain = hosts.find((h) => anyOf(h, SCAM_DOMAINS));
    if (domain) {
      s.total += 2;
      s.evidence.push(domain);
    }
    // The words decide; a link, @everyone or a brand-new member only make it worse. One weak word with a link
    // ("giveaway" and a store page) is fine, except from someone who just joined.
    const extra = (linked ? 1 : 0) + (everyone ? 2 : 0) + (facts.newcomer ? 1 : 0);
    if (s.total >= 2 || (s.total >= 1 && facts.newcomer && (linked || everyone))) {
      const severe = s.total + extra >= 4 && (linked || everyone);
      return { filter: "scam", why: "it looked like crypto or giveaway spam", severe, evidence: s.evidence };
    }
  }

  if (on.hidden) {
    const shortener = hosts.find((h) => anyOf(h, SHORTENERS));
    if (shortener) return { filter: "hidden", why: "shortened links aren't allowed here; post the full link", severe: false, evidence: [shortener] };
    const encoded = encodedLink(content);
    if (encoded) return { filter: "hidden", why: "links in code aren't allowed here; post the full link", severe: false, evidence: [`base64 ${encoded}…`] };
  }

  if (on.piracy) {
    const s = score(readings, PIRACY, PIRACY_PATTERNS, { patternForms: [1, 2], harmlessNext: HARMLESS_NEXT });
    const site = hosts.find((h) => anyOf(h, PIRACY_DOMAINS));
    if (site) {
      s.total += 2;
      s.evidence.push(site);
    }
    const host = hosts.find((h) => anyOf(h, FILE_HOSTS));
    if (host && s.total > 0) {
      s.total += 1;
      s.evidence.push(host);
    }
    if (s.total >= 2) return { filter: "piracy", why: "asking for or sharing games, keys or firmware isn't allowed (rule 1)", severe: false, evidence: s.evidence };
  }

  if (on.invites && INVITE.test(readings[1]!.text)) return { filter: "invites", why: "invites to other servers aren't allowed here", severe: false, evidence: ["invite link"] };

  if (on.links) {
    const external = [...content.toLowerCase().matchAll(URL)].map((m) => m[1]!.replace(/:\d+$/, "").replace(/^www\./, ""));
    const blocked = external.find((h) => !anyOf(h, options.allowedLinks));
    if (blocked) return { filter: "links", why: "links to that site aren't allowed here", severe: false, evidence: [blocked] };
  }

  if (on.words && options.words.length) {
    // A blocked word is blocked even after "not".
    const s = score(readings, customWords(options.words), [], { patternForms: [], negatable: false });
    if (s.total >= 2) return { filter: "words", why: "it used a blocked word", severe: false, evidence: s.evidence };
  }

  if (on.mentions && facts.mentions >= (on.mentions.limit ?? 5)) {
    return { filter: "mentions", why: "it mentioned too many people", severe: true, evidence: [`${facts.mentions} mentions`] };
  }

  if (on.caps) {
    const letters = content.match(/\p{L}/gu) ?? [];
    const upper = letters.filter((c) => c !== c.toLowerCase()).length;
    if (letters.length >= 12 && (upper / letters.length) * 100 >= (on.caps.limit ?? 70)) {
      return { filter: "caps", why: "it was mostly capital letters", severe: false, evidence: [`${Math.round((upper / letters.length) * 100)}% capitals`] };
    }
  }

  if (on.eta && looksLikeQuestion(readings[0]!.text)) {
    for (const re of ETA_PATTERNS) {
      const m = re.exec(readings[0]!.text);
      if (m && readings[0]!.weigh(m.index, m.index + m[0].length, 2) >= 2) return { filter: "eta", why: "there's no date for that (rule 3)", severe: false, evidence: [m[0].trim()] };
    }
  }
  return undefined;
}
