# MVP Native Acceptance Checklist

Use this checklist for **manual native device verification** (iOS/Android).  
Primary target is **EAS builds installed via TestFlight / Play internal testing**, not Expo web.

## Scope guardrails (before testing)

- ✅ In scope: OTP auth, profile, personal schedule, conflict visibility, groups/invites, combined schedule, meetup + optional totem, offline cache/sync, local notifications, map support for schedule/meetup coordination.
- 🚫 Not in MVP: live friend location (Phase 2), session recap/stats (Phase 2b), BLE/local mesh chat.

## Account + profile

- [ ] OTP sign-in works end-to-end on device (request code + verify code).
- [ ] New profile creation works (display name + avatar fields persist after app restart).
- [ ] Profile update path works and reflects in group views.

## Schedule + conflicts

- [ ] Browse lineup loads from seeded festival data on first run.
- [ ] Selecting a set marks it selected in personal schedule.
- [ ] Deselecting a set removes it from personal schedule.
- [ ] Conflict chips/indicators appear when selected sets overlap.
- [ ] Set reminders are created/cancelled when selecting/deselecting sets.

## Groups + invites

- [ ] Create group succeeds and shows invite code/deep link.
- [ ] Join group from invite code works from another signed-in account/device.
- [ ] Group detail shows members and shared context after join.
- [ ] Combined group schedule renders selections from multiple members.

## Meetups + totem photo

- [ ] Create meetup works with title/time (+ optional stage/note/map pin).
- [ ] Meetup appears in group schedule/map contexts.
- [ ] Totem upload works and displays in group detail.
- [ ] Meetup reminder is scheduled on creation (notification permission granted).

## Offline + sync

- [ ] In airplane mode, reopen app and verify cached festival/schedule/group data is readable.
- [ ] In airplane mode, perform queued actions (set selection, meetup creation) and confirm local UI reflects pending changes.
- [ ] Reconnect network and verify queued mutations flush to Supabase.
- [ ] After reconnect and refresh, confirm server-backed state matches local pending state.

## Notifications + map

- [ ] Local notifications are delivered on physical device for sets/meetups.
- [ ] Notification behavior is acceptable after app background/foreground transitions.
- [ ] Map screen works at MVP level:
  - [ ] cached stage/meetup context still renders without live map token
  - [ ] live map tiles render when `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` is configured

## Beta distribution path

- [ ] iOS preview/production build generated with EAS.
- [ ] Build installed and validated through TestFlight.
- [ ] Android preview/production build generated with EAS.
- [ ] Build installed and validated through Play internal testing.
