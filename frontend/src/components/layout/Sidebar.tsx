import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ScrollText,
  Settings,
  Undo2,
  type LucideIcon,
} from "lucide-react";

import { useDemoStore } from "@/lib/demoStore";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly (needed for "/" so it isn't active everywhere). */
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/orders", label: "Orders", icon: Package },
  { to: "/returns", label: "Returns", icon: Undo2 },
  { to: "/audit", label: "Audit log", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** The logo. It doesn't touch the store, so the login page can use it too. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"
      >
        <Undo2 size={18} />
      </span>
      <span className="text-lg font-semibold tracking-tight text-slate-900">ReturnWise</span>
    </div>
  );
}

interface SidebarProps {
  /** Called after a link is clicked; the mobile drawer uses it to close itself. */
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { mode } = useDemoStore();

  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="flex h-14 shrink-0 items-center px-5">
        <Brand />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`
                }
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-slate-200 p-4">
        {mode === "demo" ? (
          <>
            <p className="text-xs font-medium text-slate-700">Demo mode</p>
            <p className="mt-0.5 text-xs text-slate-500">Sample data only. PayPal Sandbox only.</p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-slate-700">Connected to your account</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Refunds and AI analysis are not connected yet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}