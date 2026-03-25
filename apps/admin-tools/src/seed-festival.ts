import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';

import { createClient } from '@supabase/supabase-js';

interface SeedPayload {
  festival: Record<string, unknown> & { id: string };
  stages: Array<Record<string, unknown> & { festival_id: string }>;
  artists: Array<Record<string, unknown>>;
  sets: Array<Record<string, unknown> & { festival_id: string }>;
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

const defaultSeedPath = path.resolve(__dirname, '../../../seed-data/sample-festival.json');
const repoRoot = path.resolve(__dirname, '../../..');

function getSupabaseConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (url && key) {
    return { url, key };
  }

  const missing: string[] = [];
  if (!url) {
    missing.push('SUPABASE_URL');
  }
  if (!key) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)');
  }

  throw new Error(
    [
      `Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      'For Railway admin-tools, add these in the service Variables tab before deploying.',
      'This seed job requires a server-side Supabase key and will not run with the public anon key.',
    ].join('\n'),
  );
}

function resolveSeedFilePath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const candidates = [...new Set([path.resolve(process.cwd(), inputPath), path.resolve(repoRoot, inputPath)])];
  const existingPath = candidates.find((candidate) => existsSync(candidate));
  if (existingPath) {
    return existingPath;
  }

  throw new Error(
    [
      `Unable to find seed file: ${inputPath}`,
      'Checked these locations:',
      ...candidates.map((candidate) => `- ${candidate}`),
      'Use an absolute path or a repo-root-relative path such as seed-data/sample-festival.json.',
    ].join('\n'),
  );
}

function getSeedFilePath(): string {
  const requestedPath = process.argv[2];
  return requestedPath ? resolveSeedFilePath(requestedPath) : defaultSeedPath;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const maybePostgrestError = error as PostgrestLikeError;

    if (maybePostgrestError.code === 'PGRST205') {
      return [
        maybePostgrestError.message ?? "Could not find the table 'public.festivals' in the schema cache",
        'The target Supabase project is missing this repo\'s expected public tables, or PostgREST has not refreshed its schema cache yet.',
        'Apply the repo migrations first: supabase/migrations/001_initial_schema.sql, 002_rls.sql, 003_supporting_tables.sql, and 004_security_hardening.sql.',
        "If you already applied them, run `NOTIFY pgrst, 'reload schema';` in the Supabase SQL Editor to refresh the schema cache.",
      ].join('\n');
    }

    if (maybePostgrestError.code === '22P02' && maybePostgrestError.message?.includes('invalid input syntax for type uuid')) {
      return [
        maybePostgrestError.message,
        'The seed payload is sending a non-UUID id into a table that expects UUID primary and foreign keys.',
        'Use the bundled sample seed file from this repo, or update any custom seed file so every `id`, `festival_id`, `artist_id`, and `stage_id` is a valid UUID.',
      ].join('\n');
    }

    return inspect(error, { depth: 5, colors: false });
  }

  return String(error);
}

function loadPayload(filePath: string): SeedPayload {
  const absolutePath = path.resolve(filePath);
  const raw = readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw) as SeedPayload;
}

function validatePayload(payload: SeedPayload): void {
  if (!payload.festival || typeof payload.festival.id !== 'string') {
    throw new Error('Seed payload must include `festival.id` as a UUID string.');
  }

  if (!Array.isArray(payload.stages) || !Array.isArray(payload.artists) || !Array.isArray(payload.sets)) {
    throw new Error('Seed payload must include array fields: `stages`, `artists`, and `sets`.');
  }

  const festivalId = payload.festival.id;
  const invalidStage = payload.stages.find((stage) => stage.festival_id !== festivalId);
  if (invalidStage) {
    throw new Error('Every stage row must reference `festival.id` via `festival_id`.');
  }

  const invalidSet = payload.sets.find((setRow) => setRow.festival_id !== festivalId);
  if (invalidSet) {
    throw new Error('Every set row must reference `festival.id` via `festival_id`.');
  }
}

async function upsertTable(
  supabase: ReturnType<typeof createClient<any>> | any,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const { error } = await supabase.from(table).upsert(rows);
  if (error) {
    throw error;
  }

  return rows.length;
}

async function main(): Promise<void> {
  const { url, key } = getSupabaseConfig();
  const supabase = createClient(url, key) as any;
  const inputPath = getSeedFilePath();
  const payload = loadPayload(inputPath);
  validatePayload(payload);

  const festivalCount = await upsertTable(supabase, 'festivals', [payload.festival]);
  const stageCount = await upsertTable(supabase, 'stages', payload.stages);
  const artistCount = await upsertTable(supabase, 'artists', payload.artists);
  const setCount = await upsertTable(supabase, 'sets', payload.sets);

  console.log(
    JSON.stringify(
      {
        festivals: festivalCount,
        stages: stageCount,
        artists: artistCount,
        sets: setCount,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
