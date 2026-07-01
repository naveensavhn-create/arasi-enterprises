import { cn } from "@/lib/utils";

export function Logo({ className, tagline = false }: { className?: string; tagline?: boolean }) {
  return (
    <div className={cn("flex flex-col items-start", className)}>
      <div className="flex items-center gap-2">
        <div
          className="grid h-10 w-10 place-items-center rounded-xl text-lg font-bold"
          style={{ background: "var(--gradient-gold-value)", color: "var(--navy)" }}
        >
          A
        </div>
        <div className="leading-tight">
          <div className="text-lg font-semibold tracking-tight">ARASI</div>
          <div className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
            Enterprises
          </div>
        </div>
      </div>
      {tagline && (
        <p className="mt-3 text-xs italic text-muted-foreground">Your Dream, Our Commitment.</p>
      )}
    </div>
  );
}
