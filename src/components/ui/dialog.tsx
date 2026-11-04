"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
export function Dialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className="dialog-content"
          onEscapeKeyDown={(event) => {
            const focused = document.activeElement;
            if (
              focused?.getAttribute("role") === "combobox" &&
              focused.getAttribute("aria-expanded") === "true"
            )
              event.preventDefault();
          }}
        >
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">YOUR CREATIVE WORKSPACE</p>
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close
              className="icon-button"
              aria-label="Close dialog"
            >
              <X size={20} />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="muted small">
            Keep the details that matter. You can always come back to refine
            them.
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
