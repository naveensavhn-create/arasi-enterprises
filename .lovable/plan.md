# Arasi ERP — Security Hardening Plan

## Reality check (things I must be honest about)

Some layers in your spec are **platform-managed on Lovable Cloud** and I cannot reconfigure them from inside the app. I will not pretend to implement them:

- **L1/L2 network + TLS**: Cloudflare edge, TLS 1.3, HSTS, cert renewal — already enforced. No Nginx/ports/geo-IP surface.
- **L3 DB exposure**: Postgres is not publicly reachable; only backend access.
- **L4 password hashing**: Supabase Auth already bcrypts passwords server-side.
- **L13 OS hardening / L17 base backups / L18 base infra scan**: platform-managed (daily PITR).
- **Rate limiting**: the backend has **no standard rate-limiting primitive**. I will build an ad-hoc Postgres-backed token bucket for the highest-risk endpoints only (login, KYC submit, exports, winner-pick). It is best-effort — not a WAF replacement.

Everything below is application-layer work I can actually ship.

## Batches (shipped one at a time, tests after each)

### Batch A — P0 foundations (schema + baseline)
1. **AES-256-GCM field encryption** for `profiles.aadhaar_no`, `pan_no`, `bank_account`, `ifsc`, `nominee_*`.
   - Encryption key: new secret `FIELD_ENCRYPTION_KEY` (generated, 64 chars).
   - Ciphertext stored as `bytea` in new `*_enc` columns; plaintext columns dropped after backfill.
   - `encryptField()` / `decryptField()` helpers in `src/lib/crypto.server.ts` using `node:crypto`.
   - All admin server fns transparently decrypt on read (per your choice: always decrypted for admins). Promoters/customers never receive these fields (RLS already enforces).
   - Backfill migration runs inside a single transaction; rollback-safe.
