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

This deploys:

- `request-otp`
- `verify-otp`
- `create_group_invite`
- `join_group_from_invite`
- `upload_totem_photo`

Or deploy one function directly:

```bash
supabase functions deploy request-otp
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

Hosted Supabase Edge Functions also receive the project anon key automatically.

## 8) Email OTP verification checklist

Use this when device login shows `Unable to send login code.` or when validating a fresh hosted setup.

- Run `npm run supabase:db:push` so the latest migrations are present, including `005_rate_limiting.sql`.
- Run `npm run supabase:functions:deploy` so `request-otp` and `verify-otp` are deployed to the hosted project.
- Confirm your local CLI is linked to the same Supabase project the mobile app uses.
- Confirm the mobile build is using the correct `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- In Supabase Auth settings, confirm email sign-in is enabled.
- In the email template for passwordless sign-in, confirm the template includes `{{ .Token }}` so users receive a numeric OTP code.
- Test the flow on device: enter email, receive code, verify code, confirm session persists after app restart.
- If the send step fails, inspect the hosted `request-otp` function logs in the Supabase dashboard.
- If verification fails, inspect the hosted `verify-otp` function logs in the Supabase dashboard.
- If repeated attempts stop working temporarily, wait for rate limits to reset before retrying.
