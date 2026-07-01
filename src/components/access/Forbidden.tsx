import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppRole } from "@/lib/roles.functions";

interface ForbiddenProps {
  required: AppRole | AppRole[];
  actual: AppRole | null;
  message?: string;
}

export function Forbidden({ required, actual, message }: ForbiddenProps) {
  const need = Array.isArray(required) ? required.join(" or ") : required;
  return (
    <section
      role="alert"
      aria-labelledby="forbidden-title"
      aria-describedby="forbidden-desc"
      className="flex min-h-[60vh] items-center justify-center p-6"
    >
      <div
        tabIndex={-1}
        autoFocus
        className="glass w-full max-w-md rounded-2xl border border-border/60 p-8 text-center shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        >
          <ShieldAlert className="h-7 w-7" />
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-destructive">
          403 · Access denied
        </div>
        <h1 id="forbidden-title" className="mt-2 text-2xl font-semibold">
          You don't have permission
        </h1>
        <p id="forbidden-desc" className="mt-2 text-sm text-muted-foreground">
          {message ??
            `This area is restricted to ${need} users. Your account is signed in as ${
              actual ?? "no role"
            }.`}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            asChild
            variant="outline"
            className="focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
          <Button
            asChild
            className="focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export class ForbiddenError extends Error {
  required: AppRole | AppRole[];
  actual: AppRole | null;
  constructor(required: AppRole | AppRole[], actual: AppRole | null) {
    super("Forbidden");
    this.name = "ForbiddenError";
    this.required = required;
    this.actual = actual;
  }
}
