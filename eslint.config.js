import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  // Payments-status guard: forbid raw `.eq("status", ...)` on payments
  // queries. Every payments-status filter MUST go through
  // `applyPaymentStatusEq` (or its `In`/`NotIn` siblings) in
  // `src/lib/payments/status-filter.ts` so the required `status::text` cast
  // stays in one place. See tests/payments-status-cast.test.ts.
  {
    files: [
      "src/lib/payments.functions.ts",
      "src/lib/payments/**/*.{ts,tsx}",
      "src/routes/**/payments*.{ts,tsx}",
      "src/routes/**/payments/**/*.{ts,tsx}",
      "src/routes/api/public/razorpay/**/*.{ts,tsx}",
      "src/routes/api/public/hooks/reconcile-*.{ts,tsx}",
      "src/components/admin/Payment*.{ts,tsx}",
      "src/components/admin/**/Payment*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='eq'][arguments.0.type='Literal'][arguments.0.value='status']",
          message:
            "Do not filter payments.status with a raw `.eq(\"status\", ...)` — the PostgREST enum comparison fails without a `::text` cast. Use `applyPaymentStatusEq` (or `applyPaymentStatusIn` / `applyPaymentStatusNotIn`) from '@/lib/payments/status-filter'.",
        },
      ],
    },
  },
  // The helper module itself uses `.filter(\"status::text\", ...)` (not
  // `.eq`), but disable the rule here so future edits to that file can add
  // internal test-only branches without tripping the guard.
  {
    files: ["src/lib/payments/status-filter.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  eslintPluginPrettier,
);

