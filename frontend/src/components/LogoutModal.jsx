import React from "react";
import { LogOut, X } from "lucide-react";
import ModalPortal from "./ModalPortal";

export default function LogoutModal({ isOpen, onCancel, onConfirm }) {
  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="rp-modal-layer">
      <button type="button" className="rp-modal-backdrop" onClick={onCancel} aria-label="Cancel sign out" />

      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
        <div className="px-6 pt-5 pb-4 sm:px-7 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
          <button
            onClick={onCancel}
            className="rp-icon-button absolute right-2 top-2"
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <div className="flex items-center gap-3 pr-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
              <LogOut size={20} className="text-[#0B75E7]" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Sign Out?</h3>
              <p className="text-xs text-slate-500">You will need to sign in again.</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 sm:px-7">
          <p className="text-sm text-slate-600 mb-6">
            Are you sure you want to sign out of your account? You'll need to sign in again to access your bookings and settings.
          </p>

          <div className="flex items-center gap-3">
            <button onClick={onCancel} className="rp-btn-secondary w-full py-2.5 text-sm">
              Cancel
            </button>
            <button onClick={onConfirm} className="rp-btn-primary w-full py-2.5 text-sm">
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
