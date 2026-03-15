"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Modal } from "@/components/Modal";
import toast from "react-hot-toast";
import { CreditCard, Receipt, Download } from "lucide-react";

interface Payment {
  id: number;
  amount: number;
  type: string;
  status: string;
  rentMonth: string;
  lateFee: number;
  paidAt: string | null;
  createdAt: string;
}

interface ReceiptData {
  receiptNumber: string;
  tenant: { name: string; email: string; phone: string };
  room: string;
  bed: string;
  rentMonth: string;
  rentAmount: number;
  lateFee: number;
  totalAmount: number;
  paymentType: string;
  paidAt: string;
  razorpayPaymentId: string | null;
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    fetchPayments();
  }, []);

  const fetchPayments = async () => {
    try {
      const res = await api.get("/api/payments/my");
      setPayments(res.data?.data || []);
    } catch {
      toast.error("Failed to load payments");
    } finally {
      setLoading(false);
    }
  };

  const viewReceipt = async (paymentId: number) => {
    try {
      const res = await api.get(`/api/payments/my/${paymentId}/receipt`);
      setReceipt(res.data.data);
      setReceiptOpen(true);
    } catch {
      toast.error("Failed to load receipt");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="badge badge-success badge-sm">Completed</span>;
      case "pending":
        return <span className="badge badge-warning badge-sm">Pending</span>;
      case "failed":
        return <span className="badge badge-error badge-sm">Failed</span>;
      default:
        return <span className="badge badge-ghost badge-sm">{status}</span>;
    }
  };

  if (loading) return <LoadingSpinner text="Loading payments..." />;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <CreditCard className="h-6 w-6" /> Payment History
      </h1>

      {payments.length === 0 ? (
        <div className="text-center py-16">
          <CreditCard className="h-12 w-12 mx-auto text-base-content/30 mb-4" />
          <p className="text-base-content/60">No payments yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>Rent Month</th>
                <th>Amount</th>
                <th>Late Fee</th>
                <th>Type</th>
                <th>Status</th>
                <th>Paid On</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.rentMonth}</td>
                  <td>₹{p.amount.toLocaleString()}</td>
                  <td>
                    {p.lateFee > 0 ? (
                      <span className="text-error">₹{p.lateFee}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className="badge badge-outline badge-sm">
                      {p.type}
                    </span>
                  </td>
                  <td>{getStatusBadge(p.status)}</td>
                  <td className="text-sm">
                    {p.paidAt
                      ? new Date(p.paidAt).toLocaleDateString("en-IN")
                      : "—"}
                  </td>
                  <td>
                    {p.status === "completed" && (
                      <button
                        className="btn btn-ghost btn-xs"
                        onClick={() => viewReceipt(p.id)}
                      >
                        <Receipt className="h-3 w-3" /> View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Receipt Modal */}
      <Modal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title="Payment Receipt"
      >
        {receipt && (
          <div className="space-y-3 text-sm">
            <div className="text-center border-b border-base-200 pb-3">
              <p className="font-bold text-lg">{receipt.receiptNumber}</p>
              <p className="text-base-content/60">Rent Payment Receipt</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-base-content/60">Tenant</p>
                <p className="font-medium">{receipt.tenant.name}</p>
              </div>
              <div>
                <p className="text-base-content/60">Email</p>
                <p className="font-medium">{receipt.tenant.email}</p>
              </div>
              <div>
                <p className="text-base-content/60">Room</p>
                <p className="font-medium">{receipt.room}</p>
              </div>
              <div>
                <p className="text-base-content/60">Bed</p>
                <p className="font-medium">{receipt.bed}</p>
              </div>
              <div>
                <p className="text-base-content/60">Rent Month</p>
                <p className="font-medium">{receipt.rentMonth}</p>
              </div>
              <div>
                <p className="text-base-content/60">Payment Type</p>
                <p className="font-medium capitalize">{receipt.paymentType}</p>
              </div>
            </div>
            <div className="divider my-1"></div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>Rent Amount</span>
                <span>₹{receipt.rentAmount.toLocaleString()}</span>
              </div>
              {receipt.lateFee > 0 && (
                <div className="flex justify-between text-error">
                  <span>Late Fee</span>
                  <span>₹{receipt.lateFee.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-base-200 pt-1">
                <span>Total</span>
                <span>₹{receipt.totalAmount.toLocaleString()}</span>
              </div>
            </div>
            <div className="text-center text-xs text-base-content/50 mt-2">
              Paid on{" "}
              {new Date(receipt.paidAt).toLocaleString("en-IN")}
              {receipt.razorpayPaymentId && (
                <> • Razorpay ID: {receipt.razorpayPaymentId}</>
              )}
            </div>
            <button
              className="btn btn-outline btn-sm w-full mt-2"
              onClick={() => window.print()}
            >
              <Download className="h-3 w-3" /> Print Receipt
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
