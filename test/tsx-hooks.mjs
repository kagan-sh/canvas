import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const stub = new URL("./kagan-stub.mjs", import.meta.url).href;

/** main.ts imports the kagan host modules; tests run it against the stand-in. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "gpui-kit" || specifier.startsWith("kagan/")) return { url: stub, shortCircuit: true };
  return nextResolve(specifier, context);
}

/** Loads a `.tsx` file as ESM, with esbuild doing the JSX transform Node cannot. */
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);
  const path = fileURLToPath(url);
  const source = await readFile(path, "utf8");
  const { code } = await transform(source, {
    loader: "tsx",
    format: "esm",
    jsx: "automatic",
    target: "es2022",
    sourcefile: path,
  });
  return { format: "module", source: code, shortCircuit: true };
}
