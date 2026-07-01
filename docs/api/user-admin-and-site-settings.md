# API Reference — User Admin & Site Settings

> Runtime: TanStack Start server functions (`createServerFn`) on Lovable Cloud
> (managed PostgreSQL). No Prisma layer — schema is owned by SQL migrations
> and enforced by RLS + `SECURITY DEFINER` RPCs.

All server functions are called from the client with `useServerFn` and are
invoked as `POST /_serverFn/<id>` (or `GET` where noted). The
`requireSupabaseAuth` middleware attaches the caller's bearer token; the
handler receives `{ supabase, userId, claims }` on `context`.

Errors are thrown as plain `Error` — the client sees `{ error: { message } }`
with HTTP 500. Validation failures from Zod arrive the same way with a
readable message.

---

## 1. User Admin — `src/lib/user-admin.functions.ts`

Every function is gated by `assertAdmin(context)` (calls the
`public.has_role(_user_id, _role)` RPC). Non-admin callers get
`Forbidden: admin role required.`

Every mutating call writes to `public.admin_audit_log` via the service-role
client. Allowed `action` values are enforced by
`admin_audit_log_action_check`:
`user.revoked | user.restored | user.deleted | user.password_reset_email | user.password_generated`.

### 1.1 `listAllUsers` — GET

Returns every auth user joined with `profiles`, primary role, ban state, and
most recent membership number.

- **Auth:** admin
- **Input:** none
- **Backing RPC:** `public.admin_list_users()` (SECURITY DEFINER, admin-gated)
- **Response:** `AdminUserRow[]`
  ```ts
  {
    id: string; email: string | null; phone: string | null;
    full_name: string | null;
    role: 'admin' | 'promoter' | 'customer' | null;
    created_at: string; last_sign_in_at: string | null;
    banned_until: string | null; membership_number: string | null;
  }
  ```

### 1.2 `sendPasswordResetEmail` — POST

Sends a Supabase password-reset email to the target user.

- **Auth:** admin
- **Input:** `{ userId: uuid, reason: string(5..500) }`
- **Backend calls:**
  - `auth.admin.getUserById(userId)` → resolve email
  - `auth.resetPasswordForEmail(email)`
  - insert into `admin_audit_log` with `action = 'user.password_reset_email'`
- **Response:** `{ ok: true, sentTo: string }`
- **Errors:** `Target user has no email address.` if the auth row has no email.

### 1.3 `generateTemporaryPassword` — POST

Rotates the target user's password to a 16-char strong random string built
from `crypto.getRandomValues` (excludes look-alikes, guaranteed
upper/lower/digit/symbol, Fisher–Yates shuffle). Returns the plaintext once
so the admin can share it out-of-band.

- **Auth:** admin, **cannot target self**
- **Input:** `{ userId: uuid, reason: string(5..500) }`
- **Backend calls:**
  - `auth.admin.updateUserById(userId, { password })`
  - `admin_audit_log` insert (`user.password_generated`, `metadata.length = 16`)
- **Response:** `{ ok: true, password: string, email: string | null }`
- **Errors:**
  - `Use the account settings page to rotate your own password.` when `userId === caller`

### 1.4 `setUserBan` — POST

Revokes or restores access. Revoke is implemented as a ~100-year ban
(`ban_duration: '876000h'`); restore uses `'none'`. On revoke the target's
sessions are signed out (best-effort).

- **Auth:** admin, **cannot revoke self**
- **Input:** `{ userId: uuid, banned: boolean, reason: string(5..500) }`
- **Last-admin safeguard:** if the target holds the `admin` role and
  `public.count_active_admins() <= 1`, the call is rejected.
- **Response:** `{ ok: true }`
- **Audit action:** `user.revoked` or `user.restored`

### 1.5 `deleteUser` — POST

Hard-deletes the auth user (Supabase Admin API). FK cascades in the schema
remove dependent rows.

- **Auth:** admin, **cannot delete self**
- **Input:** `{ userId: uuid, reason: string(5..500) }`
- **Last-admin safeguard:** same rule as `setUserBan`.
- **Response:** `{ ok: true }`
- **Audit action:** `user.deleted`

### Postgres objects relied on

| Object | Kind | Purpose |
|---|---|---|
| `public.admin_list_users()` | RPC (SECURITY DEFINER) | Admin-only user listing |
| `public.has_role(uuid, app_role)` | RPC | RBAC check |
| `public.count_active_admins()` | RPC | Last-admin guard (excludes banned) |
| `public.admin_audit_log` | table | Immutable audit trail |
| `admin_audit_log_action_check` | CHECK | Allow-list of action strings |

---

## 2. Site Settings — `src/lib/site-settings.functions.ts`

Single-row table `public.site_settings` keyed by the fixed UUID
`00000000-0000-0000-0000-000000000001`.

### 2.1 `getSiteSettings` — GET (public)

Public read for branding rendered in the shell. Uses a
**publishable-key** client (no session, no service role) and only projects
safe columns; relies on a `TO anon` SELECT policy on `site_settings`.

- **Auth:** none
- **Input:** none
- **Response:** `SiteSettings | null`
  ```ts
  {
    brand_name: string; tagline: string | null;
    support_email: string | null; support_phone: string | null;
    primary_color: string; secondary_color: string; accent_color: string; // HSL triplet "H S% L%"
    heading_font: string; body_font: string;
    logo_url: string | null; favicon_url: string | null;
    footer_text: string | null; updated_at: string;
  }
  ```

### 2.2 `updateSiteSettings` — POST

Updates the single settings row.

- **Auth:** admin (inline `has_role` check; not a shared `assertAdmin` — same
  behavior)
- **Input:** all `SiteSettings` fields except `updated_at`. Validated with
  Zod:
  - `brand_name` 1..120
  - `tagline` ≤ 200, nullable
  - `support_email` valid email or empty/null
  - `support_phone` ≤ 40, nullable
  - `primary/secondary/accent_color` **must match** `^\d{1,3}\s+\d{1,3}%\s+\d{1,3}%$`
    (Tailwind HSL triplet, e.g. `220 70% 25%`)
  - `heading_font`, `body_font` 1..80
  - `logo_url`, `favicon_url` valid URL ≤ 500 or empty/null
  - `footer_text` ≤ 500
- **Side effects:** sets `updated_by = caller.userId`
- **Response:** the updated `SiteSettings` row
- **Errors:** `Forbidden: admin role required.` for non-admins; Zod messages
  for invalid input.

### Postgres objects relied on

| Object | Kind | Purpose |
|---|---|---|
| `public.site_settings` | table (1 row) | Branding + contact + theme tokens |
| `public.has_role(uuid, app_role)` | RPC | RBAC check for updates |
| RLS policies on `site_settings` | policy | `TO anon` SELECT for public read; admin-only UPDATE |

---

## Verification checklist

- [x] Compiles — all callers already consume these signatures (`admin/users.tsx`, `admin/settings.tsx`, root shell).
- [x] `admin_audit_log_action_check` accepts every action string emitted above (migrated previously).
- [x] `count_active_admins()` excludes banned admins → last-admin guard is correct.
- [x] `site_settings` public read uses publishable client + `TO anon` SELECT policy — no service role from the browser path.
- [ ] **Prisma:** not applicable. This project has no Prisma schema; all
      migrations are raw SQL run through the Lovable Cloud migration tool.
