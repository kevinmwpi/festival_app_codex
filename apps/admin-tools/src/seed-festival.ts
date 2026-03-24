import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';

import { createClient } from '@supabase/supabase-js';

interface SeedPayload {
  festival: Record<string, unknown>;
  stages: Array<Record<string, unknown>>;
  artists: Array<Record<string, unknown>>;
  sets: Array<Record<string, unknown>>;
}

const defaultSeedPath = path.resolve(__dirname, '../../../seed-data/sample-festival.json');

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

function getSeedFilePath(): string {
  return process.argv[2] ?? process.env.SUPABASE_SEED_FILE ?? defaultSeedPath;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    return inspect(error, { depth: 5, colors: false });
  }

  return String(error);
}

function loadPayload(filePath: string): SeedPayload {
  const absolutePath = path.resolve(filePath);
  const raw = readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw) as SeedPayload;
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
