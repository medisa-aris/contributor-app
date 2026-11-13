import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes separators and neutralises formula prefixes', () => {
    const csv = toCsv(['Judul', 'Sumber'], [
      ['SOP, revisi "2"', '=HYPERLINK("x")'],
      [null, 'aman'],
    ]);
    expect(csv).toBe('Judul,Sumber\r\n"SOP, revisi ""2""","\'=HYPERLINK(""x"")"\r\n,aman');
  });
});
