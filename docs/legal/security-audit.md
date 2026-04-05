# Security Audit — Hardcoded Secrets & Environment Variables

**Last updated: April 5, 2026**
**Scope:** Full codebase scan of `festival_app_codex` repository

---

## Executive Summary

**Result: CLEAN — No hardcoded secrets found.**

All API keys, tokens, and passwords are loaded from environment variables. No sensitive credentials exist in committed source files.

---

## Scan Results

### Secrets Inventory

| Secret | Variable Name | Location | Classification | Status |
|--------|--------------|----------|---------------|--------|
| Supabase Service Role Key | `SUPABASE_SERVICE_ROLE_KEY` | `.env` (gitignored) + Supabase dashboard | Server-side only | ✅ Clean |
| Supabase Anon Key | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env` (gitignored); bundled into app at build time | Public (protected by RLS) | ✅ Clean |
| Supabase Anon Key (alt name) | `EXPO_PUBLIC_SUPABASE_KEY` | Fallback alias in `packages/data-access/src/supabase.ts:11` | Public (protected by RLS) | ✅ Clean |
| Mapbox Access Token | `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | `.env` (gitignored); bundled into app at build time | Public (Mapbox URL-restricted recommended) | ✅ Clean |
| Supabase URL | `EXPO_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | `.env.example` shows project URL | Public (project reference only) | ✅ Acceptable |
| Apple Team ID | `Z94VZGABD8` | `apps/mobile/eas.json` | Build config only (not a secret) | ✅ Acceptable |
| Apple App ID | `6761392490` | `apps/mobile/eas.json` | Build config only (not a secret) | ✅ Acceptable |

### Files Checked

| File | Result |
|------|--------|
| `packages/data-access/src/supabase.ts` | ✅ Uses `process.env.EXPO_PUBLIC_*` only |
| `packages/data-access/src/` (all) | ✅ No hardcoded secrets |
| `apps/mobile/app/` (all screens) | ✅ No hardcoded secrets |
| `apps/admin-tools/src/seed-festival.ts` | ✅ Uses `process.env.SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY` |
| `supabase/functions/_shared/helpers.ts` | ✅ Uses `Deno.env.get('SUPABASE_URL')` and `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` |
| `supabase/functions/` (all) | ✅ Uses `Deno.env.get()` only |
| `apps/mobile/eas.json` | ✅ Contains build config identifiers (Apple Team ID, App ID) — not secrets |
| `.env.example` | ✅ Contains placeholder values only, no real keys |
| `.gitignore` | ✅ Properly excludes `.env`, `.env.local`, `.env*.local` |

---

## Key Findings & Notes

### 1. EXPO_PUBLIC_ Prefix Awareness
Variables prefixed with `EXPO_PUBLIC_` are **intentionally bundled into the app binary** and visible to anyone who reverse-engineers the binary. This is expected behavior for:
- `EXPO_PUBLIC_SUPABASE_URL` — The Supabase project URL is not a secret; it's the public endpoint.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — The anon key is a public key by design, protected by Row-Level Security (RLS) policies at the database level. Supabase's architecture explicitly allows this key to be public.
- `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` — Mapbox tokens can be URL/scope-restricted in the Mapbox dashboard. **Recommended action:** Set up token scoping in Mapbox to allow only the required styles and restrict to your app's domain.

**Critical:** The `SUPABASE_SERVICE_ROLE_KEY` does NOT use the `EXPO_PUBLIC_` prefix and is never bundled into the client app. ✅

### 2. Supabase URL in .env.example
The Supabase project URL (`https://lzxewkfxdibohzqbqmiu.supabase.co`) is visible in `.env.example`. This is acceptable — the project URL is:
- Required for any API call and discoverable by anyone who uses the app.
- Not a secret — it is the public API endpoint.
- Not sufficient alone to access any data (requires the anon or service role key).

### 3. Apple Team ID & App ID in eas.json
`Z94VZGABD8` (Team ID) and `6761392490` (App ID) are committed in `apps/mobile/eas.json`. These are:
- Standard identifiers used for code signing and distribution.
- Not secrets — Apple does not treat these as confidential.
- Required in the build config file.

---

## Environment Variables Reference

All variables that must be set before building or running:

```
# Server-side only (admin tools + Supabase Edge Functions)
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<never-commit-this>

# Mobile app (bundled into binary — use public/anon values only)
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key-safe-to-bundle>
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=<mapbox-public-token>

# Edge Functions (set via Supabase dashboard → Project Settings → Edge Functions)
SUPABASE_URL=<auto-set by Supabase runtime>
SUPABASE_SERVICE_ROLE_KEY=<auto-set by Supabase runtime>
SUPABASE_ANON_KEY=<set manually in Supabase dashboard>
```

---

## Recommendations

1. **Mapbox token scoping** — In the Mapbox dashboard, restrict your public token to only the styles and APIs your app uses. This limits exposure if the token is extracted from the binary.
2. **Key rotation plan** — Establish a procedure to rotate the Supabase anon key if it is ever compromised (unlikely due to RLS, but good practice).
3. **Periodic re-scan** — Re-run this audit before each major release using: `git grep -rn "sk_\|service_role\|private_key\|password\s*=" -- "*.ts" "*.tsx" "*.js" "*.json"`
4. **CI secret scanning** — Consider adding a secret scanning step to your CI pipeline (e.g., GitHub's built-in secret scanning or `trufflehog`).
