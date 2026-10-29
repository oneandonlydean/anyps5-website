import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          GITHUB_REPO: "acme/widgets",
          BASE_URL: "https://worker.test",
          DISCORD_CLIENT_ID: "app123",
          DISCORD_PUBLIC_KEY: "00",
          DISCORD_CLIENT_SECRET: "discord-secret",
          DISCORD_BOT_TOKEN: "bot-token",
          GITHUB_CLIENT_ID: "gh-client",
          GITHUB_CLIENT_SECRET: "gh-secret",
          GITHUB_TOKEN: "gh-pat",
          DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/secret",
          TOKEN_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        },
      },
    }),
  ],
  test: { setupFiles: ["./test/setup.ts"] },
}));
