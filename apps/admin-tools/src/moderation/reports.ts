import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../env';
import { isUuid } from '../lib/uuid';

export const REPORT_STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type TargetType = 'user' | 'group' | 'meetup' | 'photo';

export interface ReportRow {
  id: string;
  created_at: string;
  status: ReportStatus;
  reason: string;
  target_type: TargetType;
  target_id: string;
  group_id: string | null;
  details: string | null;
  target_snapshot: string | null;
  reporter_id: string | null;
}

export interface ReportListItem extends ReportRow {
  reporter_name: string | null;
}

const REPORT_COLUMNS =
  'id, created_at, status, reason, target_type, target_id, group_id, details, target_snapshot, reporter_id';

/** Default placeholders written when content is removed (match the 007 normalization defaults). */
export const REMOVED_DISPLAY_NAME = 'Festie user';
export const REMOVED_GROUP_NAME = 'My crew';

export async function listReports(
  client: SupabaseClient,
  options: { status: ReportStatus | 'all'; limit: number },
): Promise<ReportListItem[]> {
  let query = client.from('reports').select(REPORT_COLUMNS).order('created_at', { ascending: true }).limit(options.limit);
  if (options.status !== 'all') {
    query = query.eq('status', options.status);
  }
  const reports = check(await query, 'Reading reports') as ReportRow[];

  const reporterIds = [...new Set(reports.map((report) => report.reporter_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (reporterIds.length > 0) {
    const users = check(
      await client.from('users').select('id, display_name').in('id', reporterIds),
      'Reading reporters',
    ) as Array<{ id: string; display_name: string }>;
    for (const user of users) {
      names.set(user.id, user.display_name);
    }
  }
  return reports.map((report) => ({
    ...report,
    reporter_name: report.reporter_id ? names.get(report.reporter_id) ?? null : null,
  }));
}

function truncate(value: string | null, length: number): string {
  if (!value) {
    return '';
  }
  const flat = value.replace(/\s+/g, ' ');
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

export function formatReportTable(reports: ReportListItem[]): string {
  if (reports.length === 0) {
    return 'No reports.';
  }
  return reports
    .map((report) =>
      [
        `${report.id}  ${report.created_at.slice(0, 16).replace('T', ' ')}  ${report.status.toUpperCase()}  ${report.reason}`,
        `  target   ${report.target_type} ${report.target_id}${report.group_id ? ` (group ${report.group_id})` : ''}`,
        `  snapshot ${truncate(report.target_snapshot, 100)}`,
        report.details ? `  details  ${truncate(report.details, 100)}` : null,
        `  reporter ${report.reporter_name ?? (report.reporter_id ? report.reporter_id : 'deleted account')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

export interface RemovalAction {
  description: string;
  run: () => Promise<void>;
}

async function removeStorageObject(client: SupabaseClient, path: string): Promise<void> {
  const { error } = await client.storage.from('totems').remove([path]);
  if (error) {
    throw new Error(`Removing storage object ${path} failed: ${error.message}`);
  }
}

/**
 * Plans the removal of reported content:
 *   meetup -> delete the meetup and its totem photo
 *   photo  -> delete the photo and clear meetups.totem_path
 *   group  -> reset the group name to "My crew"
 *   user   -> reset display name/avatar (use users:ban to remove the person)
 * then mark every open/reviewed report on the same target as actioned.
 * Storage is removed before rows so a failed run can simply be retried.
 */
export async function planContentRemoval(client: SupabaseClient, reportId: string): Promise<RemovalAction[]> {
  if (!isUuid(reportId)) {
    throw new Error(`"${reportId}" is not a report id (UUID)`);
  }
  const report = check(
    await client.from('reports').select(REPORT_COLUMNS).eq('id', reportId).maybeSingle(),
    'Reading the report',
  ) as ReportRow | null;
  if (!report) {
    throw new Error(`Report ${reportId} not found`);
  }

  const actions: RemovalAction[] = [];
  if (report.target_type === 'meetup' || report.target_type === 'photo') {
    const meetup = check(
      await client.from('meetups').select('id, title, totem_path').eq('id', report.target_id).maybeSingle(),
      'Reading the meetup',
    ) as { id: string; title: string; totem_path: string | null } | null;
    if (!meetup) {
      actions.push({ description: `meetup ${report.target_id} no longer exists (nothing to remove)`, run: async () => {} });
    } else {
      if (meetup.totem_path) {
        const path = meetup.totem_path;
        actions.push({ description: `remove storage object totems/${path}`, run: () => removeStorageObject(client, path) });
      }
      if (report.target_type === 'meetup') {
        actions.push({
          description: `delete meetup ${meetup.id} ("${meetup.title}")`,
          run: async () => {
            check(await client.from('meetups').delete().eq('id', meetup.id), 'Deleting the meetup');
          },
        });
      } else if (meetup.totem_path) {
        actions.push({
          description: `clear totem_path on meetup ${meetup.id}`,
          run: async () => {
            check(await client.from('meetups').update({ totem_path: null }).eq('id', meetup.id), 'Clearing the photo');
          },
        });
      }
    }
  } else if (report.target_type === 'group') {
    actions.push({
      description: `rename group ${report.target_id} to "${REMOVED_GROUP_NAME}"`,
      run: async () => {
        check(
          await client.from('groups').update({ name: REMOVED_GROUP_NAME }).eq('id', report.target_id),
          'Renaming the group',
        );
      },
    });
  } else {
    actions.push({
      description: `reset display name/avatar of user ${report.target_id} (run users:ban to remove the person)`,
      run: async () => {
        check(
          await client
            .from('users')
            .update({ display_name: REMOVED_DISPLAY_NAME, avatar_type: 'initials', avatar_value: '' })
            .eq('id', report.target_id),
          'Resetting the profile',
        );
      },
    });
  }

  actions.push({
    description: `mark open/reviewed reports on ${report.target_type} ${report.target_id} as actioned`,
    run: async () => {
      check(
        await client
          .from('reports')
          .update({ status: 'actioned' })
          .eq('target_type', report.target_type)
          .eq('target_id', report.target_id)
          .in('status', ['open', 'reviewed']),
        'Updating report status',
      );
    },
  });
  return actions;
}
