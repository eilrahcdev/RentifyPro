import React from "react";
import { CarFront, LogIn, UserPlus, X } from "lucide-react";
import ModalPortal from "./ModalPortal";

export default function BookingAccessModal({
  isOpen,
  onSignIn,
  onRegister,
  onBrowseVehicles,
  onClose,
}) {
  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="rp-modal-layer">
      <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close booking access dialog" />

      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
        <div className="px-6 pt-5 pb-4 sm:px-7 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
          <button
            onClick={onClose}
            className="rp-icon-button absolute right-2 top-2"
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <h3 className="pr-10 text-xl font-bold text-slate-900">Bookings require an account</h3>
          <p className="text-sm text-slate-600 mt-1">
            Sign in or register to view your booking history, status updates, and notifications.
          </p>
        </div>

        <div className="px-6 py-5 sm:px-7">
          <div className="space-y-3">
            <button onClick={onSignIn} className="rp-btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2">
              <LogIn size={18} />
              Sign In
            </button>

            <button
              onClick={onRegister}
              className="rp-btn-secondary w-full py-2.5 text-sm flex items-center justify-center gap-2"
            >
              <UserPlus size={18} />
              Register
            </button>

            <button
              onClick={onBrowseVehicles}
              className="rp-btn-secondary w-full py-2.5 text-sm flex items-center justify-center gap-2"
            >
              <CarFront size={18} strokeWidth={2} aria-hidden="true" />
              Continue Browsing Vehicles
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

