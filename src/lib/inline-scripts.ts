import { transform } from "esbuild";
import viewTransitionsSource from "../scripts/view-transitions.js?raw";

/**
 * Scripts that must run in the page's <head> before first paint, so they are inlined rather than loaded. They are
 * written readably in src/scripts and minified once here, so every page doesn't carry their comments.
 */
export const viewTransitions = (await transform(viewTransitionsSource, { minify: true })).code.trim();
