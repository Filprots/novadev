// Shared helpers in lib.ts that the derived-content writers stand on: fenced code, the prose a
// reader sees, the block locator, and folder listing that survives a file where a folder belongs.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  blockTrouble,
  fenceRanges,
  fencedLines,
  findBlock,
  isMarkerLine,
  listDirs,
  listFiles,
  proseLines,
  writeBlock,
} from '../src/lib.ts';
import { tempDir, write } from './helpers.ts';

const BEGIN = '<!-- novadev:x:begin -->';
const END = '<!-- novadev:x:end -->';
const spot = (text: string) => findBlock(text.split('\n'), 'x');

describe('fenced code', () => {
  test('marks fence lines and everything between them', () => {
    const lines = ['a', '```md', 'in', '```', 'b', '~~~~', 'in', '~~~', 'still in', '~~~~', 'c'];
    expect(fencedLines(lines)).toEqual([false, true, true, true, false, true, true, true, true, true, false]);
  });

  test('a closing fence must use the same character and be at least as long', () => {
    expect(fencedLines(['````', '```', '~~~~', '````', 'out'])).toEqual([true, true, true, true, false]);
  });

  test('"```x```" is inline code, not a fence; an unclosed fence runs to the end', () => {
    expect(fencedLines(['```x```', 'out'])).toEqual([false, false]);
    expect(fencedLines(['```', 'in', 'in'])).toEqual([true, true, true]);
  });

  test('a fence indented by four spaces is not a fence', () => {
    expect(fencedLines(['    ```', 'out'])).toEqual([false, false]);
  });

  test('fenceRanges says where each fence opens and closes — null when it never closes', () => {
    expect(fenceRanges(['a', '```md', 'in', '```', 'b', '~~~', 'in'])).toEqual([
      { open: 1, close: 3 },
      { open: 5, close: null },
    ]);
    // A markdown example with a fence inside it: the inner "```sh" cannot close the outer fence,
    // the inner closing line does, and the outer closing line opens a new fence that never closes.
    expect(fenceRanges(['```markdown', '```sh', 'x', '```', '```', 'text'])).toEqual([
      { open: 0, close: 3 },
      { open: 4, close: null },
    ]);
    expect(fenceRanges(['no', 'fences'])).toEqual([]);
  });
});

describe('the prose a reader sees', () => {
  const prose = (text: string) => proseLines(text.split('\n'));

  test('blanks fenced code and keeps the line count', () => {
    expect(prose('a\n```\ncode\n```\nb')).toEqual(['a', '', '', '', 'b']);
  });

  test('removes a comment on one line, and keeps the text around it', () => {
    expect(prose('keep <!-- gone --> this <!-- and gone -->')).toEqual(['keep  this ']);
  });

  test('a comment over several lines blanks them all, up to the text after "-->"', () => {
    expect(prose('<!--\n**Raise:** 1 → 2\n-->\nafter')).toEqual(['', '', '', 'after']);
    expect(prose('a <!-- starts here\nhidden\nends --> b\nc')).toEqual(['a ', '', ' b', 'c']);
  });

  test('a comment that never closes runs to the end only when it starts a line', () => {
    expect(prose('text\n<!-- never closed\nhidden\nhidden')).toEqual(['text', '', '', '']);
    // Mid-line, with no "-->" before the paragraph ends, "<!--" is plain text — as markdown shows it.
    expect(prose('Use `<!--` to start one.\n\nNext paragraph.')).toEqual(['Use `<!--` to start one.', '', 'Next paragraph.']);
  });

  test('a "<!--" inside fenced code is code, not a comment', () => {
    expect(prose('```\n<!--\n```\nafter')).toEqual(['', '', '', 'after']);
  });
});

describe('marker lines', () => {
  test('a marker counts on a line of its own, indented by at most three spaces', () => {
    expect(isMarkerLine('<!-- m -->', '<!-- m -->')).toBe(true);
    expect(isMarkerLine('   <!-- m -->  \r', '<!-- m -->')).toBe(true);
    expect(isMarkerLine('    <!-- m -->', '<!-- m -->')).toBe(false);
    expect(isMarkerLine('see `<!-- m -->`', '<!-- m -->')).toBe(false);
    expect(isMarkerLine('> <!-- m -->', '<!-- m -->')).toBe(false);
  });
});

