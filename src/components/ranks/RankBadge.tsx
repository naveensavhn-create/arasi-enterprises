import { Award, Crown, Gem, Medal, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tier visual identity. Codes are matched case-insensitively against the
 * rank code first, then the rank name, so admin-defined ranks like
 * "Silver Ambassador" or "Golden Ambassador" still resolve to a themed badge.
 */
export type RankTierKey = "lead" | "silver" | "gold" | "platinum" | "diamond";

type TierTheme = {
  key: RankTierKey;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  ring: string;
  badgeGradient: string;
  bannerGradient: string;
  bannerPattern: string;
  text: string;
  glow: string;
  chip: string;
};

const THEMES: Record<RankTierKey, TierTheme> = {
  lead: {
    key: "lead",
    label: "Bronze",
    Icon: Medal,
    ring: "ring-amber-700/40",
    badgeGradient: "from-amber-800 via-amber-600 to-orange-400",
    bannerGradient: "from-amber-900 via-amber-700 to-orange-500",
    bannerPattern:
      "radial-gradient(circle at 20% 20%, rgba(255,255,255,.25), transparent 40%), radial-gradient(circle at 80% 80%, rgba(0,0,0,.25), transparent 40%)",
    text: "text-amber-50",
    glow: "shadow-[0_10px_40px_-10px_rgba(180,83,9,.6)]",
    chip: "bg-amber-950/60 text-amber-100 border-amber-700/60",
  },
  silver: {
    key: "silver",
    label: "Silver",
    Icon: Award,
    ring: "ring-slate-300/60",
    badgeGradient: "from-slate-500 via-slate-300 to-slate-100",
    bannerGradient: "from-slate-600 via-slate-400 to-slate-200",
    bannerPattern:
      "linear-gradient(115deg, rgba(255,255,255,.35) 0%, transparent 30%, rgba(255,255,255,.25) 60%, transparent 90%)",
    text: "text-slate-900",
    glow: "shadow-[0_10px_40px_-10px_rgba(148,163,184,.7)]",
    chip: "bg-slate-100 text-slate-900 border-slate-400",
  },
  gold: {
    key: "gold",
    label: "Gold",
    Icon: Star,
    ring: "ring-yellow-400/60",
    badgeGradient: "from-yellow-600 via-yellow-400 to-yellow-200",
    bannerGradient: "from-yellow-600 via-amber-400 to-yellow-200",
    bannerPattern:
      "radial-gradient(circle at 30% 30%, rgba(255,255,255,.5), transparent 45%), radial-gradient(circle at 70% 70%, rgba(180,83,9,.35), transparent 50%)",
    text: "text-amber-950",
    glow: "shadow-[0_12px_40px_-10px_rgba(234,179,8,.75)]",
    chip: "bg-yellow-100 text-amber-900 border-yellow-500",
  },
  platinum: {
    key: "platinum",
    label: "Platinum",
    Icon: Crown,
    ring: "ring-cyan-200/70",
    badgeGradient: "from-slate-700 via-cyan-300 to-white",
    bannerGradient: "from-slate-800 via-cyan-400 to-slate-100",
    bannerPattern:
      "linear-gradient(120deg, rgba(255,255,255,.5) 0%, transparent 35%, rgba(14,116,144,.4) 70%, transparent 100%)",
    text: "text-slate-900",
    glow: "shadow-[0_14px_45px_-10px_rgba(103,232,249,.75)]",
    chip: "bg-cyan-50 text-slate-900 border-cyan-400",
  },
  diamond: {
    key: "diamond",
    label: "Diamond",
    Icon: Gem,
    ring: "ring-violet-300/60",
    badgeGradient: "from-indigo-600 via-fuchsia-400 to-cyan-300",
    bannerGradient: "from-indigo-700 via-fuchsia-500 to-cyan-300",
    bannerPattern:
      "radial-gradient(circle at 25% 25%, rgba(255,255,255,.55), transparent 40%), radial-gradient(circle at 75% 60%, rgba(168,85,247,.5), transparent 55%), radial-gradient(circle at 60% 90%, rgba(34,211,238,.45), transparent 50%)",
    text: "text-white",
    glow: "shadow-[0_16px_50px_-10px_rgba(217,70,239,.75)]",
    chip: "bg-indigo-950/70 text-white border-fuchsia-400/60",
  },
};

const ALIASES: Record<string, RankTierKey> = {
  lead: "lead",
  bronze: "lead",
  starter: "lead",
  silver: "silver",
  gold: "gold",
  golden: "gold",
  platinum: "platinum",
  diamond: "diamond",
};

export function resolveTier(input?: { code?: string | null; name?: string | null; tier_order?: number | null } | null): TierTheme {
  if (!input) return THEMES.lead;
  const haystacks = [input.code, input.name].filter(Boolean).map((s) => String(s).toLowerCase());
  for (const h of haystacks) {
    for (const key of Object.keys(ALIASES)) {
      if (h.includes(key)) return THEMES[ALIASES[key]];
    }
  }
  // Fall back to tier_order mapping (1..5)
  const order = Math.max(1, Math.min(5, input.tier_order ?? 1));
  const byOrder: RankTierKey[] = ["lead", "silver", "gold", "platinum", "diamond"];
  return THEMES[byOrder[order - 1]];
}

export function RankBadge({
  rank,
  size = "md",
  showLabel = true,
  className,
}: {
  rank?: { code?: string | null; name?: string | null; tier_order?: number | null } | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}) {
  const theme = resolveTier(rank);
  const dims =
    size === "sm" ? "h-8 w-8" : size === "lg" ? "h-16 w-16" : "h-12 w-12";
  const iconDims =
    size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-6 w-6";
  const { Icon } = theme;
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div
        aria-hidden
        className={cn(
          "relative grid place-items-center rounded-full ring-2 ring-offset-2 ring-offset-background",
          "bg-gradient-to-br",
          theme.badgeGradient,
          theme.ring,
          theme.glow,
          dims,
        )}
      >
        <Icon className={cn(iconDims, theme.text, "drop-shadow-sm")} />
        <Sparkles className={cn("absolute -top-1 -right-1 h-3 w-3", theme.text, "opacity-80")} />
      </div>
      {showLabel && (
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", theme.chip)}>
          {rank?.name || theme.label}
        </span>
      )}
    </div>
  );
}

export function RankBanner({
  rank,
  subtitle,
  right,
  className,
}: {
  rank?: { code?: string | null; name?: string | null; tier_order?: number | null } | null;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  const theme = resolveTier(rank);
  const { Icon } = theme;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-5",
        "bg-gradient-to-r",
        theme.bannerGradient,
        theme.glow,
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: theme.bannerPattern, mixBlendMode: "overlay" }}
      />
      <div className="relative flex items-center gap-4">
        <div
          className={cn(
            "grid place-items-center h-14 w-14 rounded-full bg-white/25 backdrop-blur-sm ring-2 ring-white/40",
          )}
        >
          <Icon className={cn("h-7 w-7", theme.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn("text-xs uppercase tracking-widest opacity-80", theme.text)}>
            Current Rank · Auto-assigned
          </div>
          <div className={cn("text-2xl font-bold truncate", theme.text)}>
            {rank?.name || "Unranked"}
          </div>
          {subtitle && (
            <div className={cn("text-sm opacity-90 mt-0.5", theme.text)}>{subtitle}</div>
          )}
        </div>
        {right && <div className={cn("flex-shrink-0", theme.text)}>{right}</div>}
      </div>
    </div>
  );
}
