import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../env';

export const TOTEMS_BUCKET = 'totems';
/** Storage's `remove()` accepts at most 1000 paths per call. */
export const REMOVE_BATCH_SIZE = 1000;
/**
 * Requested page size for storage listings and the meetups scan. The server may return fewer
 * rows per page (PostgREST `max_rows` is configured per project), so the reference scan never
 * treats a short page as the end; see `listReferencedTotemPaths`.
 */
export const PAGE_SIZE = 1000;
/**
 * Objects younger than this are never swept. The app uploads a photo first and sets
 * `meetups.totem_path` a moment later, so a fresh object may not be referenced yet.
 */
export const MIN_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
/** How many orphan paths a plan prints before summarising the rest. */
const LISTED_ORPHANS = 100;

export interface BucketObject {
  /** Full path inside the bucket, e.g. `<group_id>/<meetup_id>/<uuid>.jpg`. */
  path: string;
  createdAt: string | null;
  size: number | null;
}

export interface OrphanSweepPlan {
  bucket: string;
  total: number;
  referenced: number;
  /** Unreferenced but younger than the minimum age (or of unknown age): kept. */
  recent: number;
  orphans: BucketObject[];
  orphanBytes: number;
  /** Orphan paths in `remove()` batches of at most 1000. */
  batches: string[][];
  minAgeMs: number;
}

/**
 * Pure planning: every object whose path is not a `meetups.totem_path` and that is older than
 * `minAgeMs` is an orphan. Objects without a parseable creation time are kept. Paths are
 * de-duplicated and the result is sorted by path.
 */
export function planOrphanSweep(
  objects: readonly BucketObject[],
  referencedPaths: Iterable<string>,
  now: Date,
  options: { bucket?: string; minAgeMs?: number; batchSize?: number } = {},
): OrphanSweepPlan {
  const bucket = options.bucket ?? TOTEMS_BUCKET;
  const minAgeMs = options.minAgeMs ?? MIN_ORPHAN_AGE_MS;
  const batchSize = options.batchSize ?? REMOVE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > REMOVE_BATCH_SIZE) {
    throw new RangeError(`batchSize must be an integer between 1 and ${REMOVE_BATCH_SIZE}`);
  }

  const referenced = new Set(referencedPaths);
  const unique = new Map<string, BucketObject>();
  for (const object of objects) {
    if (!unique.has(object.path)) {
      unique.set(object.path, object);
    }
  }

  const cutoff = now.getTime() - minAgeMs;
  let referencedCount = 0;
  let recent = 0;
  const orphans: BucketObject[] = [];
  for (const object of [...unique.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (referenced.has(object.path)) {
      referencedCount += 1;
      continue;
    }
    const created = object.createdAt ? Date.parse(object.createdAt) : Number.NaN;
    if (Number.isNaN(created) || created > cutoff) {
      recent += 1;
      continue;
    }
    orphans.push(object);
  }

  const batches: string[][] = [];
  for (let index = 0; index < orphans.length; index += batchSize) {
    batches.push(orphans.slice(index, index + batchSize).map((object) => object.path));
  }

  return {
    bucket,
    total: unique.size,
    referenced: referencedCount,
    recent,
    orphans,
    orphanBytes: orphans.reduce((sum, object) => sum + (object.size ?? 0), 0),
    batches,
    minAgeMs,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function describeSweepPlan(plan: OrphanSweepPlan): string {
  const hours = Math.round(plan.minAgeMs / (60 * 60 * 1000));
  const lines = [
    `Bucket "${plan.bucket}": ${plan.total} object(s)`,
    `  - ${plan.referenced} referenced by a meetup (kept)`,
    `  - ${plan.recent} unreferenced but newer than ${hours} h or of unknown age (kept)`,
    `  - ${plan.orphans.length} orphaned (${formatBytes(plan.orphanBytes)}): delete in ${plan.batches.length} batch(es) of <= ${REMOVE_BATCH_SIZE}`,
  ];
  for (const object of plan.orphans.slice(0, LISTED_ORPHANS)) {
    lines.push(`      ${object.path}${object.createdAt ? `  (created ${object.createdAt})` : ''}`);
  }
  if (plan.orphans.length > LISTED_ORPHANS) {
    lines.push(`      … and ${plan.orphans.length - LISTED_ORPHANS} more`);
  }
  return lines.join('\n');
}

/** One `storage.from(bucket).list(prefix)` page; folder entries have `id === null`. */
export interface StorageListEntry {
  name: string;
  id: string | null;
  created_at: string | null;
  metadata: { size?: unknown } | null;
}

export type ListPage = (prefix: string, offset: number, limit: number) => Promise<StorageListEntry[]>;

/**
 * Walks the whole bucket depth-first (storage lists one folder level at a time), paging every
 * folder with `limit`/`offset` until a short page. Works for any folder depth.
 */
export async function listAllObjects(listPage: ListPage, pageSize = PAGE_SIZE): Promise<BucketObject[]> {
  const objects: BucketObject[] = [];
  const folders = [''];
  while (folders.length > 0) {
    const prefix = folders.pop() as string;
    for (let offset = 0; ; offset += pageSize) {
      const page = await listPage(prefix, offset, pageSize);
      for (const entry of page) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) {
          folders.push(path);
        } else {
          const size = Number(entry.metadata?.size);
          objects.push({ path, createdAt: entry.created_at, size: Number.isFinite(size) ? size : null });
        }
      }
      if (page.length < pageSize) {
        break;
      }
    }
  }
  return objects;
}

