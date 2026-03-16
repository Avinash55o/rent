"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { useAuth } from "@/context/AuthContext";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { StatCard } from "@/components/StatCard";
import { openRazorpayCheckout } from "@/lib/razorpay";
import toast from "react-hot-toast";
import Link from "next/link";
import { Modal } from "@/components/Modal";
import {
  Bed,
  CalendarDays,
  IndianRupee,
  CreditCard,
  MapPin,
  Shield,
  Edit2,
} from "lucide-react";
import { DashboardSkeleton } from "@/components/Skeleton";

interface BookingData {
  booking: {
    id: number;
    status: string;
    monthlyRent: number;
    moveInDate: string;
    nextRentDueDate: string;
  };
  bed: {
    id: number;
    name: string;
    roomId: number;
    status: string;
    monthlyRent: number;
  };
  deposit: {
    id: number;
    amount: number;
    status: string;
    paidAt: string | null;
  } | null;
  room: {
    id: number;
    name: string;
  } | null;
  isRentPaid: boolean;
}

export default function DashboardPage() {
  const [bookingData, setBookingData] = useState<BookingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [noBooking, setNoBooking] = useState(false);
  const [payingRent, setPayingRent] = useState(false);
  const [moveInDateModalOpen, setMoveInDateModalOpen] = useState(false);
  const [newMoveInDate, setNewMoveInDate] = useState("");
  const [updatingDate, setUpdatingDate] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    fetchBooking();
  }, []);

  const fetchBooking = async () => {
    try {
      const res = await api.get("/api/bookings/my");
      setBookingData(res.data.data);
    } catch (err: unknown) {
      const error = err as { response?: { status?: number } };
      if (error.response?.status === 404) {
        setNoBooking(true);
      } else {
        toast.error("Failed to load booking data");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateMoveInDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMoveInDate) return;
    setUpdatingDate(true);
    try {
      await api.put("/api/bookings/my/move-in-date", { moveInDate: newMoveInDate });
      toast.success("Move-in date updated successfully!");
      setMoveInDateModalOpen(false);
      fetchBooking();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to update move-in date"));
    } finally {
      setUpdatingDate(false);
    }
  };

  const handlePayRent = async () => {
    if (!bookingData) return;

    const now = new Date();
    const rentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    setPayingRent(true);

    try {
      // Initiate payment
      const res = await api.post("/api/payments/initiate", { rentMonth });
      const { razorpayOrderId, razorpayKeyId, amount } = res.data.data;

      // Open Razorpay
      const result = await openRazorpayCheckout({
        razorpayKeyId,
        orderId: razorpayOrderId,
        amount: amount * 100,
        description: `Rent for ${rentMonth}`,
        prefill: {
          name: user?.name,
          email: user?.email,
        },
      });

      // Verify payment
      await api.post("/api/payments/verify", { ...result, rentMonth });
      toast.success("Rent paid successfully!");
      fetchBooking(); // Refresh booking data
    } catch (err: unknown) {
      const msg = getErrorMessage(err, "Payment failed");
      if (msg !== "Payment cancelled by user") {
        toast.error(msg);
      }
    } finally {
      setPayingRent(false);
    }
  };

  if (loading) return <DashboardSkeleton />;

  if (noBooking) {
    return (
      <div className="text-center py-16">
        <Bed className="h-16 w-16 mx-auto text-base-content/30 mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Active Booking</h2>
        <p className="text-base-content/60 mb-6">
          You don&apos;t have an active booking yet. Browse available rooms to get
          started.
        </p>
        <Link href="/" className="btn btn-primary">
          Browse Rooms
        </Link>
      </div>
    );
  }

  const { booking, bed, room, deposit } = bookingData!;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Monthly Rent"
          value={`₹${booking.monthlyRent.toLocaleString()}`}
          icon={IndianRupee}
        />
        <StatCard
          label="Your Bed"
          value={bed.name}
          icon={Bed}
        />
        <StatCard
          label="Move-in Date"
          value={
            <div className="flex items-center gap-2">
              <span>{new Date(booking.moveInDate).toLocaleDateString("en-IN")}</span>
              {bed.status !== "occupied" && (
                <button
                  className="btn btn-ghost btn-xs btn-square"
                  onClick={() => {
                    setNewMoveInDate(booking.moveInDate);
                    setMoveInDateModalOpen(true);
                  }}
                  title="Edit Move-In Date"
                >
                  <Edit2 className="h-3 w-3" />
                </button>
              )}
            </div>
          }
          icon={CalendarDays}
        />
        <StatCard
          label="Deposit"
          value={deposit ? `₹${deposit.amount.toLocaleString()}` : "N/A"}
          icon={Shield}
          description={deposit?.status || ""}
        />
      </div>

      {/* Booking Details Card */}
      <div className="card bg-base-100 shadow-md border border-base-200 mb-6">
        <div className="card-body">
          <h2 className="card-title text-lg">Booking Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
            <div>
              <p className="text-sm text-base-content/60">Status</p>
              <span
                className={`badge ${
                  booking.status === "active"
                    ? "badge-success"
                    : "badge-warning"
                }`}
              >
                {booking.status}
              </span>
            </div>
            <div>
              <p className="text-sm text-base-content/60">Next Rent Due</p>
              <p className="font-medium">
                {new Date(booking.nextRentDueDate).toLocaleDateString("en-IN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <div>
              <p className="text-sm text-base-content/60">Room & Bed</p>
              <p className="font-medium flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {room ? `${room.name} - ` : ""}{bed.name}
              </p>
            </div>
            <div>
              <p className="text-sm text-base-content/60">Monthly Rent</p>
              <p className="font-medium">₹{booking.monthlyRent.toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pay Rent Button */}
      {(booking.status === "active" || booking.status === "deposit_paid") && !bookingData!.isRentPaid && (
        <div className="card bg-primary/5 border border-primary/20">
          <div className="card-body flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                <CreditCard className="h-5 w-5" /> Pay Monthly Rent
              </h3>
              <p className="text-sm text-base-content/60">
                Pay your rent for the current month online via Razorpay
              </p>
            </div>
            <button
              onClick={handlePayRent}
              className={`btn btn-primary w-full sm:w-auto ${payingRent ? "btn-disabled" : ""}`}
              disabled={payingRent}
            >
              {payingRent ? (
                <span className="loading loading-spinner loading-sm"></span>
              ) : (
                <>Pay ₹{booking.monthlyRent.toLocaleString()}</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Edit Move In Date Modal */}
      <Modal open={moveInDateModalOpen} onClose={() => setMoveInDateModalOpen(false)} title="Update Move-In Date">
        <form onSubmit={handleUpdateMoveInDate} className="space-y-4">
          <div className="p-3 bg-base-200 rounded text-sm text-base-content/70">
            You can change your move-in date before you pay the first month's rent.
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">New Move-In Date</span></label>
            <input
              type="date"
              className="input input-bordered w-full"
              value={newMoveInDate}
              onChange={(e) => setNewMoveInDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              required
            />
          </div>
          <button type="submit" className={`btn btn-primary w-full ${updatingDate ? "btn-disabled" : ""}`} disabled={updatingDate}>
            {updatingDate ? <span className="loading loading-spinner loading-sm"></span> : "Update Date"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
