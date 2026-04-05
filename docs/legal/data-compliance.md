# Data & Compliance — Festie

**Last updated: April 5, 2026**

This document maps every data type collected by Festie to its App Store privacy label, collection purpose, storage location, sharing scope, and retention policy. Use this as the reference for completing Apple's App Store Privacy Nutrition Label.

---

## Apple App Store Privacy Nutrition Label

### Data Used to Track You
**None.** Festie does not use any data to track users across apps or websites owned by other companies, and does not share data with data brokers or advertising networks.

### Data Linked to You

| Category | Data Type | Purpose | Storage | Shared With |
|----------|-----------|---------|---------|-------------|
| **Contact Info** | Email address | Authentication (OTP login), account identity | Supabase PostgreSQL | Not shared externally |
| **Location** | Precise GPS (lat/lng/heading/accuracy) | Real-time group location sharing on festival map | Supabase PostgreSQL (5-min rolling) | Group members only |
| **User Content** | Totem photos | Group meetup photos displayed in-app | Supabase Storage (public bucket) | Group members |
| **User Content** | Chat messages | In-group communication | Supabase PostgreSQL | Group members |
| **Identifiers** | User ID (UUID) | Internal account identifier | Supabase PostgreSQL | Not shared externally |

### Data Not Linked to You

| Category | Data Type | Purpose | Storage |
|----------|-----------|---------|---------|
| **Usage Data** | Set selections & festival selections | Personal schedule building | Supabase PostgreSQL + local SQLite |
| **Other** | Display name, avatar type/value | In-app identity within groups | Supabase PostgreSQL |
| **Other** | Group memberships, meetup details | Social coordination | Supabase PostgreSQL + local SQLite |
| **Other** | Scheduled notification metadata | Local reminders for sets/meetups | On-device MMKV only |

---

## Full Data Inventory

### 1. Email Address
- **Collected at:** Account creation / sign-in
- **Purpose:** OTP authentication; account identification
- **Stored:** Supabase Auth + `users` table (PostgreSQL)
- **Shared:** Not shared externally; visible to Supabase as processor
- **Retention:** Until account deletion
- **Mandatory:** Yes — required for account creation

### 2. Display Name
- **Collected at:** Profile setup after first login
- **Purpose:** Shown to group members to identify the user
- **Stored:** `users` table (PostgreSQL) + local SQLite cache
- **Shared:** Visible to users in the same group
- **Retention:** Until account deletion
- **Max length:** 80 characters

### 3. Avatar (type + value)
- **Collected at:** Profile setup
- **Purpose:** Visual identifier shown to group members
- **Stored:** `users` table (PostgreSQL) + local SQLite cache
- **Shared:** Visible to users in the same group
- **Retention:** Until account deletion

### 4. GPS Location (lat, lng, heading, accuracy)
- **Collected at:** Only when user explicitly enables location sharing in the group map screen
- **Purpose:** Show user's pin on group festival map in real time
- **Stored:** `location_shares` table (PostgreSQL) — 5-minute rolling window only
- **Shared:** Visible to members of the user's group only (RLS enforced)
- **Retention:** Automatically filtered out after 5 minutes; no long-term retention
- **Permission:** `NSLocationWhenInUseUsageDescription` (foreground only)
- **Background location:** NOT collected in MVP v1.0

### 5. Festival Selections
- **Collected at:** When user follows a festival
- **Purpose:** Populate the user's schedule view
- **Stored:** `user_festivals` table (PostgreSQL) + local SQLite
- **Shared:** Not shared externally
- **Retention:** Until account deletion

### 6. Set Selections & Notes
- **Collected at:** When user taps to add a set to their schedule
- **Purpose:** Build personal schedule; show conflicts
- **Stored:** `user_set_selections` table (PostgreSQL) + local SQLite
- **Shared:** Not shared externally
- **Retention:** Until account deletion

