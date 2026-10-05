# Data inventory and compliance map: Festie v1

Last reviewed: October 5, 2026, against the v1 code on this branch.

Maps every piece of personal data to where it lives, who can read it, how long it is kept and which code
and tests back each statement in the [privacy policy](./privacy-policy.md) and the
[App Store privacy answers](../app-store-privacy.md). When the code changes, update the three documents
together. Section references (§) are to [`../v1-architecture.md`](../v1-architecture.md).

## 1. Server-side data (Supabase)

| Data | Table / location | Who can read it (enforced by) | Retention / deletion | Tests |
|---|---|---|---|---|
| Email | `auth.users.email`, `public.users.email` | Only the service role. Column grants expose `users(id, display_name, avatar_type, avatar_value, created_at)` to signed-in users, never `email` or `auth_user_id` (§2.4) | Deleted with the account (`auth.users` delete cascades through `users.auth_user_id`) | `supabase/tests/rls.sql` A5, C2 |
| Display name, avatar | `public.users` | Self and people sharing a crew (`private.shares_group_with`) | Until changed or account deleted; banned accounts keep the profile, the auth user and its email (`users:ban` only sets `ban_duration`) | rls.sql D |
| Followed festivals | `public.user_festivals` | Self only | Deleted with the account (cascade) | rls.sql F |
| Set picks | `public.user_set_selections` | Self, and crew members of a crew for the same festival unless blocked either way | Deleted with the account; picks of a deleted set are deleted with it | rls.sql F, J |
| Crews and memberships | `public.groups`, `public.group_members` | Members of that crew | Membership removed on leave/removal/deletion with admin hand-off; empty crews deleted (`private.repair_group_after_departure`) | rls.sql E, I, O; `supabase/tests/local/race-*.sql` |
| Meetups (title, time, stage, optional lat/lng pin, notes) | `public.meetups` | Crew members, minus meetups by people blocked either way | Creator or crew admin can delete; creator's meetups deleted with the account (FK cascade); crew deletion cascades | rls.sql G, J, O |
| Totem photos | Storage bucket `totems` (private, 5 MiB, `image/jpeg` only, path `<group>/<meetup>/<uuid>.jpg`) | Crew members via 1-hour signed URLs (`SIGNED_URL_TTL_SECONDS = 3600`, `packages/data-access/src/media.ts`); restrictive storage policy (§2.8) | Removed on replace/delete (best effort), on account deletion (`prepare_account_deletion` returns the paths, including those of crews that become empty; `delete-account` removes them), and otherwise by the weekly, operator-run `storage:sweep-orphans` (orphans older than 24 h). A crew deleted because its last member left (`leave_group` → `repair_group_after_departure`) deletes the meetup rows but not the files, so the policy promises "within about a week" | rls.sql L, O; `supabase/functions/delete-account/handler_test.ts`; `apps/admin-tools/test/storage-sweep.test.ts` |
| Live location (lat, lng, accuracy, heading, recorded_at) | `public.location_shares`, one row per user and crew | Crew members, only rows newer than 15 minutes and not blocked either way (RLS + `get_group_locations`) | Visible to the crew for at most 15 minutes after the last update, then deleted: purged by `share_location`/`get_group_locations` and by the `purge-stale-locations` cron job every 5 minutes; deleted immediately by `stop_sharing_location`, by the `group_members` delete trigger (leave/removal) and on account deletion | rls.sql H (H13, H17, H18), O |
| Reports (reporter, target, reason, details ≤ 500, text snapshot, status) | `public.reports` | Nobody through the API (no grants); only `report_content` writes; the operator reads with the service role | Kept as a moderation record. `reporter_id` is `on delete set null`, so a deleted reporter's reports remain without their identity; snapshots of reported text remain | rls.sql K, O |
| Blocks | `public.user_blocks` | The blocker only | Deleted by unblock or when either account is deleted (cascade) | rls.sql J |
| Rate-limit records (`key` = `user:<profile id>`, or `demo-login:ip:<address>` / `demo-login:global` / `demo-login:other`; action; timestamp). The IP-keyed row is written for **any** user whose emailed code Supabase Auth rejects: `verifyEmailCode` (`packages/data-access/src/auth.ts`) then calls `demo-login` for an 8–10 digit code, and the handler records `demo-login:ip:<address>` before it compares the email (`supabase/functions/demo-login/handler.ts`) | `public.rate_limit_events`, legacy `public.auth_attempts` | Nobody through the API (locked) | Rows older than 24 hours are deleted by `purge_rate_limit_events`, run hourly (cron `17 * * * *`), so each lives 24–25 hours | rls.sql M (M3, M10); `demo-login/handler_test.ts` |
| Moderation word list | `public.moderation_terms` | Locked | n/a (not personal data) | rls.sql A |
| Sign-in audit log (action, `actor_id`, `actor_username` = email, `traits` with user id/email, `ip_address`, timestamp) for every sign-in, code request, token refresh, sign-out and deletion | `auth.audit_log_entries` in the project database (no FK to `auth.users`, so account deletion does not remove it), and Supabase's log storage (dashboard → Logs → Auth) | Operator (service role / SQL editor); never exposed to the API | Privacy policy §5: at most 90 days. Database copy: writing is turned off (Authentication → Audit Logs → "Disable writing auth audit logs to project database") and the operator-scheduled cron job `purge-auth-audit-log` (daily, `43 3 * * *`) deletes rows older than 90 days ([`../release-runbook.md`](../release-runbook.md) §2.8). Log-storage copy: the plan's log retention, checked to be ≤ 90 days (§2.8). Emailed deletions also delete the person's rows at once (§8.2). In-app deletion relies on the 90-day limit (policy §6 says so) | n/a (platform; SQL in runbook §2.8/§8.2 run against a reproduction of the GoTrue tables) |
| Sign-in sessions and refresh tokens (`ip`, `user_agent`, `created_at`, `refreshed_at`) | `auth.sessions`, `auth.refresh_tokens` | Operator only | Deleted on sign-out of that session while online (`signOut({ scope: 'local' })`, `packages/data-access/src/auth.ts`) and on account deletion (FK cascade from `auth.users`); otherwise kept while usable (policy §5 says so) | n/a (platform) |
| Server request and edge-function logs (IP addresses, request paths, user id in Auth events) | Supabase log storage | Operator | The plan's log retention, ≤ 90 days (policy §5; checked in runbook §2.8). Functions log no PII: `describeError` keeps only name, status and code | `supabase/functions/_shared/http_test.ts` (describeError) |

