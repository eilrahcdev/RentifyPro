import React from "react";
import { Car, LogIn, UserPlus, X } from "lucide-react";

export default function BookingAccessModal({
  isOpen,
  onSignIn,
  onRegister,
  onBrowseVehicles,
  onClose,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
        <div className="px-6 pt-5 pb-4 sm:px-7 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <h3 className="text-xl font-bold text-slate-900">Bookings require an account</h3>
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
              <Car size={18} />
              Continue Browsing Vehicles
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