export function storageListPage(client: SupabaseClient, bucket: string): ListPage {
  return async (prefix, offset, limit) => {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      throw new Error(`Listing ${bucket}/${prefix} failed: ${error.message}`);
    }
    return data as StorageListEntry[];
  };
}

/**
 * Every non-null `meetups.totem_path`. Keyset pagination on `id`, so rows deleted or inserted
 * while paging never shift a page and hide a referenced path.
 *
 * The scan ends only on an EMPTY page, never on a short one: a missed reference would get a live
 * photo deleted, and the project's PostgREST `max_rows` may silently cap a page below
 * `pageSize`. With keyset paging the extra request is one cheap index probe.
 */
export async function listReferencedTotemPaths(client: SupabaseClient, pageSize = PAGE_SIZE): Promise<Set<string>> {
  const paths = new Set<string>();
  let lastId: string | null = null;
  for (;;) {
    let query = client
      .from('meetups')
      .select('id, totem_path')
      .not('totem_path', 'is', null)
      .order('id', { ascending: true })
      .limit(pageSize);
    if (lastId) {
      query = query.gt('id', lastId);
    }
    const rows = check(await query, 'Reading meetup photo paths') as Array<{ id: string; totem_path: string | null }>;
    if (rows.length === 0) {
      return paths;
    }
    for (const row of rows) {
      if (row.totem_path) {
        paths.add(row.totem_path);
      }
    }
    const nextId = rows[rows.length - 1].id;
    if (lastId !== null && nextId <= lastId) {
      // Keyset order broken (would loop forever or skip rows): refuse to plan a deletion.
      throw new Error('Reading meetup photo paths: rows are not ordered by id; aborting the sweep.');
    }
    lastId = nextId;
  }
}

export async function planBucketSweep(client: SupabaseClient, now = new Date()): Promise<OrphanSweepPlan> {
  // References are read after the listing: a photo set on a meetup meanwhile is either referenced
  // here or younger than the minimum age, so it is never planned for deletion.
  const objects = await listAllObjects(storageListPage(client, TOTEMS_BUCKET));
  const referenced = await listReferencedTotemPaths(client);
  return planOrphanSweep(objects, referenced, now);
}

export async function applySweep(
  client: SupabaseClient,
  plan: OrphanSweepPlan,
  log: (line: string) => void,
): Promise<number> {
  let removed = 0;
  for (const [index, batch] of plan.batches.entries()) {
    const { data, error } = await client.storage.from(plan.bucket).remove(batch);
    if (error) {
      throw new Error(`Deleting batch ${index + 1}/${plan.batches.length} failed after ${removed} object(s): ${error.message}`);
    }
    removed += data?.length ?? 0;
    log(`Deleted batch ${index + 1}/${plan.batches.length} (${data?.length ?? 0} of ${batch.length} object(s)).`);
  }
  return removed;
}