Legacy `chat_messages` and `group_invite_generations` are locked (RLS on, no policies, no grants); chat
does not exist in v1.

## 2. On-device data

| Data | Storage | Cleared |
|---|---|---|
| Auth session (`festival-auth` / `supabase_session`) | MMKV in the app sandbox (no app-level encryption; iOS data protection applies) | Sign-out and account deletion (`packages/data-access` `signOut`/`deleteAccount`) |
| Profile cache (`profile-cache`) | MMKV | Sign-out, deletion |
| Offline cache (festivals, crews, members' display names, meetups, picks) and the sync queue | SQLite (`packages/sync-engine`); local `users` has no email column | Sign-out and deletion wipe it (`clearLocalUserData`); an involuntary session loss keeps it so unsynced writes survive (§5.1); a different account signing in wipes it first (`ensureLocalOwner`) |
| Location-sharing session `{ groupId, startedAt, expiresAt }` | MMKV | On stop, expiry, sign-out |
| Terms acceptance per account and `TERMS_VERSION` | MMKV `terms-acceptance` | Account deletion forgets it |
| Reminders | iOS local notifications (`packages/notification-utils`) | `cancelAllReminders()` on sign-out/deletion |
| Pending invite code from a deep link | MMKV `pending-invite-code` | After it is used |

Tests: `packages/data-access/test/local-owner.test.ts`, `signout-race.test.ts`, `session-auth.test.ts`,
`captive-portal.test.ts`; `packages/sync-engine/test/*`.

## 3. Collection points and permissions

| Feature | Permission / prompt | Data leaving the device |
|---|---|---|
| Sign-in | none | Email to Supabase Auth; the code email via the custom SMTP provider |
| Profile, crews, meetups, picks | none | As in §1 |
| Totem photo | Camera or Photos, asked when used (`expo-image-picker`, `microphonePermission: false`) | JPEG re-encoded by the picker (`quality: 0.8`, iOS compatible representation) with EXIF/XMP/IPTC stripped (`stripJpegMetadata`, `packages/data-access/src/media.ts`; tests in `groups-schedule.test.ts`, `meetups-totems.test.ts`) |
| Map | Location "When In Use", only if already granted for the user's own dot | None for the dot; Mapbox tile requests and the SDK's map-load (billing) events with an anonymous per-install id. Telemetry opt-out: `Mapbox.setTelemetryEnabled(false)` in `src/providers/app-providers.tsx`. **Unconfirmed on iOS**: `@rnmapbox/maps` 10.3.0 implements it there only as the legacy `MGLMapboxMetricsEnabled` user default, which Mapbox Maps SDK 11.18.2 may ignore; release-gated by the traffic check in [`../release-runbook.md`](../release-runbook.md) §5.4 step 4 |
| Location sharing | Location "When In Use", asked after "Start sharing" | Coordinates while sharing, foreground only (`watchPositionAsync` with `distanceInterval: 25`, heartbeat every 120 s, `src/location/LocationSharingProvider.tsx`) |
| Reminders | Notifications, asked at the first reminder | None (local notifications) |
| App updates | none | `expo-updates` request with app/runtime version, platform and the random `EAS-Client-ID` |

Not requested anywhere: background location (`isIosBackgroundLocationEnabled: false`,
`ACCESS_BACKGROUND_LOCATION` blocked), "Always" location, microphone (`RECORD_AUDIO` blocked), contacts,
tracking (no ATT prompt, no IDFA). `expo-insights` is not a dependency.

## 4. Processors

| Processor | Purpose | Data |
|---|---|---|
| Supabase | Database, Auth, Storage, Edge Functions | Everything in §1, in `__SUPABASE_REGION__` |
| `__EMAIL_PROVIDER__` | Sign-in code emails (custom SMTP) | Email address, email content |
| Mapbox | Map tiles and offline packs | IP address, device info, requested map area, anonymous per-install id used for monthly-active-user billing (no account data) |
| Expo (EAS Update) | App update checks | App version, platform, installation id |

Apple distributes the app; push notification services (APNs, Expo push) are not used by Festie. The
new-report notification ([`../release-runbook.md`](../release-runbook.md) §2.12) sends only the report id,
reason and target type, so the service that receives it gets no personal data and is not a processor.
Privacy policy §4 states that every processor is bound by contract to equal protection: check each
provider's data processing terms when choosing it.

## 5. User rights in the product

- Access/correct: Settings → Profile; a copy on request by email, answered with the procedure in
  [`../release-runbook.md`](../release-runbook.md) §8.2. The export covers everything in §1 for the
  account, including its `auth.sessions` (IP, device) and `auth.audit_log_entries` rows.
- Delete: Settings → Delete account (≤ 3 taps from Settings; type `DELETE`). Server steps: `delete-account`
  → `prepare_account_deletion` (admin hand-off, empty crews deleted, photo paths) → storage removal in
  batches of ≤ 1000 → `auth.admin.deleteUser` (cascade). The screen's list
  (`apps/mobile/app/settings/delete-account.tsx`) and the privacy policy §6 describe exactly this.
  Deletion requested by email follows the same steps ([`../release-runbook.md`](../release-runbook.md)
  §8.2) and also deletes the person's audit-log rows; deleting the user in the Supabase dashboard alone
  would skip the admin hand-off and the photos. Neither path can delete the copy of sign-in events in
  Supabase's log storage; it expires with the plan's log retention (≤ 90 days, policy §5–§6).
- Withdraw location consent: stop sharing or revoke the iOS permission.

## 6. Review checklist (each release)

- [ ] Any new table or column holding personal data is added to §1 with its policy and test.
- [ ] Any new SDK or network call is added to §3–§4, the privacy policy and `app-store-privacy.md`.
- [ ] The delete-account screen, `prepare_account_deletion` and privacy policy §6 still agree.
- [ ] The location retention copy is still "visible to your crew for at most 15 minutes after the last
      update, then deleted" everywhere it appears.
- [ ] `purge-auth-audit-log` is still scheduled, database audit logging is still off and the plan's log
      retention is still ≤ 90 days (privacy policy §5).
- [ ] The Mapbox telemetry traffic check ([`../release-runbook.md`](../release-runbook.md) §5.4 step 4)
      passed on this release's build, or `MapboxCommon`'s own opt-out has replaced the legacy key.
