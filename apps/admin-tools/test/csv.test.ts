import { describe, expect, it } from 'vitest';

import { CsvError, parseCsv, parseCsvRecords } from '../src/lib/csv';

describe('parseCsv', () => {
  it('parses quoted fields, escaped quotes, CRLF and embedded newlines', () => {
    const rows = parseCsv('﻿name,notes\r\n"Smith, J","He said ""hi""\nthen left"\r\nplain,\n\n', 'x.csv');
    expect(rows).toEqual([
      { line: 1, fields: ['name', 'notes'] },
      { line: 2, fields: ['Smith, J', 'He said "hi"\nthen left'] },
      { line: 4, fields: ['plain', ''] },
    ]);
  });

  it('handles a final row without a newline and empty quoted fields', () => {
    expect(parseCsv('a,b\n"",x', 'x.csv')).toEqual([
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['', 'x'] },
    ]);
  });

  it('rejects unterminated quotes and stray quotes', () => {
    expect(() => parseCsv('a\n"open', 'x.csv')).toThrow(CsvError);
    expect(() => parseCsv('a\nab"c', 'x.csv')).toThrow(/quote inside an unquoted field/);
    expect(() => parseCsv('a\n"ab"c', 'x.csv')).toThrow(/after closing quote/);
  });
});

describe('parseCsvRecords', () => {
  const schema = { required: ['name'], optional: ['genre'] } as const;

  it('maps rows by lower-cased header and trims values', () => {
    expect(parseCsvRecords('Name , GENRE\n Kestrel Bay , Folk \n', 'artists.csv', schema)).toEqual([
      { line: 2, values: { name: 'Kestrel Bay', genre: 'Folk' } },
    ]);
  });

  it('rejects unknown, duplicate and missing columns and ragged rows', () => {
    expect(() => parseCsvRecords('name,image_url\nx,y', 'artists.csv', schema)).toThrow(/unknown column "image_url"/);
    expect(() => parseCsvRecords('name,name\nx,y', 'artists.csv', schema)).toThrow(/duplicate column/);
    expect(() => parseCsvRecords('genre\nFolk', 'artists.csv', schema)).toThrow(/missing required column "name"/);
    expect(() => parseCsvRecords('name,genre\nx', 'artists.csv', schema)).toThrow(/artists.csv:2: expected 2 fields/);
    expect(() => parseCsvRecords('', 'artists.csv', schema)).toThrow(/empty/);
  });
});
