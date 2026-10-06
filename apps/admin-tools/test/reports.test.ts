import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { formatReportTable, planContentRemoval, type ReportRow } from '../src/moderation/reports';

const REPORT_ID = '6f1d2c3b-0000-4000-8000-0000000000c1';
const G = '6f1d2c3b-0000-4000-8000-000000000001';
const M = '6f1d2c3b-0000-4000-8000-0000000000a1';
const USER = '6f1d2c3b-0000-4000-8000-0000000000bb';
const REPORTED = `${G}/${M}/0b000000-0000-4000-8000-000000000001.jpg`;
const NEWER = `${G}/${M}/0b000000-0000-4000-8000-000000000002.jpg`;

function report(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: REPORT_ID,
    created_at: '2026-10-05T10:00:00Z',
    status: 'open',
    reason: 'sexual',
    target_type: 'photo',
    target_id: M,
    group_id: G,
    details: null,
    target_snapshot: REPORTED,
    reporter_id: USER,
    ...overrides,
  };
}

/** Records every PostgREST write and storage removal; reads come from `rows`. */
function fakeClient(rows: { report: ReportRow | null; meetup: { id: string; title: string; totem_path: string | null } | null }) {
  const writes: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async remove(paths: string[]) {
            writes.push(`remove:${bucket}:${paths.join(',')}`);
            return { data: [], error: null };
          },
        };
      },
    },
    from(table: string) {
      const parts: string[] = [];
      let op = 'select';
      const builder = {
        select: () => builder,
        update(values: Record<string, unknown>) {
          op = `update:${JSON.stringify(values)}`;
          return builder;
        },
        delete() {
          op = 'delete';
          return builder;
        },
        eq(column: string, value: unknown) {
          parts.push(`${column}=${String(value)}`);
          return builder;
        },
        in(column: string, values: unknown[]) {
          parts.push(`${column} in ${values.join(',')}`);
          return builder;
        },
        maybeSingle: async () => ({ data: table === 'reports' ? rows.report : rows.meetup, error: null }),
        then(resolve: (value: unknown) => void) {
          writes.push(`${table}:${op} ${parts.join(' ')}`);
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, writes };
}

async function runAll(client: SupabaseClient): Promise<string[]> {
  const actions = await planContentRemoval(client, REPORT_ID);
  for (const action of actions) {
    await action.run();
  }
  return actions.map((action) => action.description);
}

describe('planContentRemoval for photo reports', () => {
  it('removes the reported photo and clears totem_path only while it still points at it', async () => {
    const { client, writes } = fakeClient({ report: report(), meetup: { id: M, title: 'Gate', totem_path: REPORTED } });
    const descriptions = await runAll(client);
    expect(descriptions[0]).toBe(`remove storage object totems/${REPORTED} (the reported photo)`);
    expect(writes).toEqual([
      `remove:totems:${REPORTED}`,
      `meetups:update:{"totem_path":null} id=${M} totem_path=${REPORTED}`,
      `reports:update:{"status":"actioned"} target_type=photo target_id=${M} target_snapshot=${REPORTED} status in open,reviewed`,
    ]);
  });

  it('acts on the reported photo, not a newer unreviewed one, and says so in the plan', async () => {
    const { client, writes } = fakeClient({ report: report(), meetup: { id: M, title: 'Gate', totem_path: NEWER } });
    const descriptions = await runAll(client);
    expect(descriptions.some((line) => line.startsWith('WARNING') && line.includes(NEWER))).toBe(true);
    expect(writes).toEqual([
      `remove:totems:${REPORTED}`,
      `reports:update:{"status":"actioned"} target_type=photo target_id=${M} target_snapshot=${REPORTED} status in open,reviewed`,
    ]);
    expect(writes.join('\n')).not.toContain(`remove:totems:${NEWER}`);
  });

  it('still removes the reported photo when the meetup was deleted', async () => {
    const { client, writes } = fakeClient({ report: report(), meetup: null });
    const descriptions = await runAll(client);
    expect(descriptions).toContain(`meetup ${M} no longer exists (no row to update)`);
    expect(writes[0]).toBe(`remove:totems:${REPORTED}`);
    expect(writes).toHaveLength(2);
  });

  it('refuses a photo report without a snapshot path', async () => {
    const { client } = fakeClient({ report: report({ target_snapshot: null }), meetup: null });
    await expect(planContentRemoval(client, REPORT_ID)).rejects.toThrow('has no target_snapshot');
  });
});

describe('planContentRemoval for block notices', () => {
  it('removes nothing and only marks the notice actioned', async () => {
    const { client, writes } = fakeClient({
      report: report({ target_type: 'block', target_id: USER, reason: 'other', target_snapshot: 'Maya' }),
      meetup: null,
    });
    const descriptions = await runAll(client);
    expect(descriptions[0]).toContain('block notice: no content to remove');
    expect(writes).toEqual([
      `reports:update:{"status":"actioned"} target_type=block target_id=${USER} status in open,reviewed`,
    ]);
  });

  it('lists block notices like other reports', () => {
    const text = formatReportTable([
      { ...report({ target_type: 'block', target_id: USER, reason: 'other', target_snapshot: 'Maya' }), reporter_name: 'Rev' },
    ]);
    expect(text).toContain(`target   block ${USER} (group ${G})`);
    expect(text).toContain('snapshot Maya');
  });
});
