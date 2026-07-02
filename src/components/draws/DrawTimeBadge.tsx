import { CalendarClock, DoorOpen, DoorClosed, Trophy, Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  formatDateTime,
  formatDateTimeTooltip,
  formatRelative,
  USER_TIMEZONE,
} from "@/lib/format-datetime";

export type DrawTimeKind = "opens" | "closes" | "draw" | "drawn";

const KIND_META: Record<
  DrawTimeKind,
  {
    label: string;
    Icon: typeof CalendarClock;
    className: string;
  }
> = {
  opens: {
    label: "Opens",
    Icon: DoorOpen,
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  closes: {
    label: "Closes",
    Icon: DoorClosed,
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  draw: {
    label: "Draw date",
    Icon: Trophy,
    className:
      "border-primary/40 bg-primary/10 text-primary",
  },
  drawn: {
    label: "Drawn",
    Icon: Crown,
    className:
      "border-primary/60 bg-primary/15 text-primary font-medium",
  },
};

type Props = {
  kind: DrawTimeKind;
  iso: string | null | undefined;
  /** Show the "Opens/Closes/…" prefix. Default true. */
  showLabel?: boolean;
  /** Show relative hint like "in 2h" / "3d ago". Default false. */
  showRelative?: boolean;
  className?: string;
};

export function DrawTimeBadge({
  kind,
  iso,
  showLabel = true,
  showRelative = false,
  className,
}: Props) {
  const meta = KIND_META[kind];
  const Icon = meta.Icon;
  const absent = !iso;
  const primary = absent ? "—" : formatDateTime(iso, { showTz: true });
  const relative = !absent && showRelative ? formatRelative(iso) : null;
  const tooltip = absent
    ? "Not scheduled"
    : `${meta.label} · ${formatDateTimeTooltip(iso)}`;

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 whitespace-nowrap font-normal",
        !absent && meta.className,
        absent && "text-muted-foreground",
        className,
      )}
      aria-label={`${meta.label}: ${absent ? "not scheduled" : primary} (${USER_TIMEZONE})`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {showLabel && <span className="font-medium">{meta.label}:</span>}
      <span>{primary}</span>
      {relative && (
        <span className="text-[10px] opacity-70">· {relative}</span>
      )}
    </Badge>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
