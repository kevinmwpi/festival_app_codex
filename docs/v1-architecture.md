# Festie v1 — Architecture Contract

Status: **authoritative contract for the v1 App Store overhaul** (Oct 2026).
Every implementer works from this document. If code and this document disagree, fix the code or
amend this document explicitly — never silently diverge.

Goals, in priority order:

1. **Secure** — no user can read or change data they should not; verified by automated tests.
2. **Passes App Review** — account deletion, UGC report/block/filter, reviewer login, accurate privacy disclosures, no dead UI.
3. **Works at a festival** — launches and shows cached schedule/groups with no signal; times are correct in the festival's timezone; location sharing is truthful.
4. **Design** — build on the merged `match_aistudio` design language (pastel palette, 40px card radii, Georgia-italic headings, uppercase micro-labels, per-festival accent via `deriveAccentColors`). New screens must look native to it. Only change existing visuals where needed for function, accessibility, or consistency.

Non-goals for v1: chat (removed), background location, social login, universal links (custom scheme + typed code only), push notifications from the server (local notifications only).

---

## 1. Identity model

- `auth.users` (Supabase Auth) is the identity. `public.users` is the **profile**.
- New column `public.users.auth_user_id uuid unique references auth.users(id) on delete cascade`.
  - Backfill: `update public.users u set auth_user_id = a.id from auth.users a where lower(a.email) = lower(u.email) and u.auth_user_id is null;`
  - Profiles that cannot be matched are orphans from dev testing: delete them (cascades are fixed first, see §2.3).
  - Then `alter column auth_user_id set not null`.
- `public.users.email` is retained for support lookups but is **never readable by other users and never writable by clients**. Unique index on `lower(email)`.
- `public.current_app_user_id()` → `select id from public.users where auth_user_id = auth.uid()`;
  `language sql stable security definer set search_path = ''`. **No RLS policy may query a table whose own policy calls back into the querying table** — all cross-table checks go through the `security definer` helpers below.

## 2. Database

### 2.1 Migration files

- Keep `001`–`005_rate_limiting.sql` byte-for-byte (already applied to the hosted project).
- Rename `005_user_festivals_and_festival_theme.sql` → `006_user_festivals_and_festival_theme.sql` and make it **idempotent** (`create table if not exists`, `drop policy if exists` before each `create policy`, `add column if not exists`) so it succeeds whether or not the hosted DB already has it.
- New `007_v1_security_overhaul.sql`: everything in §2.2–§2.8. **Fully idempotent** (drop-if-exists every policy/function/trigger it defines; `if not exists` on tables/columns/indexes; guarded `do $$` blocks for constraints). It must apply cleanly (a) on a fresh database after 001–006 and (b) on a database where 001–006 were already applied with arbitrary dashboard-made policies on these tables — so it first **drops every existing policy** on every public table it manages and on `storage.objects` for bucket `totems` (loop over `pg_policies`).
- Optional `008_seed_moderation_terms.sql` for the word list (data only).

### 2.2 Helper functions (all `security definer`, `stable` unless noted, `set search_path = ''`, fully-qualified names, `revoke execute ... from public, anon`, `grant execute ... to authenticated`)

| Function | Returns | Semantics |
|---|---|---|
| `current_app_user_id()` | uuid | profile id of `auth.uid()` or null |
| `is_group_member(p_group_id uuid)` | boolean | caller is a member |
| `is_group_admin(p_group_id uuid)` | boolean | caller is member with role `admin` |
| `shares_group_with(p_user_id uuid)` | boolean | caller and p_user_id are both members of at least one common group |
| `is_blocked_between(p_a uuid, p_b uuid)` | boolean | either user blocked the other |
| `try_uuid(p text)` | uuid | `immutable`; returns null instead of raising on malformed input (not security definer) |
| `contains_disallowed_text(p text)` | boolean | case-insensitive whole-word match against `public.moderation_terms` |

### 2.3 Tables & constraints

Existing tables keep their names/columns unless listed. Changes:

