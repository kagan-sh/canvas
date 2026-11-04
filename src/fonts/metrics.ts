// Advance widths in 1/1000 em, read with fontTools from the woff2 in nunito.ts.
// U+0020 to U+007E, in order.
const ASCII = [
  261, 233, 405, 600, 600, 933, 701, 226, 326, 326, 451, 600, 233, 427, 233, 290, 600, 600, 600, 600, 600, 600, 600, 600, 600,
  600, 233, 233, 600, 600, 600, 447, 947, 733, 679, 675, 747, 586, 551, 729, 764, 262, 331, 634, 548, 858, 741, 771, 637, 771,
  673, 618, 607, 731, 694, 1104, 655, 601, 593, 324, 290, 324, 600, 500, 361, 533, 587, 465, 587, 534, 340, 590, 572, 237, 241,
  508, 301, 861, 572, 560, 587, 587, 365, 483, 358, 565, 518, 844, 530, 517, 466, 361, 270, 361, 600,
];

const OTHER: Record<string, number> = {
  "…": 700,
  "–": 500,
  "—": 1000,
  "·": 233,
  "•": 524,
  "×": 600,
  "‘": 233,
  "’": 233,
  "“": 405,
  "”": 405,
};

/** Width of one character in 1/1000 em. The Latin subset lacks arrows, symbols, and emoji, so
 * the browser draws those from a system font; a full em keeps that guess on the wide side. */
export function advance(char: string): number {
  const code = char.codePointAt(0) ?? 32;
  if (code >= 32 && code <= 126) return ASCII[code - 32]!;
  return OTHER[char] ?? (code < 0x2000 ? 600 : 1000);
}

/** The line box, in em. */
export const ASCENT = 1.011;
export const DESCENT = 0.353;
/** Where ink actually reaches, in em: the top of `l` and `H`, the bottom of `g` and `p`. */
export const INK_TOP = 0.712;
export const INK_BOTTOM = 0.19;
