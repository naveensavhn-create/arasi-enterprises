import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Share2, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customer/referrals")({
  head: () => ({ meta: [{ title: "Referrals — Arasi" }] }),
  component: CustomerReferralsPage,
});

function CustomerReferralsPage() {
  const { session } = useSession();
  const code = (session?.user.id ?? "").slice(0, 8).toUpperCase();
  const url = typeof window !== "undefined" ? `${window.location.origin}/?ref=${code}` : `/?ref=${code}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function share() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Arasi Enterprises", text: "Join Arasi Enterprises", url });
      } catch {
        // user cancelled
      }
    } else {
      copy(url);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Referrals</h1>
        <p className="text-sm text-muted-foreground">
          Share your code with friends. You'll earn rewards when they enroll.
        </p>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Share2 className="h-4 w-4 text-primary" /> Your referral
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Code</div>
            <div className="mt-1 flex items-center gap-2">
              <Input readOnly value={code} className="max-w-[200px] font-mono text-lg tracking-widest" />
              <Button variant="outline" size="icon" onClick={() => copy(code)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Share link</div>
            <div className="mt-1 flex items-center gap-2">
              <Input readOnly value={url} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copy(url)}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button onClick={share}>
                <Share2 className="mr-2 h-4 w-4" /> Share
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Your referrals
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Referral tracking will show here as friends sign up with your code.
        </CardContent>
      </Card>
    </div>
  );
}
