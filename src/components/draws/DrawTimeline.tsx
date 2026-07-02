import { ChevronRight } from "lucide-react";
import { DrawTimeBadge, type DrawTimeKind } from "./DrawTimeBadge";
import { cn } from "@/lib/utils";

type Props = {
  opensAt?: string | null;
  closesAt?: string | null;
  drawAt?: string | null;
  drawnAt?: string | null;
  /** Show "Opens/Closes/…" prefix on each badge. Default false for compactness. */
  showLabels?: boolean;
  className?: string;
};

const STEPS: { kind: DrawTimeKind; key: keyof Omit<Props, "showLabels" | "className"> }[] = [
  { kind: "opens", key: "opensAt" },
  { kind: "closes", key: "closesAt" },
  { kind: "draw", key: "drawAt" },
  { kind: "drawn", key: "drawnAt" },
];

/**
 * Compact horizontal timeline: Opens → Closes → Draw at → Drawn at.
 * Each step is a DrawTimeBadge with its own tooltip. Wraps on narrow screens.
 */
export function DrawTimeline({
  opensAt,
  closesAt,
  drawAt,
  drawnAt,
  showLabels = false,
  className,
}: Props) {
  const values: Record<string, string | null | undefined> = {
    opensAt,
    closesAt,
    drawAt,
    drawnAt,
  };

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="list"
      aria-label="Draw timeline"
    >
      {STEPS.map((step, i) => (
        <div key={step.kind} role="listitem" className="flex items-center gap-1.5">
          <DrawTimeBadge
            kind={step.kind}
            iso={values[step.key]}
            showLabel={showLabels}
          />
          {i < STEPS.length - 1 && (
            <ChevronRight
              className="h-3.5 w-3.5 text-muted-foreground/60"
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}
