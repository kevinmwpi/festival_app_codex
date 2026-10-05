import { parseArgs } from 'node:util';

import { createAdminClient, requireSupabaseConfig, UsageError } from '../env';
import { applySweep, describeSweepPlan, planBucketSweep } from './sweep-orphans';

export const SWEEP_ORPHANS_USAGE = 'storage:sweep-orphans [--dry-run]';

/**
 * `storage:sweep-orphans [--dry-run]` — deletes photos in the `totems` bucket that no meetup
 * references (left behind when the app was killed between a meetup delete or photo replacement
 * and its best-effort storage cleanup). Service role required, also for a dry run.
 */
export async function storageSweepOrphans(args: string[], log: (line: string) => void): Promise<void> {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: { 'dry-run': { type: 'boolean' } },
      allowPositionals: false,
      strict: true,
    }));
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nUsage: ${SWEEP_ORPHANS_USAGE}`);
  }

  const client = createAdminClient(requireSupabaseConfig());
  const plan = await planBucketSweep(client);
  log(describeSweepPlan(plan));
  if (values['dry-run']) {
    log('Dry run: nothing deleted.');
    return;
  }
  if (plan.batches.length === 0) {
    log('Nothing to delete.');
    return;
  }
  const removed = await applySweep(client, plan, log);
  log(`Deleted ${removed} orphaned object(s).`);
}
