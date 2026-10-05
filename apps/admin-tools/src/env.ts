import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface SupabaseConfig {
  url: string;
  key: string;
}

/** Service-role credentials from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). */
export function readSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig | null {
  const url = env.SUPABASE_URL?.trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY)?.trim();
  return url && key ? { url, key } : null;
}

export function requireSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig {
  const config = readSupabaseConfig(env);
  if (config) {
    return config;
  }
  const missing = [
    env.SUPABASE_URL ? null : 'SUPABASE_URL',
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY ? null : 'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)',
  ].filter(Boolean);
  throw new UsageError(
    `Missing ${missing.join(' and ')}. admin-tools needs the service-role key; it never works with the anon key.`,
  );
}

export function createAdminClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Repository root (the directory that contains seed-data/). */
export function repoRoot(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(dir, 'seed-data')) && existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, '../../..');
}

/**
 * Resolves a user-supplied path against the directory the command was started
 * from (npm sets INIT_CWD when running workspace scripts), then the repo root.
 */
export function resolveInputPath(input: string): string {
  if (path.isAbsolute(input)) {
    return input;
  }
  const bases = [process.env.INIT_CWD, process.cwd(), repoRoot()].filter((base): base is string => Boolean(base));
  for (const base of bases) {
    const candidate = path.resolve(base, input);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return path.resolve(bases[0], input);
}

/** Resolves an output path against the directory the command was started from. */
export function resolveOutputPath(output: string): string {
  return path.isAbsolute(output) ? output : path.resolve(process.env.INIT_CWD ?? process.cwd(), output);
}

export function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    throw new UsageError(`File not found: ${filePath}`);
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new UsageError(`${filePath} is not valid JSON: ${(error as Error).message}`);
  }
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/** Throws a readable error for a failed Supabase call. */
export function check<T>(result: { data: T; error: PostgrestLikeError | null }, action: string): T {
  if (result.error) {
    const { code, message, details, hint } = result.error;
    const extra = [details, hint].filter(Boolean).join(' ');
    throw new Error(`${action} failed${code ? ` (${code})` : ''}: ${message ?? 'unknown error'}${extra ? ` — ${extra}` : ''}`);
  }
  return result.data;
}
