import React from "react";
import { LogOut, X } from "lucide-react";

export default function LogoutModal({ isOpen, onCancel, onConfirm }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* modal */}
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm mx-4 p-6 sm:p-8 animate-fadeIn">
        {/* close button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition"
        >
          <X size={16} className="text-gray-500" />
        </button>

        {/* icon */}
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
            <LogOut size={28} className="text-red-500" />
          </div>
        </div>

        {/* text */}
        <div className="text-center mb-6">
          <h3 className="text-xl font-bold text-gray-900 mb-2">Sign Out?</h3>
          <p className="text-sm text-gray-500">
            Are you sure you want to sign out of your account? You'll need to sign in again to access your bookings and settings.
          </p>
        </div>

        {/* actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="w-full py-3 rounded-xl font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="w-full py-3 rounded-xl font-semibold text-white bg-red-500 hover:bg-red-600 transition flex items-center justify-center gap-2"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
