/** A system library's name as a path segment, for its card: /bot/library/<slug>.jpg. Shared with the Worker. */
export const librarySlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
