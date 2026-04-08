# Native Beta Delivery (EAS, TestFlight, Play Internal)

This repo targets **native beta distribution only**:

- iOS: **EAS Build → TestFlight**
- Android: **EAS Build → Play Console internal testing**

## 1) One-time setup

From the repo root:

```bash
npm install
npm install --global eas-cli
```

Then log in and configure EAS project metadata:

```bash
cd apps/mobile
eas login
eas project:init
```

## 2) Required config and environment

### App identifiers (already committed)

- iOS bundle ID: `com.kevin.festivalapp`
- Android package: `com.kevin.festivalapp`

### Build numbers (already scaffolded)

- `expo.ios.buildNumber` in `apps/mobile/app.json`
- `expo.android.versionCode` in `apps/mobile/app.json`

Use EAS production profile auto-increment so each store build is unique.

### Runtime env vars for mobile app

Set these in EAS (Project → Environment Variables), at minimum for `preview` and `production`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (or `EXPO_PUBLIC_SUPABASE_KEY`)
- `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (required for live map tiles)

## 3) Build profiles

`apps/mobile/eas.json` provides:

- `development`: internal dev client builds
- `preview`: internal testing builds (for QA/beta distribution)
- `production`: release builds with version auto-increment

## 4) Build commands

From `apps/mobile`:

```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

Production builds:

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

## 5) Submit to TestFlight

After a successful iOS build:

```bash
eas submit --platform ios --profile preview
```

Or for release pipeline:

```bash
eas submit --platform ios --profile production
```

Notes:

- Set `ascAppId` in `apps/mobile/eas.json` before first submit.
- App Store Connect credentials/app access are required in your Expo account context.

## 6) Submit to Play internal testing

After a successful Android build:

```bash
eas submit --platform android --profile preview
```

Or for release pipeline:

```bash
eas submit --platform android --profile production
```

Notes:

- Current submit profiles target Play `internal` track.
- Google Play service account credentials must be configured in EAS project settings.
