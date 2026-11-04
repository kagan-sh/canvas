// Node strips types from `.ts`, but not JSX. Tests that import a `.tsx` module get it
// transformed by esbuild first, so the panel and its renderers are covered by `node --test`.
import { register } from "node:module";

register("./tsx-hooks.mjs", import.meta.url);
