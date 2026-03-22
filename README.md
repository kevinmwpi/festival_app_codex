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
SUPABASE_URL=
SUPABASE_ANON_KEY=
MAPBOX_ACCESS_TOKEN=
EXPO_PUBLIC_SUPABASE_URL=
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

The current mobile scaffold includes:

- email OTP auth and profile setup
- schedule browse + personal schedule views
- offline-first local SQLite cache
- queued sync service with retry/backoff
- groups, invite flow, combined schedule, and meetup creation
- notification service and map screen shell
- chat placeholder for a later phase

## Supabase

Apply migrations:

```bash
supabase db push
```

Run DB policy tests:

```bash
supabase test db
```

Serve edge functions locally:

```bash
supabase functions serve
```

Supabase assets included here:

- initial schema: [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
- RLS policies: [`supabase/migrations/002_rls.sql`](supabase/migrations/002_rls.sql)
- support tables/storage setup: [`supabase/migrations/003_supporting_tables.sql`](supabase/migrations/003_supporting_tables.sql)
- DB tests: [`supabase/tests/rls.sql`](supabase/tests/rls.sql)

## Seed Data

Sample festival data lives in [`seed-data/sample-festival.json`](seed-data/sample-festival.json).

Run the seed script with:

```bash
npx ts-node apps/admin-tools/src/seed-festival.ts seed-data/sample-festival.json
```

The seed flow is written to be idempotent through Supabase upserts.

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
