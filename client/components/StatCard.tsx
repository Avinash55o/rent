import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  className?: string;
}

export function StatCard({ label, value, icon: Icon, description, className = "" }: StatCardProps) {
  return (
    <div className={`stat bg-base-100 rounded-xl border border-base-200 shadow-sm ${className}`}>
      <div className="stat-figure text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <div className="stat-title text-sm">{label}</div>
      <div className="stat-value text-2xl">{value}</div>
      {description && <div className="stat-desc">{description}</div>}
    </div>
  );
}
