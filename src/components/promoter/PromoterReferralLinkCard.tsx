import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2, Copy, Share2, Users2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMyPromoterReferral, type MyPromoterReferral } from "@/lib/user-profile.functions";

export function PromoterReferralLinkCard() {
  const fn = useServerFn(getMyPromoterReferral);
  const origin = useMemo(
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    [],
  );
  const { data, isLoading } = useQuery({
    queryKey: ["promoter", "referral", origin],
    queryFn: () => fn({ data: { origin } }) as Promise<MyPromoterReferral | null>,
  });

  if (isLoading || !data) return null;

  const copy = async (text: string, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Copy failed");
    }
  };

  const share = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as any).share({
          title: "Join Arasi Enterprises",
          text: "Sign up using my referral link:",
          url: data.referral_url,
        });
        return;
      } catch { /* fall through to copy */ }
    }
    copy(data.referral_url, "Link copied — share anywhere");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" /> Your referral link
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Share this link — customers who sign up with it are automatically linked to you.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">ID {data.display_id}</Badge>
          <Badge variant="outline" className="gap-1">
            <Users2 className="h-3 w-3" /> {data.referred_count} referred
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 rounded border bg-muted/40 p-2">
          <code className="flex-1 truncate font-mono text-xs">{data.referral_url}</code>
          <Button size="sm" variant="outline" onClick={() => copy(data.referral_url, "Link copied")}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link
          </Button>
          <Button size="sm" onClick={share}>
            <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Referral code:</span>
          <code className="font-mono">{data.referral_code}</code>
          <Button size="sm" variant="ghost" className="h-6 px-2"
            onClick={() => copy(data.referral_code, "Code copied")}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
