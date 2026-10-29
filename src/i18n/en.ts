/**
 * Every string on the translated pages (home, setup guide, FAQ) and the shared header and footer, in English.
 * Translations in this folder have the same shape; TypeScript checks that nothing is missing.
 *
 * Strings may hold simple HTML where noted. Links use English paths ("/guide/run"); pages rewrite them for each
 * language. Functions build sentences around numbers.
 */
const en = {
  meta: {
    title: "AnyPS5 · Native PS5 ports for Linux and Windows",
    description: "AnyPS5 converts PS5 executables into native Linux and Windows programs. Browser converter, setup guide and per-game compatibility.",
  },
  nav: {
    compatibility: "Compatibility",
    converter: "Converter",
    guide: "Setup guide",
    docs: "Docs",
    progress: "Progress",
    download: "Download",
    search: "Search (Ctrl+K)",
    theme: "Switch colour theme",
    menu: "Menu",
    language: "Language",
    home: "AnyPS5 home",
    skip: "Skip to content",
  },
  footer: {
    tagline: "Native Linux and Windows ports of PS5 executables. Free and open source under the GNU GPL v2.",
    project: "Project",
    learn: "Learn",
    community: "Community",
    webConverter: "Web converter",
    updates: "Updates",
    documentation: "Documentation",
    faq: "FAQ",
    build: "Build from source",
    contributing: "Contributing",
    bringUp: "Game bring-up",
    report: "Report a test run",
    involved: "Get involved",
    legal:
      "AnyPS5 is an independent project, not affiliated with, authorised or endorsed by Sony Interactive Entertainment. “PlayStation” and “PS5” are trademarks of Sony Interactive Entertainment Inc. Game artwork belongs to its publishers and is shown from the PlayStation Store and SteamGridDB. AnyPS5 does not include or distribute copyrighted software, firmware or keys.",
  },
  home: {
    latestRelease: "Latest release",
    /** HTML: the word in <em> gets the gradient. */
    headline: "PS5 games, running <em>natively</em> on PC.",
    lede: "AnyPS5 relinks PS5 executables into native Linux and Windows programs that run against reimplemented system libraries. No emulator, no separate runtime process.",
    openConverter: "Open the converter",
    setupGuide: "Setup guide",
    compatibility: "Compatibility",
    atAGlance: "At a glance",
    facts: ["Free and open source", "Converts on your device", "Linux and Windows"],
    status: "Project status",
    libraries: "System libraries",
    librariesOf: (done: string, total: string) => `${done} of ${total} functions`,
    librariesTrend: "Implemented functions, rising over time",
    shaders: "Shader recompiler",
    shadersOf: (left: string) => `of RDNA 2 instruction forms; ${left} unsupported cases left`,
    shadersTrend: "Decoded instruction forms over time",
    gamesUnderTest: "Games under test",
    withReports: (n: string) => `${n} with test reports`,
    reachGameplay: "Reach gameplay",
    ofTested: (percent: string) => `${percent}% of tested games`,
    latest: "Latest",
    latestUpdates: "Latest updates",
    allUpdates: "All updates",
    howItWorks: "How it works",
    stepsTitle: "Three steps from your console to your PC",
    steps: [
      { title: "Dump your game", text: "Use a PS5 you own to dump a game you bought. AnyPS5 never ships game files, firmware or keys." },
      { title: "Convert in the browser", text: "Drop the dump into the web converter. It relinks the executable on your device and bundles the system libraries." },
      { title: "Run it natively", text: "Start the output like any Linux or Windows program, with a Vulkan GPU and your controller." },
    ],
    learnMore: "Learn more",
    notEmulator: "Not an emulator",
    nativeTitle: "The game's own code, running on your CPU",
    nativeText:
      "An emulator interprets a console at run time. AnyPS5 rewrites the executable once, so its calls into the PS5's system libraries go to native reimplementations instead. The result starts like any other program on your PC.",
    libraryProgress: "See library progress",
    diagram: "How a converted game runs",
    fromDump: "PS5 executable from your dump",
    relink: "relink",
    nativeProgram: "Native program for Linux or Windows",
    calls: "calls",
    libraryNames: {
      libkernel: { name: "Kernel", role: "Threads, memory, files" },
      libc: { name: "C runtime", role: "Standard library" },
      Agc: { name: "Graphics", role: "GPU commands → Vulkan" },
      AudioOut: { name: "Audio", role: "Sound output" },
      Pad: { name: "Input", role: "Controllers" },
    },
    furthest: "Furthest along",
    furthestTitle: "Games that already go a long way",
    shotsEyebrow: "From the test bench",
    shotsTitle: "Fresh screenshots from testers",
    shotsText: "Captured by the community while testing games on their own PCs.",
    shotBy: (name: string) => `by ${name}`,
    allGames: (n: string) => `All ${n} games`,
    communityEyebrow: "Community",
    peopleTitle: "The people building AnyPS5",
    peopleText: "Every commit and every test report moves a game forward, including the runs that crash.",
    contributors: "Contributors",
    commits: "Commits",
    testers: "Testers",
    commitCount: (n: number, formatted: string) => (n === 1 ? `${formatted} commit` : `${formatted} commits`),
    reportCount: (n: number, formatted: string) => (n === 1 ? `${formatted} report` : `${formatted} reports`),
    moreContributors: "More contributors",
    everyone: "Everyone on GitHub",
    joinTitle: "Join in",
    joinText: "Test a game and share the result, pick something from the most-wanted list, or come and talk.",
    discord: "Join the Discord",
    reportRun: "Report a test run",
    github: "GitHub repository",
  },
  guide: {
    title: "Setup guide",
    eyebrow: "Get started",
    lede: "From a game you own to a native program on your PC, in six steps. Most of it happens in your browser.",
    /** HTML. */
    already: 'Already know your way around? The <a href="/convert">converter</a> and the <a href="/docs/usage">relinker reference</a> are all you need.',
    step: (n: number, total: number) => `Step ${n} of ${total}`,
    previous: "Previous",
    next: "Next",
    backTo: "Back to",
    overview: "Overview",
    steps: "Guide steps",
    onThisPage: "On this page",
    reference: "Reference",
    usage: "Relinker usage",
    inputMapping: "Input mapping",
  },
  faq: {
    title: "FAQ",
    eyebrow: "FAQ",
    heading: "Questions people ask",
    /** HTML. */
    lede: 'The short answers. The <a href="/guide">setup guide</a> has the long ones, and <a href="https://discord.gg/BHFztBPUe">Discord</a> has people.',
    description: "Answers to common questions about AnyPS5: what it is, whether it is an emulator, hardware, Steam Deck, macOS, and why a game stops.",
    /** Answers are HTML. */
    groups: [
      {
        title: "The basics",
        questions: [
          {
            q: "What is AnyPS5?",
            a: 'A tool that turns a PS5 game\'s executable into a native Linux or Windows program. It ships a <b>relinker</b>, which rewrites the executable, and reimplementations of the PS5\'s <b>system libraries</b>, which the converted program calls instead of the console\'s. Start with the <a href="/guide">setup guide</a>.',
          },
          {
            q: "Is it an emulator?",
            a: "No. An emulator interprets a console while a game runs. AnyPS5 converts the executable once, so the game's own code runs directly on your CPU, with no emulation layer and no separate runtime process. Its calls into the system libraries go to native code, and its GPU shaders are recompiled to Vulkan.",
          },
          {
            q: "Is it legal?",
            a: "AnyPS5 is free, open-source software under the GNU GPL v2. It does not include or download any game, firmware or keys: you convert a game you dumped yourself from a console you own. Whether dumping and running your own copy is allowed depends on where you live, so check your local law. This is not legal advice.",
          },
          {
            q: "Do I need a PS5?",
            a: 'Yes, to make the dump. AnyPS5 works on a decrypted dump of a game you own. The <a href="/guide/dump">dump step</a> of the guide lists what it needs.',
          },
        ],
      },
      {
        title: "Your PC",
        questions: [
          {
            q: "What hardware do I need?",
            a: 'An x86-64 CPU with the instruction set extensions of the PS5\'s Zen 2 processor (AVX2, FMA, F16C, BMI1, BMI2, LZCNT and MOVBE), a GPU with Vulkan 1.1, and plenty of memory: a PS5 game can reserve up to 13.5 GiB. The <a href="/guide/requirements">requirements</a> page has the details.',
          },
          {
            q: "Does it work on Intel CPUs?",
            a: "Mostly. Some games use AMD-only instructions, so convert with <b>Convert AMD-specific instructions for Intel CPUs</b> ticked, or <code>--to-intel</code> on the command line. A few titles generate AMD-only code while they run; those still need an AMD CPU.",
          },
          {
            q: "What about the Steam Deck?",
            a: 'On paper it qualifies: its APU is the same Zen 2 generation as the PS5\'s, and it runs Linux with a Vulkan driver. Its 16 GB is shared between the CPU and GPU, though, and games can reserve up to 13.5 GiB, so memory will be tight. If you try it, please <a href="/report">share how it went</a>.',
          },
          {
            q: "Does it run on macOS?",
            a: "The relinker itself runs on macOS, including Apple silicon, and can write macOS executables. Games need the system libraries too, and those are built for Linux and Windows; macOS support for them is still in progress.",
          },
        ],
      },
      {
        title: "Running games",
        questions: [
          {
            q: "Why is my game stuck at “Starts” or “First draw”?",
            a: 'Each stage on the <a href="/compatibility">compatibility list</a> is a step further than the one before: the game\'s code runs, then draws, then shows frames, and so on. A game usually stops because it calls a system function that is not implemented yet, or uses a GPU feature the shader recompiler does not handle. Game pages show <b>What it needs</b> when the latest report names it, and the <a href="/progress#wanted">progress page</a> lists what most games are waiting on.',
          },
          {
            q: "It stops with an error. What now?",
            a: 'AnyPS5 stops on purpose when it meets something it does not support yet, and prints why. Look the message up in <a href="/guide/troubleshooting">troubleshooting</a>. If it is not there, include it in a <a href="/report">test report</a>: exact error text helps most.',
          },
          {
            q: "Why is the first start so slow?",
            a: "The first time a game runs, its GPU shaders are recompiled and cached. Later starts reuse the cache and are much faster.",
          },
          {
            q: "Where are my saves?",
            a: 'In the <code>_sd</code> folder next to <code>app0/</code>; copy <code>_sd</code> and <code>_sd_mem</code> to move your progress. See <a href="/guide/run">running the game</a>.',
          },
          {
            q: "Will online features work?",
            a: 'Don\'t count on them yet. The network and PlayStation Network libraries are among the least complete; the <a href="/progress#libraries">library map</a> shows how far each one is.',
          },
        ],
      },
      {
        title: "Helping out",
        questions: [
          {
            q: "How can I help?",
            a: 'Test games and <a href="/report">report the results</a>, including crashes: every report sharpens the compatibility list and shows developers what to fix next. If you write C++, the <a href="/progress#wanted">most wanted</a> list and the <a href="https://github.com/boykopovar/AnyPS5/blob/main/CONTRIBUTING.md">contributing guide</a> are good places to start. Questions are welcome on <a href="https://discord.gg/BHFztBPUe">Discord</a>.',
          },
          {
            q: "A game's entry is wrong. How do I fix it?",
            a: "Every game page has a <b>Suggest a correction</b> link that opens the right file to edit. Curated corrections take priority over automatic reports.",
          },
        ],
      },
    ],
  },
};

export default en;

/** The shape every translation must match: the same keys, with strings and functions of the same signatures. */
export type Strings = typeof en;
