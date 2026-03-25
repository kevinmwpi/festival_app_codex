# Supabase Operations (Repo as Source of Truth)

This runbook keeps hosted Supabase aligned with this repository’s migrations, policies, functions, and seed data.

## 1) Link your local CLI to the hosted project

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

## 2) Reconcile hosted schema vs repo migrations

From repo root:

```bash
npm run supabase:db:pull:linked
npm run supabase:db:diff:linked
```

Interpretation:

- If diff is empty, hosted schema is aligned with repo migrations.
- If diff is non-empty, review drift and either:
  - create a migration in `supabase/migrations/` for intentional changes, or
  - revert untracked hosted edits.

## 3) Push migrations from repo to hosted project

```bash
npm run supabase:db:push
```

This includes:

- `001_initial_schema.sql`
- `002_rls.sql`
- `003_supporting_tables.sql`
- `004_security_hardening.sql`

## 4) Run DB policy tests

```bash
npm run supabase:db:test
```

`supabase/tests/rls.sql` verifies key authenticated-RLS behavior including:

- user schedule row isolation
- `group_invite_generations` owner/admin visibility and insert permissions

## 5) Deploy edge functions

Deploy all MVP functions:

```bash
npm run supabase:functions:deploy
```

Or deploy one function directly:

```bash
supabase functions deploy upload_totem_photo
```

## 6) Seed festival data

```bash
npm run supabase:seed:festival
```

Seed expectations:

- Input file defaults to `seed-data/sample-festival.json`
- `festival.id` must be present
- every `stage.festival_id` and `set.festival_id` must match `festival.id`
- all IDs must be valid UUIDs for tables that require UUID keys

## 7) Required environment variables

For the seed/import script:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`)

For edge function deployment/runtime in Supabase:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
