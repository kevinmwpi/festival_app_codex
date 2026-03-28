# AI Studio Front-End Validation (MVP Workflow Fit)

This document validates the AI Studio web UI scaffold in `kevinmwpi/festival_app_aistudio` against this repo's MVP workflows and architecture.

## What the AI Studio repo gives you

From the public repo metadata and source snapshots, the AI Studio project is a **Vite + React + Tailwind web app** with design-oriented components and utility styling (`src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/lib/utils.ts`, plus a Gemini key setup in README).

That is useful as a **visual/style source**, but it does not plug directly into this Expo React Native monorepo.

## Fit assessment vs MVP workflow

### 1) Platform mismatch (web vs native)

- AI Studio output uses DOM/Tailwind conventions (`div`, CSS imports, browser entrypoint).
- MVP app is Expo Router + React Native screens/components.

**Result:** direct copy/paste will fail. The design needs to be translated to React Native primitives and StyleSheet/theme tokens.

### 2) Missing MVP-critical behavior contracts

The generated front-end design appears to focus on visual flow and static interaction states. For MVP here, every primary screen must preserve these runtime contracts:

- OTP auth flow and profile setup routing.
- Cached/offline-first reads for schedule/group data.
- Sync queue status behavior after reconnect.
- Group invite/join + meetup creation entry points.
- Mapbox configured/not-configured fallback.

### 3) Missing integration boundaries for future features

To remain extensible, UI should not hardcode data in screen components. It should continue to consume:

- data hooks from `@festival/data-access`
- persisted app state from `useAppStore`
- reusable UI atoms from `@festival/ui`

This keeps Phase 2 additions (live location, recap/stats) additive instead of requiring large rewrites.

## Corrections to apply when importing AI Studio design

## A) Keep existing route topology, restyle inside each screen

Do **not** replace routing/screen structure. Instead, port styling into current screens:

- `app/auth/*` (enter email, verify OTP, profile setup)
- `app/(tabs)/schedule/*`
- `app/(tabs)/group/*`
- `app/(tabs)/map/*`

### B) Convert web utility classes to RN style objects

Ask AI Studio for design output in this mapping-ready format:

- spacing, typography, color, radius as named tokens
- component variants (primary/secondary/disabled/loading)
- state specs (pressed/focused/error/offline)
- no browser-only units/features (`vh`, fixed body scroll assumptions, pseudo-elements)

### C) Keep data + side effects out of visual components

When porting generated code:

- keep async calls in screen/container level hooks
- pass pure props into visual blocks
- avoid adding direct Supabase calls inside leaf display components

### D) Preserve empty/loading/offline/error states on every MVP route

Every migrated screen should still define:

- loading skeleton/state card
- empty state with CTA
- inline error/message surface
- offline-safe fallback content where applicable

## Request template for AI Studio (recommended)

Use this prompt/requirements template when requesting revised code:

1. Generate **React Native + Expo Router** compatible TSX only (no DOM elements).
2. Use inline `StyleSheet.create` objects or tokenized style constants (no Tailwind classes).
3. Preserve existing route names and user journeys: auth → schedule browse/select → groups/invites → meetup/map.
4. Separate visual component props from business/data hooks.
5. Include explicit variants: loading, empty, offline, error, success.
6. Keep chat labeled as future/disabled (not MVP interactive).
7. Provide a light/dark-ready token map for future theming.

## How to run and simulate this app locally

### 1) Install and build

```bash
npm install
npm run build
npm run test
```

### 2) Configure environment

Set mobile variables (at minimum):

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (or `EXPO_PUBLIC_SUPABASE_KEY` alias)
- optional for live map: `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`

### 3) Run Expo

```bash
npm run mobile:start
```

Simulator/device variants:

```bash
npm run mobile:ios
npm run mobile:android
npm run mobile:web
```

### 4) Validate MVP manually

Run through `docs/mvp-acceptance-checklist.md` on physical/simulator devices after style integration.

## Native refinement QA notes (PR follow-up to structural adaptation)

Manual smoke coverage for the refined native pass should include the complete primary journey:

- `auth/enter-email` → `auth/verify-otp` → `auth/profile-setup`
- `/(tabs)/schedule/browse` and `/(tabs)/schedule`
- `/(tabs)/group/index`, `/create`, `/join`
- `/(tabs)/group/[groupId]/index`, `/schedule`, `/meetup/create`
- `/(tabs)/map/index`

### What to verify quickly on device/emulator

1. **Hierarchy + spacing rhythm:** hero, section titles, and card density feel consistent page-to-page.
2. **Browse + schedule legibility:** lineup cards, selected states, and conflict treatment are easy to scan in bright conditions.
3. **Group semantics:** member rows look like member records (not meetup cards), while meetup surfaces remain meetup-specific.
4. **Map overlays on small screens:** top and bottom overlays do not block key stage pins or user panning.
5. **Offline and loading clarity:** loading/empty/offline cards are visible and actionable on every route listed above.

### Suggested screenshots for review comments

- Auth: `enter-email`, `verify-otp`, and `profile-setup` (one each).
- Schedule: browse list with at least one conflict card and one selected card.
- Group: group detail with members + combined schedule split/overlap examples.
- Map: map view with overlay(s) and visible pins.
