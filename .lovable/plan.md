## Goal

Give every admin list/ledger page the same polling-fallback UX the payments page has, driven by the existing `paymentsPollingMs` cross-device preference so a single selector controls them all.

## Scope

Pages to update:
- `admin/memberships.tsx`
- `admin/customers.tsx`
- `admin/promoters.tsx`
- `admin/plan-deletions.tsx`
- `admin/membership-emails.tsx` (currently hard-coded 15s)

Not in scope: `plans.tsx`, `reports.tsx`, `email-preview.tsx`, `rewards.tsx`, `lucky-draw.tsx`, `settings.tsx` (not ledger/list surfaces, or already domain-specific).

## Approach

1. Rename the pref semantics to a shared admin-list interval — same key `paymentsPollingMs` in storage/DB (no migration), but expose a friendlier alias `useAdminListPollingMs()` from `src/lib/ui-prefs.ts` that returns the validated value via `normalizePollingInterval`.
2. Add a shared component `src/components/admin/PollingControls.tsx` that renders:
   - status badge (Live / Polling / Manual) — realtime-aware when a `liveConnected` prop is passed, otherwise just Polling/Manual
   - the same `<select>` used in payments, wired to `setUiPrefs({ paymentsPollingMs })` via `normalizePollingInterval`
   - optional right-slot for page-specific badges (e.g. "Last webhook")
3. Add a shared hook `useListRefetchInterval(liveConnected?)` returning the `refetchInterval` value with identical semantics to payments today (Off ⇒ false; when live-connected, cap at 120s).
4. Refactor `admin/payments.tsx` to use `PollingControls` + `useListRefetchInterval`, keeping the existing "Last webhook" badge in the right slot. No behavioral change.
5. Wire the other four pages:
   - Replace hard-coded `refetchInterval: 15_000` (`membership-emails`) with `useListRefetchInterval()`.
   - Add `refetchInterval: useListRefetchInterval()` to memberships/customers/promoters/plan-deletions main queries.
   - Render `<PollingControls />` in the header row of each page.

## UX

- Selector options unchanged: 30s / 60s / 2m / Off.
- Changing it anywhere updates every page instantly (already reactive via `useUiPrefs`) and syncs cross-device.
- When Off, list pages stop background refetching; a "Refresh" affordance is not added in this change — user can navigate or use existing action buttons.

## Technical details

- No new preference keys; reuse `paymentsPollingMs` from `public.user_ui_prefs`.
- All validation flows through `normalizePollingInterval` (already added).
- `PollingControls` accepts:
  ```ts
  { liveConnected?: boolean; lastEventLabel?: string; rightSlot?: ReactNode }
  ```
- `useListRefetchInterval(liveConnected = false)` returns:
  - `paymentsPollingMs === 0` ⇒ `false`
  - `liveConnected` ⇒ `Math.max(ms, 120_000)`
  - else ⇒ `ms`
- Typecheck via `bunx tsgo --noEmit`. The existing polling E2E continues to cover the payments-page path.

## Out of scope

- Per-page override of the interval (single global pref keeps the promise made in `/settings`).
- Realtime channels for the non-payments pages.
- Manual "Refresh now" buttons.
