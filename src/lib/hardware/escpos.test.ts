import { describe, expect, it } from 'vitest';
import {
  CMD,
  COLUMNS_58MM,
  COLUMNS_80MM,
  EscPosBuilder,
  centerText,
  wrapText,
} from './escpos';

/** Find a command sequence inside the byte stream. */
function indexOfSequence(bytes: Uint8Array, sequence: readonly number[]): number {
  outer: for (let i = 0; i <= bytes.length - sequence.length; i += 1) {
    for (let j = 0; j < sequence.length; j += 1) {
      if (bytes[i + j] !== sequence[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const contains = (bytes: Uint8Array, sequence: readonly number[]) =>
  indexOfSequence(bytes, sequence) !== -1;

const asText = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('ESC/POS command stream', () => {
  it('always begins with the initialise command', () => {
    const bytes = new EscPosBuilder().build();
    // ESC @ — without it the printer inherits whatever state the last job left.
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x1b, 0x40]);
  });

  it('emits text terminated by a line feed', () => {
    const bytes = new EscPosBuilder().line('HELLO').build();
    expect(asText(bytes)).toContain('HELLO\n');
  });

  it('wraps bold text in the emphasis on/off pair', () => {
    const bytes = new EscPosBuilder().bold('URGENT').build();
    const on = indexOfSequence(bytes, CMD.BOLD_ON);
    const off = indexOfSequence(bytes, CMD.BOLD_OFF);
    const text = asText(bytes).indexOf('URGENT');

    expect(on).toBeGreaterThan(-1);
    expect(on).toBeLessThan(text);
    expect(off).toBeGreaterThan(text);
  });

  it('restores alignment and size after a heading', () => {
    const bytes = new EscPosBuilder().heading('#0042').build();
    expect(contains(bytes, CMD.ALIGN_CENTER)).toBe(true);
    expect(contains(bytes, CMD.SIZE_DOUBLE)).toBe(true);
    // Leaving the printer in double-size would corrupt every later line.
    expect(contains(bytes, CMD.SIZE_NORMAL)).toBe(true);
    expect(contains(bytes, CMD.ALIGN_LEFT)).toBe(true);
  });

  it('emits GS V 0 for a full cut', () => {
    const bytes = new EscPosBuilder().cut().build();
    expect(contains(bytes, [0x1d, 0x56, 0x00])).toBe(true);
  });

  it('emits GS V 1 for a partial cut', () => {
    const bytes = new EscPosBuilder().cut(true).build();
    expect(contains(bytes, [0x1d, 0x56, 0x01])).toBe(true);
  });

  it('feeds paper before cutting', () => {
    // The cutter sits above the print head: cutting without advancing
    // slices through the last lines of the ticket.
    const bytes = new EscPosBuilder().line('LAST LINE').cut().build();
    const cut = indexOfSequence(bytes, CMD.CUT_FULL);
    const feeds = Array.from(bytes.slice(0, cut)).filter((b) => b === 0x0a).length;
    expect(feeds).toBeGreaterThanOrEqual(4);
  });

  it('emits DLE DC4 1 1 1 for the drawer kick', () => {
    const bytes = new EscPosBuilder().kickDrawer().build();
    expect(contains(bytes, [0x10, 0x14, 0x01, 0x01, 0x01])).toBe(true);
  });

  it('transliterates characters a thermal printer cannot render', () => {
    // A raw multi-byte sequence prints as garbage and can desynchronise the
    // command parser, so accents are stripped and the rest becomes '?'.
    const bytes = new EscPosBuilder().line('Jalapeño Piñata — 世界').build();
    const text = asText(bytes);

    expect(text).toContain('Jalapeno');
    expect(text).toContain('Pinata');
    expect(Array.from(bytes).every((byte) => byte <= 0x7e)).toBe(true);
  });

  it('produces a text preview alongside the bytes', () => {
    const builder = new EscPosBuilder(COLUMNS_58MM).line('ITEM').columnsRow('Total', '$21.00');
    expect(builder.preview().split('\n')).toEqual(['ITEM', expect.stringContaining('$21.00')]);
  });
});

describe('column rows', () => {
  it('pushes the value flush right at 80mm', () => {
    const row = new EscPosBuilder(COLUMNS_80MM).columnsRow('TOTAL', '$21.00').preview();
    expect(row).toHaveLength(COLUMNS_80MM);
    expect(row.startsWith('TOTAL')).toBe(true);
    expect(row.endsWith('$21.00')).toBe(true);
  });

  it('falls back to two lines when the row cannot fit', () => {
    const long = 'A very long menu item name that will not fit beside a price';
    const preview = new EscPosBuilder(COLUMNS_58MM).columnsRow(long, '$100.00').preview();
    const lines = preview.split('\n');

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[lines.length - 1].trimStart()).toBe('$100.00');
    // The price must never be truncated or overlapped by the name.
    expect(lines.every((line) => line.length <= COLUMNS_58MM)).toBe(true);
  });
});

describe('wrapText', () => {
  it('breaks on word boundaries within the paper width', () => {
    expect(wrapText('one two three four five six', 12)).toEqual([
      'one two',
      'three four',
      'five six',
    ]);
  });

  it('hard-splits a token longer than the paper', () => {
    // Truncating here would silently drop part of a customer note.
    const lines = wrapText('X'.repeat(20), 8);
    expect(lines.join('')).toBe('X'.repeat(20));
    expect(lines.every((line) => line.length <= 8)).toBe(true);
  });

  it('preserves explicit blank lines', () => {
    expect(wrapText('a\n\nb', 10)).toEqual(['a', '', 'b']);
  });

  it('returns nothing for an empty string', () => {
    expect(wrapText('', 32)).toEqual([]);
  });
});

describe('centerText', () => {
  it('centres within the paper width', () => {
    expect(centerText('AB', 10)).toBe('    AB');
  });

  it('leaves an over-long value alone', () => {
    expect(centerText('ABCDEFGHIJK', 4)).toBe('ABCDEFGHIJK');
  });
});
