import { describe, it, expect } from 'vitest';
import { slugOf } from './ids';

describe('slugOf', () => {
  it('spells an umlaut out rather than dropping the letter', () => {
    // "Depot-Übersicht" was saved as depot-_bersicht.
    expect(slugOf('Depot-Übersicht')).toBe('depot-uebersicht');
    expect(slugOf('Größe & Maße')).toBe('groesse_masse');
  });

  it('drops other accents, and is empty when nothing is left', () => {
    expect(slugOf('Café crème')).toBe('cafe_creme');
    expect(slugOf('!!!')).toBe('');
  });
});
