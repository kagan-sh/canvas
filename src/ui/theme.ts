import { useEffect, useState } from "react";
import type { Theme } from "../constants.ts";

/** The host's `color-scheme` says which palette to use. */
export const themeFrom = (colorScheme: string): Theme => (colorScheme.includes("dark") ? "dark" : "light");

const read = (): Theme => themeFrom(getComputedStyle(document.documentElement).colorScheme);

/** Follows the host's `color-scheme`, which kagan rewrites live when the person changes theme or mode. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", update);
    const timer = setInterval(update, 1000);
    update();
    return () => {
      observer.disconnect();
      query.removeEventListener("change", update);
      clearInterval(timer);
    };
  }, []);
  return theme;
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
