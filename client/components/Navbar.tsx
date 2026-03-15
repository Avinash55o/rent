"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { LogOut, Menu, Home, LayoutDashboard, Shield, Sun, Moon } from "lucide-react";
import { useRouter } from "next/navigation";

export function Navbar() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <div className="navbar bg-base-100 shadow-sm border-b border-base-200 px-4">
      {/* Mobile menu */}
      <div className="navbar-start">
        <div className="dropdown">
          <div tabIndex={0} role="button" className="btn btn-ghost lg:hidden">
            <Menu className="h-5 w-5" />
          </div>
          <ul tabIndex={0} className="menu menu-sm dropdown-content bg-base-100 rounded-box z-50 mt-3 w-52 p-2 shadow">
            <li><Link href="/"><Home className="h-4 w-4" /> Rooms</Link></li>
            {isAuthenticated && !isAdmin && (
              <li><Link href="/dashboard"><LayoutDashboard className="h-4 w-4" /> Dashboard</Link></li>
            )}
            {isAdmin && (
              <li><Link href="/admin"><Shield className="h-4 w-4" /> Admin</Link></li>
            )}
          </ul>
        </div>
        <Link href="/" className="btn btn-ghost text-xl font-bold">
          RentEase
        </Link>
      </div>

      {/* Desktop menu */}
      <div className="navbar-center hidden lg:flex">
        <ul className="menu menu-horizontal px-1 gap-1">
          <li><Link href="/">Rooms</Link></li>
          {isAuthenticated && !isAdmin && (
            <li><Link href="/dashboard">Dashboard</Link></li>
          )}
          {isAdmin && (
            <li><Link href="/admin">Admin Panel</Link></li>
          )}
        </ul>
      </div>

      {/* Theme toggle + Auth buttons */}
      <div className="navbar-end gap-2">
        <button
          onClick={toggleTheme}
          className="btn btn-ghost btn-circle btn-sm"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>
        {isAuthenticated ? (
          <div className="flex items-center gap-3">
            <span className="text-sm hidden sm:inline">
              Hi, <strong>{user?.name?.split(" ")[0]}</strong>
            </span>
            <button onClick={handleLogout} className="btn btn-ghost btn-sm gap-1">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        ) : (
          <>
            <Link href="/login" className="btn btn-ghost btn-sm">Login</Link>
            <Link href="/signup" className="btn btn-primary btn-sm">Sign Up</Link>
          </>
        )}
      </div>
    </div>
  );
}
