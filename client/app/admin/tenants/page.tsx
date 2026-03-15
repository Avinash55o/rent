"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Modal } from "@/components/Modal";
import toast from "react-hot-toast";
import Link from "next/link";
import { Users, Plus, Eye, UserMinus } from "lucide-react";
import { TableSkeleton } from "@/components/Skeleton";

interface Tenant {
  id: number;
  name: string;
  email: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  bookingId: number | null;
  bookingStatus: string | null;
  monthlyRent: number | null;
  moveInDate: string | null;
  nextRentDueDate: string | null;
  bedName: string | null;
  roomName: string | null;
}

interface BedOption {
  id: number;
  name: string;
  roomName?: string;
  monthlyRent: number;
}

export default function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availableBeds, setAvailableBeds] = useState<BedOption[]>([]);

  // Form state
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    bedId: "",
  });

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    try {
      const res = await api.get("/api/admin/tenants");
      setTenants(res.data?.data || []);
    } catch {
      toast.error("Failed to load tenants");
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableBeds = async () => {
    try {
      const res = await api.get("/api/rooms");
      const rooms = res.data?.data || [];
      const beds: BedOption[] = [];
      for (const room of rooms) {
        for (const bed of room.beds) {
          if (bed.status === "available") {
            beds.push({
              id: bed.id,
              name: bed.name,
              roomName: room.name,
              monthlyRent: bed.monthlyRent,
            });
          }
        }
      }
      setAvailableBeds(beds);
    } catch {
      // Ignore
    }
  };

  const openModal = () => {
    fetchAvailableBeds();
    setModalOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone,
      };
      if (form.bedId) payload.bedId = Number(form.bedId);

      await api.post("/api/admin/tenants", payload);
      toast.success("Tenant created!");
      setModalOpen(false);
      setForm({ name: "", email: "", password: "", phone: "", bedId: "" });
      fetchTenants();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to create tenant"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (tenantId: number) => {
    if (!confirm("Are you sure you want to deactivate this tenant? Their booking will be ended.")) return;
    try {
      await api.put(`/api/admin/tenants/${tenantId}/deactivate`);
      toast.success("Tenant deactivated");
      fetchTenants();
    } catch {
      toast.error("Failed to deactivate tenant");
    }
  };

  if (loading) {
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> Tenants
          </h1>
        </div>
        <TableSkeleton rows={5} />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="h-6 w-6" /> Tenants
        </h1>
        <button className="btn btn-primary btn-sm" onClick={openModal}>
          <Plus className="h-4 w-4" /> Add Tenant
        </button>
      </div>

      {tenants.length === 0 ? (
        <div className="text-center py-16">
          <Users className="h-12 w-12 mx-auto text-base-content/30 mb-4" />
          <p className="text-base-content/60">No tenants yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Room / Bed</th>
                <th>Rent</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td className="text-sm">{t.email}</td>
                  <td className="text-sm">{t.phone}</td>
                  <td className="text-sm">
                    {t.roomName && t.bedName
                      ? `${t.roomName} / ${t.bedName}`
                      : "—"}
                  </td>
                  <td className="text-sm">
                    {t.monthlyRent
                      ? `₹${t.monthlyRent.toLocaleString()}`
                      : "—"}
                  </td>
                  <td>
                    {!t.isActive ? (
                      <span className="badge badge-error badge-sm">Inactive</span>
                    ) : t.bookingStatus === "active" ? (
                      <span className="badge badge-success badge-sm">Active</span>
                    ) : (
                      <span className="badge badge-ghost badge-sm">No booking</span>
                    )}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="btn btn-ghost btn-xs"
                      >
                        <Eye className="h-3 w-3" />
                      </Link>
                      {t.isActive && (
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => handleDeactivate(t.id)}
                        >
                          <UserMinus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Tenant Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add New Tenant"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Name</span></label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Email</span></label>
            <input
              type="email"
              className="input input-bordered w-full"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Password</span></label>
            <input
              type="password"
              className="input input-bordered w-full"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={6}
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Phone</span></label>
            <input
              type="tel"
              className="input input-bordered w-full"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              required
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Assign Bed (optional)</span></label>
            <select
              className="select select-bordered w-full"
              value={form.bedId}
              onChange={(e) => setForm((f) => ({ ...f, bedId: e.target.value }))}
            >
              <option value="">No bed assigned</option>
              {availableBeds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.roomName} — {b.name} (₹{b.monthlyRent}/mo)
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className={`btn btn-primary w-full ${submitting ? "btn-disabled" : ""}`}
            disabled={submitting}
          >
            {submitting && <span className="loading loading-spinner loading-sm"></span>}
            Create Tenant
          </button>
        </form>
      </Modal>
    </div>
  );
}
