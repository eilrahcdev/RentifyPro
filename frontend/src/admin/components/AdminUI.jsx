import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileImage,
  FileText,
  LoaderCircle,
  Mail,
  Phone,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import VehicleImage from "./VehicleImage";
import ManualDocumentComparison from "./ManualDocumentComparison";
import { presentVehicle } from "../vehiclePresentation";
import { adminDataApi } from "../adminDataApi";
import AdminSelect from "./AdminSelect";

export function StatusBadge({ value }) {
  const status = String(value || "").toLowerCase();
  const tone =
    ["active", "available", "approved", "verified"].includes(status)
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
      : ["on rent", "rented", "confirmed", "paid"].includes(status)
        ? "bg-blue-50 text-blue-700 ring-blue-600/15"
        : ["pending", "pending review", "pending verification", "inactive"].includes(status)
          ? "bg-amber-50 text-amber-700 ring-amber-600/15"
          : ["maintenance", "under maintenance", "partial"].includes(status)
            ? "bg-orange-50 text-orange-700 ring-orange-600/15"
            : ["rejected", "suspended", "cancelled", "unavailable", "overdue"].includes(status)
              ? "bg-rose-50 text-rose-700 ring-rose-600/15"
              : "bg-slate-100 text-slate-700 ring-slate-500/15";

  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {value}
    </span>
  );
}

