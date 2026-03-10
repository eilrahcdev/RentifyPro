import React from "react";

export default function InfoModal({
  isOpen,
  title = "RentifyPro says",
  message = "",
  onClose,
  confirmLabel = "OK",
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl rounded-3xl border border-[#E8C36A] bg-[#17130D] px-6 py-5 text-amber-50 shadow-2xl">
        <h3 className="text-3xl font-bold text-[#E8C36A]">{title}</h3>
        <p className="mt-3 text-base text-amber-100">{message}</p>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border-2 border-[#E8C36A] bg-[#E8C36A] px-8 py-2 font-semibold text-[#17130D] transition hover:bg-[#F4D27E]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
