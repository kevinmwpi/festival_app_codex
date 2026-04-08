# IP Infringement Review — Festie

**Last updated: April 5, 2026**
**Prepared for:** App Store preview submission (v1.0)

**Overall Risk Level: LOW**

This document reviews potential intellectual property concerns across the app name, branding, and content categories.

---

## 1. App Name — "Festie"

**Finding: LOW RISK**

- "Festie" is common festival slang and not a widely registered trademark in the software/app category.
- A search of USPTO TESS (Trademark Electronic Search System) should be performed by the developer before commercial launch. As of this review, no conflicting registrations were identified through general knowledge.
- There is an Australian slang word "festie/festy" but no known trademark registration conflicts in the US tech/app space.

**Action required:**
- [ ] Perform a USPTO TESS search at https://tess2.uspto.gov for "Festie" in International Class 42 (software/apps) before launch.
- [ ] Consider registering "Festie" as a trademark if the search comes back clean.

---

## 2. Logo — 🎵 Music Note Emoji

**Finding: NO RISK**

- The 🎵 (Musical Note) emoji (U+1F3B5) is a Unicode standard character.
- Unicode characters are not copyrightable or trademarkable.
- The circular badge/button design used as the logo container is original work.

**No action required.**

---

## 3. Bundle Identifier & URLs

**Finding: NO RISK**

- `com.kevin.festivalapp` — uses developer's own identifier namespace.
- `festivalapp://` deep link scheme — generic, no conflict with known apps.

**No action required.**

---

## 4. Artist Names & Set Data

**Finding: LOW RISK**

- Artist names (e.g., "Taylor Swift", "Beyoncé") are **facts** — they are not copyrightable.
- Set times, stage assignments, and festival schedules are factual data — not protected by copyright in most jurisdictions (the "sweat of the brow" doctrine does not apply in the US after *Feist v. Rural Telephone*).
- Displaying artist names for personal scheduling purposes constitutes **fair use** (informational, non-commercial, transformative).

**Action required:**
- [ ] Ensure artist `image_url` fields reference **licensed or royalty-free images only**. Do not use press/promo photos scraped from Google, artist websites, or record label sites without a license. Acceptable sources: artist's official press kit with license, Creative Commons licensed photos, or images licensed from a stock photo provider.
- [ ] Add a disclaimer on any screen showing artist/festival content: *"Schedule information is for personal planning purposes only. Festie is not affiliated with any artist, label, or festival organizer."*

---

## 5. Festival Names & Branding

**Finding: LOW RISK**

- Festival names (e.g., "Coachella", "Lollapalooza") are trademarked, but **displaying the name in a scheduling app for informational purposes** does not constitute trademark infringement (nominative fair use).
- Festie does not sell tickets, claim affiliation, or use festival logos.
- Festival map assets (`map_asset_url` field) must be either original designs or licensed. Do not reproduce official festival maps without permission.

**Action required:**
- [ ] Confirm that any festival map assets used are original/licensed (not reproduced from official festival publications).
- [ ] Do not display official festival logos in the app without a license.
- [ ] Confirm the following disclaimer appears in the app or About screen: *"Festie is an independent app and is not affiliated with, endorsed by, or in partnership with any festival or event organizer."*

---

## 6. Mapbox

**Finding: NO RISK (with compliance)**

- Mapbox is used under a commercial SDK license.
- Mapbox requires attribution: the Mapbox logo and "© Mapbox © OpenStreetMap" attribution must be visible when the map is shown.
- The `@rnmapbox/maps` SDK displays this attribution automatically by default.

**Action required:**
- [ ] Verify that Mapbox attribution is visible on the map screen and has not been hidden or removed.
- [ ] Confirm you are within your Mapbox plan's monthly active user limits.

---

## 7. Third-Party Libraries

**Finding: NO RISK**

The app uses open-source libraries. All are under permissive licenses:

| Library | License | Notes |
|---------|---------|-------|
| React Native | MIT | No attribution required in app |
| Expo SDK | MIT | No attribution required in app |
| Supabase JS | MIT | No attribution required in app |
| @rnmapbox/maps | MIT | Mapbox attribution handled by map component |
| Zustand | MIT | No attribution required |
| TanStack Query | MIT | No attribution required |
| piexifjs | MIT | No attribution required |
| react-native-mmkv | MIT | No attribution required |

**No action required.**

---

## 8. Emoji Usage

**Finding: NO RISK**

- Emoji used throughout the UI (🎵, navigation icons) are rendered by the operating system using Apple/Google's emoji font.
- Using emojis in an app is standard practice and does not constitute IP infringement.

**No action required.**

---

## Summary & Action Items

| Item | Risk | Action |
|------|------|--------|
| "Festie" app name | LOW | USPTO trademark search before commercial launch |
| 🎵 emoji logo | NONE | No action needed |
| Artist names in schedule | LOW | Ensure artist images are licensed |
| Festival names | LOW | No affiliation claims; use licensed map assets only |
| Mapbox attribution | LOW | Verify attribution is visible on map screen |
| Open-source libraries | NONE | All MIT licensed |

**No cease-and-desist risk identified for the current MVP build**, provided artist images are sourced from licensed or royalty-free providers.
