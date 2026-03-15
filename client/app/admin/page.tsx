"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatCard } from "@/components/StatCard";
import toast from "react-hot-toast";
import { Bed, Users, CheckCircle2, Clock, AlertTriangle, Home } from "lucide-react";

interface DashboardData {
  beds: {
    total: number;
    occupied: number;
    reserved: number;
    available: number;
  };
  tenants: {
    total: number;
    activeBookings: number;
  };
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/api/admin/dashboard")
      .then((res) => setData(res.data.data))
      .catch(() => toast.error("Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner text="Loading dashboard..." />;
  if (!data) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Beds" value={data.beds.total} icon={Bed} />
        <StatCard
          label="Occupied Beds"
          value={data.beds.occupied}
          icon={Home}
          description={`${data.beds.total > 0 ? Math.round((data.beds.occupied / data.beds.total) * 100) : 0}% occupancy`}
        />
        <StatCard
          label="Available Beds"
          value={data.beds.available}
          icon={CheckCircle2}
        />
        <StatCard
          label="Reserved"
          value={data.beds.reserved}
          icon={Clock}
        />
        <StatCard
          label="Total Tenants"
          value={data.tenants.total}
          icon={Users}
        />
        <StatCard
          label="Active Bookings"
          value={data.tenants.activeBookings}
          icon={AlertTriangle}
        />
      </div>
    </div>
  );
}
