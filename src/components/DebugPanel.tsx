import { useEffect, useRef, useState } from "react";

/**
 * Dev-only floating debug panel. Captures window errors, unhandled promise
 * rejections, and `console.error` calls so runtime failures surface even when
 * a component silently renders nothing. Enable in production via
 * `?debug=1` or `localStorage.setItem("arasi:debug", "1")`.
 */
type DebugEntry = {
  id: number;
  kind: "error" | "rejection" | "console";
  message: string;
  stack?: string;
  at: string;
};

const MAX_ENTRIES = 50;

function shouldEnable(): boolean {
  if (typeof window === "undefined") return false;
  if (import.meta.env.DEV) return true;
  try {
    if (new URLSearchParams(window.location.search).get("debug") === "1") return true;
    if (window.localStorage.getItem("arasi:debug") === "1") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg, null, 2);
  } catch {
    return String(arg);
  }
}

export function DebugPanel() {
  const [enabled] = useState(shouldEnable);
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [open, setOpen] = useState(false);
  const idRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const push = (entry: Omit<DebugEntry, "id" | "at">) => {
      idRef.current += 1;
      const next: DebugEntry = {
        ...entry,
        id: idRef.current,
        at: new Date().toLocaleTimeString(),
      };
      setEntries((prev) => [next, ...prev].slice(0, MAX_ENTRIES));
    };

    const onError = (event: ErrorEvent) => {
      const err = event.error;
      push({
        kind: "error",
        message: event.message || (err instanceof Error ? err.message : "Unknown error"),
        stack: err instanceof Error ? err.stack : undefined,
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      push({
        kind: "rejection",
        message:
          reason instanceof Error
            ? reason.message
            : typeof reason === "string"
              ? reason
              : "Unhandled promise rejection",
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };

    const originalConsoleError = console.error;
    const wrappedConsoleError = (...args: unknown[]) => {
      try {
        const message = args.map(formatArg).join(" ");
        const stackArg = args.find((a): a is Error => a instanceof Error);
        push({
          kind: "console",
          message: message.slice(0, 2000),
          stack: stackArg?.stack,
        });
      } catch {
        /* never let logging crash the app */
      }
      originalConsoleError.apply(console, args as []);
    };
    console.error = wrappedConsoleError;

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      if (console.error === wrappedConsoleError) console.error = originalConsoleError;
    };
  }, [enabled]);

  if (!enabled) return null;

  const badgeColor =
    entries.length === 0
      ? "bg-emerald-500"
      : entries[0]?.kind === "console"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div
      // Keep out of the way of app UI. Skip during printing / screenshot tests.
      className="fixed bottom-3 right-3 z-[9999] print:hidden"
      data-testid="debug-panel"
    >
      {open ? (
        <div className="w-[min(92vw,420px)] rounded-lg border border-border bg-card/95 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <span className={`inline-block h-2 w-2 rounded-full ${badgeColor}`} />
              Runtime debug ({entries.length})
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setEntries([])}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                aria-label="Close debug panel"
              >
                ×
              </button>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-auto p-2 text-[11px]">
            {entries.length === 0 ? (
              <p className="p-3 text-center text-muted-foreground">
                No errors captured. Anything logged via <code>console.error</code>,{" "}
                <code>window.onerror</code>, or an unhandled rejection will appear here.
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="rounded border border-border/60 bg-background/60 p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">
                        {e.kind} · {e.at}
                      </span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words font-mono text-foreground">
                      {e.message}
                    </div>
                    {e.stack ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[10px] text-muted-foreground">
                          stack
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-snug text-muted-foreground">
                          {e.stack}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-2 text-xs font-medium text-foreground shadow-lg backdrop-blur hover:bg-accent"
          aria-label="Open runtime debug panel"
        >
          <span className={`inline-block h-2 w-2 rounded-full ${badgeColor}`} />
          Debug {entries.length > 0 ? `(${entries.length})` : ""}
        </button>
      )}
    </div>
  );
}
