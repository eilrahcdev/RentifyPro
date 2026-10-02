import { useEffect } from "react";
import { BadgeCheck, MapPin, MessageCircle, Star, X } from "lucide-react";
import { getInitialsFromName } from "../utils/dateUtils";
import { resolveAssetUrl } from "../utils/media";
import VehicleCover from "./VehicleCover";
import ModalPortal from "./ModalPortal";

const STAR_SLOTS = [1, 2, 3, 4, 5];

export default function VehiclePreviewModal({
  isOpen,
  vehicle,
  onClose,
  onBookNow,
  onChatOwner,
  disableChat = false,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !vehicle) return null;

  const description =
    String(vehicle.description || "").trim() || "No additional description provided by the owner.";
  const ownerName = vehicle.owner?.name || "Vehicle Owner";
  const ownerEmail = String(vehicle.owner?.email || "").trim();
  const ownerAvatar = resolveAssetUrl(vehicle.owner?.avatar || "");
  const ownerVerified = vehicle.owner?.verified !== false;
  const rating = Number.isFinite(Number(vehicle.rating)) ? Number(vehicle.rating) : 0;
  const reviewCount = Number.isFinite(Number(vehicle.reviewCount)) ? Number(vehicle.reviewCount) : 0;
  const isBookable = vehicle.available !== false;
  const location = String(vehicle.location || "").trim();

  return (
    <ModalPortal lockScroll={false}>
    <div className="rp-modal-layer">
      <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close vehicle preview" />

      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_25px_80px_rgba(15,23,42,0.25)]">
        <div className="shrink-0 border-b border-slate-200 bg-gradient-to-r from-[#0B75E7]/10 via-white to-white px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rp-icon-button absolute right-2 top-2"
            aria-label="Close vehicle preview"
          >
            <X size={16} />
          </button>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehicle Preview</p>
          <h3 className="mt-1 pr-10 text-xl sm:text-2xl font-bold text-slate-900">{vehicle.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
            <MapPin size={16} strokeWidth={2} className="text-[#0B75E7]" aria-hidden="true" />
            {location || "Location not specified"}
          </p>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.05fr_1fr]">
            <VehicleCover
              vehicle={vehicle}
              alt={vehicle.name}
              className="min-h-[230px]"
              contentClassName="p-5 sm:p-7"
            />

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rp-chip bg-amber-100 text-amber-700">
                  <Star size={16} strokeWidth={2} className="fill-current" aria-hidden="true" />
                  {reviewCount > 0 ? rating.toFixed(1) : "No reviews"}
                </span>
                {reviewCount > 0 && (
                  <span className="text-xs text-slate-500">
                    {reviewCount} review{reviewCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 text-amber-500">
                {STAR_SLOTS.map((slot) => (
                  <Star
                    key={slot}
                    size={16}
                    className={slot <= Math.round(Math.max(0, Math.min(5, rating))) ? "fill-current" : ""}
                  />
                ))}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{description}</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {ownerAvatar ? (
                      <img
                        src={ownerAvatar}
                        alt={ownerName}
                        className="h-11 w-11 rounded-full border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-[#0B75E7] text-sm font-bold text-white">
                        {getInitialsFromName(ownerName)}
                      </div>
                    )}
                    <div className="min-w-0 break-words">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Car Owner</p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-900">{ownerName}</p>
                        {ownerVerified && <BadgeCheck size={16} strokeWidth={2} className="text-[#0B75E7]" aria-hidden="true" />}
                      </div>
                      <p className="text-xs text-slate-500">{ownerEmail || "Verified RentifyPro owner"}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onChatOwner}
                    disabled={disableChat}
                    className="rp-btn-secondary inline-flex items-center gap-2 px-3 py-2 text-xs sm:text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <MessageCircle size={18} strokeWidth={2} aria-hidden="true" />
                    Chat Owner
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={onBookNow}
                disabled={!isBookable}
                className={`w-full py-2.5 rounded-xl text-sm sm:text-base font-semibold transition ${
                  isBookable
                    ? "rp-btn-primary"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
              >
                {isBookable ? "Book Now" : "Unavailable"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
