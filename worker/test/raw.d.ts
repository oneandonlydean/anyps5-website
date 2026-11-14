// Files imported as text (Vite's ?raw), like data/bot.yaml in the automod tests.
declare module "*?raw" {
  const text: string;
  export default text;
}
