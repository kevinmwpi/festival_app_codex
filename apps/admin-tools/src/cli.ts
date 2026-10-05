import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';

import { buildDemoPlan } from './demo/plan';
import { describeDemoPlan, runDemoSeed } from './demo/seed';
import {
  createAdminClient,
  readJsonFile,
  readSupabaseConfig,
  repoRoot,
  requireSupabaseConfig,
  resolveInputPath,
  resolveOutputPath,
  UsageError,
} from './env';
import { buildSeedFromCsv, CSV_FILES, type CsvInput } from './festival/import-csv';
import { applyFestivalSeed, describeSeedPlan, planFestivalSeed } from './festival/seed';
import { shiftFestivalDates } from './festival/shift-dates';
import type { FestivalSeed } from './festival/types';
import { formatIssues, validateFestivalSeed } from './festival/validate';
import { banUser, describeBan, resolveBanTarget } from './moderation/ban';
import { formatReportTable, listReports, planContentRemoval, REPORT_STATUSES, type ReportStatus } from './moderation/reports';
import { addTerms, listTerms, normalizeTerms, removeTerms } from './moderation/terms';

const HELP = `Festie admin tools (service role). Usage:

  npm run admin -- <command> [options]

Festival data
  festival:validate <file>                         Validate a festival JSON file (offline)
  festival:seed <file> [--dry-run]                 Validate and write a festival (auto-bumps version)
  festival:import-csv <dir> [--out <file>]         festival.csv, stages.csv, artists.csv, sets.csv -> JSON
  festival:shift-dates <file> --start <YYYY-MM-DD> [--out <file>] [--dry-run]
                                                   Move a demo festival to new dates (wall-clock preserved)
  demo:seed [--file <file>] [--dry-run]            Demo festival + fake crew, picks, meetup photo, live map

Moderation
  reports:list [--status open|reviewed|actioned|dismissed|all] [--limit <n>] [--json]
  reports:remove-content <report_id> [--dry-run]   Delete the reported meetup/photo (or reset name) + mark actioned
  users:ban <user_id> [--dry-run]                  Ban, remove memberships/locations, mark reports actioned
  moderation:list-terms
  moderation:add-terms <term...> [--dry-run]
  moderation:remove-terms <term...> [--dry-run]

Environment: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
See docs/festival-data.md.`;

type Log = (line: string) => void;
const log: Log = (line) => process.stdout.write(`${line}\n`);

