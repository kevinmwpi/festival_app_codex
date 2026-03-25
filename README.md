# Festival App

Festival planning app monorepo built with Turborepo, Expo, Supabase, and shared TypeScript packages.

This repo includes:

- `apps/mobile`: Expo mobile client with auth, schedule, groups, meetups, offline cache/sync, map shell, and notification utilities
- `apps/admin-tools`: seed script for loading festival data into Supabase
- `packages/*`: shared domain, data, sync, UI, map, notification, and transport code
- `supabase/`: SQL migrations, RLS policies, edge functions, and DB tests

## Workspace Layout

```text
apps/
  mobile/
  admin-tools/
packages/
  domain/
  data-access/
  sync-engine/
  ui/
  notification-utils/
  map-utils/
  transport/
supabase/
  migrations/
  functions/
  tests/
seed-data/
```

## Requirements

- Node.js 20+
- npm 10+
- Supabase CLI for local DB/function workflows
- Expo tooling for simulator/device testing

## Environment

Copy `.env.example` to your local env file and fill in real values:

```bash
# Admin tools / server-side only
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Mobile / Expo public runtime vars
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_KEY=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=
```

## Getting Started

Install dependencies:

```bash
npm install
```

Build the whole workspace:

```bash
npm run build
```

Run tests:

```bash
npm run test
```

Lint/typecheck:

```bash
npm run lint
```

## Mobile App

Start the Expo app:

```bash
npm --workspace @festival/mobile run start
```

Useful variants:

```bash
npm --workspace @festival/mobile run ios
npm --workspace @festival/mobile run android
npm --workspace @festival/mobile run web
```

`web` is available for local debugging only; native iOS/Android builds are the acceptance target.

The current mobile scaffold includes:

- email OTP auth and profile setup
- schedule browse + personal schedule views
- offline-first local SQLite cache
- queued sync service with retry/backoff
- groups, invite flow, combined schedule, and meetup creation
- notification service and map screen shell
- chat placeholder for a later phase

MVP phase boundaries:

- In MVP now: OTP auth/profile, personal schedule + conflicts, groups/invites, combined schedule, meetup coordination (optional totem), offline cache/sync, local notifications, map support for meetup/schedule coordination.
- Phase 2+: live friend location.
- Phase 2b+: session recap/stats.
- Not MVP: BLE/local mesh chat.

Manual device QA checklist for MVP acceptance:

- [`docs/mvp-acceptance-checklist.md`](docs/mvp-acceptance-checklist.md)

## Native Beta Delivery (EAS)

Native distribution target for this repo is:

- iOS: EAS Build → TestFlight
- Android: EAS Build → Play internal testing

EAS build/submit profiles live in [`apps/mobile/eas.json`](apps/mobile/eas.json), with `development`, `preview`, and `production` profiles.

For setup and release commands, see [`docs/native-beta-release.md`](docs/native-beta-release.md).

## Supabase

Primary runbook for hosted/local Supabase operations:

- [`docs/supabase-operations.md`](docs/supabase-operations.md)

Apply migrations:

```bash
npm run supabase:db:push
```

Run DB policy tests:

```bash
npm run supabase:db:test
```

Serve edge functions locally:

```bash
npm run supabase:functions:serve
```

Deploy all MVP edge functions:

```bash
npm run supabase:functions:deploy
```

Supabase assets included here:

- initial schema: [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
- RLS policies: [`supabase/migrations/002_rls.sql`](supabase/migrations/002_rls.sql)
- support tables/storage setup: [`supabase/migrations/003_supporting_tables.sql`](supabase/migrations/003_supporting_tables.sql)
- security hardening: [`supabase/migrations/004_security_hardening.sql`](supabase/migrations/004_security_hardening.sql)
- DB tests: [`supabase/tests/rls.sql`](supabase/tests/rls.sql)

## Seed Data

Sample festival data lives in [`seed-data/sample-festival.json`](seed-data/sample-festival.json).

Run the seed script with:

```bash
npm run supabase:seed:festival
```

The seed flow is written to be idempotent through Supabase upserts.

### Railway Admin Tools Setup

`apps/admin-tools` is a one-off seed job, not a long-running web server.

For Railway, configure the `festival/admin-tools` service with:

- Build command: `npm run build --workspace=@festival/admin-tools`
- Start command: `npm run start --workspace=@festival/admin-tools`
- Variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`

The admin seed job only reads server-side vars and does not fall back to `EXPO_PUBLIC_*` values.
It uses the bundled sample seed file by default, unless you pass an explicit CLI file path.
The mobile app only reads `EXPO_PUBLIC_*` values.
This repo also accepts Supabase's newer mobile env name `EXPO_PUBLIC_SUPABASE_KEY` as an alias for `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
If you want this to run on a schedule, use a Railway cron job or manual redeploy instead of treating it like an always-on service.

## Shared Packages

- `@festival/domain`: pure scheduling logic and tests
- `@festival/data-access`: Supabase client, local cache access, auth helpers, media uploads, and group/schedule data flows
- `@festival/sync-engine`: SQLite schema, local queue, pending sync state, and flush/retry logic
- `@festival/ui`: reusable React Native UI primitives, offline banner, and screen helpers
- `@festival/notification-utils`: local reminder scheduling with Expo Notifications
- `@festival/map-utils`: stage/meetup map helpers
- `@festival/transport`: messaging transport interface stub for later phases

## Current Verification

The workspace currently passes:

- `npm run build`
- `npm run test`

The domain and sync-engine packages have executable unit tests in place. Mobile simulator flows and Supabase CLI flows still need to be exercised against a real local or hosted backend environment.
