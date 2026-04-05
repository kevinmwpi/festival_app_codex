# Privacy Policy — Festie

**Last updated: April 5, 2026**

Festie ("we", "our", or "us") is operated by Kevin Pi. This Privacy Policy explains how we collect, use, store, and protect information when you use the Festie mobile application ("App").

---

## 1. Information We Collect

### 1.1 Account Information
When you create an account, we collect:
- **Email address** — used to identify your account and send your one-time login code.
- **Display name** — the name shown to your group members inside the app.
- **Avatar** — an emoji or initials you choose to represent yourself.

### 1.2 Festival & Schedule Data
We collect and store:
- The festivals you add to your profile.
- The artist sets you select ("want to see" list).
- Notes you attach to selected sets.

### 1.3 Group & Social Data
When you create or join a group:
- Your group memberships and your role (member or admin).
- Meetup details you create: title, time, location (stage or custom map pin), and any notes.
- Totem photos you upload for a meetup (stored in our cloud storage).
- Group chat messages (if used).

### 1.4 Location Data
With your explicit permission, we collect:
- **Real-time GPS coordinates** (latitude, longitude, heading, and accuracy) when you enable location sharing within a group.
- Location data is shared **only with members of your group** and is retained for a **5-minute rolling window** — older location records are discarded automatically.
- We do **not** track your location in the background or outside of an active sharing session.

### 1.5 Device & Session Data
- Authentication session tokens (stored securely on your device using encrypted local storage).
- A generic client identifier (`festival-app`) sent with API requests for troubleshooting.

### 1.6 What We Do Not Collect
- We do not collect payment information.
- We do not collect contacts, call logs, or SMS data.
- We do not use third-party advertising SDKs or analytics platforms.
- We do not sell your data to any third party.

---

## 2. How We Use Your Information

| Data | Purpose |
|------|---------|
| Email address | Account authentication (OTP login) |
| Display name & avatar | Shown to group members to identify you |
| Festival & set selections | Build and display your personal schedule |
| Group & meetup data | Coordinate with friends at the festival |
| Location (when sharing) | Show your pin on the group map in real time |
| Totem photos | Display your group's meetup photo |
| Chat messages | In-group communication |

---

## 3. How We Share Your Information

We share your information **only in these limited circumstances**:

- **With your group members** — display name, avatar, location (when you enable sharing), and meetup details are visible to people in your group.
- **With our service providers** — we use Supabase (database and authentication), Mapbox (maps), and Expo/EAS (app delivery). These providers process data only to operate the App. See Section 5 for details.
- **If required by law** — we may disclose information if compelled by a valid legal process.

We do **not** share your data with advertisers, data brokers, or any other third party.

---

## 4. Data Retention

| Data Type | Retention |
|-----------|-----------|
| Account profile | Until you delete your account |
| Festival & set selections | Until you delete your account |
| Group memberships | Until you leave or delete the group |
| Meetup data | Until deleted by the group |
| Location shares | Automatically deleted after 5 minutes |
| Totem photos | Until the meetup is deleted |
| Chat messages | Until deleted by the group |
| Authentication sessions | Until you sign out or session expires |

To request deletion of your account and all associated data, contact us at the email in Section 8.

---

## 5. Third-Party Services

### Supabase
Database hosting, authentication, and file storage. Data is stored on Supabase-managed infrastructure. See [Supabase's Privacy Policy](https://supabase.com/privacy).

### Mapbox
Provides the interactive festival map. Your device may send tile-request metadata to Mapbox servers when viewing the map. See [Mapbox's Privacy Policy](https://www.mapbox.com/legal/privacy).

### Expo / EAS
Used to build and deliver the App. See [Expo's Privacy Policy](https://expo.dev/privacy).

---

## 6. Data Security

We implement technical safeguards including:
- All data in transit is encrypted via HTTPS/TLS.
- Authentication tokens are stored in encrypted on-device storage (MMKV).
- Database access is protected by Row-Level Security (RLS) — users can only access their own data and data shared by their groups.
- Uploaded photos have metadata (EXIF data) stripped before storage.
- Rate limiting is enforced on authentication and sensitive endpoints to prevent abuse.

No method of transmission or storage is 100% secure. If you discover a security concern, please contact us immediately at the address in Section 8.

---

## 7. Children's Privacy

Festie is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected such information, contact us and we will delete it promptly.

---

## 8. Your Rights

Depending on your location, you may have rights to:
- **Access** the personal data we hold about you.
- **Correct** inaccurate data.
- **Delete** your account and all associated data.
- **Object** to or restrict certain processing.

To exercise any of these rights, email us at: **privacy@festie.app** (or your designated support contact).

---

## 9. Changes to This Policy

We may update this policy from time to time. We will notify you of material changes by updating the "Last updated" date above. Continued use of the App after changes constitutes acceptance of the updated policy.

---

## 10. Contact

Kevin Pi
Email: **privacy@festie.app**
App: Festie (com.kevin.festivalapp)

---

*This privacy policy was written for the Festie v1.0 MVP release. It covers all data practices as of the date above.*