interface Parsed {
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

function parse(args: string[], options: ParseArgsConfig['options'], positionals: { min: number; max: number; usage: string }): Parsed {
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nUsage: ${positionals.usage}`);
  }
  if (parsed.positionals.length < positionals.min || parsed.positionals.length > positionals.max) {
    throw new UsageError(`Usage: ${positionals.usage}`);
  }
  return parsed as Parsed;
}

const DRY_RUN = { 'dry-run': { type: 'boolean' } } as const;

function loadValidSeed(fileArgument: string): { seed: FestivalSeed; filePath: string } {
  const filePath = resolveInputPath(fileArgument);
  const result = validateFestivalSeed(readJsonFile(filePath));
  if (result.warnings.length > 0) {
    log(`Warnings in ${filePath}:\n${formatIssues(result.warnings)}`);
  }
  if (!result.seed) {
    throw new UsageError(`${filePath} is not a valid festival file:\n${formatIssues(result.errors)}`);
  }
  return { seed: result.seed, filePath };
}

function summarizeSeed(seed: FestivalSeed): string {
  const f = seed.festival;
  return `${f.name} (${f.id}) ${f.start_date}..${f.end_date} ${f.timezone}, ${f.status}${f.is_demo ? ', demo' : ''}: ` +
    `${seed.stages.length} stages, ${seed.artists.length} artists, ${seed.sets.length} sets`;
}

function writeSeedFile(filePath: string, seed: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
}

async function festivalValidate(args: string[]): Promise<void> {
  const { positionals } = parse(args, {}, { min: 1, max: 1, usage: 'festival:validate <file>' });
  const { seed, filePath } = loadValidSeed(positionals[0]);
  log(`OK ${filePath}\n${summarizeSeed(seed)}`);
}

async function festivalSeed(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, DRY_RUN, { min: 1, max: 1, usage: 'festival:seed <file> [--dry-run]' });
  const { seed } = loadValidSeed(positionals[0]);
  log(summarizeSeed(seed));
  const config = values['dry-run'] ? readSupabaseConfig() : requireSupabaseConfig();
  if (!config) {
    log('Dry run: file is valid. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to also diff against the database.');
    return;
  }
  const client = createAdminClient(config);
  const plan = await planFestivalSeed(client, seed);
  log(describeSeedPlan(plan));
  if (values['dry-run']) {
    log('Dry run: nothing written.');
    return;
  }
  await applyFestivalSeed(client, seed, plan);
  log(`Seeded ${seed.festival.name} at version ${plan.nextVersion} (${seed.festival.status}).`);
}

async function festivalImportCsv(args: string[]): Promise<void> {
  const { positionals, values } = parse(
    args,
    { out: { type: 'string' } },
    { min: 1, max: 1, usage: 'festival:import-csv <dir> [--out <file>]' },
  );
  const dir = resolveInputPath(positionals[0]);
  const input = {} as CsvInput;
  for (const file of CSV_FILES) {
    const filePath = path.join(dir, file);
    if (!existsSync(filePath)) {
      throw new UsageError(`Missing ${filePath} (expected ${CSV_FILES.join(', ')})`);
    }
    input[file] = readFileSync(filePath, 'utf8');
  }
  const built = buildSeedFromCsv(input);
  if (!built.seed) {
    throw new UsageError(`CSV import failed:\n${formatIssues(built.errors)}`);
  }
  const result = validateFestivalSeed(built.seed);
  if (result.warnings.length > 0) {
    process.stderr.write(`Warnings:\n${formatIssues(result.warnings)}\n`);
  }
  if (!result.seed) {
    throw new UsageError(`Imported data is not a valid festival:\n${formatIssues(result.errors)}`);
  }
  if (typeof values.out === 'string') {
    const outPath = resolveOutputPath(values.out);
    writeSeedFile(outPath, result.seed);
    log(`Wrote ${outPath}\n${summarizeSeed(result.seed)}`);
  } else {
    process.stdout.write(`${JSON.stringify(result.seed, null, 2)}\n`);
  }
}

async function festivalShiftDates(args: string[]): Promise<void> {
  const { positionals, values } = parse(
    args,
    { start: { type: 'string' }, out: { type: 'string' }, ...DRY_RUN },
    { min: 1, max: 1, usage: 'festival:shift-dates <file> --start <YYYY-MM-DD> [--out <file>] [--dry-run]' },
  );
  if (typeof values.start !== 'string') {
    throw new UsageError('Usage: festival:shift-dates <file> --start <YYYY-MM-DD> [--out <file>] [--dry-run]');
  }
  const { seed, filePath } = loadValidSeed(positionals[0]);
  let shifted;
  try {
    shifted = shiftFestivalDates(seed, values.start);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const check = validateFestivalSeed(shifted.seed);
  if (!check.seed) {
    throw new Error(`Shifted festival failed validation:\n${formatIssues(check.errors)}`);
  }
  log(`Shifting by ${shifted.days} day(s): ${seed.festival.start_date}..${seed.festival.end_date} -> ` +
    `${shifted.seed.festival.start_date}..${shifted.seed.festival.end_date}`);
  if (values['dry-run']) {
    log('Dry run: nothing written.');
    return;
  }
  const outPath = typeof values.out === 'string' ? resolveOutputPath(values.out) : filePath;
  writeSeedFile(outPath, shifted.seed);
  log(`Wrote ${outPath}. Run festival:seed (or demo:seed) to publish it.`);
}

async function demoSeed(args: string[]): Promise<void> {
  const { values } = parse(
    args,
    { file: { type: 'string' }, ...DRY_RUN },
    { min: 0, max: 0, usage: 'demo:seed [--file <file>] [--dry-run]' },
  );
  const file = typeof values.file === 'string' ? values.file : path.join(repoRoot(), 'seed-data', 'demo-festival.json');
  const { seed } = loadValidSeed(file);
  let plan;
  try {
    plan = buildDemoPlan(seed);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(summarizeSeed(seed));
  log(describeDemoPlan(plan));
  const totemPath = path.join(repoRoot(), 'seed-data', 'demo-totem.jpg');
  if (!existsSync(totemPath)) {
    throw new UsageError(`Missing demo totem photo ${totemPath}`);
  }
  if (values['dry-run']) {
    log('Dry run: nothing written.');
    return;
  }
  const client = createAdminClient(requireSupabaseConfig());
  await runDemoSeed(client, seed, plan, readFileSync(totemPath), log);
  log('Demo content seeded. The reviewer account joins "Festie Demo Crew" on every demo login (prepare_demo_account).');
}

async function reportsList(args: string[]): Promise<void> {
  const { values } = parse(
    args,
    { status: { type: 'string' }, limit: { type: 'string' }, json: { type: 'boolean' } },
    { min: 0, max: 0, usage: 'reports:list [--status open|reviewed|actioned|dismissed|all] [--limit <n>] [--json]' },
  );
  const status = (typeof values.status === 'string' ? values.status : 'open') as ReportStatus | 'all';
  if (status !== 'all' && !REPORT_STATUSES.includes(status)) {
    throw new UsageError(`--status must be one of ${[...REPORT_STATUSES, 'all'].join(', ')}`);
  }
  const limit = typeof values.limit === 'string' ? Number(values.limit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new UsageError('--limit must be an integer between 1 and 1000');
  }
  const reports = await listReports(createAdminClient(requireSupabaseConfig()), { status, limit });
  log(values.json ? JSON.stringify(reports, null, 2) : formatReportTable(reports));
}

async function reportsRemoveContent(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, DRY_RUN, {
    min: 1,
    max: 1,
    usage: 'reports:remove-content <report_id> [--dry-run]',
  });
  const client = createAdminClient(requireSupabaseConfig());
  const actions = await planContentRemoval(client, positionals[0]);
  log(actions.map((action) => `  - ${action.description}`).join('\n'));
  if (values['dry-run']) {
    log('Dry run: nothing changed.');
    return;
  }
  for (const action of actions) {
    await action.run();
  }
  log('Done.');
}

async function usersBan(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, DRY_RUN, { min: 1, max: 1, usage: 'users:ban <user_id> [--dry-run]' });
  const client = createAdminClient(requireSupabaseConfig());
  const target = await resolveBanTarget(client, positionals[0]);
  log(describeBan(target));
  if (values['dry-run']) {
    log('Dry run: nothing changed.');
    return;
  }
  const { removedObjects } = await banUser(client, target);
  log(`Banned. Removed ${removedObjects} orphaned photo(s).`);
}

async function moderationListTerms(args: string[]): Promise<void> {
  parse(args, {}, { min: 0, max: 0, usage: 'moderation:list-terms' });
  const terms = await listTerms(createAdminClient(requireSupabaseConfig()));
  log(terms.join('\n'));
  log(`${terms.length} term(s).`);
}

async function moderationChangeTerms(args: string[], mode: 'add' | 'remove'): Promise<void> {
  const usage = `moderation:${mode}-terms <term...> [--dry-run]`;
  const { positionals, values } = parse(args, DRY_RUN, { min: 1, max: 500, usage });
  const { terms, errors } = normalizeTerms(positionals);
  if (errors.length > 0) {
    throw new UsageError(`Invalid term(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  }
  log(`${mode === 'add' ? 'Add' : 'Remove'}: ${terms.join(', ')}`);
  if (values['dry-run']) {
    log('Dry run: nothing changed.');
    return;
  }
  const client = createAdminClient(requireSupabaseConfig());
  if (mode === 'add') {
    await addTerms(client, terms);
    log(`Added ${terms.length} term(s) (existing ones are kept). New names/titles are checked immediately; existing content is not rescanned.`);
  } else {
    log(`Removed ${await removeTerms(client, terms)} term(s).`);
  }
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  'festival:validate': festivalValidate,
  'festival:seed': festivalSeed,
  'festival:import-csv': festivalImportCsv,
  'festival:shift-dates': festivalShiftDates,
  'demo:seed': demoSeed,
  'reports:list': reportsList,
  'reports:remove-content': reportsRemoveContent,
  'users:ban': usersBan,
  'moderation:list-terms': moderationListTerms,
  'moderation:add-terms': (args) => moderationChangeTerms(args, 'add'),
  'moderation:remove-terms': (args) => moderationChangeTerms(args, 'remove'),
};

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    log(HELP);
    return command ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}\n`);
    return 2;
  }
  try {
    await handler(args);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
