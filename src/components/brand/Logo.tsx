import { cn } from "@/lib/utils";
import logoAsset from "@/assets/arasi-logo.png.asset.json";

export const ARASI_LOGO_URL = logoAsset.url;

export function Logo({
  className,
  tagline = false,
  size = 40,
  showWordmark = true,
  src,
}: {
  className?: string;
  tagline?: boolean;
  size?: number;
  showWordmark?: boolean;
  src?: string | null;
}) {
  const imgSrc = src && src.trim().length > 0 ? src : logoAsset.url;
  return (
    <div className={cn("flex flex-col items-start", className)}>
      <div className="flex items-center gap-3">
        <img
          src={imgSrc}
          alt="ARASI Enterprises"
          width={size}
          height={size}
          className="shrink-0 object-contain"
          style={{ height: size, width: size }}
        />
        {showWordmark && (
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">ARASI</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Enterprises
            </div>
          </div>
        )}
      </div>
      {tagline && (
        <p className="mt-3 text-xs italic text-muted-foreground">
          Building Dreams, Creating Opportunities.
        </p>
      )}
    </div>
  );
}
