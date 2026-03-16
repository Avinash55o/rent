"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import api from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Modal } from "@/components/Modal";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  User,
  Bed,
  CreditCard,
  IndianRupee,
  CalendarDays,
  Shield,
  MessageSquare,
} from "lucide-react";

interface TenantDetail {
  tenant: {
    id: number;
    name: string;
    email: string;
    phone: string;
    isActive: boolean;
    createdAt: string;
  };
  booking: {
    id: number;
    status: string;
    monthlyRent: number;
    moveInDate: string;
    moveOutDate: string | null;
    nextRentDueDate: string;
  } | null;
  bed: {
    id: number;
    name: string;
    status: string;
    monthlyRent: number;
    roomId: number;
  } | null;
  deposit: {
    id: number;
    amount: number;
    status: string;
    paidAt: string | null;
  } | null;
  payments: Array<{
    id: number;
    amount: number;
    type: string;
    status: string;
    rentMonth: string;
    lateFee: number;
    paidAt: string | null;
  }>;
  complaints: Array<{
    id: number;
    subject: string;
    status: string;
    createdAt: string;
  }>;
}

export default function TenantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tenantId = params.id as string;

  const [data, setData] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Update rent modal
  const [rentModalOpen, setRentModalOpen] = useState(false);
  const [newRent, setNewRent] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [updatingRent, setUpdatingRent] = useState(false);

  // End booking modal
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [endForm, setEndForm] = useState({
    moveOutDate: new Date().toISOString().slice(0, 10),
    refundAmount: 0,
    deductionAmount: 0,
    deductionReason: "",
  });
  const [endingBooking, setEndingBooking] = useState(false);

  useEffect(() => {
    fetchTenant();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const fetchTenant = async () => {
    try {
      const res = await api.get(`/api/admin/tenants/${tenantId}`);
      setData(res.data.data);
      if (res.data.data.booking) {
        setNewRent(res.data.data.booking.monthlyRent.toString());
      }
      if (res.data.data.deposit) {
        setEndForm((f) => ({
          ...f,
          refundAmount: res.data.data.deposit.amount,
        }));
      }
    } catch {
      toast.error("Failed to load tenant");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRent = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingRent(true);
    try {
      await api.put(`/api/admin/tenants/${tenantId}/rent`, {
        monthlyRent: Number(newRent),
        applyToAll,
      });
      toast.success("Rent updated!");
      setRentModalOpen(false);
      fetchTenant();
    } catch {
      toast.error("Failed to update rent");
    } finally {
      setUpdatingRent(false);
    }
  };

  const handleEndBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.booking) return;
    setEndingBooking(true);
    try {
      await api.post(`/api/bookings/${data.booking.id}/end`, {
        moveOutDate: endForm.moveOutDate,
        refundAmount: Number(endForm.refundAmount),
        deductionAmount: Number(endForm.deductionAmount),
        deductionReason: endForm.deductionReason || undefined,
      });
      toast.success("Booking ended!");
      setEndModalOpen(false);
      fetchTenant();
    } catch {
      toast.error("Failed to end booking");
    } finally {
      setEndingBooking(false);
    }
  };

  if (loading) return <LoadingSpinner text="Loading tenant..." />;
  if (!data) return <p>Tenant not found</p>;

  const { tenant, booking, bed, deposit, payments, complaints } = data;

  return (
    <div>
      <button
        className="btn btn-ghost btn-sm mb-4"
        onClick={() => router.push("/admin/tenants")}
      >
        <ArrowLeft className="h-4 w-4" /> Back to Tenants
      </button>

      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <User className="h-6 w-6" /> {tenant.name}
      </h1>

      {/* Profile Info */}
      <div className="card bg-base-100 shadow-sm border border-base-200 mb-6">
        <div className="card-body p-5">
          <h2 className="font-bold text-lg mb-3">Profile</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-base-content/60">Email</p>
              <p className="font-medium">{tenant.email}</p>
            </div>
            <div>
              <p className="text-base-content/60">Phone</p>
              <p className="font-medium">{tenant.phone || "—"}</p>
            </div>
            <div>
              <p className="text-base-content/60">Status</p>
              <span
                className={`badge ${tenant.isActive ? "badge-success" : "badge-error"} badge-sm`}
              >
                {tenant.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <div>
              <p className="text-base-content/60">Joined</p>
              <p className="font-medium">
                {new Date(tenant.createdAt).toLocaleDateString("en-IN")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Booking Info */}
      {booking ? (
        <div className="card bg-base-100 shadow-sm border border-base-200 mb-6">
          <div className="card-body p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Bed className="h-5 w-5" /> Booking
              </h2>
              <div className="flex gap-2">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setRentModalOpen(true)}
                >
                  <IndianRupee className="h-3 w-3" /> Update Rent
                </button>
                {booking.status === "active" && (
                  <button
                    className="btn btn-error btn-sm btn-outline"
                    onClick={() => setEndModalOpen(true)}
                  >
                    End Booking
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-base-content/60">Status</p>
                <span className={`badge badge-sm ${booking.status === "active" ? "badge-success" : booking.status === "ended" ? "badge-error" : "badge-warning"}`}>
                  {booking.status}
                </span>
              </div>
              <div>
                <p className="text-base-content/60">Bed</p>
                <p className="font-medium">{bed?.name || "—"}</p>
              </div>
              <div>
                <p className="text-base-content/60">Monthly Rent</p>
                <p className="font-medium">₹{booking.monthlyRent.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-base-content/60">Move-in</p>
                <p className="font-medium">
                  {new Date(booking.moveInDate).toLocaleDateString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-base-content/60">Next Rent Due</p>
                <p className="font-medium">
                  {new Date(booking.nextRentDueDate).toLocaleDateString("en-IN")}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="alert mb-6">
          <span>No active booking for this tenant.</span>
        </div>
      )}

      {/* Deposit Info */}
      {deposit && (
        <div className="card bg-base-100 shadow-sm border border-base-200 mb-6">
          <div className="card-body p-5">
            <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
              <Shield className="h-5 w-5" /> Deposit
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-base-content/60">Amount</p>
                <p className="font-medium">₹{deposit.amount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-base-content/60">Status</p>
                <span className="badge badge-sm badge-outline">{deposit.status}</span>
              </div>
              <div>
                <p className="text-base-content/60">Paid</p>
                <p className="font-medium">
                  {deposit.paidAt
                    ? new Date(deposit.paidAt).toLocaleDateString("en-IN")
                    : "Not yet"}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment History */}
      <div className="card bg-base-100 shadow-sm border border-base-200 mb-6">
        <div className="card-body p-5">
          <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
            <CreditCard className="h-5 w-5" /> Payments ({payments.length})
          </h2>
          {payments.length === 0 ? (
            <p className="text-sm text-base-content/60">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Amount</th>
                    <th>Late Fee</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{p.rentMonth}</td>
                      <td>₹{p.amount.toLocaleString()}</td>
                      <td>{p.lateFee > 0 ? `₹${p.lateFee}` : "—"}</td>
                      <td><span className="badge badge-outline badge-xs">{p.type}</span></td>
                      <td>
                        <span className={`badge badge-xs ${p.status === "completed" ? "badge-success" : p.status === "pending" ? "badge-warning" : "badge-error"}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="text-xs">
                        {p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-IN") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Complaints */}
      <div className="card bg-base-100 shadow-sm border border-base-200 mb-6">
        <div className="card-body p-5">
          <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
            <MessageSquare className="h-5 w-5" /> Complaints ({complaints.length})
          </h2>
          {complaints.length === 0 ? (
            <p className="text-sm text-base-content/60">No complaints.</p>
          ) : (
            <div className="space-y-2">
              {complaints.map((c) => (
                <div key={c.id} className="flex justify-between items-center p-2 bg-base-200/50 rounded">
                  <span className="text-sm">{c.subject}</span>
                  <span className={`badge badge-xs ${c.status === "resolved" ? "badge-success" : c.status === "in_progress" ? "badge-info" : "badge-warning"}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Update Rent Modal */}
      <Modal open={rentModalOpen} onClose={() => setRentModalOpen(false)} title="Update Monthly Rent">
        <form onSubmit={handleUpdateRent} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">New Monthly Rent (₹)</span></label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              className="input input-bordered w-full"
              value={newRent}
              onChange={(e) => setNewRent(e.target.value)}
              required
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />
            <span className="label-text">Apply to all tenants</span>
          </label>
          <button
            type="submit"
            className={`btn btn-primary w-full ${updatingRent ? "btn-disabled" : ""}`}
            disabled={updatingRent}
          >
            {updatingRent && <span className="loading loading-spinner loading-sm"></span>}
            Update Rent
          </button>
        </form>
      </Modal>

      {/* End Booking Modal */}
      <Modal open={endModalOpen} onClose={() => setEndModalOpen(false)} title="End Booking">
        <form onSubmit={handleEndBooking} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Move-out Date</span></label>
            <input
              type="date"
              className="input input-bordered w-full"
              value={endForm.moveOutDate}
              onChange={(e) => setEndForm((f) => ({ ...f, moveOutDate: e.target.value }))}
              required
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Refund Amount (₹)</span></label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              className="input input-bordered w-full"
              value={endForm.refundAmount}
              onChange={(e) => setEndForm((f) => ({ ...f, refundAmount: Number(e.target.value) || 0 }))}
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Deduction Amount (₹)</span></label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              className="input input-bordered w-full"
              value={endForm.deductionAmount}
              onChange={(e) => setEndForm((f) => ({ ...f, deductionAmount: Number(e.target.value) || 0 }))}
            />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Deduction Reason</span></label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="e.g., Broken furniture"
              value={endForm.deductionReason}
              onChange={(e) => setEndForm((f) => ({ ...f, deductionReason: e.target.value }))}
            />
          </div>
          <button
            type="submit"
            className={`btn btn-error w-full ${endingBooking ? "btn-disabled" : ""}`}
            disabled={endingBooking}
          >
            {endingBooking && <span className="loading loading-spinner loading-sm"></span>}
            End Booking
          </button>
        </form>
      </Modal>
    </div>
  );
}
