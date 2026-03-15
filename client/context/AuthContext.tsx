"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

interface User {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "tenant";
  isActive: boolean;
  googleId?: string | null;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  isAuthenticated: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback((newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get("/api/auth/me");
      const userData = res.data?.data?.user;
      if (userData) {
        setUser(userData);
        localStorage.setItem("user", JSON.stringify(userData));
      }
    } catch {
      // Token is invalid — clear everything
      logout();
    }
  }, [logout]);

  // On mount: restore from localStorage and validate
  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");

    if (storedToken && storedUser) {
      // Safely parse stored user data
      let parsedUser: User | null = null;
      try {
        parsedUser = JSON.parse(storedUser);
      } catch {
        // Corrupted localStorage data - clear it
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setLoading(false);
        return;
      }

      setToken(storedToken);
      setUser(parsedUser);

      // Validate token in background
      api
        .get("/api/auth/me", {
          headers: { Authorization: `Bearer ${storedToken}` },
        })
        .then((res) => {
          const userData = res.data?.data?.user;
          if (userData) {
            setUser(userData);
            localStorage.setItem("user", JSON.stringify(userData));
          }
        })
        .catch(() => {
          // Token expired or invalid
          setToken(null);
          setUser(null);
          localStorage.removeItem("token");
          localStorage.removeItem("user");
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        refreshUser,
        isAuthenticated: !!token && !!user,
        isAdmin: user?.role === "admin",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be inside AuthProvider");
  return context;
}