export function StatCard({ label, value, description, icon: Icon, tone = "blue", showArrow = false }) {
  const tones = {
    blue: { icon: "bg-blue-50 text-blue-600 ring-blue-100" },
    green: { icon: "bg-emerald-50 text-emerald-600 ring-emerald-100" },
    amber: { icon: "bg-amber-50 text-amber-600 ring-amber-100" },
    red: { icon: "bg-rose-50 text-rose-600 ring-rose-100" },
    slate: { icon: "bg-slate-100 text-slate-600 ring-slate-200" },
  };
  const theme = tones[tone] || tones.blue;

  return (
    <article className="group min-h-[132px] min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_20px_rgba(33,33,33,0.035)] transition duration-200 hover:border-blue-200 hover:shadow-[0_10px_26px_rgba(33,33,33,0.055)]">
      <div className="flex items-start justify-between gap-3.5">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${theme.icon}`}>
            <Icon size={19} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">{label}</p>
            <p className="mt-1 text-[28px] font-extrabold tracking-[-0.035em] text-slate-900">{value}</p>
            {description ? <p className="mt-1.5 text-[11px] leading-[1.1rem] text-slate-500">{description}</p> : null}
          </div>
        </div>
        {showArrow ? <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-blue-600" aria-hidden="true" /> : null}
      </div>
    </article>
  );
}

export function SearchField({ label, value, onChange, placeholder }) {
  return (
    <label className="block min-w-0">
      {label ? <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-600">{label}</span> : null}
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </div>
    </label>
  );
}

export function FilterSelect(props) {
  return <AdminSelect {...props} />;
}

export function EmptyState({ icon: Icon = FileText, title, description }) {
  return (
    <div className="px-6 py-14 text-center">
      <Icon size={30} className="mx-auto text-slate-300" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function TableFooter({ visible, total, noun }) {
  return (
    <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-500">
      Showing {visible} of {total} {noun}
    </div>
  );
}

export function Toast({ message }) {
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-2xl sm:bottom-auto sm:left-auto sm:right-5 sm:top-5 sm:translate-x-0">
      <CheckCircle2 size={18} className="text-emerald-400" aria-hidden="true" />
      {message}
    </div>
  );
}

export function ConfirmationDialog({ confirmation, loading, onCancel, onConfirm }) {
  if (!confirmation) return null;
  return <ConfirmationForm key={confirmation.key || confirmation.title} confirmation={confirmation} loading={loading} onCancel={onCancel} onConfirm={onConfirm} />;
}

function ConfirmationForm({ confirmation, loading, onCancel, onConfirm }) {
  const dialogRef = useDialogFocus();
  const danger = confirmation.tone === "danger";
  const [reason, setReason] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const reasonValid = !confirmation.requireReason || (reason.trim().length >= 10 && reason.trim().length <= 500);
  const passwordValid = !confirmation.requirePassword || adminPassword.length > 0;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && !loading && onCancel()}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${danger ? "bg-rose-50 text-rose-600" : "bg-blue-50 text-blue-600"}`}>
          {danger ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
        </div>
        <h3 id="confirmation-title" className="mt-5 text-xl font-bold text-slate-950">{confirmation.title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{confirmation.description}</p>
        {confirmation.requireReason ? <label className="mt-5 block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">Reason</span><textarea data-dialog-initial value={reason} onChange={(event) => setReason(event.target.value.slice(0, 500))} disabled={loading} rows={3} placeholder="Explain why this action is necessary (at least 10 characters)" className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50" /><span className={`mt-1 block text-xs ${reason.length && !reasonValid ? "text-rose-600" : "text-slate-500"}`}>{reason.trim().length}/500 characters</span></label> : null}
        {confirmation.requirePassword ? <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-slate-800">Confirm Super Admin password</span><input type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} disabled={loading} placeholder="Enter your current password" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-50" /></label> : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" data-dialog-initial={!confirmation.requireReason ? true : undefined} disabled={loading} onClick={onCancel} className="h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={loading || !reasonValid || !passwordValid} onClick={() => onConfirm({ reason: reason.trim(), adminPassword })} className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${danger ? "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-100" : "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-100"}`}>
            {loading ? <LoaderCircle size={17} className="animate-spin" /> : null}
            {loading ? "Working..." : confirmation.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ViewerDialog({ item, onClose }) {
  if (!item) return null;
  if (item.type === "Customer profile") return <CustomerProfileDialog item={item} onClose={onClose} />;
  if (item.type === "Vehicle details") return <VehicleDetailsDialog key={item.vehicle?.id || item.title} item={item} onClose={onClose} />;
  if (item.type === "Booking operations") return <BookingDetailsDialog item={item} onClose={onClose} />;
  return <DefaultViewerDialog item={item} onClose={onClose} />;
}

function DefaultViewerDialog({ item, onClose }) {
  const dialogRef = useDialogFocus();
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="viewer-title" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">{item.type}</p>
            <h3 id="viewer-title" className="mt-2 text-xl font-bold text-slate-950">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{item.subtitle}</p>
          </div>
          <button type="button" data-dialog-initial onClick={onClose} aria-label="Close preview" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><X size={19} /></button>
        </div>
        <PreviewPane item={item} className="mt-6 min-h-64" />
      </div>
    </div>
  );
}

function BookingDetailsDialog({ item, onClose }) {
  const dialogRef = useDialogFocus();
  const booking = item.booking || {};
  const status = booking.isOverdue ? "Overdue" : booking.isActive ? "Active" : booking.status;
  const details = [
    ["Renter", booking.renter],
    ["Vehicle", booking.vehicle],
    ["Operator", booking.operator],
    ["Pickup", formatBookingDateTime(booking.pickupAt)],
    ["Return", formatBookingDateTime(booking.returnAt)],
    ["Booked on", formatBookingDateTime(booking.createdAt)],
    ["Booking status", booking.status],
    ["Driver option", booking.driverSelected ? "Selected" : "Not selected"],
  ];
  const hasRating = Number(booking.reviewRating) >= 1 && Number(booking.reviewRating) <= 5;
  const hasReview = hasRating || Boolean(booking.reviewComment);

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="booking-details-title" className="flex max-h-[min(720px,calc(100dvh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Booking details</p><h3 id="booking-details-title" className="mt-1 break-words text-xl font-bold text-slate-950">{item.title}</h3></div>
          <button data-dialog-initial type="button" onClick={onClose} aria-label="Close booking details" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><X size={19} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          {status ? <StatusBadge value={status} /> : null}
          <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{value || "Not provided"}</dd></div>)}
          </dl>
          {hasReview ? <section aria-labelledby="booking-review-title" className="mt-5 border-t border-slate-200 pt-4"><h4 id="booking-review-title" className="text-sm font-bold text-slate-900">Renter review</h4>{hasRating ? <p className="mt-2 text-sm font-semibold text-slate-700">Rating: {booking.reviewRating} / 5</p> : null}{booking.reviewComment ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{booking.reviewComment}</p> : null}{booking.reviewCreatedAt ? <p className="mt-2 text-xs text-slate-500">Submitted {formatBookingDateTime(booking.reviewCreatedAt)}</p> : null}</section> : null}
        </div>
      </div>
    </div>
  );
}

function formatBookingDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Not provided";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function VehicleDetailsDialog({ item, onClose }) {
  const dialogRef = useDialogFocus();
  const vehicle = presentVehicle(item.vehicle || {});
  const images = vehicle.images?.length ? vehicle.images : vehicle.image ? [vehicle.image] : [];
  const [imageIndex, setImageIndex] = useState(0);
  const selectedIndex = Math.min(imageIndex, Math.max(0, images.length - 1));
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="vehicle-details-title" className="flex max-h-[min(720px,calc(100dvh-3rem))] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Vehicle details</p><h3 id="vehicle-details-title" className="mt-1 break-words text-xl font-bold text-slate-950">{vehicle.name || item.title}</h3></div>
          <button data-dialog-initial type="button" onClick={onClose} aria-label="Close vehicle details" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><X size={19} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          <VehicleImage vehicle={{ ...vehicle, image: images[selectedIndex] || "" }} />
          {images.length > 1 ? <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => setImageIndex(selectedIndex - 1)} disabled={selectedIndex === 0} aria-label="Previous vehicle image" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={18} /></button>
              <p aria-live="polite" className="text-xs font-semibold text-slate-600">Image {selectedIndex + 1} of {images.length}</p>
              <button type="button" onClick={() => setImageIndex(selectedIndex + 1)} disabled={selectedIndex === images.length - 1} aria-label="Next vehicle image" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={18} /></button>
            </div>
            <div aria-label="Vehicle image gallery" className="flex gap-2 overflow-x-auto pb-1">
              {images.map((image, index) => <button type="button" key={image} onClick={() => setImageIndex(index)} aria-label={`Show vehicle image ${index + 1}`} aria-pressed={index === selectedIndex} className={`shrink-0 overflow-hidden rounded-lg border-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${index === selectedIndex ? "border-blue-600" : "border-transparent hover:border-blue-200"}`}><VehicleImage vehicle={{ ...vehicle, image }} className="w-16" thumbnail /></button>)}
            </div>
          </div> : null}
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold tracking-wide text-blue-700">{[vehicle.type, vehicle.category].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ") || "Vehicle"}</p><p className="mt-1 break-words text-sm text-slate-600">{vehicle.location || "Location not provided"}</p></div>
            {vehicle.status ? <StatusBadge value={vehicle.status} /> : null}
          </div>
          <section aria-labelledby="vehicle-description-title" className="mt-3 rounded-xl bg-slate-50 p-3"><h4 id="vehicle-description-title" className="text-sm font-bold text-slate-900">Description</h4><p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600 [overflow-wrap:anywhere]">{vehicle.description || "No description has been provided for this vehicle."}</p></section>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {[["Rental rate", vehicle.rentalRate], ["Seats", vehicle.seats], ["Transmission", vehicle.transmission], ["Fuel", vehicle.fuel], ["Plate number", vehicle.plateNumber], ["Driver option", vehicle.driverOption]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className={`mt-1 break-words text-sm font-semibold ${label === "Rental rate" ? "text-blue-700" : "text-slate-900"}`}>{value ?? "Not provided"}</dd></div>)}
          </dl>
          <div className="mt-4 border-t border-slate-200 pt-3"><p className="text-xs text-slate-500">Operator</p><p className="mt-1 break-words text-sm font-semibold text-slate-900">{vehicle.operator || "Not provided"}</p></div>
        </div>
      </div>
    </div>
  );
}

function CustomerProfileDialog({ item, onClose }) {
  const dialogRef = useDialogFocus();
  const customer = item.customer || {};
  const documents = Array.isArray(item.documents) ? item.documents : [];
  const galleryRef = useRef(null);
  const initials = String(customer.name || item.title || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const navigateGallery = (direction) => {
    const gallery = galleryRef.current;
    if (!gallery) return;
    gallery.scrollBy({ left: direction * Math.min(gallery.clientWidth * 0.82, 390), behavior: "smooth" });
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center overflow-y-auto bg-slate-950/55 px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="viewer-title" className="flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Customer profile</p>
            <h3 id="viewer-title" className="mt-1.5 truncate text-xl font-bold text-slate-950">{customer.name || item.title}</h3>
            <p className="mt-1 text-sm text-slate-500">Account details and submitted verification documents.</p>
          </div>
          <button type="button" data-dialog-initial onClick={onClose} aria-label="Close customer profile" className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><X size={19} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <section aria-label="Customer account details" className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-[auto_1fr] sm:p-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white shadow-sm">{initials}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="truncate text-lg font-bold text-slate-950">{customer.name || item.title}</h4>
                {customer.status ? <StatusBadge value={customer.status} /> : null}
              </div>
              <p className="mt-1 text-sm font-medium text-slate-500">{customer.role || "Customer"} account</p>
            </div>
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2 lg:grid-cols-4">
              <ProfileDetail icon={Mail} label="Email address" value={customer.email} />
              <ProfileDetail icon={Phone} label="Phone number" value={customer.phone} />
              <ProfileDetail icon={UserRound} label="Role" value={customer.role} />
              <ProfileDetail icon={CalendarDays} label="Joined" value={customer.created} />
            </div>
          </section>

          <section aria-labelledby="customer-documents-title" className="mt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Verification files</p>
                <h4 id="customer-documents-title" className="mt-1 text-lg font-bold text-slate-950">Submitted documents</h4>
                <p className="mt-1 text-sm text-slate-500">{documents.length ? `${documents.length} document${documents.length === 1 ? "" : "s"} attached to this account.` : "No documents are attached to this account."}</p>
              </div>
              {documents.length > 1 ? (
                <div className="flex shrink-0 gap-2" aria-label="Document gallery navigation">
                  <button type="button" onClick={() => navigateGallery(-1)} aria-label="View previous documents" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><ChevronLeft size={18} /></button>
                  <button type="button" onClick={() => navigateGallery(1)} aria-label="View next documents" className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><ChevronRight size={18} /></button>
                </div>
              ) : null}
            </div>

            {documents.length ? (
              <div ref={galleryRef} tabIndex={0} aria-label="Customer document gallery" className="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">
                {documents.map((document, index) => <CustomerDocumentCard key={document.id || `${document.fileName}-${index}`} document={document} />)}
              </div>
            ) : (
              <div className="mt-4 flex min-h-52 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div>
                  <FileText size={32} className="mx-auto text-slate-400" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">No submitted documents</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">This customer has not uploaded a verification document yet.</p>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="flex shrink-0 justify-end border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Close</button>
        </div>
      </div>
    </div>
  );
}

function ProfileDetail({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon size={15} className="shrink-0 text-blue-600" />{label}</div>
      <p className="mt-2 truncate text-sm font-semibold text-slate-900" title={value || "Not provided"}>{value || "Not provided"}</p>
    </div>
  );
}

function CustomerDocumentCard({ document }) {
  const mimeType = String(document.mimeType || "").toLowerCase();
  const DocumentIcon = mimeType.startsWith("image/") ? FileImage : FileText;

  return (
    <article className="w-[min(78vw,360px)] shrink-0 snap-start overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <PreviewPane item={document} className="h-56 rounded-none border-0 border-b border-slate-200" compact />
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-blue-600"><DocumentIcon size={15} className="shrink-0" />{document.document || "Verification document"}</p>
            <h5 className="mt-2 truncate text-sm font-bold text-slate-950" title={document.fileName}>{document.fileName || "Uploaded document"}</h5>
          </div>
          {document.approval ? <StatusBadge value={document.approval} /> : null}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <p className="truncate text-xs text-slate-500">Submitted {document.submitted || "date unavailable"}</p>
          {document.previewUrl ? <a href={document.previewUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Open full file<ExternalLink size={14} /></a> : null}
        </div>
      </div>
    </article>
  );
}

export function DocumentReviewDialog({ document, onClose, onApprove, onReject, onCompare }) {
  const dialogRef = useDialogFocus(Boolean(document));
  if (!document) return null;
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="review-title" className="flex max-h-[min(720px,calc(100dvh-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-600">Document review</p><h3 id="review-title" title={document.fileName} className="mt-1 truncate text-base font-bold text-slate-950">{document.fileName}</h3><p className="mt-1 text-xs text-slate-500">Review the verification details before making a decision.</p></div>
          <button type="button" data-dialog-initial aria-label="Close review" onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"><X size={19} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <div className="grid items-start gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div><PreviewPane item={document} className="h-56 sm:h-64" compact />
            {document.previewUrl ? <a href={document.previewUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600">Open original document</a> : null}
          </div>
          <dl className="min-w-0 divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 [overflow-wrap:anywhere]">
            {[
              ['Customer', document.customer],
              ['Role', document.role],
              ['Document type', document.document],
              ['Submitted', document.submitted],
              ['Current status', document.approval],
              ['Queue stage', formatQueueStage(document.processingStage)],
              ['Extraction score', document.confidence === null ? 'Not available' : `${document.confidence}%`],
              ['Details matched', document.detailsMatched ? 'Yes' : 'No'],
              ['Tampering flag', document.suspectedTampering ? 'Flagged for review' : 'Not flagged'],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[minmax(0,104px)_minmax(0,1fr)] gap-3 py-2"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="text-sm font-medium text-slate-900">{value}</dd></div>
            ))}
            {document.mismatchFields?.length ? <div className="py-2"><dt className="text-xs font-semibold text-slate-500">Mismatched fields</dt><dd className="mt-1 text-sm font-medium text-rose-700">{document.mismatchFields.join(", ")}</dd></div> : null}
            {document.reason ? <div className="py-2"><dt className="text-xs font-semibold text-slate-500">Screening notes</dt><dd className="mt-1 text-sm leading-5 text-slate-700">{document.reason}</dd></div> : null}
          </dl>
          </div>
          {document.canCompareManually ? <ManualDocumentComparison key={`${document.id}:${document.reviewVersion}`} document={document} onCompare={onCompare} /> : null}
          {document.canApprove === false ? <p className="mt-4 text-sm leading-6 text-amber-800">Document approval is blocked until the required comparison has passed. A mismatch requires corrected registration details or a new upload.</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <button type="button" onClick={onReject} className="h-11 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-100">Reject</button>
          <button type="button" onClick={onApprove} disabled={document.canApprove === false} className="h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600">Approve Document</button>
        </div>
      </div>
    </div>
  );
}

function formatQueueStage(value) {
  return ({ queued: "Queued", processing: "Automated screening", retry_wait: "Waiting to retry", pending_review: "Ready for manual review", verified: "Approved", rejected: "Rejected" })[value] || "Pending review";
}

function useDialogFocus(active = true) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const previouslyFocused = document.activeElement;
    const focusableSelector = '[data-dialog-initial]:not([disabled]), button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusFrame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector(focusableSelector)?.focus();
    });
    const keepFocusInside = (event) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(focusableSelector)].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", keepFocusInside);
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [active]);

  return dialogRef;
}

function PreviewPane({ item, className = "", compact = false }) {
  const previewUrl = String(item?.previewUrl || "").trim();
  const [retryCount, setRetryCount] = useState(0);
  const [preview, setPreview] = useState(null);
  const currentPreview = preview?.source === previewUrl && preview?.attempt === retryCount ? preview : null;
  const title = item?.title || item?.fileName || "document";

  useEffect(() => {
    if (!previewUrl) return undefined;
    const controller = new AbortController();
    let active = true;
    let objectUrl = "";
    adminDataApi.getMediaBlob(previewUrl, { signal: controller.signal })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ source: previewUrl, attempt: retryCount, objectUrl, mimeType: blob.type, error: "" });
      })
      .catch((error) => {
        if (!active || error.name === "AbortError") return;
        setPreview({ source: previewUrl, attempt: retryCount, error: error.message || "The file could not be loaded." });
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewUrl, retryCount]);

  if (previewUrl) {
    const handleDisplayError = () => setPreview((current) => ({ ...current, error: "The uploaded file could not be displayed. Open the original file to inspect it." }));
    return (
      <div aria-busy={!currentPreview} className={`overflow-hidden rounded-xl border border-slate-200 bg-slate-50 ${className}`}>
        {!currentPreview ? <div role="status" className="flex h-full min-h-40 items-center justify-center gap-2 p-3 text-sm text-slate-600"><LoaderCircle size={18} className="shrink-0 animate-spin" />Loading uploaded file...</div>
          : currentPreview.error ? <div role="alert" className="flex h-full min-h-40 items-center justify-center p-3 text-center"><div><AlertTriangle size={25} className="mx-auto text-amber-600" /><p className="mt-2 text-sm font-semibold text-slate-800">File preview unavailable</p><p className="mt-1 text-xs leading-5 text-slate-600">{currentPreview.error}</p><div className="mt-2 flex flex-wrap items-center justify-center gap-3"><button type="button" onClick={() => setRetryCount((count) => count + 1)} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Retry preview</button><a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-blue-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Open original file<ExternalLink size={13} /></a></div></div></div>
            : currentPreview.mimeType.startsWith("image/") ? <img src={currentPreview.objectUrl} alt={`Preview of ${title}`} onError={handleDisplayError} className="h-full max-h-[480px] w-full object-contain" />
              : <object data={currentPreview.objectUrl} type="application/pdf" aria-label={`Preview of ${title}`} onError={handleDisplayError} className={`${compact ? "h-full" : "h-[420px]"} w-full bg-white`}><div className="flex h-full items-center justify-center p-4 text-center"><p className="text-sm text-slate-600">Your browser cannot display this PDF. <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100">Open the original file</a> to inspect it.</p></div></object>}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center ${className}`}>
      <div>
        <FileText size={30} className="mx-auto text-slate-400" />
        <p className="mt-3 text-sm font-semibold text-slate-800">No uploaded file reference</p>
        <p className="mt-1 text-xs text-slate-500">This document record does not have an uploaded file reference.</p>
      </div>
    </div>
  );
}
