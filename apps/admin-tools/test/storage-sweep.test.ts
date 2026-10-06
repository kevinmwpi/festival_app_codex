import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/cli';
import {
  applySweep,
  type BucketObject,
  describeSweepPlan,
  listAllObjects,
  listReferencedTotemPaths,
  listReportedTotemPaths,
  MIN_ORPHAN_AGE_MS,
  planBucketSweep,
  planOrphanSweep,
  type StorageListEntry,
} from '../src/storage/sweep-orphans';

const NOW = new Date('2026-10-05T12:00:00Z');
const OLD = '2026-10-01T08:00:00Z';
const FRESH = '2026-10-05T11:30:00Z';
const G = '6f1d2c3b-0000-4000-8000-000000000001';
const M1 = '6f1d2c3b-0000-4000-8000-0000000000a1';
const M2 = '6f1d2c3b-0000-4000-8000-0000000000a2';

function object(path: string, createdAt: string | null = OLD, size: number | null = 1000): BucketObject {
  return { path, createdAt, size };
}

describe('planOrphanSweep', () => {
  it('keeps referenced and recent objects and plans the rest', () => {
    const plan = planOrphanSweep(
      [
        object(`${G}/${M1}/live.jpg`),
        object(`${G}/${M1}/replaced.jpg`, OLD, 2048),
        object(`${G}/${M2}/deleted-meetup.jpg`, OLD, 4096),
        object(`${G}/${M2}/just-uploaded.jpg`, FRESH),
        object('legacy-root.jpg', OLD, null),
      ],
      [`${G}/${M1}/live.jpg`, `${G}/unrelated/path.jpg`],
      NOW,
    );
    expect(plan.total).toBe(5);
    expect(plan.referenced).toBe(1);
    expect(plan.recent).toBe(1);
    expect(plan.orphans.map((entry) => entry.path)).toEqual([
      `${G}/${M1}/replaced.jpg`,
      `${G}/${M2}/deleted-meetup.jpg`,
      'legacy-root.jpg',
    ]);
    expect(plan.orphanBytes).toBe(6144);
    expect(plan.batches).toEqual([plan.orphans.map((entry) => entry.path)]);
    expect(plan.bucket).toBe('totems');
  });

  it('never deletes objects of unknown age and respects the age boundary', () => {
    const boundary = new Date(NOW.getTime() - MIN_ORPHAN_AGE_MS).toISOString();
    const justOlder = new Date(NOW.getTime() - MIN_ORPHAN_AGE_MS - 1).toISOString();
    const plan = planOrphanSweep(
      [object('a.jpg', null), object('b.jpg', 'not a date'), object('c.jpg', boundary), object('d.jpg', justOlder)],
      [],
      NOW,
    );
    expect(plan.recent).toBe(2);
    expect(plan.orphans.map((entry) => entry.path)).toEqual(['c.jpg', 'd.jpg']);
  });

  it('batches deletions in chunks of at most 1000 and de-duplicates paths', () => {
    const objects = Array.from({ length: 2345 }, (_, index) => object(`${G}/${M1}/${String(index).padStart(5, '0')}.jpg`));
    const plan = planOrphanSweep([...objects, objects[0]], [], NOW);
    expect(plan.total).toBe(2345);
    expect(plan.batches.map((batch) => batch.length)).toEqual([1000, 1000, 345]);
    expect(plan.batches.flat()).toEqual(objects.map((entry) => entry.path));
    expect(() => planOrphanSweep(objects, [], NOW, { batchSize: 1001 })).toThrow(RangeError);
  });

  it('plans nothing for an empty or fully referenced bucket', () => {
    expect(planOrphanSweep([], [], NOW).batches).toEqual([]);
    const plan = planOrphanSweep([object('x.jpg')], ['x.jpg'], NOW);
    expect(plan.orphans).toEqual([]);
    expect(describeSweepPlan(plan)).toContain('0 orphaned (0 B): delete in 0 batch(es)');
  });

  it('describes the plan and caps the listed paths', () => {
    const objects = Array.from({ length: 105 }, (_, index) => object(`${G}/${M1}/${String(index).padStart(3, '0')}.jpg`, OLD, 1024 * 1024));
    const text = describeSweepPlan(planOrphanSweep(objects, [], NOW));
    expect(text).toContain('Bucket "totems": 105 object(s)');
    expect(text).toContain('105 orphaned (105.0 MiB): delete in 1 batch(es) of <= 1000');
    expect(text).toContain('newer than 24 h');
    expect(text).toContain(`${G}/${M1}/099.jpg`);
    expect(text).not.toContain(`${G}/${M1}/100.jpg`);
    expect(text).toContain('… and 5 more');
  });
});

