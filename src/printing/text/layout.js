// Column primitives for the ESC/POS text documents (KTD8). Pure string work on
// a fixed character grid: every function returns lines that are at most
// `width` characters long, so the encoder never has to wrap on its own and the
// output can be asserted without a printer. The grid is Font A (12 dots wide),
// which gives 48 columns on 80mm (576 dots) and 32 on 58mm (384 dots).

const COLUMNS = { '80mm': 48, '58mm': 32 };

export function columnsFor(paper) {
  return COLUMNS[paper] || COLUMNS['80mm'];
}

/** Word-wraps `text` to `width`, hard-splitting words longer than a line. */
export function wrap(text, width) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (let word of words) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Left text and right text on one row, the right one ending at the last column.
 * When the left text does not fit next to the right one it wraps, and the right
 * text goes on the last line of the wrap (or on its own line if even that last
 * line leaves no room).
 */
export function twoColumns(left, right, width) {
  const rightText = String(right ?? '');
  const room = width - rightText.length - 1;
  const lines = wrap(left, room > 0 ? room : width);
  if (lines.length === 0) lines.push('');
  const last = lines[lines.length - 1];
  if (last.length + 1 + rightText.length <= width) {
    lines[lines.length - 1] = last + ' '.repeat(width - last.length - rightText.length) + rightText;
  } else {
    lines.push(' '.repeat(Math.max(0, width - rightText.length)) + rightText);
  }
  return lines;
}

export function center(text, width) {
  const s = String(text ?? '');
  if (s.length >= width) return s;
  return ' '.repeat(Math.floor((width - s.length) / 2)) + s;
}

export function rule(width, char = '-') {
  return char.repeat(width);
}
