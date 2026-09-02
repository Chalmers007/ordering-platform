/**
 * ESC/POS command builder.
 *
 * Pure: bytes in, bytes out, no I/O and no browser APIs. That is what makes
 * a receipt testable without a printer — `renderTicket()` returns both the
 * byte stream and a plain-text rendering of the same ticket, and the tests
 * assert on both.
 *
 * Command references are from the Epson ESC/POS standard, which every
 * 58mm/80mm thermal printer worth buying implements.
 */

// --- control bytes ----------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const DC4 = 0x14;
const LF = 0x0a;

export const CMD = {
  /** ESC @ — reset to power-on defaults. */
  INIT: [ESC, 0x40],
  /** ESC a n — 0 left, 1 centre, 2 right. */
  ALIGN_LEFT: [ESC, 0x61, 0],
  ALIGN_CENTER: [ESC, 0x61, 1],
  ALIGN_RIGHT: [ESC, 0x61, 2],
  /** ESC E n — emphasised (bold). */
  BOLD_ON: [ESC, 0x45, 1],
  BOLD_OFF: [ESC, 0x45, 0],
  /** GS ! n — character size; n = (width-1)<<4 | (height-1). */
  SIZE_NORMAL: [GS, 0x21, 0x00],
  SIZE_DOUBLE_HEIGHT: [GS, 0x21, 0x01],
  SIZE_DOUBLE: [GS, 0x21, 0x11],
  /** ESC - n — underline. */
  UNDERLINE_ON: [ESC, 0x2d, 1],
  UNDERLINE_OFF: [ESC, 0x2d, 0],
  /** GS V 0 — full cut. */
  CUT_FULL: [GS, 0x56, 0x00],
  /** GS V 1 — partial cut, leaves a tab so the ticket does not drop. */
  CUT_PARTIAL: [GS, 0x56, 0x01],
  /** DLE DC4 1 1 1 — kick the cash drawer on pin 2. */
  DRAWER_KICK: [DLE, DC4, 0x01, 0x01, 0x01],
  LINE_FEED: [LF],
} as const;

export type Columns = 32 | 48;

/** Printable characters per line. 58mm ≈ 32, 80mm ≈ 48 at font A. */
export const COLUMNS_58MM: Columns = 32;
export const COLUMNS_80MM: Columns = 48;

// --- builder ----------------------------------------------------------

export class EscPosBuilder {
  private readonly bytes: number[] = [];
  /** The same document as text, for previews and tests. */
  private readonly lines: string[] = [];

  constructor(private readonly columns: Columns = COLUMNS_80MM) {
    this.raw(CMD.INIT);
  }

  raw(command: readonly number[]): this {
    this.bytes.push(...command);
    return this;
  }

  /**
   * Thermal printers are single-byte devices. Anything outside CP437's
   * printable range is transliterated rather than sent raw — an unmapped
   * byte prints as garbage and can desynchronise the parser.
   */
  private encode(text: string): number[] {
    const out: number[] = [];
    for (const char of text.normalize('NFKD')) {
      const code = char.codePointAt(0) ?? 0x3f;
      if (code === 0x0a) out.push(LF);
      else if (code >= 0x20 && code <= 0x7e) out.push(code);
      else if (code > 0x7e) {
        // Combining marks vanish (NFKD already split them off); anything
        // else legible becomes '?'.
        if (code >= 0x0300 && code <= 0x036f) continue;
        out.push(0x3f);
      }
    }
    return out;
  }

  text(value: string): this {
    this.bytes.push(...this.encode(value));
    return this;
  }

  line(value = ''): this {
    const wrapped = wrapText(value, this.columns);
    for (const part of wrapped) {
      this.bytes.push(...this.encode(part), LF);
      this.lines.push(part);
    }
    if (wrapped.length === 0) {
      this.bytes.push(LF);
      this.lines.push('');
    }
    return this;
  }

  feed(count = 1): this {
    for (let i = 0; i < count; i += 1) {
      this.bytes.push(LF);
      this.lines.push('');
    }
    return this;
  }

  centered(value: string): this {
    this.raw(CMD.ALIGN_CENTER);
    const wrapped = wrapText(value, this.columns);
    for (const part of wrapped) {
      this.bytes.push(...this.encode(part), LF);
      this.lines.push(centerText(part, this.columns));
    }
    this.raw(CMD.ALIGN_LEFT);
    return this;
  }

  bold(value: string): this {
    this.raw(CMD.BOLD_ON);
    this.line(value);
    this.raw(CMD.BOLD_OFF);
    return this;
  }

  /** Large, centred — the order number a cook reads across the pass. */
  heading(value: string): this {
    this.raw(CMD.ALIGN_CENTER).raw(CMD.SIZE_DOUBLE).raw(CMD.BOLD_ON);
    this.bytes.push(...this.encode(value), LF);
    this.lines.push(centerText(value, this.columns));
    this.raw(CMD.BOLD_OFF).raw(CMD.SIZE_NORMAL).raw(CMD.ALIGN_LEFT);
    return this;
  }

  rule(char = '-'): this {
    const value = char.repeat(this.columns);
    this.bytes.push(...this.encode(value), LF);
    this.lines.push(value);
    return this;
  }

  /** Label on the left, value flush right, dots between — the classic
   *  receipt row. Falls back to two lines when it cannot fit. */
  columnsRow(left: string, right: string, filler = ' '): this {
    const gap = this.columns - left.length - right.length;
    if (gap < 1) {
      this.line(left);
      const padded = right.padStart(this.columns);
      this.bytes.push(...this.encode(padded), LF);
      this.lines.push(padded);
      return this;
    }
    const value = left + filler.repeat(gap) + right;
    this.bytes.push(...this.encode(value), LF);
    this.lines.push(value);
    return this;
  }

  cut(partial = false): this {
    // Feed first: the cutter sits above the print head, so cutting without
    // advancing slices through the last few lines.
    this.feed(4);
    return this.raw(partial ? CMD.CUT_PARTIAL : CMD.CUT_FULL);
  }

  kickDrawer(): this {
    return this.raw(CMD.DRAWER_KICK);
  }

  build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  preview(): string {
    return this.lines.join('\n');
  }
}

// --- text helpers -----------------------------------------------------

export function wrapText(value: string, columns: number): string[] {
  if (value === '') return [];

  const out: string[] = [];
  for (const paragraph of value.split('\n')) {
    if (paragraph === '') {
      out.push('');
      continue;
    }

    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (word.length > columns) {
        // A single unbreakable token longer than the paper: hard-split it
        // rather than letting the printer truncate silently.
        if (current) {
          out.push(current);
          current = '';
        }
        for (let i = 0; i < word.length; i += columns) {
          const chunk = word.slice(i, i + columns);
          if (chunk.length === columns) out.push(chunk);
          else current = chunk;
        }
        continue;
      }

      if (!current) current = word;
      else if (current.length + 1 + word.length <= columns) current += ` ${word}`;
      else {
        out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

export function centerText(value: string, columns: number): string {
  if (value.length >= columns) return value;
  return ' '.repeat(Math.floor((columns - value.length) / 2)) + value;
}
