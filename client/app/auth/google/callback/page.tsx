"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import toast from "react-hot-toast";
import { Suspense } from "react";

function GoogleCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const code = searchParams.get("code");
    const state = localStorage.getItem("google_oauth_state");

    // Clear the stored state
    localStorage.removeItem("google_oauth_state");

    if (!code) {
      toast.error("Google login failed — no code received");
      router.replace("/login");
      return;
    }

    if (!state) {
      toast.error("Google login failed — session expired. Please try again.");
      router.replace("/login");
      return;
    }

    api
      .post("/api/auth/google/callback", { code, state })
      .then((res) => {
        const { token, user } = res.data.data;
        login(token, user);
        toast.success("Logged in with Google!");
        router.replace(user.role === "admin" ? "/admin" : "/dashboard");
      })
      .catch(() => {
        toast.error("Google login failed. Please try again.");
        router.replace("/login");
      });
  }, [searchParams, router, login]);

  return <LoadingSpinner text="Completing Google login..." />;
}

export default function GoogleCallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Suspense fallback={<LoadingSpinner text="Loading..." />}>
        <GoogleCallbackInner />
      </Suspense>
    </div>
  );
}
