import { describe, expect, it } from 'vitest';

import { normalizeTerm, normalizeTerms } from '../src/moderation/terms';
import { readRepoFile } from './fixtures';

describe('normalizeTerm', () => {
  it('lower-cases, trims and collapses whitespace', () => {
    expect(normalizeTerm('  White   POWER ')).toEqual({ ok: true, term: 'white power' });
    expect(normalizeTerm("Don't")).toEqual({ ok: true, term: "don't" });
  });

  it('rejects terms that cannot match on word boundaries', () => {
    expect(normalizeTerm('x').ok).toBe(false);
    expect(normalizeTerm('f*ck').ok).toBe(false);
    expect(normalizeTerm('-dash').ok).toBe(false);
    expect(normalizeTerm('a'.repeat(61)).ok).toBe(false);
  });

  it('dedupes and reports invalid input', () => {
    expect(normalizeTerms(['Foo', 'foo', ' FOO ', '!!'])).toEqual({ terms: ['foo'], errors: ['"!!" may contain letters, digits, spaces, apostrophes and hyphens, and must start and end with a letter or digit'] });
  });

  it('accepts every term seeded by 009_seed_moderation_terms.sql', () => {
    const sql = readRepoFile('supabase/migrations/009_seed_moderation_terms.sql');
    const terms = [...sql.matchAll(/\('([^']+)'\)/g)].map((match) => match[1]);
    expect(terms.length).toBeGreaterThan(50);
    for (const term of terms) {
      expect(normalizeTerm(term)).toEqual({ ok: true, term });
    }
    expect(new Set(terms).size).toBe(terms.length);
  });
});
