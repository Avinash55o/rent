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
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomData | null>(null);
  const [editingBeds, setEditingBeds] = useState<Record<number, { name: string; monthlyRent: number }>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; roomId: number | null }>({
    isOpen: false,
    roomId: null,
  });
  const [deleting, setDeleting] = useState(false);

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

  const handleEditClick = (room: RoomData) => {
    setEditingRoom(room);
    const bedEdits: Record<number, { name: string; monthlyRent: number }> = {};
    room.beds.forEach((b) => {
      bedEdits[b.id] = { name: b.name, monthlyRent: b.monthlyRent };
    });
    setEditingBeds(bedEdits);
    setEditModalOpen(true);
  };

  const updateEditingBed = (bedId: number, field: "name" | "monthlyRent", value: string | number) => {
    setEditingBeds((prev) => ({
      ...prev,
      [bedId]: { ...prev[bedId], [field]: value }
    }));
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom) return;
    setSavingEdit(true);
    try {
      await api.put(`/api/rooms/${editingRoom.id}`, { name: editingRoom.name, description: editingRoom.description });
      
      const updates = Object.entries(editingBeds).map(([bedId, data]) => {
         return api.put(`/api/rooms/${editingRoom.id}/beds/${bedId}`, data);
      });
      await Promise.all(updates);

      toast.success("Room updated successfully!");
      setEditModalOpen(false);
      fetchRooms();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to update room"));
    } finally {
      setSavingEdit(false);
    }
  };

  const confirmDeleteRoom = async () => {
    if (!confirmModal.roomId) return;
    setDeleting(true);
    try {
      await api.delete(`/api/rooms/${confirmModal.roomId}`);
      toast.success("Room deleted successfully!");
      setConfirmModal({ isOpen: false, roomId: null });
      fetchRooms();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to delete room"));
    } finally {
      setDeleting(false);
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
                <div className="flex items-center justify-between mb-1">
                  <h3 className="card-title text-lg m-0">{room.name}</h3>
                  <div className="flex gap-1">
                    <button 
                      className="btn btn-ghost btn-xs text-error px-2" 
                      onClick={() => setConfirmModal({ isOpen: true, roomId: room.id })}
                      title="Delete Room"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button className="btn btn-ghost btn-xs" onClick={() => handleEditClick(room)}>Edit</button>
                  </div>
                </div>
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

      {/* Edit Room Modal */}
      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Room & Beds">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Room Name</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={editingRoom?.name || ""}
              onChange={(e) => setEditingRoom(prev => prev ? { ...prev, name: e.target.value } : null)}
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
              value={editingRoom?.description || ""}
              onChange={(e) => setEditingRoom(prev => prev ? { ...prev, description: e.target.value } : null)}
            />
          </div>

          <div>
            <label className="label-text font-medium mb-2 block">Beds (Edit details)</label>
            <div className="space-y-2">
              {editingRoom?.beds.map((bed) => (
                <div key={bed.id} className="flex gap-2 items-center">
                  <input
                    type="text"
                    className="input input-bordered input-sm flex-1"
                    value={editingBeds[bed.id]?.name || ""}
                    onChange={(e) => updateEditingBed(bed.id, "name", e.target.value)}
                    required
                  />
                  <input
                    type="text" inputMode="numeric" pattern="[0-9]*"
                    className="input input-bordered input-sm w-28"
                    value={editingBeds[bed.id]?.monthlyRent}
                    onChange={(e) => updateEditingBed(bed.id, "monthlyRent", Number(e.target.value) || 0)}
                    required
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className={`btn btn-primary w-full ${savingEdit ? "btn-disabled" : ""}`}
            disabled={savingEdit}
          >
            {savingEdit && <span className="loading loading-spinner loading-sm"></span>}
            Save Changes
          </button>
        </form>
      </Modal>

      {/* Confirmation Modal */}
      <Modal
        open={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, roomId: null })}
        title="Delete Room"
      >
        <div className="space-y-4">
          <p className="text-base-content/80">
            Are you sure you want to completely delete this room and all its beds? This cannot be undone.
          </p>
          <div className="flex gap-3 justify-end mt-6">
            <button
              className="btn btn-ghost"
              onClick={() => setConfirmModal({ isOpen: false, roomId: null })}
            >
              Cancel
            </button>
            <button
              className={`btn btn-error ${deleting ? "btn-disabled" : ""}`}
              onClick={confirmDeleteRoom}
              disabled={deleting}
            >
              {deleting && <span className="loading loading-spinner loading-sm"></span>}
              Yes, Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
