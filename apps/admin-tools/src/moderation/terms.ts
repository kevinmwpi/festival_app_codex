import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../env';

/**
 * public.moderation_terms holds whole-word, case-insensitive terms checked by
 * private.contains_disallowed_text() on display names, group names and meetup
 * titles/notes. Terms must start and end with a letter or digit because the
 * match is anchored on non-alphanumeric boundaries.
 */

const TERM_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}' -]*[\p{L}\p{N}])?$/u;
export const MAX_TERM_LENGTH = 60;

export type NormalizedTerm = { ok: true; term: string } | { ok: false; input: string; error: string };

export function normalizeTerm(input: string): NormalizedTerm {
  const term = input.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (term.length < 2) {
    return { ok: false, input, error: 'must be at least 2 characters' };
  }
  if (term.length > MAX_TERM_LENGTH) {
    return { ok: false, input, error: `must be at most ${MAX_TERM_LENGTH} characters` };
  }
  if (!TERM_PATTERN.test(term)) {
    return { ok: false, input, error: 'may contain letters, digits, spaces, apostrophes and hyphens, and must start and end with a letter or digit' };
  }
  return { ok: true, term };
}

export function normalizeTerms(inputs: string[]): { terms: string[]; errors: string[] } {
  const terms = new Set<string>();
  const errors: string[] = [];
  for (const input of inputs) {
    const result = normalizeTerm(input);
    if (result.ok) {
      terms.add(result.term);
    } else {
      errors.push(`"${result.input}" ${result.error}`);
    }
  }
  return { terms: [...terms].sort(), errors };
}

export async function listTerms(client: SupabaseClient): Promise<string[]> {
  const terms: string[] = [];
  for (let from = 0; ; from += 1000) {
    const page = check(
      await client.from('moderation_terms').select('term').order('term').range(from, from + 999),
      'Reading moderation terms',
    ) as Array<{ term: string }>;
    terms.push(...page.map((row) => row.term));
    if (page.length < 1000) {
      return terms;
    }
  }
}

export async function addTerms(client: SupabaseClient, terms: string[]): Promise<void> {
  check(
    await client.from('moderation_terms').upsert(terms.map((term) => ({ term })), { onConflict: 'term', ignoreDuplicates: true }),
    'Adding moderation terms',
  );
}

export async function removeTerms(client: SupabaseClient, terms: string[]): Promise<number> {
  const removed = check(
    await client.from('moderation_terms').delete().in('term', terms).select('term'),
    'Removing moderation terms',
  ) as Array<{ term: string }>;
  return removed.length;
}
