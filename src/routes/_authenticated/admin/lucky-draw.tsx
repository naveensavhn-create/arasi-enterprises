import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Ticket, CalendarClock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/lucky-draw")({
  head: () => ({ meta: [{ title: "Lucky Draw — Admin" }] }),
  component: AdminLuckyDrawPage,
});

function AdminLuckyDrawPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lucky Draw</h1>
        <p className="text-sm text-muted-foreground">
          Run monthly draws for customers who paid all installments on time.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> Next draw
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Not scheduled yet.
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Ticket className="h-4 w-4 text-primary" /> Eligible entries
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Customers with all installments paid in the qualifying window.
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-4 w-4 text-primary" /> Past winners
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">No draws yet.</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Enable draws</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ask to enable the lucky draw module and we'll scaffold the <code>draws</code>,{" "}
          <code>draw_entries</code>, and <code>draw_winners</code> tables with a secure server
          function that picks winners at random from eligible entries.
        </CardContent>
      </Card>
    </div>
  );
}
