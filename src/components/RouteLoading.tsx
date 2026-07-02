import { Loader2 } from "lucide-react";

interface RouteLoadingProps {
  label?: string;
}

/**
 * Shared pending-state UI for authenticated route boundaries.
 * Prevents a blank white page while `beforeLoad` awaits the auth session
 * or role lookup.
 */
export function RouteLoading({ label = "Loading…" }: RouteLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen w-full items-center justify-center bg-background"
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

interface RouteErrorProps {
  error: unknown;
  onRetry?: () => void;
}

export function RouteError({ error, onRetry }: RouteErrorProps) {
  const message =
    error instanceof Error ? error.message : "Something went wrong loading this page.";
  return (
    <div
      role="alert"
      className="flex min-h-screen w-full items-center justify-center bg-background p-6"
    >
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold text-foreground">We hit a snag</h1>
        <p className="text-sm text-muted-foreground break-words">{message}</p>
        <div className="flex justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Try again
            </button>
          ) : null}
          <a
            href="/auth"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go to sign in
          </a>
        </div>
      </div>
    </div>
  );
}
