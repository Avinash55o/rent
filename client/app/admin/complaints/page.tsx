"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Modal } from "@/components/Modal";
import toast from "react-hot-toast";
import { MessageSquare, AlertCircle, Clock, CheckCircle2 } from "lucide-react";

interface Complaint {
  id: number;
  subject: string;
  message: string;
  status: string;
  adminReply: string | null;
  tenantId: number;
  tenantName: string;
  tenantEmail: string;
  createdAt: string;
  updatedAt: string;
}

export default function AdminComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [replyStatus, setReplyStatus] = useState("open");
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetchComplaints(); }, []);

  const fetchComplaints = async () => {
    try {
      const res = await api.get("/api/complaints");
      setComplaints(res.data?.data || []);
    } catch { toast.error("Failed to load complaints"); }
    finally { setLoading(false); }
  };

  const openReply = (c: Complaint) => {
    setSelected(c);
    setReplyStatus(c.status);
    setReplyText(c.adminReply || "");
    setModalOpen(true);
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    try {
      await api.put(`/api/complaints/${selected.id}`, {
        status: replyStatus,
        adminReply: replyText,
      });
      toast.success("Complaint updated!");
      setModalOpen(false);
      fetchComplaints();
    } catch { toast.error("Failed to update complaint"); }
    finally { setSubmitting(false); }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "open": return <AlertCircle className="h-4 w-4 text-warning" />;
      case "in_progress": return <Clock className="h-4 w-4 text-info" />;
      case "resolved": return <CheckCircle2 className="h-4 w-4 text-success" />;
      default: return null;
    }
  };

  if (loading) return <LoadingSpinner text="Loading complaints..." />;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <MessageSquare className="h-6 w-6" /> Complaints
      </h1>

      {complaints.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="h-12 w-12 mx-auto text-base-content/30 mb-4" />
          <p className="text-base-content/60">No complaints yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {complaints.map((c) => (
            <div key={c.id} className="card bg-base-100 shadow-sm border border-base-200 cursor-pointer hover:shadow-md transition-shadow" onClick={() => openReply(c)}>
              <div className="card-body p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold flex items-center gap-2">
                      {getStatusIcon(c.status)} {c.subject}
                    </h3>
                    <p className="text-sm text-base-content/60 mt-1">{c.message}</p>
                    <p className="text-xs text-base-content/40 mt-2">
                      By {c.tenantName} ({c.tenantEmail}) • {new Date(c.createdAt).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  <span className={`badge badge-sm ${c.status === "resolved" ? "badge-success" : c.status === "in_progress" ? "badge-info" : "badge-warning"}`}>
                    {c.status.replace("_", " ")}
                  </span>
                </div>
                {c.adminReply && (
                  <div className="mt-2 p-2 bg-base-200 rounded text-sm">
                    <strong>Your reply:</strong> {c.adminReply}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Reply to Complaint">
        {selected && (
          <form onSubmit={handleReply} className="space-y-4">
            <div className="p-3 bg-base-200 rounded text-sm">
              <p className="font-bold">{selected.subject}</p>
              <p className="mt-1">{selected.message}</p>
              <p className="text-xs text-base-content/50 mt-2">From: {selected.tenantName}</p>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Status</span></label>
              <select className="select select-bordered w-full" value={replyStatus} onChange={(e) => setReplyStatus(e.target.value)}>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Admin Reply</span></label>
              <textarea className="textarea textarea-bordered w-full" value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={3} placeholder="Type your reply..." />
            </div>
            <button type="submit" className={`btn btn-primary w-full ${submitting ? "btn-disabled" : ""}`} disabled={submitting}>
              {submitting && <span className="loading loading-spinner loading-sm"></span>}
              Update Complaint
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
