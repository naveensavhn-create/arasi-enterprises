/**
 * Static audit of every `createServerFn(...)` call site in the codebase.
 *
 * Enforces two invariants that the security plan requires:
 *   1. Every server function must declare `.inputValidator(...)` — even
 *      "no-arg" fns should validate that no unexpected payload was sent.
 *   2. Every server function must either:
 *        a) Attach `[requireSupabaseAuth]` via `.middleware([...])`, OR
 *        b) Explicitly mark itself public with a single-line comment
 *           `// PUBLIC_OK: <reason>` immediately above the export.
 *
 * Wired into CI (`.github/workflows/tests.yml`). Exits non-zero on any
 * violation with a machine-readable summary. Read-only: never mutates
 * source files.
 *
 * Run locally with:  bun run scripts/audit-server-fns.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type Finding = {
  file: string;
  exportName: string;
  line: number;
  issues: string[];
};

const ROOTS = ["src/lib", "src/routes"];
const FILE_PATTERN = /\.(functions|server)\.tsx?$|\.tsx?$/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

function auditFile(path: string): Finding[] {
  const source = readFileSync(path, "utf8");
  if (!source.includes("createServerFn")) return [];

  const findings: Finding[] = [];
  const lines = source.split("\n");

  // Match `export const <name> = createServerFn(...)`.
  const exportRe = /^\s*export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*createServerFn\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(exportRe);
    if (!m) continue;
    const exportName = m[1];

    // Grab the full chain: from this line until the terminating `);` line,
    // capped at 200 lines to avoid runaway parses.
    const chainLines: string[] = [];
    for (let j = i; j < Math.min(lines.length, i + 200); j++) {
      chainLines.push(lines[j]);
      if (/^\s*\);?\s*$/.test(lines[j]) && chainLines.length > 3) break;
      // Stop if we hit the next top-level export.
      if (j > i && /^\s*export\s+(const|function|async)\s+/.test(lines[j])) break;
    }
    const chain = chainLines.join("\n");

    const hasValidator = /\.inputValidator\s*\(/.test(chain);
    const hasAuthMiddleware =
      /\.middleware\s*\(\s*\[[^\]]*\brequireSupabaseAuth\b/.test(chain);

    // Look for an explicit `// PUBLIC_OK` marker on any of the 6 lines
    // immediately preceding the export declaration.
    const publicOk = lines
      .slice(Math.max(0, i - 6), i)
      .some((l) => /\/\/\s*PUBLIC_OK\b/.test(l));

    const issues: string[] = [];
    if (!hasValidator) {
      issues.push("missing .inputValidator() — every server fn must validate input");
    }
    if (!hasAuthMiddleware && !publicOk) {
      issues.push(
        "no `requireSupabaseAuth` middleware and no `// PUBLIC_OK: <reason>` marker",
      );
    }

    if (issues.length > 0) {
      findings.push({ file: path, exportName, line: i + 1, issues });
    }
  }

  return findings;
}

function main(): void {
  const files = ROOTS.flatMap((r) => walk(r)).filter((f) => FILE_PATTERN.test(f));
  const findings = files.flatMap(auditFile);

  if (findings.length === 0) {
    console.log(`✓ audit-server-fns: ${files.length} files scanned, 0 violations`);
    process.exit(0);
  }

  console.error(`✗ audit-server-fns: ${findings.length} violation(s)\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.exportName}`);
    for (const issue of f.issues) console.error(`      - ${issue}`);
  }
  console.error(
    `\nFix each violation by adding \`.inputValidator(...)\` and either\n` +
      `\`.middleware([requireSupabaseAuth])\` or a\n` +
      `\`// PUBLIC_OK: <reason>\` comment immediately above the export.`,
  );
  process.exit(1);
}

main();
