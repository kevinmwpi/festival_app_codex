/**
 * RFC 4180 CSV parsing (quoted fields, escaped quotes, CRLF, embedded
 * newlines, UTF-8 BOM). Kept dependency-free on purpose.
 */

export class CsvError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line: number,
  ) {
    super(`${file}:${line}: ${message}`);
    this.name = 'CsvError';
  }
}

export interface CsvRow {
  /** 1-based physical line where the record starts. */
  line: number;
  fields: string[];
}

export function parseCsv(text: string, file = 'input.csv'): CsvRow[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let line = 1;
  let rowStartLine = 1;
  let index = 0;

  const endField = () => {
    fields.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    const isBlank = fields.length === 1 && fields[0] === '';
    if (!isBlank) {
      rows.push({ line: rowStartLine, fields });
    }
    fields = [];
  };

  while (index < input.length) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        const next = input[index];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          throw new CsvError('unexpected character after closing quote', file, line);
        }
        continue;
      }
      if (char === '\n') {
        line += 1;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      if (field !== '' || fieldWasQuoted) {
        throw new CsvError('quote inside an unquoted field (wrap the field in quotes and double inner quotes)', file, line);
      }
      inQuotes = true;
      fieldWasQuoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      endRow();
      if (char === '\r' && input[index + 1] === '\n') {
        index += 1;
      }
      index += 1;
      line += 1;
      rowStartLine = line;
      continue;
    }
    field += char;
    index += 1;
  }

  if (inQuotes) {
    throw new CsvError('unterminated quoted field', file, rowStartLine);
  }
  if (field !== '' || fieldWasQuoted || fields.length > 0) {
    endRow();
  }
  return rows;
}

export interface CsvRecord {
  line: number;
  values: Record<string, string>;
}

export interface CsvSchema {
  required: readonly string[];
  optional: readonly string[];
}

/**
 * Parses a CSV with a header row into records keyed by lower-cased header.
 * Unknown or missing columns and ragged rows are errors. Values are trimmed.
 */
export function parseCsvRecords(text: string, file: string, schema: CsvSchema): CsvRecord[] {
  const rows = parseCsv(text, file);
  if (rows.length === 0) {
    throw new CsvError('file is empty (a header row is required)', file, 1);
  }
  const header = rows[0].fields.map((name) => name.trim().toLowerCase());
  const known = new Set([...schema.required, ...schema.optional]);

  const seen = new Set<string>();
  for (const name of header) {
    if (!known.has(name)) {
      throw new CsvError(
        `unknown column "${name}" (allowed: ${[...schema.required, ...schema.optional].join(', ')})`,
        file,
        rows[0].line,
      );
    }
    if (seen.has(name)) {
      throw new CsvError(`duplicate column "${name}"`, file, rows[0].line);
    }
    seen.add(name);
  }
  for (const name of schema.required) {
    if (!seen.has(name)) {
      throw new CsvError(`missing required column "${name}"`, file, rows[0].line);
    }
  }

  return rows.slice(1).map((row) => {
    if (row.fields.length !== header.length) {
      throw new CsvError(`expected ${header.length} fields, found ${row.fields.length}`, file, row.line);
    }
    const values: Record<string, string> = {};
    header.forEach((name, column) => {
      values[name] = row.fields[column].trim();
    });
    return { line: row.line, values };
  });
}
