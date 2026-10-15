import { formatDurationMinutes } from "../utils/dateUtils";

const date = (value) => value ? new Date(value).toLocaleString() : "Not recorded";
const money = (value) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value) || 0);

export default function BookingPolicyDetails({ booking, onReport }) {
  const policy = booking.bookingPolicy;
  const history = policy?.extensionHistory || [];
  const returned = booking.actualReturnAt;
  const reported = (booking.returnRequest || booking.return_request)?.reportedHandoverAt;
  if (!history.length && !returned && !reported) return null;
  const approved = history.filter((entry) => entry.status === "approved");
  const extensionAmount = approved.reduce((sum, entry) => sum + Number(entry.totalAmount || 0), 0);
  return (
    <details className="mt-3 border-t border-slate-200 pt-2 text-sm text-slate-700">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">Extension and return details</summary>
      <div className="space-y-3 pb-2">
        {approved.length > 0 && <p>Original rental: {money(Number(booking.totalAmount || 0) - extensionAmount)}. Approved extensions: {money(extensionAmount)}.</p>}
        {history.map((entry, index) => <div key={`${entry.requestedAt}-${index}`} className="break-words">
          <p className="font-medium">Extension {index + 1}: {entry.status}</p>
          <p>Requested return: {date(entry.requestedReturnAt)}.</p>
          {entry.status === "approved" && <p>Rental time charged: {date(entry.billingStartAt)} to {date(entry.requestedReturnAt)} ({formatDurationMinutes(entry.durationMinutes)}), {money(entry.totalAmount)}.</p>}
        </div>)}
        {reported && <p>Renter-reported handover: {date(reported)}. {returned ? "Reviewed by the owner." : "Waiting for owner verification."}</p>}
        {returned && <>
          <p>Verified handover: {date(returned)}.</p>
          <p>Owner confirmation: {date((booking.returnRequest || booking.return_request)?.confirmedAt)}.</p>
          {onReport && <button type="button" onClick={onReport} className="min-h-11 py-2 text-left font-semibold text-blue-800 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700">Report an incorrect handover time or charge</button>}
        </>}
      </div>
    </details>
  );
}
