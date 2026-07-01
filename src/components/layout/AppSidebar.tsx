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
        { title: "Plans", url: "/admin/plans", icon: Package },
        { title: "Memberships", url: "/admin/memberships", icon: ShieldCheck },
        { title: "Payments", url: "/admin/payments", icon: CreditCard },
      ],
    },
    {
      label: "Programs",
      items: [
        { title: "Rewards", url: "/admin/rewards", icon: Gift },
        { title: "Lucky Draw", url: "/admin/lucky-draw", icon: Trophy },
        { title: "Reports", url: "/admin/reports", icon: BarChart3 },
      ],
    },
    {
      label: "System",
      items: [{ title: "Settings", url: "/admin/settings", icon: Settings }],
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
        { title: "Referrals", url: "/customer/referrals", icon: Share2 },
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

      <SidebarContent>
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
                        <Link to={item.url} className="flex items-center gap-2">
                          <item.icon className="h-4 w-4 shrink-0" />
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
