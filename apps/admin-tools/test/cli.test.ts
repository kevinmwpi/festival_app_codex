import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/cli';
import { readSupabaseConfig } from '../src/env';
import { REPO_ROOT, realFestival } from './fixtures';

let output = '';
let errors = '';
const savedEnv = { ...process.env };

beforeEach(() => {
  output = '';
  errors = '';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  process.env.INIT_CWD = REPO_ROOT;
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

describe('cli', () => {
  it('prints help and rejects unknown commands', async () => {
    expect(await main(['help'])).toBe(0);
    expect(output).toContain('festival:seed <file> [--dry-run]');
    expect(await main(['nope'])).toBe(2);
    expect(errors).toContain('Unknown command "nope"');
  });

  it('validates the demo festival offline', async () => {
    expect(await main(['festival:validate', 'seed-data/demo-festival.json'])).toBe(0);
    expect(output).toContain('Festie Demo Fest');
  });

  it('festival:seed --dry-run works without credentials; a real seed requires them', async () => {
    expect(await main(['festival:seed', 'seed-data/demo-festival.json', '--dry-run'])).toBe(0);
    expect(output).toContain('Dry run: file is valid');
    expect(await main(['festival:seed', 'seed-data/demo-festival.json'])).toBe(2);
    expect(errors).toContain('Missing SUPABASE_URL');
  });

  it('reports validation errors with exit code 2', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'festie-cli-'));
    try {
      const file = path.join(dir, 'bad.json');
      const festival = realFestival();
      delete festival.festival.source_url;
      writeFileSync(file, JSON.stringify(festival));
      expect(await main(['festival:validate', file])).toBe(2);
      expect(errors).toContain('festival.source_url');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown options', async () => {
    expect(await main(['festival:seed', 'seed-data/demo-festival.json', '--force'])).toBe(2);
    expect(errors).toContain("Unknown option '--force'");
  });

  it('imports CSV to a file and shifts demo dates', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'festie-cli-'));
    try {
      const out = path.join(dir, 'demo.json');
      expect(await main(['festival:import-csv', 'seed-data/demo-festival-csv', '--out', out])).toBe(0);
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(
        JSON.parse(readFileSync(path.join(REPO_ROOT, 'seed-data/demo-festival.json'), 'utf8')),
      );
      expect(await main(['festival:shift-dates', out, '--start', '2026-10-09'])).toBe(0);
      expect(JSON.parse(readFileSync(out, 'utf8')).festival.start_date).toBe('2026-10-09');
      expect(await main(['festival:shift-dates', out])).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('demo:seed --dry-run prints the plan without credentials', async () => {
    expect(await main(['demo:seed', '--dry-run'])).toBe(0);
    expect(output).toContain('Festie Demo Crew');
    expect(output).toContain('Dry run: nothing written.');
  });

  it('moderation term changes validate input before needing credentials', async () => {
    expect(await main(['moderation:add-terms', 'f*ck', '--dry-run'])).toBe(2);
    expect(await main(['moderation:add-terms', 'Badword', '--dry-run'])).toBe(0);
    expect(output).toContain('Add: badword');
  });

  it('reads the service-role key from either variable', () => {
    expect(readSupabaseConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' })).toEqual({
      url: 'https://x.supabase.co',
      key: 'k',
    });
    expect(readSupabaseConfig({ SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
  });
});
