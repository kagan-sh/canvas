import { contentBounds, exportText, layoutNotes, layoutReport, type Doc } from "./model.ts";

/** Where the drawing sits, so an agent can place new work beside it. */
export function summary(doc: Doc): string {
  const bounds = contentBounds(doc);
  const count = doc.elements.length;
  if (bounds === null) return `canvas "${doc.name}" is empty; draw near 0,0`;
  return `canvas "${doc.name}": ${count} element${count === 1 ? "" : "s"} using ${Math.round(bounds.x)},${Math.round(bounds.y)} to ${Math.round(bounds.x + bounds.w)},${Math.round(bounds.y + bounds.h)}`;
}

export const shellWord = (word: string) => (/^[\w.][\w.-]*$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);

/** The whole canvas as text: summary, one line per element, then the layout notes. */
export function dump(doc: Doc): string {
  return [summary(doc), exportText(doc), layoutReport(layoutNotes(doc))].filter((part) => part !== "").join("\n\n");
}

/**
 * Only the lines an edit changed, so a small edit on a big canvas gets a small reply. Layout notes
 * are the ones this edit caused or that touch what it changed; older ones elsewhere are counted.
 */
export function changes(before: Doc, after: Doc, added: string[]): string {
  const old = new Set(exportText(before).split("\n"));
  const changed = after.elements.length === 0 ? [] : exportText(after).split("\n").filter((line) => !old.has(line));
  const kept = new Set(after.elements.map((element) => element.id));
  const deleted = before.elements.filter((element) => !kept.has(element.id)).map((element) => element.id);
  const touched = new Set(changed.map((line) => line.split(" ")[0]!));
  const earlier = new Set(layoutNotes(before).map((note) => note.text));
  const notes = layoutNotes(after);
  const relevant = notes.filter((note) => !earlier.has(note.text) || note.ids.some((id) => touched.has(id)));
  const elsewhere = notes.length - relevant.length;
  return [
    summary(after),
    added.length === 0 ? "" : `added: ${added.join(" ")}`,
    deleted.length === 0 ? "" : `deleted: ${deleted.join(" ")}`,
    changed.join("\n"),
    layoutReport(relevant),
    elsewhere === 0 ? "" : `${elsewhere} older layout note${elsewhere === 1 ? "" : "s"} elsewhere on the canvas; canvas_read lists them.`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

/** The note the panel's Send pastes into a thread. It points at the canvas instead of pasting it. */
export function shareText(doc: Doc, note: string): string {
  const body = note.trim();
  return [
    ...(body === "" ? [] : [body, ""]),
    `The canvas beside you is "${doc.name}". Run this to see what is on it:`,
    "",
    `kg canvas show ${shellWord(doc.name)}`,
    "",
    "Draw on it with the canvas_edit tool; the canvas skill says how.",
    body === ""
      ? "In one or two sentences, tell me what you see. Ask whether I want to draw or change anything."
      : "Then do what I asked.",
  ].join("\n");
}

/**
 * One canvas per name, however the name was typed. Same rule 0.1.6 used, so rows it wrote are
 * found by the same name.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}
