import React from "react";
import ModalPortal from "./ModalPortal";

export default function InfoModal({
  isOpen,
  title = "RentifyPro says",
  message = "",
  onClose,
  confirmLabel = "OK",
}) {
  if (!isOpen) return null;

  return (
    <ModalPortal>
    <div className="rp-modal-layer">
      <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close information dialog" />

      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
        <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white">
          <h3 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h3>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm sm:text-base text-slate-600">{message}</p>

          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className="rp-btn-primary px-6 py-2 text-sm sm:text-base">
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
