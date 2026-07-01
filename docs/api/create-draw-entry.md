# `createDrawEntry`

Server function that creates (or returns) the caller's entry into a lucky draw.

- **Module:** `src/lib/draws.functions.ts`
- **Kind:** `createServerFn({ method: "POST" })` with `requireSupabaseAuth` middleware
- **Auth:** Authenticated user (any role). RLS on `draw_entries` enforces
  `customer_id = auth.uid()`.
- **Idempotent:** Yes. If the caller already has an entry for `drawId`, the
  existing row is returned instead of inserting a duplicate. Concurrent
  unique-key races (`23505`) are recovered by re-reading the winning row.
- **Testable handler:** `createDrawEntryHandler(input, { supabase, userId })`
  is exported for integration tests.

---

## Input

```ts
{
  drawId: string;        // required, UUID
  membershipId?: string; // optional, UUID — pin a specific membership
}
```

Raw input is passed through `inputValidator` unmodified; the handler runs
`safeParse` internally so schema failures throw a structured `DrawEntryError`
instead of a raw `ZodError`.

## Success response

Returns a single `draw_entries` row:

```ts
{
  id: string;              // uuid
  draw_id: string;         // uuid
  customer_id: string;     // uuid (= auth.uid())
  membership_id: string | null;
  entry_number: number;    // per-draw sequence assigned by DB trigger
  eligible: boolean;
  created_at: string;      // ISO 8601 timestamptz
}
```

The same shape is returned for:
- a fresh insert,
- an idempotent hit (existing entry for the same `drawId` + caller), and
- the recovered row after a concurrent-insert race.

---

## Error contract

All rejections throw a `DrawEntryError` **before** any `INSERT` is attempted.
The class serializes via `toJSON()` into:

```ts
{
  ok: false;
  error: "INVALID_INPUT" | "INVALID_ELIGIBILITY";
  reason: string;                        // stable machine code (see tables)
  message: string;                       // human-readable, safe to display
  details?: Record<string, unknown>;     // context for the specific reason
}
```

`DrawEntryError#status` is always `400`. Errors that are *not* `DrawEntryError`
(e.g. an unexpected DB failure) surface as plain `Error` and should be treated
as `500`.

### `error: "INVALID_INPUT"` (HTTP 400)

Thrown by Zod validation. **Never touches the database.**

| `reason`                    | `details`                                                                         | When                                                             |
| --------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `SCHEMA_VALIDATION_FAILED`  | `{ issues: Array<{ path: string; message: string }> }`                            | `drawId` missing/not UUID, `membershipId` present but not UUID.  |

Example:

```json
{
  "ok": false,
  "error": "INVALID_INPUT",
  "reason": "SCHEMA_VALIDATION_FAILED",
  "message": "Invalid draw id",
  "details": {
    "issues": [{ "path": "drawId", "message": "Invalid draw id" }]
  }
}
```

### `error: "INVALID_ELIGIBILITY"` (HTTP 400)

Thrown by server-side pre-flight or by the DB trigger / RLS layer. **Never
inserts a row.**

| `reason`                     | `details`                                    | When                                                                                     |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DRAW_NOT_FOUND`             | `{ drawId }`                                 | No `draws` row with that id (or FK `23503` from DB).                                     |
| `DRAW_CLOSED`                | `{ status }`                                 | Draw `status` is not `scheduled` or `open` (e.g. `closed`, `completed`, `cancelled`).    |
| `DRAW_NOT_OPEN_YET`          | `{ opens_at }`                               | `opens_at` is in the future.                                                             |
| `DRAW_ENTRIES_CLOSED`        | `{ closes_at }`                              | `closes_at` is in the past.                                                              |
| `NO_ACTIVE_MEMBERSHIP`       | — (omitted)                                  | Draw requires an active membership and the caller has none.                              |
| `PLAN_NOT_ELIGIBLE`          | `{ required_plan_id }`                       | Draw is plan-restricted and the caller has no active membership on that plan.            |
| `MEMBERSHIP_NOT_ELIGIBLE`    | `{ membershipId, required_plan_id \| null }` | Caller passed `membershipId` that isn't active / doesn't match the draw's plan.          |
| `NOT_ALLOWED`                | —                                            | RLS denied the insert (`42501`). Should not occur in normal use.                         |
| `TRIGGER_REJECTED`           | —                                            | `validate_draw_entry()` (or a `CHECK`) rejected. `message` carries the trigger's reason. |

Example:

```json
{
  "ok": false,
  "error": "INVALID_ELIGIBILITY",
  "reason": "PLAN_NOT_ELIGIBLE",
  "message": "Your membership plan isn't eligible for this draw.",
  "details": { "required_plan_id": "b7a1…" }
}
```

### Unmapped errors

Any other DB / network failure is re-thrown as a plain `Error` carrying the
underlying message. Treat these as `500 Internal Server Error`; do not display
`.message` directly to the user.

---

## Behavior guarantees

1. **Input validation runs first.** Malformed `drawId` / `membershipId` throws
   `INVALID_INPUT` before the DB is touched. Verified in
   `tests/create-draw-entry-eligibility.test.ts` with a spy on `insert()`.
2. **Idempotency.** A pre-flight `SELECT` on `(draw_id, customer_id)` short-
   circuits and returns the existing row.
3. **Eligibility gates precede INSERT.** Draw existence, status, open/close
   window, and membership/plan checks all throw `INVALID_ELIGIBILITY` before
   `.insert()` is called.
4. **Race recovery.** On `23505` from the unique index
   `(draw_id, customer_id)`, the handler re-reads the winning row and returns
   it — the caller never sees a duplicate-entry error for their own retry.
5. **Belt-and-braces.** DB trigger `validate_draw_entry()` and RLS on
   `draw_entries` remain the authoritative gates; any rejection they raise is
   mapped to `INVALID_ELIGIBILITY / TRIGGER_REJECTED` or `NOT_ALLOWED`.

## Client usage

```ts
import { useServerFn } from "@tanstack/react-start";
import { createDrawEntry, DrawEntryError } from "@/lib/draws.functions";

const join = useServerFn(createDrawEntry);

try {
  const entry = await join({ data: { drawId } });
  toast.success(`Joined — entry #${entry.entry_number}`);
} catch (err) {
  // Server functions rehydrate as plain objects; match on `error` + `reason`.
  const e = err as { error?: string; reason?: string; message?: string };
  if (e.error === "INVALID_ELIGIBILITY" && e.reason === "NO_ACTIVE_MEMBERSHIP") {
    toast.error("You need an active membership to enter this draw.");
  } else {
    toast.error(e.message ?? "Could not join the draw.");
  }
}
```

## Related

- Table: `public.draw_entries` (unique on `(draw_id, customer_id)`)
- Trigger: `validate_draw_entry()` on `draw_entries` insert
- RLS: `draw_entries.customer_id = auth.uid()` on INSERT / SELECT
- Tests: `tests/create-draw-entry-eligibility.test.ts`
