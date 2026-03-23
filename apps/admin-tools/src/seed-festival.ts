import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';

interface SeedPayload {
  festival: Record<string, unknown>;
  stages: Array<Record<string, unknown>>;
  artists: Array<Record<string, unknown>>;
  sets: Array<Record<string, unknown>>;
}
 
const defaultSeedPath = path.resolve(__dirname, '../../../seed-data/sample-festival.json');
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) must be set.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function loadPayload(filePath: string): SeedPayload {
  const absolutePath = path.resolve(filePath);
  const raw = readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw) as SeedPayload;
}

async function upsertTable(table: string, rows: Array<Record<string, unknown>>): Promise<number> {
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
  const inputPath = process.argv[2] ?? defaultSeedPath;
  const payload = loadPayload(inputPath);

  const festivalCount = await upsertTable('festivals', [payload.festival]);
  const stageCount = await upsertTable('stages', payload.stages);
  const artistCount = await upsertTable('artists', payload.artists);
  const setCount = await upsertTable('sets', payload.sets);

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

void main();
