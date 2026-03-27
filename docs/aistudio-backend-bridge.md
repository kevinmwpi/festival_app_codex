# AI Studio Front-End Backend Bridge (Updated)

This adapter now follows resource-style routes and uses Supabase Auth-backed identity for persisted user schedule/group data.

## Route contract

All routes are served by:

`/functions/v1/aistudio_frontend_adapter/*`

### Auth

- `POST /auth/magic-link`
  - body: `{ "email": "you@example.com", "app_origin": "https://app.example.com" }`
  - sends Supabase magic link email with canonical callback path `/auth/callback`.
- `POST /auth/oauth/start`
  - body: `{ "provider": "google" | "apple", "app_origin": "https://app.example.com" }`
  - returns provider `auth_url` and always uses canonical callback path `/auth/callback`.


Callback behavior is canonicalized everywhere to:

- `/auth/callback`

`app_origin` is optional; if omitted, the function falls back to `AISTUDIO_APP_BASE_URL` and then request origin.

### Festival read model

- `GET /festival-feed?festival_id=<uuid?>`
  - returns festival + stages + artists/set timings shaped for AI Studio UI.

### Groups (multi-group per user is supported)

- `GET /groups` (Bearer token required)
  - lists the caller's group memberships.
- `POST /groups` (Bearer token required)
  - body: `{ "group_name": "...", "festival_id": "...", "invite_code": "..." }`
  - creates a group and owner membership.
- `POST /group-memberships` (Bearer token required)
  - body: `{ "invite_code": "..." }`
  - joins an existing group by invite code.

### Schedule selections

- `GET /schedule-selections?festival_id=<uuid?>` (Bearer token required)
- `POST /schedule-selections` (Bearer token required)
  - body: `{ "set_id": "...", "note": "..." }`
- `DELETE /schedule-selections?set_id=<uuid>` (Bearer token required)

## Key design updates from feedback

1. **Auth direction**: account linkage is now tied to Supabase sessions created through magic link, Google, or Apple auth starts.
2. **Endpoint shape**: migrated from action-based payloads to route/resource-style endpoint paths.
3. **Schedule persistence**: added CRUD-style selection routes for `user_set_selections`.
4. **Group scope**: users can belong to multiple groups per festival (implemented naturally by `group_members` rows).
5. **Map POIs**: intentionally excluded for now.

## Recommended long-term architecture

Use this adapter as a transition layer, then gradually converge to:

- Supabase Auth directly in clients for sign-in/session handling.
- Dedicated REST resources (or PostgREST) per domain aggregate:
  - `/festivals/:id/feed`
  - `/groups`, `/groups/:id/members`
  - `/users/me/schedule-selections`
- Keep edge functions for logic that is cross-table, permission-sensitive, or provider-integrated.

This keeps auth secure, route contracts stable, and complex policy logic centralized.
