import { PNG_CHUNK_CHARS, PNG_MAX_BYTES } from "../protocol.ts";
import { call } from "./client.ts";

const MAX_SIDE = 8192;
let fontCss: Promise<string> | null = null;

/** Base64 without a data: prefix, as the clipboard call takes it. */
export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** The font travels inside the SVG as a data URL: an SVG drawn as an image cannot fetch files. */
export function embeddedFontCss(): Promise<string> {
  fontCss ??= fetch("fonts/nunito.woff2")
    .then((r) => {
      if (!r.ok) throw new Error("The font did not load.");
      return r.arrayBuffer();
    })
    .then(
      (buffer) =>
        `@font-face { font-family: "Nunito"; src: url(data:font/woff2;base64,${base64(new Uint8Array(buffer))}) format("woff2"); font-weight: 500; } text { font-weight: 500; }`,
    );
  fontCss.catch(() => {
    fontCss = null;
  });
  return fontCss;
}

/** The SVG drawn to a canvas and read back as PNG bytes. A data: URL, because the CSP allows no blob: images. */
export async function pngFromSvg(markup: string): Promise<Blob> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await image.decode();
  const scale = Math.min(2, MAX_SIDE / Math.max(image.width, image.height, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("This page can't draw images.");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((done, fail) => canvas.toBlob((blob) => (blob ? done(blob) : fail(new Error("Couldn't draw the image."))), "image/png"));
}

export class TooLarge extends Error {}

/** Sends the PNG as base64 pieces under one upload id. The plugin writes the clipboard after the last one. */
export async function uploadPng(png: Blob): Promise<void> {
  if (png.size > PNG_MAX_BYTES) throw new TooLarge("This drawing is too big to copy as an image. Zoom to a smaller part or split it.");
  const text = base64(new Uint8Array(await png.arrayBuffer()));
  const upload = crypto.randomUUID();
  const count = Math.max(1, Math.ceil(text.length / PNG_CHUNK_CHARS));
  for (let index = 0; index < count; index++) {
    await call({ call: "pngChunk", upload, index, last: index === count - 1, data: text.slice(index * PNG_CHUNK_CHARS, (index + 1) * PNG_CHUNK_CHARS) });
  }
}
