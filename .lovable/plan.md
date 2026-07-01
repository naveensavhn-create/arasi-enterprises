## Admin Settings Expansion

Extend the Admin Settings area with two new sections: **User Management** and **Site Appearance**. Both are admin-only, gated by the existing `has_role('admin')` check.

### 1. User Management (`/admin/users`)

A single searchable table of all users pulled from `auth.users` + `profiles` + `user_roles`, with per-row actions:

- **View details** — email, phone, role, created date, last sign-in, membership number if any.
- **Reset password (email link)** — sends the standard password recovery email to the user's inbox.
- **Generate temporary password** — server generates a strong random password, updates the user via Auth Admin API, and displays it once in a copy-to-clipboard dialog with a "user must change on next login" note.
- **Revoke access** — signs the user out of all sessions and disables sign-in by banning the account (Auth Admin `ban_duration`), reversible via "Restore access".
- **Remove user** — hard delete via Auth Admin API (cascades to profile/roles). Confirmation dialog; blocked when the target is the last admin.

Every action is written to `admin_audit_log` with actor, target, action, and reason (min 5 chars, matching the existing pattern).

### 2. Site Appearance (`/admin/site-settings`)

A new `site_settings` singleton row storing:

- Brand name, tagline, support email/phone.
- Primary, secondary, accent color (HSL triplets that map to existing CSS tokens).
- Heading font and body font (choose from a curated Google Fonts list).
- Logo URL, favicon URL.
- Footer text.

The admin form previews changes live. On save, values are persisted to the DB and exposed to every page via a `SiteSettingsProvider` that:

- Reads settings once on app mount (public read via anon SELECT policy — these are non-sensitive branding values).
- Applies colors by writing CSS custom properties onto `:root` at runtime.
- Loads the selected Google Fonts via a `<link>` in the root head.
- Provides `useSiteSettings()` to any component that needs the brand name, logo, or footer.

### 3. Sidebar & Route Wiring

Add "Users" and "Site settings" entries to the admin section of `AppSidebar`. Both routes live under `_authenticated/admin/` so the existing admin gate + bearer middleware apply.

### 4. Guardrails

- Password generation and user deletion require the caller be admin (server-side `has_role` check) and additionally require the caller not to be deleting/banning themselves.
- Last-admin protection reused from the roles module.
- Generated passwords never persist in logs — the audit entry only records that a rotation happened.
- Site-settings writes are admin-only; reads are public (anon SELECT), same pattern as marketing content.

## Technical notes

**Database**

- New `public.site_settings` table (singleton, id = fixed uuid). Public SELECT to `anon`+`authenticated`; INSERT/UPDATE limited to admins via RLS.
- Extend `admin_audit_log.action` usage with new values: `user.password_reset_email`, `user.password_generated`, `user.revoked`, `user.restored`, `user.deleted`.
- New RPC `admin_list_users()` — SECURITY DEFINER, admin-gated — returns joined `auth.users` + `profiles` + roles data safely.
- New RPC `count_admins()` helper for last-admin protection.

**Server functions** (`src/lib/user-admin.functions.ts`, `src/lib/site-settings.functions.ts`)

- `listUsers`, `sendPasswordResetEmail`, `generateTemporaryPassword`, `setUserBan`, `deleteUser` — all gated with `assertAdmin`, all use `supabaseAdmin` loaded inside the handler for Auth Admin API access.
- `getSiteSettings` (public), `updateSiteSettings` (admin-only).

**Frontend**

- `src/routes/_authenticated/admin/users.tsx` — table, search, action dialogs, "show password once" modal.
- `src/routes/_authenticated/admin/site-settings.tsx` — themed form with live preview panel.
- `src/components/providers/SiteSettingsProvider.tsx` — mounts in `__root.tsx`, applies CSS vars and font links.
- Extend `src/components/layout/AppSidebar.tsx` with the two new items.

**Out of scope for this pass**

- Bulk user CSV import/export (already exists for memberships).
- Per-page layout customization beyond the global brand tokens.
- Rich-text footer or CMS pages.