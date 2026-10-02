import { Fuel, MapPin, Settings, Star, Users } from "lucide-react";
import VehicleCover from "./VehicleCover";
import { formatVehicleTypeLabel } from "../utils/vehicleText";
import "./VehicleCard.css";

// Actions and management controls stay with the page that owns their behavior.
export default function VehicleCard({
  vehicle,
  onPreview,
  onBookNow,
  actions,
  management,
  details,
  imageBadge,
  compactSpecs = false,
  className = "",
  imageClassName = "",
  ...articleProps
}) {
  const specs = vehicle.specs || {};
  const available = vehicle.available ?? vehicle.availabilityStatus === "available";
  const inspection = !available && vehicle.availabilityHoldReason === "inspection";
  const status = available ? "Available" : inspection ? "Under inspection/maintenance" : "Unavailable";
  const category = formatVehicleTypeLabel(vehicle.type || specs.type, vehicle.subType || specs.subType, {
    separator: " · ",
    fallback: vehicle.category || "Owner-listed Vehicle",
  });
  const price = Number(vehicle.price ?? vehicle.hourlyRentalRate ?? vehicle.dailyRentalRate ?? 0);
  const rating = Number(vehicle.rating ?? vehicle.averageRating ?? 0);
  const Preview = onPreview ? "button" : "div";
  const seatsLabel = `${vehicle.seats ?? specs.seats ?? "-"} seats`;
  const transmissionLabel = vehicle.transmission || specs.transmission || "-";
  const fuelLabel = vehicle.fuel || specs.fuel || "-";

  return (
    <article {...articleProps} className={[
      "rp-vehicle-card",
      management && "rp-vehicle-card--managed",
      compactSpecs && "rp-vehicle-card--compact-specs",
      className,
    ].filter(Boolean).join(" ")}>
      <Preview
        className="rp-vehicle-card__preview"
        {...(onPreview ? {
          type: "button",
          onClick: () => onPreview(vehicle),
          "aria-label": `View details for ${vehicle.name}`,
        } : {})}
      >
        <span className="rp-vehicle-card__media">
          <VehicleCover vehicle={vehicle} alt={vehicle.name} contentClassName="p-4 sm:p-5" imageClassName={imageClassName}>
            <span className="rp-vehicle-card__badges">
              <span className={`rp-vehicle-card__availability ${available ? "is-available" : inspection ? "is-inspection" : ""}`}>{status}</span>
              <span className="rp-vehicle-card__rating">
                {imageBadge ?? <><Star size={16} strokeWidth={2} fill="currentColor" aria-hidden="true" />{vehicle.reviewCount > 0 && Number.isFinite(rating) ? rating : "New"}</>}
              </span>
            </span>
          </VehicleCover>
        </span>
      </Preview>

      <div className="rp-vehicle-card__body">
        <div className="rp-vehicle-card__topline">
          <span className="rp-vehicle-card__category" title={category}>{category}</span>
          {vehicle.driverOptionEnabled && <span className="rp-vehicle-card__driver">Driver available</span>}
        </div>
        <h3 title={vehicle.name}>{vehicle.name}</h3>
        <p className="rp-vehicle-card__location">
          <MapPin size={16} strokeWidth={2} aria-hidden="true" />
          <span title={vehicle.location}>{vehicle.location || "Location available on request"}</span>
        </p>
        <div className="rp-vehicle-card__specs" aria-label={`${vehicle.name} specifications`}>
          <span title={seatsLabel}><Users size={16} strokeWidth={2} aria-hidden="true" /><span className="rp-vehicle-card__spec-value">{seatsLabel}</span></span>
          <span title={transmissionLabel}><Settings size={16} strokeWidth={2} aria-hidden="true" /><span className="rp-vehicle-card__spec-value">{transmissionLabel}</span></span>
          <span title={fuelLabel}><Fuel size={16} strokeWidth={2} aria-hidden="true" /><span className="rp-vehicle-card__spec-value">{fuelLabel}</span></span>
        </div>
        {details && <div className="rp-vehicle-card__details">{details}</div>}
        <div className="rp-vehicle-card__bottom">
          {management && <div className="rp-vehicle-card__management">{management}</div>}
          <div className="rp-vehicle-card__footer">
            <p className="rp-vehicle-card__price">
              <span>From</span>
              <strong>₱{Number.isFinite(price) ? price.toLocaleString("en-PH") : "—"}</strong>
              <small>/ hour</small>
            </p>
            <div className={`rp-vehicle-card__actions ${management ? "rp-vehicle-card__actions--management" : ""}`}>
              {actions ?? (onBookNow && (
                <button type="button" className="rp-vehicle-card__book" onClick={() => onBookNow(vehicle)} disabled={!available}>
                  {available ? "Book now" : "Unavailable"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
