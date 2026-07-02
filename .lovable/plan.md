# Scope

Nine changes across admin, promoter, and the shared preferences surface. Grouped by area so you can accept/reject each block.

---

## 1. Admin — view & edit full profile of any promoter/customer

- Add "View profile" action on `/admin/users` and `/admin/approvals` rows → opens a full profile drawer.
- Drawer has two modes: **View** (read-only, all fields incl. Aadhaar + document previews via signed URL) and **Edit** (admin can correct any field the user entered wrong).
- Editable fields: full name, email, phone, address (line1/2, city, state, postal code, country), Aadhaar number, referred-by promoter, role.
- Every save writes a diff entry to `admin_audit_log` (`profile.edited_by_admin`, `changed_fields`, before/after).
- Aadhaar edits are gated by a second confirmation dialog + reason field.

## 2. Draws — "New draw" option for admins

- Add a **Create draw** button on `/admin/lucky-draw` opening a dialog with:
  name, prize, mode (automated/manual), plan (optional), opens_at / closes_at / draw_at, winners_count, requires_active_membership.
- Zod-validated in `src/lib/draws.functions.ts` (`adminCreateDraw`, admin-only).
- After creation the list refreshes; if mode=automated the existing enrollment trigger fires.
- Also add a **Draw result now** button on each open/closed draw row (wraps `admin_pick_draw_winners_manual`).

## 3. Preferences — advanced options

Extend `/settings` and `user_ui_prefs` with:
- **Appearance**: theme (system/light/dark), density (comfortable/compact — already there), accent color.
- **Notifications**: email on KYC decisions, email on payment reminders, in-app toast duration.
- **Data & privacy**: default table page size (10/25/50/100), CSV date format, timezone override.
- **Admin-only** (rendered only when `has_role admin`): default polling interval for ledgers, default reminder-window (days), enable dev/debug panels, sticky filters across sessions, dashboard hero widgets toggle.

Migration adds new JSONB columns/keys to `user_ui_prefs`; existing hook `useSyncUiPrefsWithServer` extended, no breaking change.

## 4. Plan deletion — cleaner code, only truly removable

- Consolidate `deletePlan` logic in `src/lib/plans.functions.ts` behind a single guard: block if ANY membership (any status) references the plan; use the existing `prevent_plan_delete_with_memberships` trigger + a new `plan_is_deletable(_id)` RPC that returns `{deletable, blocking_memberships_count, active_count}`.
- `/admin/plans` shows a small chip on each row (Deletable / N memberships blocking) and disables the delete button with a tooltip when blocked.
- The `AlertDialog` copy now names the exact blocker count returned by the RPC (no more generic errors).

## 5. Users section — real, tabbed table

Right now `/admin/users` renders empty. Replace with:
- **Tabs**: All | Customers | Promoters | Admins.
- **Columns**: Display ID (see §6/§7), Name, Email, Phone, Role, KYC status, Registered on, Membership # (if any), Actions (View profile).
- Server-side search, sort by registered date, pagination (respecting new "default page size" pref from §3).
- Backed by extended `admin_list_users` RPC (adds `customer_display_id`, `promoter_display_id`, `kyc_status`).

## 6. Customer sequential IDs (start at 1001, continuous)

- New table `public.customer_ids (user_id UUID PK, display_id INT UNIQUE, assigned_at)` with a Postgres SEQUENCE starting at **1001**.
- Trigger on `user_roles` insert: when `role='customer'` and no id yet, allocate next sequence value. Backfill migration assigns IDs to existing customers ordered by `profiles.created_at` (deterministic, gap-free from 1001).
- Sequence guarantees continuous, non-recyclable integers; deletion doesn't reuse ids (documented).
- Surface `CUST-01001` style label in the users table, customer dashboard, KYC card.

## 7. Promoter 5-digit IDs + referral links

- New table `public.promoter_ids (user_id UUID PK, display_id CHAR(5) UNIQUE, referral_code TEXT UNIQUE, assigned_at)`.
- On promotion to `promoter`: allocate a random 5-digit id (10000–99999, retry on collision) and a URL-safe `referral_code` (10 chars).
- Referral link: `${site.origin}/auth?ref={referral_code}` — copyable from `/promoter/dashboard` and `/promoter/referrals`, and shown in admin's promoter profile drawer.

## 8. Referral link → onboarding flow

- `/auth` reads `?ref=` → stores it in `sessionStorage` before OAuth/email signup.
- New RPC `apply_referral_code(_code)` runs post-sign-in: sets `profiles.referred_by_promoter_id` if still NULL, writes `admin_audit_log` entry `customer.referral_applied` with source=`link`.
- Ignores invalid/expired codes silently; never overrides an existing referrer (matches existing `guard_profile_referrer` trigger).

## 9. Referral visibility

- **Promoter portal** (`/promoter/referrals`, existing page): add "Copy referral link" button + stat card (Total referred, Approved, Pending KYC, This month).
- **Admin portal**: new `/admin/referrals` page listing every referral (promoter → customer, joined_via link/manual, KYC status, membership #, date). Filter by promoter. CSV export.

---

## Technical details

**Migrations (single approval, ordered):**
1. `customer_ids` + sequence starting 1001 + backfill + assignment trigger.
2. `promoter_ids` + assignment trigger + referral code generator (base62, unique).
3. `user_ui_prefs` JSON schema extension (new keys are opt-in defaults, no breaking change).
4. RPCs: `plan_is_deletable`, `apply_referral_code`, extended `admin_list_users`, `admin_update_profile` (SECURITY DEFINER, admin-only, writes audit log).

**Server functions (`src/lib/*.functions.ts`):**
- `admin.functions.ts` — `adminUpdateProfile`, `adminGetProfile`.
- `draws.functions.ts` — `adminCreateDraw`, existing pick-winners already wired.
- `plans.functions.ts` — `getPlanDeletability`, wraps RPC.
- `referrals.functions.ts` (new) — `applyReferralCode`, `listMyReferrals` (promoter), `adminListReferrals`.

**UI:**
- New drawer `src/components/admin/UserProfileDrawer.tsx` (view + edit modes, react-hook-form + zod).
- New dialog `src/components/admin/CreateDrawDialog.tsx`.
- `src/routes/admin/users.tsx` rebuilt with Tabs + DataTable.
- `src/routes/admin/referrals.tsx` new.
- `src/routes/settings.tsx` new sections; admin-only block gated by `has_role`.

**Tests (Vitest, matching existing patterns):**
- `tests/admin-update-profile-audit.test.ts` — audit log diff + Aadhaar-edit guard.
- `tests/customer-display-id-sequence.test.ts` — starts at 1001, continuous, no reuse.
- `tests/promoter-referral-code.test.ts` — uniqueness, 5-digit id, `apply_referral_code` idempotency + no-overwrite.
- `tests/admin-create-draw.test.ts` — admin-only, valid inputs, auto-enrollment fires.
- `tests/plan-deletability.test.ts` — blocked when memberships exist, allowed otherwise.

**Security:** every new RPC is `SECURITY DEFINER` with explicit `has_role(auth.uid(), 'admin')` gate (or promoter-owner gate for referral queries). No new anon grants. All profile edits audit-logged.

---

## Out of scope (say if you want them in)

- Public "signup with referral" landing page redesign.
- Bulk edit / CSV import of profiles.
- Referral rewards / commissions.
- Rotating a promoter's referral code (can add on request).
