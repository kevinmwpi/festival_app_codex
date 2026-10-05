import { DataAccessError, toDataAccessError } from './errors';

/**
 * Rows requested per page. Matches PostgREST's `max_rows` (1000 in `supabase/config.toml` and on hosted
 * Supabase); correctness does not depend on it, because completeness is checked against an exact count.
 */
export const PAGE_SIZE = 1000;
/** Ids per `in.(…)` filter, keeping request URLs well under proxy limits. */
export const IN_FILTER_CHUNK_SIZE = 150;
const MAX_SNAPSHOT_ATTEMPTS = 3;

export interface PageResult {
  data: unknown;
  error: unknown;
  status?: number;
  count?: number | null;
}

/** A filtered, ordered query that `selectAllRows` can page through. */
export interface RangeableQuery {
  range(from: number, to: number): PromiseLike<PageResult>;
}

/**
 * Builds a fresh query for one page. Pass `options` to `select(columns, options)` (it requests an exact
 * count) and order by a unique key (e.g. `.order('id')`) so pages never overlap or skip rows.
 */
export type PageQueryBuilder = (options: { count: 'exact' }) => RangeableQuery;

function readPage(result: PageResult): { rows: unknown[]; count: number | null } {
  if (result.error) {
    throw toDataAccessError(result.error as Error, result.status ?? null);
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  return { rows, count: typeof result.count === 'number' && Number.isFinite(result.count) ? result.count : null };
}

/**
 * Reads every row a query matches. PostgREST silently caps each response at `max_rows`, and refreshes
 * treat what they fetch as the complete server state (rows missing from it are deleted locally), so an
 * unbounded read must never be issued as a single request.
 *
 * Each page asks for an exact count. Paging stops once that many rows are collected (one request for
 * the usual small result). Without a count it continues until an empty page. If the count changes
 * between pages the snapshot is inconsistent, so paging restarts; after repeated changes it throws a
 * retryable `DataAccessError` (`result_changed`, status 503) rather than return a partial result.
 */
export async function selectAllRows<T>(build: PageQueryBuilder, pageSize: number = PAGE_SIZE): Promise<T[]> {
  for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const rows: unknown[] = [];
    let expected: number | null | undefined;
    let consistent = true;

    for (;;) {
      const page = readPage(await build({ count: 'exact' }).range(rows.length, rows.length + pageSize - 1));
      if (expected === undefined) {
        expected = page.count;
      } else if (page.count !== expected) {
        consistent = false;
        break;
      }

      rows.push(...page.rows);
      if (page.rows.length === 0 || (expected !== null && rows.length >= expected)) {
        break;
      }
    }

    if (consistent && (expected === null || expected === undefined || rows.length === expected)) {
      return rows as T[];
    }
  }

  throw new DataAccessError('The data changed while it was loading. Try again.', { code: 'result_changed', status: 503 });
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * `selectAllRows` for a query filtered with `in(column, ids)`: ids are split into chunks of
 * `IN_FILTER_CHUNK_SIZE` and each chunk is paged completely. Resolves `[]` without a request for no ids.
 */
export async function selectAllRowsIn<T>(
  ids: readonly string[],
  build: (idsChunk: string[], options: { count: 'exact' }) => RangeableQuery,
): Promise<T[]> {
  const rows: T[] = [];
  for (const idsChunk of chunk([...new Set(ids)], IN_FILTER_CHUNK_SIZE)) {
    rows.push(...(await selectAllRows<T>((options) => build(idsChunk, options))));
  }
  return rows;
}
