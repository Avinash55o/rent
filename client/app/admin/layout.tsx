"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";
import {
  LayoutDashboard,
  Home,
  Users,
  CreditCard,
  MessageSquare,
  Settings,
  Menu,
} from "lucide-react";

const sidebarLinks = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/rooms", label: "Rooms & Beds", icon: Home },
  { href: "/admin/tenants", label: "Tenants", icon: Users },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/complaints", label: "Complaints", icon: MessageSquare },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex">
          <div className="drawer lg:drawer-open">
            <input id="admin-drawer" type="checkbox" className="drawer-toggle" />
            <div className="drawer-content flex flex-col">
              <div className="lg:hidden p-4 border-b border-base-200">
                <label htmlFor="admin-drawer" className="btn btn-ghost btn-sm">
                  <Menu className="h-5 w-5" /> Menu
                </label>
              </div>
              <main className="flex-1 p-4 sm:p-6 lg:p-8">
                {children}
              </main>
            </div>
            <div className="drawer-side z-30">
              <label htmlFor="admin-drawer" className="drawer-overlay"></label>
              <aside className="bg-base-100 border-r border-base-200 w-64 min-h-full">
                <div className="p-4 border-b border-base-200">
                  <h2 className="font-bold text-lg">Admin Panel</h2>
                </div>
                <ul className="menu p-4 gap-1">
                  {sidebarLinks.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className={
                          pathname === link.href ? "active font-medium" : ""
                        }
                      >
                        <link.icon className="h-4 w-4" />
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
