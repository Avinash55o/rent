"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Modal } from "@/components/Modal";
import toast from "react-hot-toast";
import { MessageSquare, Plus, Clock, CheckCircle2, AlertCircle } from "lucide-react";

interface Complaint {
  id: number;
  subject: string;
  message: string;
  status: string;
  adminReply: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchComplaints();
  }, []);

  const fetchComplaints = async () => {
    try {
      const res = await api.get("/api/complaints/my");
      setComplaints(res.data?.data || []);
    } catch {
      toast.error("Failed to load complaints");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/complaints", { subject, message });
      toast.success("Complaint submitted");
      setSubject("");
      setMessage("");
      setModalOpen(false);
      fetchComplaints();
    } catch {
      toast.error("Failed to submit complaint");
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "open":
        return <AlertCircle className="h-4 w-4 text-warning" />;
      case "in_progress":
        return <Clock className="h-4 w-4 text-info" />;
      case "resolved":
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      default:
        return null;
    }
  };

  if (loading) return <LoadingSpinner text="Loading complaints..." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6" /> My Complaints
        </h1>
        <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" /> New Complaint
        </button>
      </div>

      {complaints.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="h-12 w-12 mx-auto text-base-content/30 mb-4" />
          <p className="text-base-content/60">No complaints submitted yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {complaints.map((c) => (
            <div
              key={c.id}
              className="card bg-base-100 shadow-sm border border-base-200"
            >
              <div className="card-body p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold flex items-center gap-2">
                      {getStatusIcon(c.status)} {c.subject}
                    </h3>
                    <p className="text-sm text-base-content/60 mt-1">
                      {c.message}
                    </p>
                  </div>
                  <span
                    className={`badge badge-sm ${
                      c.status === "resolved"
                        ? "badge-success"
                        : c.status === "in_progress"
                        ? "badge-info"
                        : "badge-warning"
                    }`}
                  >
                    {c.status.replace("_", " ")}
                  </span>
                </div>
                {c.adminReply && (
                  <div className="mt-3 p-3 bg-base-200 rounded-lg">
                    <p className="text-xs font-semibold text-base-content/60 mb-1">
                      Admin Reply
                    </p>
                    <p className="text-sm">{c.adminReply}</p>
                  </div>
                )}
                <p className="text-xs text-base-content/40 mt-2">
                  Submitted{" "}
                  {new Date(c.createdAt).toLocaleDateString("en-IN")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Complaint Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Submit a Complaint"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Subject</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="e.g., Broken AC"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Message</span>
            </label>
            <textarea
              className="textarea textarea-bordered w-full"
              placeholder="Describe the issue..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={4}
            />
          </div>
          <button
            type="submit"
            className={`btn btn-primary w-full ${submitting ? "btn-disabled" : ""}`}
            disabled={submitting}
          >
            {submitting && <span className="loading loading-spinner loading-sm"></span>}
            Submit Complaint
          </button>
        </form>
      </Modal>
    </div>
  );
}