describe('listAllObjects', () => {
  const file = (name: string, size = 10): StorageListEntry => ({ name, id: `id-${name}`, created_at: OLD, metadata: { size } });
  const folder = (name: string): StorageListEntry => ({ name, id: null, created_at: null, metadata: null });

  it('walks every folder level and pages each folder until a short page', async () => {
    const tree: Record<string, StorageListEntry[]> = {
      '': [folder(G), file('root.jpg')],
      [G]: [folder(M1), folder(M2)],
      [`${G}/${M1}`]: [file('a.jpg'), file('b.jpg'), file('c.jpg'), file('d.jpg'), file('e.jpg')],
      [`${G}/${M2}`]: [file('f.jpg', Number.NaN)],
    };
    const calls: string[] = [];
    const objects = await listAllObjects(async (prefix, offset, limit) => {
      calls.push(`${prefix}@${offset}`);
      return (tree[prefix] ?? []).slice(offset, offset + limit);
    }, 2);

    expect(objects.map((entry) => entry.path).sort()).toEqual([
      `${G}/${M1}/a.jpg`,
      `${G}/${M1}/b.jpg`,
      `${G}/${M1}/c.jpg`,
      `${G}/${M1}/d.jpg`,
      `${G}/${M1}/e.jpg`,
      `${G}/${M2}/f.jpg`,
      'root.jpg',
    ]);
    expect(objects.find((entry) => entry.path === 'root.jpg')).toEqual({ path: 'root.jpg', createdAt: OLD, size: 10 });
    expect(objects.find((entry) => entry.path.endsWith('f.jpg'))?.size).toBeNull();
    // 5 files at page size 2 → offsets 0, 2, 4; full pages at the root/group level fetch one more.
    expect(calls.filter((call) => call.startsWith(`${G}/${M1}@`))).toEqual([`${G}/${M1}@0`, `${G}/${M1}@2`, `${G}/${M1}@4`]);
    expect(calls.filter((call) => call.startsWith(`${G}@`))).toEqual([`${G}@0`, `${G}@2`]);
  });
});

/** Minimal PostgREST query-builder fake for the meetups keyset scan. */
function fakeMeetupsClient(rows: Array<{ id: string; totem_path: string | null }>, serverMaxRows = Number.POSITIVE_INFINITY) {
  const queries: Array<{ gt: string | null; limit: number }> = [];
  const client = {
    from(table: string) {
      expect(table).toBe('meetups');
      const state = { gt: null as string | null, limit: 1000 };
      const builder = {
        select: () => builder,
        not: (column: string, op: string, value: null) => {
          expect([column, op, value]).toEqual(['totem_path', 'is', null]);
          return builder;
        },
        order: () => builder,
        limit: (limit: number) => {
          state.limit = limit;
          return builder;
        },
        gt: (column: string, value: string) => {
          expect(column).toBe('id');
          state.gt = value;
          return builder;
        },
        then: (resolve: (value: unknown) => void) => {
          queries.push({ ...state });
          const data = rows
            .filter((row) => row.totem_path !== null && (state.gt === null || row.id > state.gt))
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .slice(0, Math.min(state.limit, serverMaxRows));
          resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

describe('listReferencedTotemPaths', () => {
  it('reads every referenced path with keyset pagination', async () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      totem_path: index === 3 ? null : `${G}/m${index}/p.jpg`,
    }));
    const { client, queries } = fakeMeetupsClient(rows);
    const paths = await listReferencedTotemPaths(client, 2);
    expect([...paths].sort()).toEqual(rows.filter((row) => row.totem_path).map((row) => row.totem_path).sort());
    // Six referenced rows at page size 2: three full pages, then an empty one ends the scan.
    expect(queries.map((query) => query.gt)).toEqual([null, rows[1].id, rows[4].id, rows[6].id]);
  });

  it('keeps paging past short pages when the server caps max_rows below the page size', async () => {
    const rows = Array.from({ length: 1234 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      totem_path: `${G}/m${index}/p.jpg`,
    }));
    const { client, queries } = fakeMeetupsClient(rows, 500);
    const paths = await listReferencedTotemPaths(client);
    expect(paths.size).toBe(1234);
    expect(paths.has(`${G}/m1233/p.jpg`)).toBe(true);
    // 500 + 500 + 234, then an empty page ends the scan; every request asked for 1000.
    expect(queries.map((query) => query.gt)).toEqual([null, rows[499].id, rows[999].id, rows[1233].id]);
    expect(queries.every((query) => query.limit === 1000)).toBe(true);
  });

  it('aborts instead of planning deletions when the keyset order is broken', async () => {
    const page = [{ id: 'b', totem_path: 'x.jpg' }];
    const client = {
      from: () => {
        const builder = {
          select: () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          gt: () => builder,
          then: (resolve: (value: unknown) => void) => resolve({ data: page, error: null }),
        };
        return builder;
      },
    } as unknown as SupabaseClient;
    await expect(listReferencedTotemPaths(client)).rejects.toThrow('not ordered by id');
  });

  it('fails the scan on a query error', async () => {
    const client = {
      from: () => {
        const builder = {
          select: () => builder,
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          gt: () => builder,
          then: (resolve: (value: unknown) => void) => resolve({ data: null, error: { message: 'timeout' } }),
        };
        return builder;
      },
    } as unknown as SupabaseClient;
    await expect(listReferencedTotemPaths(client)).rejects.toThrow('Reading meetup photo paths failed: timeout');
  });
});