describe('finding a block', () => {
  test('two marker lines, in order, make the block', () => {
    expect(spot(`# A\n\n${BEGIN}\nbody\n${END}\n`)).toEqual({ state: 'found', begin: 2, end: 4 });
    expect(spot(`  ${BEGIN}  \r\nbody\r\n${END}\r\n`)).toEqual({ state: 'found', begin: 0, end: 2 });
  });

  test('a marker quoted in a sentence or an inline code span is not a marker', () => {
    expect(spot(`Sync rewrites what follows \`${BEGIN}\`.\n`)).toEqual({ state: 'absent' });
    expect(spot(`Between \`${BEGIN}\` and \`${END}\`.\n`)).toEqual({ state: 'absent' });
    const quoted = `Text \`${BEGIN}\`.\n\n${BEGIN}\nold\n${END}\n`;
    expect(spot(quoted)).toEqual({ state: 'found', begin: 2, end: 4 });
  });

  test('markers in fenced code, in an indented code block, or in a quote are not markers', () => {
    expect(spot(`\`\`\`markdown\n${BEGIN}\nrows\n${END}\n\`\`\`\n`)).toEqual({ state: 'absent' });
    expect(spot(`    ${BEGIN}\n    rows\n    ${END}\n`)).toEqual({ state: 'absent' });
    expect(spot(`> ${BEGIN}\n> ${END}\n`)).toEqual({ state: 'absent' });
  });

  test('anything but one begin line then one end line is broken', () => {
    expect(spot(`${BEGIN}\n`)).toEqual({ state: 'broken', begins: 1, ends: 0 });
    expect(spot(`${END}\n`)).toEqual({ state: 'broken', begins: 0, ends: 1 });
    expect(spot(`${END}\n${BEGIN}\n`)).toEqual({ state: 'broken', begins: 1, ends: 1 });
    expect(spot(`${BEGIN}\n${BEGIN}\n${END}\n`)).toEqual({ state: 'broken', begins: 2, ends: 1 });
    expect(blockTrouble(`${BEGIN}\n${BEGIN}\n${END}\n`, 'x')).toContain('found 2 and 1');
    expect(blockTrouble('# A\n', 'x')).toBe(`missing ${BEGIN} … ${END} block`);
    expect(blockTrouble(`${BEGIN}\n${END}\n`, 'x')).toBeNull();
  });
});

describe('writing a block', () => {
  test('writes the same bytes the old writer did for whole-line markers', () => {
    const page = `# A\n\nIntro.\n\n${BEGIN}\nold\n${END}\n\nOutro.\n`;
    expect(writeBlock(page, 'x', '\nnew body\n')).toBe(`# A\n\nIntro.\n\n${BEGIN}\nnew body\n${END}\n\nOutro.\n`);
    expect(writeBlock(`${BEGIN}\n${END}`, 'x', '')).toBe(`${BEGIN}\n\n${END}`);
  });

  test('never writes into quoted markers, and refuses a broken block', () => {
    const quoted = `Use \`${BEGIN}\` … \`${END}\`.\n\nHand-written.\n`;
    expect(writeBlock(quoted, 'x', 'new')).toBeNull();
    expect(writeBlock(`${BEGIN}\nkeep me\n`, 'x', 'new')).toBeNull();
  });

  test('a CRLF file stays CRLF, and an up-to-date one comes back byte for byte', () => {
    const page = `# A\r\n\r\n${BEGIN}\r\nold\r\n${END}\r\n\r\nOutro.\r\n`;
    const next = writeBlock(page, 'x', 'new\nrows');
    expect(next).toBe(`# A\r\n\r\n${BEGIN}\r\nnew\r\nrows\r\n${END}\r\n\r\nOutro.\r\n`);
    expect(writeBlock(next!, 'x', 'new\nrows')).toBe(next);
    expect(blockTrouble(page, 'x')).toBeNull();
  });

  test('a quote above the real block survives a rewrite', () => {
    const page = `Note: \`${BEGIN}\`.\n\n## Mine\n\nHand-written.\n\n${BEGIN}\nold\n${END}\n`;
    expect(writeBlock(page, 'x', 'new')).toBe(`Note: \`${BEGIN}\`.\n\n## Mine\n\nHand-written.\n\n${BEGIN}\nnew\n${END}\n`);
  });
});

describe('listing a folder', () => {
  test('a file where a folder belongs lists as empty instead of crashing', () => {
    const root = tempDir();
    write(root, 'metrics', 'I am a file');
    expect(listDirs(join(root, 'metrics'))).toEqual([]);
    expect(listFiles(join(root, 'metrics'))).toEqual([]);
    expect(listDirs(join(root, 'missing'))).toEqual([]);
  });

  test('lists files and folders apart, sorted', () => {
    const root = tempDir();
    write(root, 'f/b.md', '');
    write(root, 'f/a.md', '');
    write(root, 'f/sub/x.md', '');
    expect(listFiles(join(root, 'f'))).toEqual(['a.md', 'b.md']);
    expect(listDirs(join(root, 'f'))).toEqual(['sub']);
  });
});
