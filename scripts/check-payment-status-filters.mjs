#!/usr/bin/env node
/**
 * CI guard: fail the build when a payments-related file uses a raw
 * PostgREST filter against `payments.status` without the `::text` cast.
 *
 * Background: PG15/16/17 rejects `WHERE status = 'paid'` on the
 * `payment_status` enum column with:
 *   ERROR: operator does not exist: payment_status = text
 * Every payments-status filter MUST go through the helpers in
 * `src/lib/payments/status-filter.ts` (`applyPaymentStatusEq`,
 * `applyPaymentStatusIn`, `applyPaymentStatusNotIn`) so the required
 * `status::text` cast lives in exactly one place.
 *
 * This scanner is intentionally pattern-based (no TS parse) so it runs in
 * a few milliseconds and can't be broken by transient type errors. It
 * complements the ESLint rule (which only fires when a payments file is
 * linted) by also catching new files/callsites the lint step may skip.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

/** Files/dirs whose contents describe the rule itself — never flag them. */
const ALLOWLIST = new Set(
  [
    "src/lib/payments/status-filter.ts",
    "scripts/check-payment-status-filters.mjs",
    "eslint.config.js",
    "tests/payments-status-cast.test.ts",
  ].map((p) => p.split("/").join(sep)),
);

/**
 * Only scan files that plausibly touch the `payments` table. Keeps false
 * positives at zero — other tables (memberships, plans, export_jobs...)
 * legitimately use `.eq("status", ...)`.
 */
const INCLUDE_PATTERNS = [
  /^src[\\/]lib[\\/]payments\.functions\.ts$/,
  /^src[\\/]lib[\\/]payments[\\/].*\.(ts|tsx)$/,
  /^src[\\/]routes[\\/].*payments.*\.(ts|tsx)$/,
  /^src[\\/]routes[\\/]api[\\/]public[\\/]razorpay[\\/].*\.(ts|tsx)$/,
  /^src[\\/]routes[\\/]api[\\/]public[\\/]hooks[\\/]reconcile.*\.(ts|tsx)$/,
  /^src[\\/]components[\\/]admin[\\/].*Payment.*\.(ts|tsx)$/,
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".output",
  ".vinxi",
  "coverage",
]);

/**
 * Patterns that indicate a raw uncast filter against `status`. We match
 * `.eq / .neq / .in / .not.in / .filter("status", ...)` — any variant that
 * would produce PostgREST `status=...` instead of `status::text=...`.
 */
const BAD_PATTERNS = [
  { re: /\.eq\(\s*["']status["']/g, label: '.eq("status", ...)' },
  { re: /\.neq\(\s*["']status["']/g, label: '.neq("status", ...)' },
  { re: /\.in\(\s*["']status["']/g, label: '.in("status", ...)' },
  { re: /\.not\(\s*["']status["']/g, label: '.not("status", ...)' },
  {
    re: /\.filter\(\s*["']status["']\s*,/g,
    label: '.filter("status", ...) — use "status::text"',
  },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function shouldScan(relPath) {
  if (ALLOWLIST.has(relPath)) return false;
  return INCLUDE_PATTERNS.some((re) => re.test(relPath));
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

const violations = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (!shouldScan(rel)) continue;
  scanned++;
  const src = readFileSync(file, "utf8");
  for (const { re, label } of BAD_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      violations.push({ file: rel, line: lineNumber(src, m.index), label });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\n✖ Found ${violations.length} uncast payments.status filter(s) in ${scanned} scanned file(s):\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.label}`);
  }
  console.error(
    `\nUse applyPaymentStatusEq / applyPaymentStatusIn / applyPaymentStatusNotIn` +
      ` from '@/lib/payments/status-filter' — they add the required ` +
      `status::text cast so PostgREST doesn't fail with "operator does not ` +
      `exist: payment_status = text".\n`,
  );
  process.exit(1);
}

console.log(
  `✔ payments.status filters clean (${scanned} payments-related file(s) scanned).`,
);
