# Intellectual property review: Festie v1

Last reviewed: October 5, 2026, against the v1 code on this branch.

**This is an engineering checklist, not legal advice.** It records the content rules the code enforces
and the checks a person must still do. If you can, have a lawyer review the app name and the festival
content before a commercial launch.

## 1. Content rules for festival data

Festie shows festival schedules. What the app displays, and what it deliberately does not, is enforced by
the admin tooling and the database ([`../festival-data.md`](../festival-data.md) section 3 is the operating
procedure):

| Rule | How it is enforced |
|---|---|
| **Sample festival is fictional.** "Festie Demo Fest" uses invented artist names, is marked `is_demo` and shown with a "Sample" badge | `seed-data/demo-festival.json`; app badge and sort order (§5.5 of the contract) |
| **Real festivals are factual data from official public sources**: festival, stage and artist names, dates, set times. No descriptions, bios, editorial text or ticket information | Strict validator in `apps/admin-tools` (unknown fields are errors); there are no description or bio columns |
| **Every published real festival records its source** (`source_url`, the organizer's public schedule page) | Validator refuses to publish without it; database check `festivals_published_requires_source` (`status = 'draft' or is_demo or source_url is not null`); migration 007 reset legacy rows without a source to draft |
| **Names are used nominatively**, only to identify the festival, stages and artists, with a disclaimer of affiliation on every festival screen and in the Terms | `FESTIVAL_DISCLAIMER` in `apps/mobile/src/components/FestivalNotes.tsx`; Terms §8 |
| **No logos, wordmarks, posters, official maps, artwork or brand colours** | `image_url` and `map_asset_url` must be null (validator); artists have no image column in the seed format; accent colours are chosen by us and used only as pastel fills |
| **No artist photos** unless licensed in writing; v1 shows none (artists are shown as monogram initials, `ArtistMonogram.tsx`) | No artist image field is accepted by `festival:seed` |
| **Map data** comes from Mapbox tiles (OpenStreetMap-based) and coordinates from public map data, never from a festival's site map | Coordinates only (`latitude`/`longitude`/bounds); no map image upload path |
| **Corrections and takedowns:** if an organizer asks, unpublish first (`status: draft`), then fix or remove | [`../festival-data.md`](../festival-data.md) sections 3–4; support page asks users to report schedule mistakes |

Why this approach: schedule facts (who plays where and when) are generally not protected by copyright,
while the organizer's presentation (logos, artwork, descriptions, photos, map designs) is. Festival and
artist names are trademarks used here only to refer to them. This reasoning has not been reviewed by a
lawyer; it is why the rules above are strict.

Earlier versions of this document described the use as "non-commercial fair use"; that framing is wrong
for an App Store app and is not relied on. Festie avoids copying protected expression instead.

## 2. User content

Users upload totem photos and write names and meetup text. The Terms of Use (§5) give us only the licence
needed to run the service, prohibit infringing content (§4) and provide reporting; reported content is
removed with `npm run admin -- reports:remove-content`. Copyright complaints go to the support email.

## 3. App name, icon and store listing

- [ ] **Trademark search for "Festie"** in the classes for software and apps (Nice classes 9 and 42) in
      every country you launch in, using the official search tools (USPTO Trademark Search, EUIPO / TMview,
      UKIPO), plus an App Store search for similar names. Record the result here.
- [ ] **App icon and splash: replace before submission.** `apps/mobile/assets/images/icon.png` (and the
      splash and Android icons in the same folder) are still the Expo project-template artwork, which shows
      Expo's logo. App Review rejects template icons, and the logo is Expo's mark. An original Festie icon
      is required (owned by the mobile shell, `apps/mobile/app.json` assets).
- [ ] Store listing: no festival or artist names in the app name, subtitle or keywords; screenshots show
      the demo festival or real schedules without logos or artwork.
- `com.kevin.festivalapp` and the `festivalapp://` scheme are generic identifiers in the developer's own
  namespace.

## 4. Third-party software and services

| Component | Licence / terms | Obligation |
|---|---|---|
| React Native, Expo SDK and modules, expo-router, @expo/vector-icons | MIT | None in-app |
| @supabase/supabase-js | MIT | None in-app |
| @rnmapbox/maps (React Native wrapper) | MIT | None in-app |
| Mapbox Maps SDK for iOS/Android (native, v11, pulled in by @rnmapbox/maps) | Mapbox Terms of Service (proprietary, not open source) | Keep the Mapbox logo and attribution visible on the map; stay within your Mapbox plan; use only a public `pk.` token in the app |
| Map tiles (Mapbox, OpenStreetMap data) | Mapbox ToS; OpenStreetMap ODbL | Attribution "© Mapbox © OpenStreetMap" is shown by the map control; do not hide it |
| TanStack Query, Zustand, react-native-mmkv, react-native-nitro-modules, piexifjs | MIT | None in-app |
| Space Mono font (`apps/mobile/assets/fonts`) | SIL Open Font License 1.1 (Expo template font) | None for embedding |

Verify before each release: `npx license-checker --production --summary` (or an equivalent) from
`apps/mobile`, and confirm the Mapbox attribution on a device ([`../qa-checklist.md`](../qa-checklist.md) §14).

## 5. Open items

- [ ] Trademark search done and recorded (§3).
- [ ] Original app icon and splash in place (§3).
- [ ] Each published real festival checked against its `source_url` with no copied artwork or text (§1).
