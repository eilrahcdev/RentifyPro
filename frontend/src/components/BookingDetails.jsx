import { ChevronDown } from "lucide-react";

export default function BookingDetails({ summary, children }) {
  return (
    <div className="rp-booking-details">
      <dl className="rp-booking-detail-grid">{summary}</dl>
      <details className="rp-booking-disclosure">
        <summary>
          More booking details
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <dl className="rp-booking-detail-grid">{children}</dl>
      </details>
    </div>
  );
}

export function BookingInfo({ title, value, icon: Icon }) {
  return (
    <div className="rp-booking-info">
      <dt>{Icon && <Icon size={16} strokeWidth={2} aria-hidden="true" />}{title}</dt>
      <dd>{value}</dd>
    </div>
  );
}
