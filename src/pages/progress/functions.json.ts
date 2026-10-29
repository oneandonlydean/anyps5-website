import { getFunctions } from "../../lib/upstream";

/** Every declared function per library, split into implemented and missing; the progress map loads it on demand. */
export async function GET() {
  const libraries: Record<string, { done: string[]; todo: string[] }> = {};
  for (const [name, [label, done]] of Object.entries(await getFunctions())) {
    const entry = (libraries[label] ??= { done: [], todo: [] });
    (done ? entry.done : entry.todo).push(name);
  }
  return new Response(JSON.stringify(libraries), { headers: { "Content-Type": "application/json" } });
}
