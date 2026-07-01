export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="rounded-2xl border border-border bg-card p-10 shadow-[var(--shadow-card)]">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Coming soon</p>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          {description ??
            "This module is scaffolded in the sidebar. Full functionality ships in an upcoming iteration."}
        </p>
      </div>
    </div>
  );
}
