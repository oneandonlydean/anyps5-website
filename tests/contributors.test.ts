import { describe, expect, it } from "vitest";
import { countPeople } from "../scripts/lib/contributors";

describe("countPeople", () => {
  it("counts each person once", () => {
    expect(
      countPeople([
        { type: "User", login: "alice", contributions: 10 },
        { type: "User", login: "dependabot[bot]", contributions: 5 },
        { type: "Bot", login: "renovate", contributions: 5 },
        { type: "Anonymous", name: "Alice", email: "alice@work.example", contributions: 3 },
        { type: "Anonymous", name: "Bob", email: "bob@home.example", contributions: 2 },
        { type: "Anonymous", name: "bob", email: "bob@work.example", contributions: 1 },
        { type: "Anonymous", name: "Carol C", email: "123+carol@users.noreply.github.com", contributions: 1 },
        { type: "User", login: "carol", contributions: 4 },
        { type: "Anonymous", name: "Claude", email: "noreply@anthropic.com", contributions: 9 },
        { type: "Anonymous", name: "Cursor Agent", email: "cursoragent@cursor.com", contributions: 2 },
      ]),
    ).toBe(3);
  });
});
