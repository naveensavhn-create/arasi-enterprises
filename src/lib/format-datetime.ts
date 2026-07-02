// Shared timezone-aware datetime formatting for draw views (and any other
// place we want consistent, tz-labeled timestamps across portals).

export const USER_TIMEZONE: string =
  (typeof Intl !== "undefined" &&
    Intl.DateTimeFormat().resolvedOptions().timeZone) ||
  "UTC";

type FmtOptions = {
  /** Include the short timezone name (e.g. "IST", "GMT+5:30"). Default true. */
  showTz?: boolean;
  /** Include the time component. Default true. */
  withTime?: boolean;
  /** Override the locale. Defaults to the user's locale. */
  locale?: string;
};

/** Formats an ISO timestamp in the user's local timezone with a short tz label. */
export function formatDateTime(
  iso: string | null | undefined,
  opts: FmtOptions = {},
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const { showTz = true, withTime = true, locale } = opts;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      ...(showTz && withTime ? { timeZoneName: "short" } : {}),
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

/** Full absolute tooltip: date, time (with seconds) and IANA zone name. */
export function formatDateTimeTooltip(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const base = new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "long",
    }).format(d);
    return `${base} (${USER_TIMEZONE})`;
  } catch {
    return d.toISOString();
  }
}

/** Compact relative label, e.g. "in 3h", "2d ago". Falls back to absolute. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffMs = t - Date.now();
  const abs = Math.abs(diffMs);
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  const rtf =
    typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl
      ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
      : null;
  const sign = diffMs >= 0 ? 1 : -1;
  const pick = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
    rtf ? rtf.format(sign * Math.round(value), unit) : `${Math.round(value)}${unit[0]}`;
  if (abs < min) return "just now";
  if (abs < hr) return pick(abs / min, "minute");
  if (abs < day) return pick(abs / hr, "hour");
  if (abs < 7 * day) return pick(abs / day, "day");
  return formatDateTime(iso, { showTz: false });
}
