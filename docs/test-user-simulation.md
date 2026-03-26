# Simulating the App for Test Users

This runbook explains the fastest ways to let test users exercise the app after front-end updates.

## Option A: Internal dev simulation (same network)

Use this for rapid QA with teammates and seeded data checks.

1. Install deps and validate baseline:

```bash
npm install
npm run build
npm run test
```

2. Configure env vars (required):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (or `EXPO_PUBLIC_SUPABASE_KEY`)
- optional: `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`

3. Start Expo for shared device testing:

```bash
npm run mobile:start:lan
```

If LAN discovery fails for remote testers, use tunnel mode:

```bash
npm run mobile:start:tunnel
```

4. Testers open Expo Go (or dev client) and connect via QR code/link.

## Option B: Browser simulation for product walkthroughs

Use web only for quick visual validation; native flows remain the MVP acceptance target.

```bash
npm run mobile:web
```

Then open `http://localhost:8081` in a browser on the host machine.

## Option C: Real beta-user simulation (recommended)

For non-technical test users, use EAS preview/production builds instead of Expo Go:

- iOS: upload preview/production to TestFlight and invite testers.
- Android: upload preview/production to Play internal testing track and invite testers.

See full build/submit commands in `docs/native-beta-release.md`.

## Suggested QA matrix for test users

At minimum, ask each tester to verify:

- OTP login + profile persistence
- schedule select/deselect + conflict indicators
- group create/join from invite code
- meetup creation (with reminder behavior)
- offline reopen + reconnect sync
- map fallback without token and live map with token

Use `docs/mvp-acceptance-checklist.md` as the canonical sign-off list.