describe('listReportedTotemPaths and planBucketSweep', () => {
  /** Serves `meetups` and `reports` keyset scans plus a one-folder storage listing. */
  function fakeSweepClient(options: {
    files: StorageListEntry[];
    meetups: Array<{ id: string; totem_path: string | null }>;
    reports: Array<{ id: string; target_snapshot: string | null }>;
  }) {
    const filters: string[][] = [];
    const client = {
      storage: {
        from: () => ({
          list: async (prefix: string, { offset }: { offset: number }) => {
            if (offset > 0) {
              return { data: [], error: null };
            }
            if (prefix === '') {
              return { data: [{ name: G, id: null, created_at: null, metadata: null }], error: null };
            }
            if (prefix === G) {
              return { data: [{ name: M1, id: null, created_at: null, metadata: null }], error: null };
            }
            return { data: options.files, error: null };
          },
        }),
      },
      from(table: string) {
        const applied: string[] = [];
        filters.push(applied);
        let gt: string | null = null;
        const builder = {
          select: () => builder,
          eq: (column: string, value: string) => {
            applied.push(`${column}=${value}`);
            return builder;
          },
          in: (column: string, values: string[]) => {
            applied.push(`${column} in ${values.join(',')}`);
            return builder;
          },
          not: () => builder,
          order: () => builder,
          limit: () => builder,
          gt: (_column: string, value: string) => {
            gt = value;
            return builder;
          },
          then: (resolve: (value: unknown) => void) => {
            const source: Array<{ id: string }> = table === 'meetups' ? options.meetups : options.reports;
            resolve({ data: source.filter((row) => gt === null || row.id > gt), error: null });
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient;
    return { client, filters };
  }

  const file = (name: string): StorageListEntry => ({ name, id: `id-${name}`, created_at: OLD, metadata: { size: 1 } });

  it('reads the snapshot paths of open/reviewed photo reports only', async () => {
    const { client, filters } = fakeSweepClient({
      files: [],
      meetups: [],
      reports: [{ id: 'r1', target_snapshot: `${G}/${M1}/reported.jpg` }],
    });
    expect([...(await listReportedTotemPaths(client))]).toEqual([`${G}/${M1}/reported.jpg`]);
    expect(filters[0]).toEqual(['target_type=photo', 'status in open,reviewed']);
  });

  it('never plans a reported photo for deletion, even when no meetup references it any more', async () => {
    const { client } = fakeSweepClient({
      files: [file('live.jpg'), file('reported.jpg'), file('replaced.jpg')],
      meetups: [{ id: 'm1', totem_path: `${G}/${M1}/live.jpg` }],
      reports: [{ id: 'r1', target_snapshot: `${G}/${M1}/reported.jpg` }],
    });
    const plan = await planBucketSweep(client, NOW);
    expect(plan.referenced).toBe(2);
    expect(plan.orphans.map((entry) => entry.path)).toEqual([`${G}/${M1}/replaced.jpg`]);
    expect(describeSweepPlan(plan)).toContain('2 referenced by a meetup or an unresolved photo report (kept)');
  });
});

describe('applySweep', () => {
  it('removes batch by batch and stops at the first failure', async () => {
    const removed: string[][] = [];
    let failOn = 2;
    const client = {
      storage: {
        from(bucket: string) {
          expect(bucket).toBe('totems');
          return {
            remove: async (paths: string[]) => {
              removed.push(paths);
              return removed.length === failOn
                ? { data: null, error: { message: 'boom' } }
                : { data: paths.map((name) => ({ name })), error: null };
            },
          };
        },
      },
    } as unknown as SupabaseClient;
    const objects = Array.from({ length: 2500 }, (_, index) => object(`p/${String(index).padStart(4, '0')}.jpg`));
    const plan = planOrphanSweep(objects, [], NOW);
    const lines: string[] = [];

    await expect(applySweep(client, plan, (line) => lines.push(line))).rejects.toThrow('Deleting batch 2/3 failed after 1000 object(s): boom');
    expect(removed.map((batch) => batch.length)).toEqual([1000, 1000]);

    removed.length = 0;
    failOn = 0;
    expect(await applySweep(client, plan, (line) => lines.push(line))).toBe(2500);
    expect(removed.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect(lines.at(-1)).toBe('Deleted batch 3/3 (500 of 500 object(s)).');
  });
});

describe('storage:sweep-orphans command', () => {
  let output = '';
  let errors = '';
  const savedEnv = { ...process.env };

  beforeEach(() => {
    output = '';
    errors = '';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  it('is listed in help', async () => {
    expect(await main(['help'])).toBe(0);
    expect(output).toContain('storage:sweep-orphans [--dry-run]');
  });

  it('requires the service-role key, even for a dry run', async () => {
    expect(await main(['storage:sweep-orphans', '--dry-run'])).toBe(2);
    expect(errors).toContain('Missing SUPABASE_URL');
  });

  it('rejects unknown options and positionals', async () => {
    expect(await main(['storage:sweep-orphans', '--force'])).toBe(2);
    expect(errors).toContain("Unknown option '--force'");
    expect(errors).toContain('Usage: storage:sweep-orphans [--dry-run]');
    expect(await main(['storage:sweep-orphans', 'extra'])).toBe(2);
  });
});
