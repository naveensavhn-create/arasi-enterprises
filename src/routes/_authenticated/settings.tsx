import { createFileRoute } from "@tanstack/react-router";
import { Monitor, LayoutGrid, Rows3, PanelLeft, PanelLeftClose } from "lucide-react";
import { useUiPrefs, setUiPrefs, type SidebarMode, type Density } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Preferences — Arasi Enterprises" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const prefs = useUiPrefs();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Account</p>
        <h1 className="mt-1 text-2xl font-semibold">Preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Personalize how the workspace looks. Changes apply immediately and are saved on this device.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <SectionHeader
          icon={Monitor}
          title="Sidebar default"
          description="Choose how the sidebar opens on new sessions. You can still toggle it any time with the header button."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={prefs.sidebarMode === "expanded"}
            onClick={() => setUiPrefs({ sidebarMode: "expanded" as SidebarMode })}
            icon={PanelLeft}
            title="Expanded"
            desc="Show labels next to icons."
          />
          <OptionCard
            active={prefs.sidebarMode === "collapsed"}
            onClick={() => setUiPrefs({ sidebarMode: "collapsed" as SidebarMode })}
            icon={PanelLeftClose}
            title="Collapsed"
            desc="Icon-only rail to maximize workspace."
          />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
        <SectionHeader
          icon={LayoutGrid}
          title="Table density"
          description="Control row height across tables and data grids."
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <OptionCard
            active={prefs.density === "comfortable"}
            onClick={() => setUiPrefs({ density: "comfortable" as Density })}
            icon={LayoutGrid}
            title="Comfortable"
            desc="Roomy spacing for readability."
          />
          <OptionCard
            active={prefs.density === "compact"}
            onClick={() => setUiPrefs({ density: "compact" as Density })}
            icon={Rows3}
            title="Compact"
            desc="Tighter rows to fit more on screen."
          />
        </div>

        <div className="mt-5 rounded-lg border border-border bg-muted/40 p-3">
          <p className="mb-2 text-xs text-muted-foreground">Preview</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="density-cell">Name</th>
                <th className="density-cell">Plan</th>
                <th className="density-cell text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {["Aarav", "Diya", "Rohan"].map((n, i) => (
                <tr key={n} className="border-b border-border/60 last:border-0">
                  <td className="density-cell">{n}</td>
                  <td className="density-cell text-muted-foreground">Gold</td>
                  <td className="density-cell text-right tabular-nums">₹{(i + 1) * 1200}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Monitor;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function OptionCard({
  active,
  onClick,
  icon: Icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Monitor;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-left transition",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary/40"
          : "border-border bg-background hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{desc}</div>
      </div>
    </button>
  );
}
