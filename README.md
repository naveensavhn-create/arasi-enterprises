# ARASI Enterprises ERP

Advance-booking & monthly-installment membership ERP built on TanStack Start,
Lovable Cloud (Postgres + Auth + Storage), Razorpay, and Resend.

## Portals

- **Admin** — memberships, plans, payments ledger, KYC approvals, draws,
  reminders, audit log, exports.
- **Promoter** — referred customers, draws feed (public winner list).
- **Customer** — enrollment, installments, membership status, lucky-draw
  entries.

## API documentation

Server functions live in `src/lib/*.functions.ts` (client-callable RPC via
`createServerFn`). Public webhook / cron endpoints live under
`src/routes/api/public/*`.

Reference docs:

| Area                        | Doc                                                   |
| --------------------------- | ----------------------------------------------------- |
| Draws — create entry        | [`docs/api/create-draw-entry.md`](docs/api/create-draw-entry.md) |
| User admin & site settings  | [`docs/api/user-admin-and-site-settings.md`](docs/api/user-admin-and-site-settings.md) |

Each API doc specifies inputs, success shape, and the exact error contract
(`error` code, `reason`, `message`, `details`) with HTTP status.

## Tests

```bash
bunx vitest run
```

Notable suites:

- `tests/create-draw-entry-eligibility.test.ts` — pins the `createDrawEntry`
  error contract (`INVALID_INPUT` / `INVALID_ELIGIBILITY`) and proves no
  `INSERT` fires on rejection.
- `tests/payment-detail-drawer.test.tsx` — admin payments drawer validation.
- `tests/reconcile-payments-input-validation.test.ts` — payment-status
  filter rejects malformed input before any PostgREST call.
