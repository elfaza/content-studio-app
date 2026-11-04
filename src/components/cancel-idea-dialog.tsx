"use client";
import { useState } from "react";
import { Dialog } from "./ui/dialog";

export function CancelIdeaDialog({
  title,
  onClose,
  onConfirm,
}: {
  title: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      title="Cancel idea"
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
      description="Keep the idea and record why you decided to stop working on it."
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!reason.trim()) {
            setError("Enter a cancellation reason.");
            return;
          }
          setSaving(true);
          setError("");
          try {
            await onConfirm(reason.trim());
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not cancel this idea.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <p className="cancel-idea-title">{title}</p>
        <label className="field">
          <span>Cancellation reason</span>
          <textarea
            rows={4}
            required
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are you cancelling this idea?"
            disabled={saving}
          />
        </label>
        <p className="form-note">
          Pending schedules for this idea will also be cancelled. You can
          restore the idea later; old schedules will not restart automatically.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          <button
            className="button outline"
            type="button"
            disabled={saving}
            onClick={onClose}
          >
            Keep idea
          </button>
          <button className="button danger" disabled={saving || !reason.trim()}>
            {saving ? "Cancelling…" : "Cancel idea"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
