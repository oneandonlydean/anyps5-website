import { getCoverage, getFunctions } from "../../lib/upstream";

/** What the Worker checks uploaded run reports against: implemented functions and untranslated shader instructions. */
export async function GET() {
  const [functions, coverage] = await Promise.all([getFunctions(), getCoverage()]);
  const implemented = Object.entries(functions)
    .filter(([, [, done]]) => done)
    .map(([name]) => name);
  return new Response(JSON.stringify({ implemented, untranslated: coverage?.untranslated ?? [] }), { headers: { "Content-Type": "application/json" } });
}
