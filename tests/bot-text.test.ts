import { describe, expect, it } from "vitest";
import { numberedRules } from "../worker/src/bot/commands";
import { loadBotText } from "../src/lib/load";

describe("data/bot.yaml", () => {
  it("numbers its rules 1, 2, 3… so /rule can find each one", async () => {
    const numbers = numberedRules((await loadBotText()).rules).map((r) => r.number);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});