2. **HTTP security headers + strict CSP** in `src/routes/__root.tsx` head + a shared `withSecurityHeaders()` wrapper for every `/api/public/*` route.
   - CSP: `default-src 'self'`, script/style nonces, no `unsafe-eval`, allow-list Supabase + Razorpay + Cloudinary origins.
   - Adds: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy` (camera/mic/geo off), `Cross-Origin-Opener-Policy: same-origin`.
3. **Immutable audit log**: trigger on `admin_audit_log` that rejects `UPDATE`/`DELETE` from any role except `service_role`. Add `ip_address` and `user_agent` capture via `getRequestIP()`/`getRequestHeader('user-agent')` in every audit-writing server fn.
4. **RBAC sweep + CI guard**: script `scripts/audit-server-fns.ts` that parses every `*.functions.ts`, asserts each `createServerFn` either declares `PUBLIC_OK` marker or uses `requireSupabaseAuth` + explicit `has_role` check. Wired into `.github/workflows/tests.yml`; fails CI on unguarded fns. Fix any gaps it finds.
5. **Zod validator audit**: same AST script asserts every server fn has an `.inputValidator()`. Backfill schemas where missing.

### Batch B — P1 auth, sessions, files, detection
6. **MFA (TOTP) for admins** via Supabase `auth.mfa`.
   - `/admin/mfa-setup` enrollment page (QR + backup codes).
   - `enforce_admin_mfa` server middleware: reads `aal` claim; if admin without `aal2` and `mfa_grace_started_at` > 7 days, blocks all admin server fns with `MFA_REQUIRED`.
   - Banner in admin layout while inside grace period.
7. **Session hygiene**:
   - Absolute lifetime cap (12h) + idle timeout (30min) enforced in `_authenticated/route.tsx` via `last_activity_at` cookie.
   - `logoutEverywhere()` server fn calling `auth.admin.signOut(userId, 'global')`.
   - New `/settings/sessions` page listing active refresh tokens; revoke individually.
8. **File security overhaul** for KYC uploads:
   - Server fn `uploadKycDoc` that: validates size (≤5MB), sniffs magic bytes (must be JPEG/PNG/PDF — extension alone rejected), renames to `<uuid>.<ext>`, stores in **private** bucket only.
   - Delete public read policy from any KYC bucket; access exclusively via short-TTL signed URLs from admin server fn.
   - Verify all existing storage buckets — flip any KYC-adjacent bucket to private.
9. **Rate limiting (ad-hoc, Postgres-backed)**:
   - New table `rate_limit_buckets(key, window_start, count)` with `try_consume(key, limit, window_s)` SQL function.
   - Applied to: password sign-in attempts (10/15min/IP), KYC submit (5/hour/user), CSV/export server fns (10/hour/user), `pick_draw_winners` (3/hour/admin), impersonation start (5/day/admin).
10. **Monitoring & alerts**:
    - New table `security_alerts(id, severity, kind, subject_user_id, ip, meta, created_at)`.
    - `pg_cron` job every 5min scanning `admin_audit_log` + `auth.audit_log_entries` for: >5 failed logins/15min/IP, role escalation, impersonation >30min, export volume anomalies, first-time-country logins.
    - Writes to `security_alerts` + inserts a `notifications` row for every super-admin.

### Batch C — P2 devsecops, secrets, rotation
11. **Secret rotation runbook** at `docs/security/secret-rotation.md` + a `verifyRequiredSecrets()` boot check in `src/start.ts` that logs an ERROR (does not crash) if `FIELD_ENCRYPTION_KEY`, `RAZORPAY_WEBHOOK_SECRET`, `LOVABLE_API_KEY` are missing at cold start.
12. **CI security gates** (`.github/workflows/tests.yml`):
    - `bun audit --production` (fail on high/critical).
    - `semgrep --config=p/owasp-top-ten --config=p/typescript` targeting `src/`, allowlisted findings only.
    - Custom `scripts/check-forbidden-patterns.ts`: no `dangerouslySetInnerHTML`, no raw SQL string interpolation, no `console.log` of `password|token|secret|aadhaar|pan|otp` identifiers.
13. **Security memory update** documenting intentional public surfaces (landing, `/api/public/*` webhooks with HMAC), the RBAC contract, and the encryption boundary.

## Technical details

- **Encryption format**: `<12-byte IV><ciphertext><16-byte GCM tag>` stored as single `bytea`. AAD = column name. Rotating the key requires re-encrypting; runbook covers it.
- **CSP nonce**: generated per SSR request, threaded through `__root.tsx` via `useServerFn(getCspNonce)`; applied to every inline `<script>` we emit (none today, but locks it down).
- **MFA gate**: server-side check `context.claims.aal === 'aal2'` inside a shared `requireAdminMfa` middleware composed after `requireSupabaseAuth`. No client-only bypass.
- **Rate limiter**: `try_consume` uses `INSERT ... ON CONFLICT DO UPDATE` with `pg_advisory_xact_lock(hashtext(key))` to serialize; returns `false` when over limit, server fn throws `RATE_LIMITED` (HTTP 429 equivalent surfaced to client as a friendly toast).
- **File magic bytes**: `file-type` package (pure JS, Worker-safe).
- **Semgrep**: run as a container in Actions; no local dependency.

## Ordering + review gates

I'll ship **Batch A**, run the full test suite, then stop for your review before starting Batch B, and again before Batch C. Every batch includes new tests. No batch touches business logic other than adding authorization/validation around it.

## What I explicitly won't do

- Add HTTP-level rate limiting at the edge (platform).
- Configure Nginx, TLS ciphers, DB IP allowlists, or OS packages (platform).
- Implement SMS OTP as an MFA factor (adds cost + MSG91 coupling; TOTP + backup codes cover the OWASP requirement). Can revisit if you need it.
- Encrypt `email`/`mobile` at rest — they'd break search, login lookup, and reminder delivery. Left in RLS-protected plaintext, which is standard for these fields.
