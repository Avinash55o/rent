"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import toast from "react-hot-toast";
import { Settings, Save } from "lucide-react";

interface SettingsData {
  rent_due_start_day?: string;
  rent_due_end_day?: string;
  late_fee_amount?: string;
  deposit_amount?: string;
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingsData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    rent_due_start_day: 1,
    rent_due_end_day: 5,
    late_fee_amount: 100,
    deposit_amount: 5000,
  });

  useEffect(() => {
    api.get("/api/admin/settings")
      .then((res) => {
        const s = res.data?.data || {};
        setSettings(s);
        setForm({
          rent_due_start_day: parseInt(s.rent_due_start_day) || 1,
          rent_due_end_day: parseInt(s.rent_due_end_day) || 5,
          late_fee_amount: parseInt(s.late_fee_amount) || 100,
          deposit_amount: parseInt(s.deposit_amount) || 5000,
        });
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/api/admin/settings", form);
      toast.success("Settings saved!");
    } catch { toast.error("Failed to save settings"); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingSpinner text="Loading settings..." />;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Settings className="h-6 w-6" /> System Settings
      </h1>

      <div className="card bg-base-100 shadow-md border border-base-200 max-w-lg">
        <div className="card-body">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="form-control">
              <label className="label"><span className="label-text">Rent Due Start Day</span></label>
              <input type="number" className="input input-bordered w-full" value={form.rent_due_start_day} onChange={(e) => setForm((f) => ({ ...f, rent_due_start_day: Number(e.target.value) }))} min={1} max={28} />
              <label className="label"><span className="label-text-alt">Day of month when rent window opens</span></label>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Rent Due End Day</span></label>
              <input type="number" className="input input-bordered w-full" value={form.rent_due_end_day} onChange={(e) => setForm((f) => ({ ...f, rent_due_end_day: Number(e.target.value) }))} min={1} max={28} />
              <label className="label"><span className="label-text-alt">After this day, late fee applies</span></label>
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Late Fee Amount (₹)</span></label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" className="input input-bordered w-full" value={form.late_fee_amount} onChange={(e) => setForm((f) => ({ ...f, late_fee_amount: Number(e.target.value) || 0 }))} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Default Deposit Amount (₹)</span></label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" className="input input-bordered w-full" value={form.deposit_amount} onChange={(e) => setForm((f) => ({ ...f, deposit_amount: Number(e.target.value) || 0 }))} />
              <label className="label"><span className="label-text-alt">Amount charged as security deposit when booking</span></label>
            </div>
            <button type="submit" className={`btn btn-primary ${saving ? "btn-disabled" : ""}`} disabled={saving}>
              {saving ? <span className="loading loading-spinner loading-sm"></span> : <Save className="h-4 w-4" />}
              Save Settings
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
