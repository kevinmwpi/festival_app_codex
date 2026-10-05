# App Review notes (template)

Paste the text between the lines into App Store Connect → your version → App Review Information →
**Notes**, after replacing every `__PLACEHOLDER__`. Put the same email and code in **Sign-in required**
(User name = the demo email, Password = the 8-digit code).

Before every submission, follow [`release-runbook.md`](./release-runbook.md) §3.3: the demo login must work
on the production project, `demo:seed` must have run after migration 007, and the demo festival should be
shifted so its sets are "now playing" during the review window. The email and code are the
`DEMO_LOGIN_EMAIL` / `DEMO_LOGIN_CODE` Supabase function secrets; never commit them.

Every tap below was checked against the v1 code (screen labels in quotes are the exact on-screen text).
If you change a screen, update this file.

---

Festie helps groups of friends plan a music festival together: each person builds a schedule of the sets
they want to see, sees which sets their crew picked, sets up meetups (with an optional "totem" photo so
friends can spot the meeting point) and can choose to share their live location with their crew while the
app is open.

DEMO ACCOUNT
Sign-in uses a one-time code sent by email. For review, use:
- Email: __DEMO_LOGIN_EMAIL__
- Code: __DEMO_LOGIN_CODE__ (8 digits)
On the first screen enter the email and tap "Enter Festival", then type the 8-digit code and tap "Verify".
(The app may also email a code to that address; ignore it, the code above always works.) Then tick
"I agree to the Terms of Use and Privacy Policy" and tap "Continue". The demo account is already a
member of "Festie Demo Crew" for the sample festival "Festie Demo Fest" (fictional, marked "Sample"),
with three demo members, a meetup with a totem photo and live demo locations. You can delete the demo
account and sign in again with the same code at any time; it is recreated automatically.

USER-GENERATED CONTENT: REPORT, BLOCK, REMOVE (Guideline 1.2)
Users must accept our Terms of Use (zero tolerance for objectionable content and abusive users) before
seeing any crew content. Names, crew names and meetup text are checked against a disallowed-word filter.
- Open the "Group" tab, then tap "Festie Demo Crew".
- Report or block a person: tap a member (e.g. Maya) under Members, then "Report Maya" (choose a
  reason, optionally add details, tap "Send report") or "Block Maya" (confirm with "Block"). Blocked
  members' meetups, picks and location disappear; unblock in the same menu or in Settings, "Blocked users".
- Report a meetup or photo: on Jordan's meetup tap the "⋯" button, then "Report meetup" or
  "Report photo".
- Report the crew: scroll down and tap "Report this crew". Leave it with "Leave crew".
- Remove a member: crew admins see "Remove from crew" (and "Remove meetup") in the same menus. In the
  demo crew the admin is the demo member Maya, so the demo account sees Report and Block only. To see the
  admin actions, create a crew from the Group tab ("Create"); the creator is its admin and can
  remove anyone who joins with its invite code.
We review every report within 24 hours; offending content is removed and offending users are banned and
removed from all crews.

LOCATION SHARING
Location is only used while the app is open; there is no background location. Open the "Map" tab and
make sure "Festie Demo Crew" is selected: the demo members appear near the stages. Tap "Share
location" (or "Share my location" on the list view shown when the map is unavailable), read the
explanation, pick a duration (1, 4 or 8 hours, or "Until I stop", at most 24 hours) and tap "Start
sharing"; iOS then asks for location permission ("While Using the App"). Only members of that crew see
your position, and it is visible to your crew for at most 15 minutes after the last update, then deleted.
To stop, tap "Sharing location" and then "Stop sharing my location", or use Settings, "Stop sharing
location".

ACCOUNT DELETION (Guideline 5.1.1(v))
On the "Fests" tab tap your avatar (top right) to open Settings, then "Delete account", type DELETE and
tap "Delete my account". The account and its data are deleted on our server immediately.

FESTIVAL DATA
Festie is an independent app and is not affiliated with or endorsed by any festival, organizer or
artist; every festival screen says so. Real festival schedules are factual information (names, stages,
set times) entered from the organizers' public official schedules, with the source recorded; no logos,
artwork or photos are used. Published real festivals at submission: __REAL_FESTIVALS__. "Festie Demo
Fest" is fictional sample data.

PERMISSIONS
Location (While Using): your position on the festival map and, only when you turn on sharing, for your
crew. Camera and Photos: only when you add a totem photo to a meetup; location metadata is removed before
upload. Notifications: optional local reminders for sets and meetups (no push server).

Contact: __SUPPORT_EMAIL__

---
