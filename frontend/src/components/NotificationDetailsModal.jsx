import { WalletCards, X } from "lucide-react";
import ModalPortal from "./ModalPortal";

const LATE_RETURN_EVENTS = new Set([
  "booking.overdue",
  "late_return.processed",
  "vehicle_return.confirmed",
]);

const money = (value) =>
  `₱${Math.max(0, Number(value || 0)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

const formatDuration = (value) => {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours}h ${remainder}m`;
  if (hours) return `${hours}h`;
  return `${remainder}m`;
};

const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function DetailLine({ label, value, strong = false }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${strong ? "font-bold text-slate-950" : "font-semibold text-slate-800"}`}>
        {value}
      </span>
    </div>
  );
}

export default function NotificationDetailsModal({ notification, viewerRole = "user", onClose, onOpenBookings }) {
  if (!notification) return null;

  const data = notification.data || {};
  const eventName = String(notification.event || "").trim().toLowerCase();
  const isLateReturn =
    LATE_RETURN_EVENTS.has(eventName) &&
    (Boolean(data.isOverdue) ||
      Number(data.overdueMinutes || 0) > 0 ||
      Number(data.lateReturnPenaltyFee || 0) > 0 ||
      Number(data.estimatedLateReturnPenaltyFee || 0) > 0);
  const isFinalFee = data.feeStatus === "final" || hasNumber(data.lateReturnPenaltyFee);
  const isRenter = String(viewerRole || "user").toLowerCase() !== "owner";
  const feeAmount = isFinalFee ? data.lateReturnPenaltyFee : data.estimatedLateReturnPenaltyFee;
  const canOpenBookings = isRenter && typeof onOpenBookings === "function";

  return (
    <ModalPortal>
      <div
        className="rp-modal-layer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-details-title"
      >
        <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close notification details" />
        <section className="relative z-10 flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)] sm:max-h-[90dvh] sm:rounded-3xl">
          <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-[#017FE6]">
                  <WalletCards size={24} strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#017FE6]">
                    {isLateReturn ? (isFinalFee ? "Late-return payment" : "Late-return estimate") : "Notification"}
                  </p>
                  <h2 id="notification-details-title" className="mt-0.5 text-lg font-bold text-slate-900">
                    {isLateReturn ? (isFinalFee ? "Review late-return fee" : "Late-return fee details") : "Notification details"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {isLateReturn ? "Review the booking and payment information below." : formatDateTime(notification.lastOccurredAt || notification.createdAt)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rp-icon-button"
                aria-label="Close notification details"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-slate-50 p-4 sm:p-6">
            {isLateReturn && (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${isFinalFee ? "border-blue-200 bg-blue-50 text-blue-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                {isFinalFee
                  ? isRenter
                    ? "This is the final fee after the owner confirmed receipt. To settle it, open My Bookings, find this completed booking, and select Pay Remaining. You can pay online or request walk-in payment for owner approval."
                    : "This is the final fee recorded when you confirmed receipt. The renter can settle the remaining balance from My Bookings."
                  : "This amount is an estimate and continues to increase until the owner confirms receipt of the vehicle. It cannot be paid until the fee is finalized."}
              </div>
            )}

            <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <p className="pb-1 text-sm font-semibold text-slate-800">{notification.title}</p>
              <p className="leading-6 text-slate-600">{notification.message}</p>
              <DetailLine label="Received" value={formatDateTime(notification.lastOccurredAt || notification.createdAt)} />
            </section>

            {isLateReturn && (
              <>
                <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                  <p className="pb-1 text-sm font-semibold text-slate-800">Late-return details</p>
                  <DetailLine label="Vehicle" value={data.vehicleName || "Booked vehicle"} />
                  <DetailLine label="Scheduled Return" value={formatDateTime(data.scheduledReturnAt)} />
                  {data.actualReturnAt && <DetailLine label="Receipt Confirmed" value={formatDateTime(data.actualReturnAt)} />}
                  <DetailLine label="Overdue Duration" value={formatDuration(data.overdueMinutes)} />
                  {hasNumber(data.graceMinutes) && <DetailLine label="Grace Period" value={formatDuration(data.graceMinutes)} />}
                  {hasNumber(data.lateReturnPenaltyRatePerHour) && (
                    <DetailLine label="Late Fee Rate" value={`${money(data.lateReturnPenaltyRatePerHour)} / hour`} />
                  )}
                </section>

                <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                  <p className="pb-1 text-sm font-semibold text-slate-800">Payment details</p>
                  {hasNumber(data.rentalAmount) && <DetailLine label="Rental Amount" value={money(data.rentalAmount)} />}
                  <DetailLine
                    label={isFinalFee ? "Late-return Fee" : "Estimated Late-return Fee"}
                    value={money(feeAmount)}
                    strong
                  />
                  {hasNumber(data.transactionFee) && <DetailLine label="Transaction Fee" value={money(data.transactionFee)} />}
                  {hasNumber(data.paymentAmountPaid) && <DetailLine label="Already Paid" value={money(data.paymentAmountPaid)} />}
                  {hasNumber(data.totalAmountPayable) && <DetailLine label="Total Amount Payable" value={money(data.totalAmountPayable)} />}
                  {hasNumber(data.remainingBalance) && (
                    <DetailLine label="Remaining Balance" value={money(data.remainingBalance)} strong />
                  )}
                </section>
              </>
            )}
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button type="button" onClick={onClose} className="rp-btn-secondary px-4 py-2.5 text-sm">
              Close
            </button>
            {canOpenBookings && (
              <button type="button" onClick={onOpenBookings} className="rp-btn-primary px-4 py-2.5 text-sm">
                {isFinalFee ? "View Booking & Payment" : "View Booking"}
              </button>
            )}
          </footer>
        </section>
      </div>
    </ModalPortal>
  );
}
