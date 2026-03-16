"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Modal } from "@/components/Modal";
import toast from "react-hot-toast";
import { CreditCard, Plus, Download } from "lucide-react";
import { TableSkeleton } from "@/components/Skeleton";

interface Payment {
  id: number;
  tenantId: number;
  tenantName?: string;
  roomName?: string;
  bedName?: string;
  amount: number;
  type: string;
  status: string;
  rentMonth: string;
  lateFee: number;
  paidAt: string | null;
  createdAt: string;
}

interface TenantOption {
  id: number;
  name: string;
  email: string;
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [form, setForm] = useState({ tenantId: "", amount: "", rentMonth: "", notes: "" });

  useEffect(() => { fetchPayments(); }, []);

  const fetchPayments = async () => {
    try {
      const res = await api.get("/api/payments");
      setPayments(res.data?.data?.data || []);
    } catch { toast.error("Failed to load payments"); }
    finally { setLoading(false); }
  };

  const fetchTenants = async () => {
    try {
      const res = await api.get("/api/admin/tenants");
      setTenants((res.data?.data?.data || []).map((t: TenantOption) => ({ id: t.id, name: t.name, email: t.email })));
    } catch { /* ignore */ }
  };

  const openModal = () => { fetchTenants(); setModalOpen(true); };

  const handleManualPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/payments/manual", {
        tenantId: Number(form.tenantId),
        amount: Number(form.amount),
        rentMonth: form.rentMonth,
        notes: form.notes || undefined,
      });
      toast.success("Manual payment recorded!");
      setModalOpen(false);
      setForm({ tenantId: "", amount: "", rentMonth: "", notes: "" });
      fetchPayments();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to record payment"));
    } finally { setSubmitting(false); }
  };

  const handleExport = async (type: "payments" | "tenants") => {
    try {
      const res = await api.get(`/api/admin/export/${type}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${type}-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`${type} CSV downloaded!`);
    } catch { toast.error(`Failed to export ${type}`); }
  };

  if (loading) {
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="h-6 w-6" /> Payments
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
          <CreditCard className="h-6 w-6" /> Payments
        </h1>
        <div className="flex gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm" onClick={() => handleExport("payments")}>
            <Download className="h-4 w-4" /> Export Payments
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => handleExport("tenants")}>
            <Download className="h-4 w-4" /> Export Tenants
          </button>
          <button className="btn btn-primary btn-sm" onClick={openModal}>
            <Plus className="h-4 w-4" /> Record Payment
          </button>
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="text-center py-16">
          <CreditCard className="h-12 w-12 mx-auto text-base-content/30 mb-4" />
          <p className="text-base-content/60">No payments recorded yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>Payment ID</th>
                <th>Tenant Name</th>
                <th>Room & Bed</th>
                <th>Month</th>
                <th>Amount</th>
                <th>Late Fee</th>
                <th>Type</th>
                <th>Status</th>
                <th>Paid On</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>#{p.id}</td>
                  <td>
                    <div className="font-medium">{p.tenantName || `Tenant #${p.tenantId}`}</div>
                  </td>
                  <td>
                    {p.roomName && p.bedName ? (
                      <div className="text-sm">
                        {p.roomName} - {p.bedName}
                      </div>
                    ) : (
                      <span className="text-base-content/50 text-sm">N/A</span>
                    )}
                  </td>
                  <td className="font-medium">{p.rentMonth}</td>
                  <td>₹{p.amount.toLocaleString()}</td>
                  <td>{p.lateFee > 0 ? <span className="text-error">₹{p.lateFee}</span> : "—"}</td>
                  <td><span className="badge badge-outline badge-sm">{p.type}</span></td>
                  <td>
                    <span className={`badge badge-sm ${p.status === "completed" ? "badge-success" : p.status === "pending" ? "badge-warning" : "badge-error"}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="text-sm">{p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-IN") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record Manual Payment">
        <form onSubmit={handleManualPayment} className="space-y-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Tenant</span></label>
            <select className="select select-bordered w-full" value={form.tenantId} onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))} required>
              <option value="" disabled>Select tenant</option>
              {tenants.map((t) => (<option key={t.id} value={t.id}>{t.name} ({t.email})</option>))}
            </select>
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Amount (₹)</span></label>
            <input type="text" inputMode="numeric" pattern="[0-9]*" className="input input-bordered w-full" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Rent Month</span></label>
            <input type="month" className="input input-bordered w-full" value={form.rentMonth} onChange={(e) => setForm((f) => ({ ...f, rentMonth: e.target.value }))} required />
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Notes</span></label>
            <input type="text" className="input input-bordered w-full" placeholder="e.g., Paid by cash" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <button type="submit" className={`btn btn-primary w-full ${submitting ? "btn-disabled" : ""}`} disabled={submitting}>
            {submitting && <span className="loading loading-spinner loading-sm"></span>}
            Record Payment
          </button>
        </form>
      </Modal>
    </div>
  );
}
