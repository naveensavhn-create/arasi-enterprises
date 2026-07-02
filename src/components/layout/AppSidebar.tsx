import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  UserCog,
  CreditCard,
  Wallet,
  Gift,
  Ticket,
  Share2,
  BarChart3,
  Settings,
  Package,
  Trophy,
  Receipt,
  Briefcase,
  ShieldCheck,
  Plus,
  Send,
  Mail,
  SlidersHorizontal,
  FileSpreadsheet,
  IdCard,
  UserCheck,
} from "lucide-react";


import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Logo } from "@/components/brand/Logo";
import type { AppRole } from "@/lib/auth";

type NavItem = { title: string; url: string; icon: typeof LayoutDashboard };
type NavGroup = { label: string; items: NavItem[] };

const NAV: Record<AppRole, NavGroup[]> = {
  admin: [
    {
      label: "Overview",
      items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }],
    },
    {
      label: "Manage",
      items: [
        { title: "Customers", url: "/admin/customers", icon: Users },
        { title: "Promoters", url: "/admin/promoters", icon: UserCog },
        { title: "Approvals", url: "/admin/approvals", icon: UserCheck },
        { title: "Plans", url: "/admin/plans", icon: Package },
        { title: "Memberships", url: "/admin/memberships", icon: ShieldCheck },
        { title: "Payments", url: "/admin/payments", icon: CreditCard },
        { title: "Exports", url: "/admin/exports", icon: FileSpreadsheet },
      ],
    },
    {
      label: "Programs",
      items: [
        { title: "Rewards", url: "/admin/rewards", icon: Gift },
        { title: "Lucky Draw", url: "/admin/lucky-draw", icon: Trophy },
        { title: "Draw Results", url: "/admin/draw-results", icon: Trophy },
        { title: "Reports", url: "/admin/reports", icon: BarChart3 },
      ],
    },
    {
      label: "System",
      items: [
        { title: "Users", url: "/admin/users", icon: Users },
        { title: "Site Settings", url: "/admin/site-settings", icon: SlidersHorizontal },
        { title: "Admin Settings", url: "/admin/settings", icon: Settings },
        { title: "Email Preview", url: "/admin/email-preview", icon: Send },
        { title: "Membership Emails", url: "/admin/membership-emails", icon: Mail },
        { title: "Payment Reminders", url: "/admin/reminders", icon: Mail },
        { title: "Reminder Jobs", url: "/admin/reminder-jobs", icon: Mail },
        { title: "Reminder Templates", url: "/admin/reminder-templates", icon: Mail },
        { title: "KYC Email Log", url: "/admin/kyc-emails", icon: Mail },
        { title: "Plan Deletions", url: "/admin/plan-deletions", icon: ShieldCheck },
        { title: "Audit Log", url: "/admin/audit-log", icon: ShieldCheck },
        { title: "Preferences", url: "/settings", icon: SlidersHorizontal },
      ],
    },
  ],
  promoter: [
    {
      label: "Overview",
      items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }],
    },
    {
      label: "Business",
      items: [
        { title: "My Customers", url: "/promoter/customers", icon: Users },
        { title: "Collections", url: "/promoter/collections", icon: Wallet },
        { title: "Commissions", url: "/promoter/commissions", icon: Receipt },
        { title: "Portfolio", url: "/promoter/portfolio", icon: Briefcase },
        { title: "Lucky Draw", url: "/promoter/lucky-draw", icon: Trophy },
      ],
    },
    {
      label: "System",
      items: [
        { title: "Profile & KYC", url: "/kyc", icon: IdCard },
        { title: "Preferences", url: "/settings", icon: SlidersHorizontal },
      ],
    },
  ],
  customer: [
    {
      label: "Overview",
      items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }],
    },
    {
      label: "My Account",
      items: [
        { title: "Membership", url: "/customer/membership", icon: ShieldCheck },
        { title: "Enroll in Plan", url: "/customer/enroll", icon: Plus },
        { title: "Installments", url: "/customer/installments", icon: CreditCard },
        { title: "Payment History", url: "/customer/payments", icon: Receipt },
        { title: "Rewards", url: "/customer/rewards", icon: Gift },
        { title: "Lucky Draw", url: "/customer/lucky-draw", icon: Ticket },
        { title: "My Draw Results", url: "/customer/draw-results", icon: Trophy },
        { title: "Referrals", url: "/customer/referrals", icon: Share2 },
      ],
    },
    {
      label: "System",
      items: [
        { title: "Profile & KYC", url: "/kyc", icon: IdCard },
        { title: "Preferences", url: "/settings", icon: SlidersHorizontal },
      ],
    },
  ],
};

export function AppSidebar({ role }: { role: AppRole | null | undefined }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const groups = role ? NAV[role] : [];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex h-14 items-center px-2">
          {collapsed ? (
            <div
              className="grid h-9 w-9 place-items-center rounded-lg text-base font-bold"
              style={{ background: "var(--gradient-gold-value)", color: "var(--navy)" }}
            >
              A
            </div>
          ) : (
            <Logo />
          )}
        </div>
      </SidebarHeader>

      <SidebarContent
        aria-label={role ? `${role} navigation` : "Navigation"}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
          const container = e.currentTarget;
          const links = Array.from(
            container.querySelectorAll<HTMLAnchorElement>('a[data-sidebar="menu-button"], a[href]')
          ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
          if (!links.length) return;
          const active = document.activeElement as HTMLElement | null;
          const idx = active ? links.indexOf(active as HTMLAnchorElement) : -1;
          let next = idx;
          if (e.key === "ArrowDown") next = idx < 0 ? 0 : (idx + 1) % links.length;
          else if (e.key === "ArrowUp") next = idx <= 0 ? links.length - 1 : idx - 1;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = links.length - 1;
          if (next !== idx) {
            e.preventDefault();
            links[next]?.focus();
          }
        }}
      >
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = pathname === item.url;
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                      >
                        <Link
                          to={item.url}
                          aria-label={item.title}
                          aria-current={active ? "page" : undefined}
                          className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        >
                          <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {!collapsed && role && (
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {role} portal
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
