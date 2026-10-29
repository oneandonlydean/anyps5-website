import { DOCS } from "./docs";

export const docsNav = [
  { title: "Reference", links: DOCS.map((d) => ({ href: `/docs/${d.slug}`, label: d.title })) },
  { title: "Start here", links: [{ href: "/guide", label: "Setup guide" }] },
];
