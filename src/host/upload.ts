import { PNG_MAX_BYTES } from "../protocol.ts";

/** The most base64 characters an upload may hold: the largest PNG, padded. */
const MAX_CHARS = Math.ceil((PNG_MAX_BYTES * 4) / 3) + 4;
/** A transfer that stops halfway is dropped instead of held for the plugin's lifetime. */
const UPLOAD_TTL_MS = 60_000;
/** Only one page sends pictures, and it sends one at a time. A few stale ones are enough. */
const MAX_PENDING_UPLOADS = 4;

type Pending = { parts: string[]; chars: number; next: number; updatedAt: number };

/**
 * Collects a picture the page sends in pieces. Pieces must arrive in order, starting at 0, and the
 * last one completes the upload. Anything else ends the upload with an error. A transfer that is
 * abandoned, or a burst of them, is forgotten, so a closed page cannot hold memory forever.
 */
export class PngUploads {
  private readonly pending = new Map<string, Pending>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private sweep(): void {
    const cutoff = this.now() - UPLOAD_TTL_MS;
    for (const [upload, current] of this.pending) if (current.updatedAt < cutoff) this.pending.delete(upload);
  }

  /** A new upload needs a slot. A continuation keeps the one it already has. */
  private makeRoom(): void {
    while (this.pending.size >= MAX_PENDING_UPLOADS) {
      const oldest = [...this.pending].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
      if (oldest === undefined) break;
      this.pending.delete(oldest[0]);
    }
  }

  accept(upload: string, index: number, last: boolean, data: string): string | null {
    this.sweep();
    const found = this.pending.get(upload);
    if (found === undefined) this.makeRoom();
    const current = found ?? { parts: [], chars: 0, next: 0, updatedAt: this.now() };
    if (index !== current.next) {
      this.pending.delete(upload);
      throw new Error(`A picture piece arrived out of order: expected piece ${current.next}, got ${index}.`);
    }
    current.parts.push(data);
    current.chars += data.length;
    current.next += 1;
    current.updatedAt = this.now();
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
