import messages from '../../i18n/lib-import.ts';
import { translate } from '../../../../shared/i18n/core.ts';

/** A CSV file split into rows and cells, with the separator it uses. */
export interface CsvTable {
  delimiter: ',' | ';' | '\t';
  rows: string[][];
}

/**
 * Picks the separator that occurs most often outside quotes in the first line; a comma wins a tie.
 * @param text - The CSV text without byte order mark.
 */
function detectDelimiter(text: string): CsvTable['delimiter'] {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char in counts) counts[char as keyof typeof counts] += 1;
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[',']) return '\t';
  return ',';
}

/**
 * Splits CSV text into rows of cells as RFC 4180 describes: quoted cells may contain separators, line breaks and
 * doubled quotes. A byte order mark is removed, the separator (comma, semicolon or tab) is detected, and rows whose
 * cells are all empty are dropped.
 * @param text - The file content.
 */
export function parseCsv(text: string): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cellStarted = false;
  /** Ends the current cell. */
  const endCell = () => {
    row.push(cell);
    cell = '';
    cellStarted = false;
  };
  /** Ends the current row and keeps it unless all its cells are empty. */
  const endRow = () => {
    endCell();
    if (row.some(/**
     * Detects a cell with content.
     * @param value - One cell of the row.
     */ (value) => value !== '')) rows.push(row);
    row = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && !cellStarted) {
      quoted = true;
      cellStarted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      endRow();
    } else {
      cell += char;
      cellStarted = true;
    }
  }
  if (quoted) throw new Error(translate(messages, 'unclosedQuote'));
  if (cell !== '' || row.length) endRow();
  return { delimiter, rows };
}

/**
 * Quotes one cell for a CSV file, doubling quotes inside it.
 * @param value - The cell text.
 */
function quoteCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Writes rows as CSV text with every cell quoted, like KeePassXC does, and CRLF line ends as RFC 4180 asks.
 * @param rows - The rows, the header first.
 */
export function formatCsv(rows: readonly (readonly string[])[]): string {
  return rows.map(/**
   * Writes one row.
   * @param row - The cells of the row.
   */ (row) => row.map(quoteCell).join(',')).join('\r\n') + '\r\n';
}