### 7. Group Data (name, membership, invite codes)
- **Collected at:** When user creates or joins a group
- **Purpose:** Social coordination feature
- **Stored:** `groups`, `group_members`, `group_invite_generations` tables (PostgreSQL) + local SQLite
- **Shared:** Group name visible to members; invite codes are ephemeral
- **Retention:** Until the group is deleted

### 8. Meetup Data (title, time, location, notes)
- **Collected at:** When user creates a meetup within a group
- **Purpose:** Plan meeting points at the festival
- **Stored:** `meetups` table (PostgreSQL) + local SQLite
- **Shared:** Visible to group members only
- **Retention:** Until deleted by user or group deletion

### 9. Totem Photos
- **Collected at:** When user uploads a group photo for a meetup
- **Purpose:** Visual identifier for the group's meetup location
- **Storage:** Supabase Storage public bucket (`totems`)
- **Processing:** EXIF metadata is stripped before upload (no GPS/device data in photo)
- **Shared:** Publicly accessible via URL (bucket is public); visible to group members in-app
- **Retention:** Until meetup is deleted

### 10. Chat Messages
- **Collected at:** When user sends a group chat message
- **Purpose:** In-group communication
- **Stored:** `chat_messages` table (PostgreSQL)
- **Shared:** Visible to group members only (RLS enforced)
- **Retention:** Until deleted or group deletion

### 11. Authentication Session Tokens
- **Collected at:** After successful OTP verification
- **Purpose:** Maintain authenticated session without re-login
- **Stored:** On-device only (MMKV encrypted storage, key: `festival-auth`)
- **Shared:** Never sent to third parties; sent to Supabase for API authentication
- **Retention:** Until sign-out or session expiry (JWT expiry: 1 hour with auto-refresh)

### 12. Notification Metadata
- **Collected at:** When user schedules a reminder
- **Purpose:** Fire local push notifications for upcoming sets/meetups
- **Stored:** On-device only (MMKV, key: `festival-reminders`)
- **Shared:** Never leaves the device
- **Retention:** Until user removes reminder or uninstalls app

---

## Permissions Required

### iOS
| Permission | Usage String | Used For |
|-----------|-------------|---------|
| `NSLocationWhenInUseUsageDescription` | "Festie uses your location to show your position on the festival map and help friends find you." | Group location sharing (opt-in, foreground only) |
| `NSCameraUsageDescription` | Camera access for totem photos | Taking group photos |
| `NSPhotoLibraryUsageDescription` | Photo library access for totem photos | Selecting group photos from library |

### Android
| Permission | Used For |
|-----------|---------|
| `ACCESS_FINE_LOCATION` | Precise GPS for group location sharing |
| `ACCESS_COARSE_LOCATION` | Fallback location |
| `CAMERA` | Totem photo capture |
| `READ_EXTERNAL_STORAGE` | Photo selection |

---

## Third-Party Data Processors

| Processor | Data Shared | Purpose | Privacy Policy |
|-----------|-------------|---------|---------------|
| Supabase | Email, profile, all server-side data | Database, auth, storage hosting | https://supabase.com/privacy |
| Mapbox | Map tile requests (no user PII) | Interactive festival map rendering | https://www.mapbox.com/legal/privacy |
| Expo / EAS | App binary delivery | Build and app distribution | https://expo.dev/privacy |

---

## Data Security Controls

- All data in transit encrypted via HTTPS/TLS
- Database protected by Row-Level Security (RLS) — users access only their own data and group-shared data
- Auth tokens stored in encrypted on-device storage (MMKV)
- File uploads limited to 5 MiB
- EXIF metadata stripped from photos before upload
- Rate limiting on all authentication endpoints (5 attempts per 15 minutes)
- Input validation and payload size limits on all server-side endpoints
- No service role key used in client app (anon key only, protected by RLS)

---

## App Store Submission Checklist

- [ ] Privacy policy URL submitted to App Store Connect
- [ ] Privacy Nutrition Label completed (use table above as reference)
- [ ] "Data Used to Track You" → **None**
- [ ] Location permission set to "When In Use" only (background NOT requested)
- [ ] Camera and Photo Library permissions declared
- [ ] No advertising frameworks declared (none used)
