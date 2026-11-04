import { PNG_MAX_BYTES } from "./protocol.ts";

/** The most base64 characters an upload may hold: the largest PNG, padded. */
const MAX_CHARS = Math.ceil((PNG_MAX_BYTES * 4) / 3) + 4;

type Pending = { parts: string[]; chars: number; next: number };

/**
 * Collects a picture the page sends in pieces. Pieces must arrive in order, starting at 0, and the
 * last one completes the upload. Anything else ends the upload with an error.
 */
export class PngUploads {
  private readonly pending = new Map<string, Pending>();

  accept(upload: string, index: number, last: boolean, data: string): string | null {
    const current = this.pending.get(upload) ?? { parts: [], chars: 0, next: 0 };
    if (index !== current.next) {
      this.pending.delete(upload);
      throw new Error(`A picture piece arrived out of order: expected piece ${current.next}, got ${index}.`);
    }
    current.parts.push(data);
    current.chars += data.length;
    current.next += 1;
    if (current.chars > MAX_CHARS) {
      this.pending.delete(upload);
      throw new Error("The picture is larger than 8 MiB.");
    }
    if (!last) {
      this.pending.set(upload, current);
      return null;
    }
    this.pending.delete(upload);
    const base64 = current.parts.join("");
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    if ((base64.length / 4) * 3 - padding > PNG_MAX_BYTES) throw new Error("The picture is larger than 8 MiB.");
    return base64;
  }
}
