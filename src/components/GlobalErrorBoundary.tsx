import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

interface GlobalErrorBoundaryProps {
  children: ReactNode;
}

interface GlobalErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Last-resort React error boundary. Catches render/lifecycle errors thrown
 * outside TanStack Router's per-route `errorComponent` (e.g. inside providers
 * or global toasters) so the user sees a real message instead of a blank page.
 */
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  state: GlobalErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Preserve real stack for Server Logs / devtools.
    console.error(error);
    this.setState({ info });
    try {
      reportLovableError(error, {
        boundary: "global_react_error_boundary",
        componentStack: info.componentStack ?? undefined,
      });
    } catch {
      /* reporting must never crash the fallback */
    }
  }

  private handleReset = () => {
    this.setState({ error: null, info: null });
  };

  private handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info } = this.state;
    const isDev = import.meta.env.DEV;

    return (
      <div
        role="alert"
        className="flex min-h-screen w-full items-start justify-center bg-background p-6"
      >
        <div className="w-full max-w-2xl space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">
              The app hit an unexpected error
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {error.message || "An unknown error occurred while rendering the page."}
            </p>
          </div>

          {isDev ? (
            <details
              open
              className="rounded-md border border-border bg-card p-3 text-left text-xs"
            >
              <summary className="cursor-pointer font-medium text-foreground">
                Stack trace (dev only)
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
                {error.stack || String(error)}
              </pre>
              {info?.componentStack ? (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
                  {info.componentStack}
                </pre>
              ) : null}
            </details>
          ) : null}

          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Reload page
            </button>
            <a
              href="/"
              className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
