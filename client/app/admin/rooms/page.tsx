"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";
import { getErrorMessage } from "@/lib/errors";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Modal } from "@/components/Modal";
import toast from "react-hot-toast";
import {
  Home,
  Plus,
  Bed,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
} from "lucide-react";

interface BedData {
  id: number;
  name: string;
  status: string;
  monthlyRent: number;
}

interface RoomData {
  id: number;
  name: string;
  description: string;
  beds: BedData[];
}

interface NewBed {
  name: string;
  monthlyRent: number;
}

export default function AdminRoomsPage() {
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state for new room
  const [roomName, setRoomName] = useState("");
  const [roomDesc, setRoomDesc] = useState("");
  const [newBeds, setNewBeds] = useState<NewBed[]>([
    { name: "Bed A", monthlyRent: 5000 },
  ]);

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      const res = await api.get("/api/rooms");
      setRooms(res.data?.data || []);
    } catch {
      toast.error("Failed to load rooms");
    } finally {
      setLoading(false);
    }
  };

  const addBedField = () => {
    setNewBeds((prev) => [
      ...prev,
      { name: `Bed ${String.fromCharCode(65 + prev.length)}`, monthlyRent: 5000 },
    ]);
  };

  const removeBedField = (index: number) => {
    setNewBeds((prev) => prev.filter((_, i) => i !== index));
  };

  const updateBedField = (
    index: number,
    field: keyof NewBed,
    value: string | number
  ) => {
    setNewBeds((prev) =>
      prev.map((b, i) => (i === index ? { ...b, [field]: value } : b))
    );
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newBeds.length === 0) {
      toast.error("Add at least one bed");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/rooms", {
        name: roomName,
        description: roomDesc,
        beds: newBeds.map((b) => ({
          name: b.name,
          monthlyRent: Number(b.monthlyRent),
        })),
      });
      toast.success("Room created!");
      setModalOpen(false);
      setRoomName("");
      setRoomDesc("");
      setNewBeds([{ name: "Bed A", monthlyRent: 5000 }]);
      fetchRooms();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to create room"));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "available":
        return (
          <span className="badge badge-success badge-xs gap-1">
            <CheckCircle2 className="h-3 w-3" /> Available
          </span>
        );
      case "occupied":
        return (
          <span className="badge badge-error badge-xs gap-1">
            <XCircle className="h-3 w-3" /> Occupied
          </span>
        );
      case "reserved":
        return (
          <span className="badge badge-warning badge-xs gap-1">
            <Clock className="h-3 w-3" /> Reserved
          </span>
        );
      default:
        return <span className="badge badge-ghost badge-xs">{status}</span>;
    }
  };

  if (loading) return <LoadingSpinner text="Loading rooms..." />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Home className="h-6 w-6" /> Rooms & Beds
        </h1>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setModalOpen(true)}
        >
          <Plus className="h-4 w-4" /> Create Room
        </button>
      </div>

      {rooms.length === 0 ? (
        <div className="text-center py-16">
          <Home className="h-12 w-12 mx-auto text-base-content/30 mb-4" />
          <p className="text-base-content/60">No rooms yet. Create one!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="card bg-base-100 shadow-md border border-base-200"
            >
              <div className="card-body p-5">
                <h3 className="card-title text-lg">{room.name}</h3>
                {room.description && (
                  <p className="text-sm text-base-content/60">
                    {room.description}
                  </p>
                )}
                <div className="divider my-1"></div>
                <div className="space-y-2">
                  {room.beds.map((bed) => (
                    <div
                      key={bed.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-base-200/50"
                    >
                      <div className="flex items-center gap-2">
                        <Bed className="h-4 w-4 text-base-content/50" />
                        <span className="text-sm font-medium">{bed.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-base-content/50">
                          ₹{bed.monthlyRent.toLocaleString()}/mo
                        </span>
                        {getStatusBadge(bed.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Room Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create New Room"
      >
        <form onSubmit={handleCreateRoom} className="space-y-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Room Name</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="e.g., Room 101"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              required
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Description</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="e.g., AC Room on first floor"
              value={roomDesc}
              onChange={(e) => setRoomDesc(e.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label-text font-medium">Beds</label>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={addBedField}
              >
                <Plus className="h-3 w-3" /> Add Bed
              </button>
            </div>
            <div className="space-y-2">
              {newBeds.map((bed, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1"
                    placeholder="Bed name"
                    value={bed.name}
                    onChange={(e) => updateBedField(i, "name", e.target.value)}
                    required
                  />
                  <input
                    type="number"
                    className="input input-bordered input-sm w-28"
                    placeholder="Rent"
                    value={bed.monthlyRent}
                    onChange={(e) =>
                      updateBedField(i, "monthlyRent", Number(e.target.value))
                    }
                    required
                    min={0}
                  />
                  {newBeds.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-square"
                      onClick={() => removeBedField(i)}
                    >
                      <Trash2 className="h-4 w-4 text-error" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className={`btn btn-primary w-full ${submitting ? "btn-disabled" : ""}`}
            disabled={submitting}
          >
            {submitting && <span className="loading loading-spinner loading-sm"></span>}
            Create Room
          </button>
        </form>
      </Modal>
    </div>
  );
}