- `users`: `auth_user_id` (§1). `display_name` 1–40 chars after trim (check). `avatar_type in ('initials','emoji','color')`. `avatar_value` ≤ 100.
- `festivals`: add `status text not null default 'published' check (status in ('draft','published'))`, `is_demo boolean not null default false`, `latitude double precision`, `longitude double precision`, `default_zoom double precision default 15`, `bounds_sw_lat`, `bounds_sw_lng`, `bounds_ne_lat`, `bounds_ne_lng` (double precision, nullable), `source_url text`, `updated_at timestamptz default now()`. Keep `accent_color`, `image_url`, `map_asset_url`, `version`.
- `stages`: add `latitude double precision`, `longitude double precision`. Keep `map_x`/`map_y` (legacy, unused by v1 client).
- `groups`: `created_by_user_id` becomes **nullable**, FK `on delete set null`. Add `invite_code_rotated_at timestamptz`. `name` 1–60 after trim. Drop the legacy `pending-` placeholder concept entirely.
- `group_members`: `role in ('admin','member')`.
- `meetups`: `created_by_user_id` FK `on delete cascade`. Add `latitude double precision`, `longitude double precision`, `totem_path text`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`. Check: `totem_path is null or totem_path like group_id::text || '/' || id::text || '/%'`. `totem_image_url` and `custom_map_x/y` retained but unused (legacy). Title 1–80, notes ≤ 500.
- `location_shares`: **unique (user_id, group_id)** (dedupe existing rows first, keep newest). lat ∈ [-90,90], lng ∈ [-180,180], accuracy ≥ 0, heading ∈ [0,360) or null.
- `chat_messages`: FK sender `on delete cascade`. **Locked**: RLS on, no policies, all privileges revoked from `anon`, `authenticated`.
- `group_invite_generations`, `auth_attempts`: locked the same way (service role only).
- New `user_blocks(blocker_id uuid references users on delete cascade, blocked_id uuid references users on delete cascade, created_at timestamptz default now(), primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id))`.
- New `reports(id uuid pk default gen_random_uuid(), reporter_id uuid references users on delete set null, target_type text check in ('user','group','meetup','photo'), target_id uuid not null, group_id uuid null references groups on delete set null, reason text check in ('spam','harassment','hate','sexual','violence','impersonation','other'), details text check (char_length(details) <= 500), status text not null default 'open' check in ('open','reviewed','actioned','dismissed'), created_at timestamptz default now(), unique (reporter_id, target_type, target_id))`.
- New `moderation_terms(term text primary key)` — locked (no client access); read only via `contains_disallowed_text`.
- New `rate_limit_events(key text, action text, created_at timestamptz default now())` + index — locked; used by RPCs via a `security definer` helper `check_rate_limit(p_key text, p_action text, p_max int, p_window interval)` that raises `rate_limited` (SQLSTATE `P0429`) when exceeded and records the event otherwise.
- Triggers (`before insert or update`): reject disallowed text in `users.display_name`, `groups.name`, `meetups.title`, `meetups.notes` with SQLSTATE `P0422` message `content_not_allowed`. `meetups.updated_at` maintenance; `meetups.created_by_user_id` and `group_id` immutable on update.

### 2.4 Privileges

- `revoke all on all tables in schema public from anon, authenticated;` then grant explicitly:
  - `anon` + `authenticated`: `select` on `festivals`, `stages`, `artists`, `sets` (RLS restricts to published festivals).
  - `authenticated`:
    - `users`: `select (id, display_name, avatar_type, avatar_value, created_at)` only. **No** insert/update/delete (use RPCs).
    - `user_festivals`: select, insert, delete.
    - `user_set_selections`: select, insert, update, delete.
    - `groups`: select, `update (name)`, delete.
    - `group_members`: select, delete.
    - `meetups`: select, insert, update, delete.
    - `location_shares`: select (writes via RPC only).
    - `user_blocks`: select, insert, delete.
    - `reports`: insert (select own via policy).
- Also `alter default privileges in schema public revoke all on tables from anon, authenticated;` so future tables are closed by default.

### 2.5 RLS policies (RLS enabled on **every** public table)

| Table | Policy |
|---|---|
| festivals | select: `status = 'published'` |
| stages, sets | select: parent festival published |
| artists | select: true |
| users | select: `id = current_app_user_id() or shares_group_with(id)` |
| user_festivals | all ops: `user_id = current_app_user_id()` |
| user_set_selections | select: `user_id = me or (shares a group whose festival_id = user_set_selections.festival_id with user_id and not is_blocked_between(me, user_id))`; insert/update (using+check)/delete: `user_id = me` |
| groups | select: `is_group_member(id)`; update: `is_group_admin(id)`; delete: `is_group_admin(id)` |
| group_members | select: `is_group_member(group_id)`; delete: `user_id = me or is_group_admin(group_id)` (prefer RPCs `leave_group` / `remove_group_member`, which also handle admin hand-off) |
| meetups | select: `is_group_member(group_id) and not is_blocked_between(me, created_by_user_id)`; insert: `is_group_member(group_id) and created_by_user_id = me`; update: `created_by_user_id = me` (check same + still member); delete: `created_by_user_id = me or is_group_admin(group_id)` |
| location_shares | select: `is_group_member(group_id) and recorded_at > now() - interval '15 minutes' and not is_blocked_between(me, user_id)`; no direct writes |
| user_blocks | select/insert/delete: `blocker_id = me` (insert also requires `blocked_id <> me`) |
| reports | select: `reporter_id = me`; insert: `reporter_id = me` |
| chat_messages, group_invite_generations, auth_attempts, moderation_terms, rate_limit_events | no policies (locked) |

### 2.6 RPCs (`security definer`, `set search_path = ''`, `revoke execute from public, anon`, `grant execute to authenticated`; each raises a clear error code)

| RPC | Args | Returns | Rules |
|---|---|---|---|
| `upsert_my_profile` | `p_display_name text, p_avatar_type text, p_avatar_value text` | `table(id uuid, display_name text, avatar_type text, avatar_value text)` | requires `auth.uid()`; inserts with `auth_user_id = auth.uid()`, `email = auth.jwt()->>'email'` or updates own row; validation + moderation via constraints/trigger |
| `get_my_profile` | — | same shape, 0 or 1 row | |
| `create_group` | `p_name text, p_festival_id uuid` | `table(group_id uuid, name text, festival_id uuid, invite_code text)` | festival must be published; rate limit 10/day per user; atomic insert of group + admin membership; invite code = 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `extensions.gen_random_bytes`, retry on collision |
| `join_group` | `p_invite_code text` | `table(group_id uuid, group_name text, festival_id uuid, member_count int)` | normalize `upper(regexp_replace(code,'[^A-Za-z0-9]','','g'))`; **exact** equality on `invite_code`; failed attempts rate limited 10/hour per user (`rate_limited`); unknown code → `invite_not_found`; max 50 members → `group_full`; already member → returns group (idempotent) |
| `rotate_invite_code` | `p_group_id uuid` | `text` | admin only |
| `leave_group` | `p_group_id uuid` | void | removes own membership + own location share; if caller was the last admin and members remain, promote the earliest-joined member; if no members remain, delete group |
| `remove_group_member` | `p_group_id uuid, p_user_id uuid` | void | admin only; cannot remove self (use leave) |
| `share_location` | `p_group_id uuid, p_lat double precision, p_lng double precision, p_accuracy double precision, p_heading double precision` | void | member only; validates ranges; upsert on (user_id, group_id), `recorded_at = now()`; rate limit 1 per 5 s per user+group (silently ignore extra, do not raise) |
| `stop_sharing_location` | `p_group_id uuid` | void | deletes own row |
| `get_group_locations` | `p_group_id uuid` | `table(user_id uuid, display_name text, avatar_type text, avatar_value text, lat double precision, lng double precision, accuracy double precision, heading double precision, recorded_at timestamptz)` | member only; last 15 min; excludes caller; excludes blocked either direction |
| `block_user` / `unblock_user` | `p_user_id uuid` | void | blocking also deletes nothing else; RLS filters do the hiding |
| `report_content` | `p_target_type text, p_target_id uuid, p_reason text, p_details text default null` | uuid | caller must be able to see the target (member of its group / shares group with user); upsert-ignore duplicates; rate limit 20/day |
| `prepare_account_deletion` | `p_auth_user_id uuid` | `table(storage_path text)` | **service_role only** (revoke from authenticated). Hands off admin roles in every group (same rules as `leave_group`), deletes empty groups, returns totem storage paths of meetups the user created so the edge function can remove the objects |
| `purge_stale_locations` | — | int | **service_role/postgres only**; deletes `location_shares` older than 15 minutes |

Error convention: `raise exception using errcode = 'P0001', message = '<code>'` where `<code>` ∈
`not_authenticated, profile_required, not_group_member, not_group_admin, invite_not_found, group_full, rate_limited, content_not_allowed, invalid_input, festival_not_found`. The client maps codes to friendly messages.

### 2.7 Scheduled jobs

In 007, inside a guarded block: if `pg_cron` is available (`select 1 from pg_available_extensions where name='pg_cron'`), `create extension if not exists pg_cron` and schedule (idempotently, unschedule-by-name first):
- `purge-stale-locations` every 5 minutes → `select public.purge_stale_locations();`
- `purge-rate-limit-events` hourly → delete `rate_limit_events` and `auth_attempts` older than 24 h.
If pg_cron is unavailable the migration must still succeed (raise notice).

### 2.8 Storage

- Bucket `totems`: `public = false`, `file_size_limit = 5242880`, `allowed_mime_types = {image/jpeg,image/png,image/heic,image/webp}` (update existing row).
- Object path: `<group_id>/<meetup_id>/<random>.jpg`.
- Policies on `storage.objects` (bucket_id = 'totems'):
  - select: `is_group_member(try_uuid((storage.foldername(name))[1]))`
  - insert: member of folder[1] **and** a meetup with id `try_uuid(folder[2])` exists in that group created by `current_app_user_id()`
  - delete: `owner = auth.uid()` or `is_group_admin(try_uuid(folder[1]))`
- Clients read via `createSignedUrl(path, 3600)` only. No public URLs anywhere.

### 2.9 Generated types

`packages/data-access/src/database.types.ts` must be hand-updated to match the final schema exactly (tables, new columns, RPC `Functions` signatures). Keep the Supabase CLI generated shape.

---

## 3. Edge functions (`supabase/functions`)

Remove: `request-otp`, `verify-otp`, `create_group_invite`, `join_group_from_invite`, `upload_totem_photo` (replaced by Supabase Auth + RPCs + storage RLS). Remove now-unused `_shared` helpers.

Add:

1. **`delete-account`** (`verify_jwt = true`): POST, no body. Resolves user from the bearer token via `auth.getUser(jwt)`. With the service role: `rpc('prepare_account_deletion', { p_auth_user_id })` → remove returned storage paths **and** every `totems` object whose `owner = auth user id` → `auth.admin.deleteUser(id)` (cascades through `public.users.auth_user_id`). Returns `{ deleted: true }`. Idempotent (already-deleted user → 200). Logs no PII.
2. **`demo-login`** (`verify_jwt = false`): the **only** App Review path. POST `{ email, code }`. Enabled only when secrets `DEMO_LOGIN_EMAIL` and `DEMO_LOGIN_CODE` (≥ 8 chars) are both set; otherwise always 404. If `lower(email)` matches and `code` matches (constant-time compare), call `auth.admin.generateLink({ type: 'magiclink', email })` and return `{ token_hash: properties.hashed_token }`. Any mismatch → 401 `{ error: 'invalid_code' }` (same body/timing for wrong email and wrong code). Rate limit 20/hour per client IP (`x-forwarded-for` first hop) via `rate_limit_events` with key `ip:<addr>`.

Shared: strict JSON body parsing with size cap, method check, CORS limited to what native clients need (no browser use is intended; keep `*` only on OPTIONS-safe responses or drop CORS).

`supabase/config.toml`: `[functions.delete-account] verify_jwt = true`, `[functions.demo-login] verify_jwt = false`; `[auth.email] enable_signup = true, otp_length = 6, otp_expiry = 600, enable_confirmations = false`; `[auth.rate_limit] email_sent = 30, token_verifications = 30`; `[storage.buckets.totems] public = false`. Document custom SMTP requirement in the runbook (Supabase's default SMTP only delivers to project team members).

Verification: `deno check` every function (install via `npm i -g deno` if available) and unit-test pure helpers with `deno test` where feasible.

---

## 4. Client data layer (`packages/*`)

### 4.1 `@festival/data-access`

- Supabase client: reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (alias `EXPO_PUBLIC_SUPABASE_KEY`). **No silent fallbacks** — export `supabaseConfigError: string | null`; when config is missing, create no network client and every call throws `ConfigError`. App shows a config error screen.
- Auth API (replace custom OTP functions):
  - `requestEmailCode(email)` → `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`.
  - `verifyEmailCode(email, code)` → `supabase.auth.verifyOtp({ email, token: code, type: 'email' })`; on failure, try `functions.invoke('demo-login', { body: { email, code } })` once; if it returns `token_hash`, `verifyOtp({ token_hash, type: 'magiclink' })`. Otherwise rethrow the original error. Accept codes of 6–10 digits.
  - `getSessionOffline()` → `supabase.auth.getSession()` (no network). **Routing decisions must use this, never `getUser()`.**
  - `signOut()` → clears auth session, MMKV profile cache, local SQLite user data (`clearLocalUserData()` in sync-engine: everything except festival catalog tables), pending queue, scheduled local notifications, location-sharing state.
  - `deleteAccount()` → `functions.invoke('delete-account')`, then the same local wipe as `signOut()`.
- Profile: `getMyProfile()` (RPC, caches to MMKV `profile-cache`), `getCachedProfile()` (sync, MMKV), `saveMyProfile(input)` (RPC `upsert_my_profile`). Never select `email` from `users`.
- Groups: `createGroup` → RPC `create_group`; `joinGroup(code)` → RPC `join_group`; `leaveGroup`, `removeGroupMember`, `rotateInviteCode`; group detail/members cached to SQLite as today; member selects use explicit columns.
- Meetups: create/update via sync queue (direct table upsert under RLS); `deleteMeetup(id)` via sync queue delete. Payload uses `latitude/longitude`, never `custom_map_x/y`.
- Totem photos: `uploadTotemPhoto(file, meetup)` → EXIF strip (keep piexif) → `storage.from('totems').upload('<group_id>/<meetup_id>/<uuid>.jpg')` → `update meetups set totem_path`. `getTotemSignedUrl(path)` with in-memory cache (expire 50 min).
- Location: `shareLocation(groupId, coords)` → RPC; `stopSharingLocation(groupId)` → RPC; `getGroupLocations(groupId)` → RPC.
- Moderation: `reportContent(...)`, `blockUser(id)`, `unblockUser(id)`, `listBlockedUsers()` (select own `user_blocks` rows; display names only for users still visible, else "Blocked user").
- Festivals: only published rows come back (RLS). `fetchAndCacheFestival` compares `version` with a light query first (`select id, version`), downloads the bundle only when changed. Festival rows include lat/lng/bounds/timezone.
- Selections: `refreshUserSelections` must **not** drop rows with `pending_sync = 1`, and must not resurrect rows that have a queued delete. Merge rule: server rows replace local rows only where no pending local op exists for that id/set.
- Error mapping: `toUserMessage(error)` translates the §2.6 codes, network errors, and auth errors into friendly copy.

### 4.2 `@festival/sync-engine`

- Local SQLite schema mirrors new columns (festival lat/lng/bounds/status/is_demo, stage lat/lng, meetup latitude/longitude/totem_path/created_at/updated_at). Bump a schema version in `app_meta` and migrate (add columns) on open.
- `MUTABLE_TABLES = { user_set_selections, meetups }`.
- Add `clearLocalUserData()` and `getPendingOperationIds(table)`.
- Permanent errors (RLS violation `42501`, check violation `23514`, `P0001` codes other than `rate_limited`) are **dropped from the queue** after recording the failure (expose `getFailedOperations()` for UI), not retried forever; transient errors keep exponential backoff.

### 4.3 `@festival/domain` — time & schedule (unit tested with vitest)

All festival times render in the **festival's IANA timezone**, not the device's:
- `formatFestivalTime(iso, tz)` → e.g. `9:30 PM`; `formatFestivalDate(dateOrIso, tz, opts)`.
- `festivalDayKey(iso, tz, dayStartHour = 6)` → `YYYY-MM-DD` of the festival day (a 1:00 AM set belongs to the previous day).
- `minutesIntoFestivalDay(iso, tz, dayStartHour = 6)` → for timeline positioning.
- `listFestivalDays(rows, tz)`.
- Use `Intl.DateTimeFormat(..., { timeZone })` with `formatToParts`; provide a tested fallback if `timeZone` throws (Hermes supports it, but guard).
- Existing conflict detection stays; add tests for overlapping/adjacent sets across midnight.

### 4.4 `@festival/map-utils`

- `getFestivalCamera(festival)` → `{ center: [lng, lat], zoom, bounds? } | null` (null when the festival has no coordinates).
- `getStageCoordinate(stage)`, `getMeetupCoordinate(meetup, stagesById)` → `[lng, lat] | null`.
- Remove all hard-coded city coordinates.

### 4.5 `@festival/notification-utils`

- Reminders scheduled at the correct absolute instant (ISO from DB is absolute — just don't re-interpret in local time). Reminder copy uses festival-time formatting.
- `cancelAllReminders()` used by sign-out/delete.
- Ask permission contextually (first time the user adds a set or meetup), handle denial gracefully.

---

## 5. Mobile app (`apps/mobile`)

### 5.1 Shell & routing

- `app/_layout.tsx`: fonts + splash (from design branch), `AppProviders`, config-error screen if `supabaseConfigError`.
- `app/index.tsx`: `getSessionOffline()` → no session → `/auth/enter-email`; session + cached profile → `/(tabs)/festivals`; session, no cached profile → try `getMyProfile()` (online) → profile-setup if none; offline with no cache → show retry state (not the login screen).
- Auth listener: on `SIGNED_OUT` route to enter-email.
- Persist `activeFestivalId` and `selectedGroupId` in MMKV (zustand persist or manual). Default festival: first followed festival, else first published festival; no hard-coded UUID.
- Remove `app/(tabs)/chat`, `app/modal.tsx`, `components/EditScreenInfo.tsx` and other Expo template leftovers not used.

### 5.2 Auth screens

- Enter email: remove the non-functional Google/Apple buttons; keep the design's visual balance. Inline validation; friendly errors; links to Terms & Privacy (already present).
- Verify code: 6–10 digit input (auto-advance, paste support, one hidden `TextInput` with `textContentType="oneTimeCode"`), resend with 60 s cooldown, uses `verifyEmailCode` (demo fallback is transparent).
- Profile setup: display name (1–40), avatar choice; server moderation error surfaced clearly.

### 5.3 Settings (new, `app/settings/` stack, opened from an avatar/gear button in the Fests screen header)

Sections, styled with existing `@festival/ui` primitives (add `ListRow`, `DestructiveButton` to the UI package if needed):
- Profile: edit name/avatar.
- Privacy: Blocked users (list + unblock), Location sharing status (which group, until when, stop).
- Notifications: open system settings if denied.
- About: Privacy Policy, Terms of Use, Contact support (`mailto:` using `SUPPORT_EMAIL` from `src/config/app-info.ts`), app version/build.
- Sign out.
- Delete account: explains what is deleted, requires typing `DELETE`, calls `deleteAccount()`, then routes to enter-email. Must work in ≤ 3 taps from Settings (Apple 5.1.1(v)).

### 5.4 Groups & meetups

- Create group (RPC) → share sheet (`Share.share`) with message: `Join my crew "<name>" on Festie. Code: ABC123 — or tap festivalapp://group/join?code=ABC123`.
- Join screen reads `code` from `useLocalSearchParams` and pre-fills; deep link `festivalapp://group/join?code=...` must route to it (verify the expo-router path; `(tabs)` group segments are not part of the URL).
- Group detail: members list; tapping another member opens actions: **Report**, **Block** (confirm), and for admins **Remove from group**. Footer: **Leave group** (confirm). Admin: rotate invite code.
- Meetups: list; creator can delete; others can **Report**. Totem photo shown via signed URL; photo has Report action.
- Report sheet: reason picker (§2.3 reasons) + optional details; success toast "Thanks — we'll review this within 24 hours." (runbook commits the developer to that SLA).
- Create meetup: stage picker (primary); custom pin **only** when the festival has coordinates and Mapbox is configured (tap on map → lat/lng); otherwise stage + notes. Remove the old normalized-grid picker.
- Blocked users' content is hidden server-side; client also hides them in member lists as "Blocked user" with Unblock.

### 5.5 Schedule & lineup

- All time labels via `@festival/domain` festival-time helpers using `festival.timezone`; day tabs via `festivalDayKey`; timeline positions via `minutesIntoFestivalDay`.
- Show "Times shown in festival local time (PDT)" hint where times appear.
- Show the not-affiliated disclaimer on festival detail/lineup: "Festie is an independent app and is not affiliated with or endorsed by any festival, organizer, or artist. Schedules may change — check official sources."
- Demo festivals (`is_demo`) show a small "Demo" badge.

### 5.6 Map & live location

- Mapbox config plugin added to `app.json` per `@rnmapbox/maps` install docs (check `node_modules/@rnmapbox/maps/plugin/install.md`). Download token via EAS secret env (`RNMAPBOX_MAPS_DOWNLOAD_TOKEN`) documented in runbook.
- Camera from `getFestivalCamera`; stage pins from stage lat/lng; meetup pins; friend pins.
- Fallback (no token, or festival without coordinates): a styled card listing stages, next sets, meetups — **no fake map, no hard-coded city**.
- Offline pack: festival bounds (or center ± ~1.5 km), zoom 13–17, named `festival-<id>`; button state reflects real pack status (`offlineManager.getPack`).
- **Location sharing** (`src/location/LocationSharingProvider.tsx`, mounted in `AppProviders`):
  - State persisted in MMKV: `{ groupId, startedAt, expiresAt }` or null. Sharing auto-expires after 8 hours (user can choose 1 h / 4 h / until I stop ≤ 24 h).
  - Foreground only: watch position (`Accuracy.Balanced`, `distanceInterval` 25 m, `timeInterval` 30 s) only while sharing is active **and** `AppState === 'active'` **and** permission is granted; stop the watcher when backgrounded; resume on foreground.
  - Sends via `shareLocation` RPC, throttled to ≥ 15 s.
  - Turning off / expiry / leaving group / sign out → `stopSharingLocation` + clear state.
  - Exposes `useLocationSharing()` → `{ status: 'off'|'sharing'|'paused'|'permission_denied', groupId, expiresAt, start(groupId, durationMs), stop() }`. UI must reflect real status (e.g. "Paused while Festie is in the background").
  - Before first start: explainer sheet ("Only members of <group> can see your location, only while Festie is open, for the time you choose. Positions are deleted within 15 minutes.").
- Friend locations: `getGroupLocations` every 30 s **only while the map screen is focused** (`useFocusEffect`); show "last seen N min ago".

### 5.7 App config (`apps/mobile/app.json`, `eas.json`)

- Delete the stray root `app.json` and root `eas.json` (wrong bundle id); `apps/mobile` is the only Expo project. Bundle id / package: `com.kevin.festivalapp`.
- Android permissions de-duplicated: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA` only; `blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.ACCESS_BACKGROUND_LOCATION"]`.
- iOS: no microphone permission (`expo-image-picker` plugin `microphonePermission: false`), `NSLocationWhenInUseUsageDescription` = accurate copy about group sharing + map position; camera/photos copy about totem photos. No background modes.
- Remove `expo-insights` unless it is disclosed (prefer removal).
- `eas.json`: production/preview env documents required vars; nothing secret committed.

### 5.8 Design rules for new/changed UI

- Use tokens from `@festival/ui/theme` and existing primitives; add primitives to `@festival/ui` instead of one-off styles when reused twice.
- Accessibility: every icon-only control gets `accessibilityLabel` + `accessibilityRole`; hit areas ≥ 44×44; `textSecondary` must meet WCAG AA for body text (raise opacity if needed — a "smooth" token tweak, not a redesign).
- Destructive actions use a consistent destructive style + confirmation.
- Empty, loading, error, and offline states for every data screen.

---

## 6. Content & admin tooling

- Delete `seed-data/coachella-2026.json` and `seed-data/lollapalooza-2026.json` (fabricated lineups under real trademarks).
- `seed-data/demo-festival.json`: clearly fictional "Festie Demo Fest", `is_demo: true`, `status: published`, upcoming dates in 2027, fictional artists, real coordinates of a large open public space so the map works, stage coordinates inside it, accent color.
- `apps/admin-tools`: validate input (schema check with precise errors: ids are UUIDs, times have offsets, sets within festival dates, stage/artist references exist, end > start, lat/lng ranges), support `status`, `is_demo`, coordinates, bump `version` automatically on change; `--dry-run`. Add CSV import (`stages.csv`, `artists.csv`, `sets.csv`) → JSON converter documented in `docs/festival-data.md` so real festival data can be entered from public schedules with a `source_url`.

## 7. Verification gates (must pass before merge)

1. `npm run build` and `npm run lint` (tsc) — zero errors.
2. `npm run test` — domain, sync-engine, data-access unit tests.
3. `npm run db:test` — spins a throwaway local Postgres 16 (`/usr/lib/postgresql/16/bin`), loads `supabase/tests/local/supabase-stubs.sql` (roles `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`/`auth.jwt()`/`auth.role()` from `request.jwt.claims`, `storage.buckets`/`storage.objects`/`storage.foldername`, `extensions` schema with `uuid-ossp` + `pgcrypto`), applies migrations 001→007 in order, then runs `supabase/tests/rls.sql` assertions, and also re-applies 007 a second time to prove idempotency. Must cover every row of §2.5/§2.6 including negative cases (wildcard invite codes, self-insert into group_members, admin escalation, tampering with others' meetups, email column hidden, storage cross-group access, block filtering, account-deletion cascade).
4. `deno check` on edge functions (if deno can be installed).
5. `npx expo export --platform ios` in `apps/mobile` succeeds (Metro + Hermes bundle).
6. `.github/workflows/ci.yml` runs gates 1–3 (and 5 if fast enough) on push/PR.

## 8. Ownership map (who edits what during the overhaul)

| Slice | Owns |
|---|---|
| BE-DB | `supabase/migrations/**`, `supabase/tests/**`, `scripts/db-test.sh`, root `package.json` script `db:test`, `seed-data/**`, `apps/admin-tools/**`, `docs/festival-data.md` |
| DA | `packages/data-access/**`, `packages/sync-engine/**`, `packages/domain/**`, `packages/map-utils/**` |
| BE-FN | `supabase/functions/**`, `supabase/config.toml` |
| MOBILE-A (shell) | `apps/mobile/app/_layout.tsx`, `app/index.tsx`, `app/+not-found.tsx`, `app/auth/**`, `app/settings/**`, `apps/mobile/src/providers/**`, `apps/mobile/src/config/**`, `packages/ui/**`, `apps/mobile/app.json`, `apps/mobile/eas.json`, `apps/mobile/package.json`, root `app.json`/`eas.json` deletion, template leftovers |
| MOBILE-B (features) | `apps/mobile/app/(tabs)/**`, `apps/mobile/src/state/**`, `apps/mobile/src/location/**`, `apps/mobile/src/hooks/**`, `packages/notification-utils/**` |
| DOCS | `docs/**` (except `festival-data.md`), `apps/mobile/app/legal/**`, `README.md`, `.github/workflows/ci.yml` |
