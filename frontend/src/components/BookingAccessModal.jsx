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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md mx-4 p-6 sm:p-8 animate-fadeIn">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition"
        >
          <X size={16} className="text-gray-500" />
        </button>

        <div className="text-center">
          <h3 className="text-xl font-bold text-gray-900">Bookings require an account</h3>
          <p className="text-sm text-gray-500 mt-2">
            Sign in or register to view your booking history, status updates, and notifications.
          </p>
        </div>

        <div className="mt-6 space-y-3">
          <button
            onClick={onSignIn}
            className="w-full py-3 rounded-xl font-semibold text-white bg-[#017FE6] hover:bg-[#0165B8] transition flex items-center justify-center gap-2"
          >
            <LogIn size={18} />
            Sign In
          </button>

          <button
            onClick={onRegister}
            className="w-full py-3 rounded-xl font-semibold border border-[#017FE6] text-[#017FE6] hover:bg-[#017FE6]/5 transition flex items-center justify-center gap-2"
          >
            <UserPlus size={18} />
            Register
          </button>

          <button
            onClick={onBrowseVehicles}
            className="w-full py-3 rounded-xl font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-2"
          >
            <Car size={18} />
            Continue Browsing Vehicles
          </button>
        </div>
      </div>
    </div>
  );
}

