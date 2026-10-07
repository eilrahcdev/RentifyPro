import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CarFront, Check, ImagePlus, MapPin, Save, Settings2, UploadCloud, UserRoundCheck, Users, Wrench, X } from "lucide-react";
import API from "../../utils/api";
import { isPhilippineLocation } from "../../utils/locationValidation";
import VehicleCover from "../../components/VehicleCover";
import VehicleCard from "../../components/VehicleCard";
import { VehicleGridSkeleton } from "../../components/LoadingSkeletons";
import "./Vehicles.css";
import ModalPortal from "../../components/ModalPortal";
import { showActionToast } from "../../utils/actionToast";
import ConfirmationModal from "../../components/ConfirmationModal";
import { validateVehicleImageFiles } from "../../utils/fileValidation";
import OwnerPageHeader from "../components/OwnerPageHeader";
import HelpLink from "../../components/HelpLink";
import VehiclePhotoReviews from "../../components/VehiclePhotoReviews";
import AutoResizeTextarea from "../../components/AutoResizeTextarea";
import {
  LISTING_LIMITS,
  getPlateNumberLimit,
  normalizeListingText,
  sanitizeDecimalInput,
  sanitizeIntegerInput,
  sanitizeListingInput,
  validateListingFields,
} from "../../utils/vehicleListingValidation";

const createInitialForm = () => ({
  name: "",
  description: "",
  dailyRentalRate: "",
  lateReturnFeeType: "percentage",
  lateReturnFeeValue: "0",
  lateReturnGraceMinutes: "0",
  location: "",
  availabilityStatus: "available",
  specType: "car",
  specSubType: "",
  specSeats: 4,
  specTransmission: "Automatic",
  specFuel: "Gasoline",
  specPlateNumber: "",
  driverOptionEnabled: false,
  driverDailyRate: "",
  existingImages: [],
  existingImagePaths: [],
  newImageFiles: [],
  coverImagePath: "",
  coverUploadIndex: "",
  coverDisplayMode: "auto",
});

const LISTING_TEXT_FIELDS = new Set(["name", "description", "location", "specSubType", "specPlateNumber"]);
const LISTING_DECIMAL_FIELDS = new Set(["dailyRentalRate", "driverDailyRate", "lateReturnFeeValue"]);
const LISTING_INTEGER_FIELDS = new Set(["specSeats", "lateReturnGraceMinutes"]);

const sanitizeVehicleField = (field, value, specType) => {
  if (LISTING_TEXT_FIELDS.has(field)) return sanitizeListingInput(value, field, { specType });
  if (LISTING_DECIMAL_FIELDS.has(field)) return sanitizeDecimalInput(value);
  if (LISTING_INTEGER_FIELDS.has(field)) return sanitizeIntegerInput(value);
  return value;
};

const getVehicleOperationalStatus = (vehicle) => {
  if (vehicle?.availabilityStatus === "available") return "available";
  if (vehicle?.availabilityHoldReason === "inspection") return "inspection";
  return "unavailable";
};

const formatCurrency = (value) => `\u20b1${Number(value || 0).toLocaleString("en-PH")}`;

const formatLateReturnPolicy = (source = {}) => {
  const policy = source.lateReturnPolicy || source;
  const feeType = policy.feeType || source.lateReturnFeeType || "percentage";
  const value = Number(policy.value ?? source.lateReturnFeeValue ?? 0);
  const graceMinutes = Number(policy.graceMinutes ?? source.lateReturnGraceMinutes ?? 0);
  const feeLabel = feeType === "fixed_hourly" ? `${formatCurrency(value)} / overdue hour` : `${value}% of hourly rate`;
  return `${feeLabel} after ${graceMinutes} minute${graceMinutes === 1 ? "" : "s"} grace`;
};

const getFallbackCoverState = ({ existingImagePaths = [], newImageFiles = [] } = {}) => {
  if (existingImagePaths.length) {
    return { coverImagePath: existingImagePaths[0], coverUploadIndex: "" };
  }

  if (newImageFiles.length) {
    return { coverImagePath: "", coverUploadIndex: "0" };
  }

  return { coverImagePath: "", coverUploadIndex: "" };
};

const getVehicleFormErrors = (form) => {
  const errors = validateListingFields(form);
  if (!errors.location && form.location.trim() && !isPhilippineLocation(form.location.trim())) {
    errors.location = "Enter a valid location within the Philippines.";
  }
  if (!form.existingImages.length && !form.newImageFiles.length) {
    errors.images = "Add at least one vehicle photo.";
  }
  return errors;
};

const getVehicleSubmissionError = (error) => {
  return error?.message || "Failed to save vehicle.";
};

const VEHICLE_ERROR_FIELD_ALIASES = Object.freeze({
  approvedImageIds: "images",
  coverImagePath: "images",
  coverUploadIndex: "images",
  imageUrls: "images",
});

const normalizeVehicleFieldErrors = (errors = {}) => Object.fromEntries(
  Object.entries(errors).map(([field, message]) => [VEHICLE_ERROR_FIELD_ALIASES[field] || field, message])
);

const focusVehicleField = (field) => {
  const targetField = VEHICLE_ERROR_FIELD_ALIASES[field] || field;
  window.requestAnimationFrame(() => {
    const target = document.getElementById(`owner-vehicle-${targetField}`);
    if (!target) return;
    const scrollRegion = document.getElementById("owner-vehicle-form-scroll-region");
    if (scrollRegion) {
      const targetRect = target.getBoundingClientRect();
      const scrollRect = scrollRegion.getBoundingClientRect();
      const centeredTop = scrollRegion.scrollTop + targetRect.top - scrollRect.top
        - Math.max(16, (scrollRegion.clientHeight - targetRect.height) / 2);
      scrollRegion.scrollTo({ top: centeredTop, behavior: "smooth" });
    }
    target.focus({ preventScroll: true });
  });
};

function VehicleFormSectionHeader({ step, icon: Icon, title, description }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#017FE6]">
        <Icon size={20} strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#017FE6]">Step {step}</span>
          <span className="h-px w-5 bg-blue-200" aria-hidden="true" />
        </div>
        <h3 className="mt-1 text-base font-bold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function VehicleSelectField({ field, label, value, onChange, onBlur, options, error }) {
  const helpId = `owner-vehicle-${field}-help`;
  return (
    <label htmlFor={`owner-vehicle-${field}`} className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="relative block">
        <select
          id={`owner-vehicle-${field}`}
          aria-invalid={Boolean(error)}
          aria-describedby={helpId}
          className={`h-11 w-full cursor-pointer rounded-xl border bg-white px-3.5 text-sm font-medium text-slate-800 shadow-sm outline-none transition ${error
            ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
            : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          }`}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
      <p id={helpId} aria-live="polite" className={`mt-1 text-xs ${error ? "font-medium text-red-700" : "text-slate-600"}`}>
        {error}
      </p>
    </label>
  );
}

function VehicleModal({
  mode,
  form,
  setForm,
  loading,
  error,
  serverFieldErrors = {},
  onFileError,
  onClearFieldError,
  onClose,
  onSubmit,
}) {
  const [touchedFields, setTouchedFields] = useState({});
  const originalVehicleType = useRef(form.specType).current;
  const newImagePreviews = useMemo(
    () =>
      form.newImageFiles.map((file, index) => ({
        key: `${file.name}-${file.lastModified}`,
        index,
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [form.newImageFiles]
  );

  const coverPreviewUrl = useMemo(() => {
    if (form.coverImagePath) {
      const existingIndex = form.existingImagePaths.indexOf(form.coverImagePath);
      if (existingIndex >= 0) return form.existingImages[existingIndex] || "";
    }

    const uploadIndex = Number.parseInt(String(form.coverUploadIndex), 10);
    if (Number.isFinite(uploadIndex) && uploadIndex >= 0) {
      return newImagePreviews[uploadIndex]?.url || "";
    }

    return form.existingImages[0] || newImagePreviews[0]?.url || "";
  }, [form.coverImagePath, form.coverUploadIndex, form.existingImagePaths, form.existingImages, newImagePreviews]);

  useEffect(() => {
    return () => {
      newImagePreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [newImagePreviews]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !loading) onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onClose]);

  const inputClass = "h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:outline-none";
  const labelClass = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500";
  const clientFieldErrors = getVehicleFormErrors(form);
  const fieldErrors = { ...clientFieldErrors, ...serverFieldErrors };
  const canSubmit = Object.keys(clientFieldErrors).length === 0 && Object.keys(serverFieldErrors).length === 0;
  const visibleFieldError = (field) => serverFieldErrors[field] || (touchedFields[field] ? fieldErrors[field] : "");
  const fieldClass = (field, extra = "") => `${inputClass} ${extra} ${
    visibleFieldError(field)
      ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
      : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
  }`;
  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: sanitizeVehicleField(field, value, prev.specType) }));
    onClearFieldError?.(field);
  };
  const updateChoice = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    onClearFieldError?.(field);
  };
  const markTouched = (field) => setTouchedFields((prev) => ({ ...prev, [field]: true }));
  const listingInputProps = (field) => ({
    id: `owner-vehicle-${field}`,
    maxLength: field === "specPlateNumber" ? getPlateNumberLimit(form.specType) + 1 : LISTING_LIMITS[field],
    "aria-invalid": Boolean(visibleFieldError(field)),
    "aria-describedby": `owner-vehicle-${field}-help`,
    onBlur: () => {
      setTouchedFields((prev) => ({ ...prev, [field]: true }));
      if (LISTING_LIMITS[field]) setForm((prev) => ({ ...prev, [field]: normalizeListingText(prev[field], field === "description") }));
    },
  });
  const fieldHint = (field) => <p id={`owner-vehicle-${field}-help`} aria-live="polite" className={`mt-1 text-xs ${visibleFieldError(field) ? "font-medium text-red-700" : "text-slate-600"}`}>
    {visibleFieldError(field)}
    {field === "description" && <span className="block">{form.description.length}/2,000 characters · minimum 30. Describe condition, features, and renter expectations.</span>}
    {field === "specPlateNumber" && (
      <span className="block">
        {form.specPlateNumber.replace(/[^A-Z0-9]/gi, "").length}/{getPlateNumberLimit(form.specType)} letters or numbers for {form.specType === "motorcycle" ? "motorcycles" : "cars, vans, and trucks"}. A space or hyphen is optional.
      </span>
    )}
  </p>;

  const listingChecks = [
    { label: "Listing details", complete: Boolean(form.name.trim() && form.location.trim() && form.description.trim()) },
    { label: "Rate and plate number", complete: Boolean(Number(form.dailyRentalRate) > 0 && form.specPlateNumber.trim()) },
    { label: "Late-return policy", complete: Boolean(Number(form.lateReturnFeeValue) >= 0 && Number(form.lateReturnGraceMinutes) >= 0) },
    { label: "Vehicle specifications", complete: Boolean(form.specType && form.specSubType.trim() && Number(form.specSeats) > 0) },
    { label: "At least one vehicle photo", complete: Boolean(form.existingImages.length || form.newImageFiles.length) },
  ];
  const completedChecks = listingChecks.filter((item) => item.complete).length;

  return (
    <ModalPortal>
      <div className="rp-modal-layer" role="dialog" aria-modal="true" aria-labelledby="vehicle-modal-title">
        <button type="button" className="rp-modal-backdrop" onClick={loading ? undefined : onClose} aria-label="Close vehicle form" />
        <form
          aria-busy={loading}
          onSubmit={(event) => {
            event.preventDefault();
          setTouchedFields((prev) => ({
            ...prev,
            ...Object.fromEntries(Object.keys(clientFieldErrors).map((field) => [field, true])),
          }));
          onSubmit();
          }}
          className="relative flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.32)] sm:rounded-3xl"
        >
          <fieldset disabled={loading} className="contents">
          <div className="border-b border-slate-200 bg-white px-5 py-4 sm:px-7 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#017FE6] text-white shadow-[0_8px_20px_rgba(1,127,230,0.24)]">
                  <CarFront size={20} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#017FE6]">Vehicle inventory</p>
                  <h2 id="vehicle-modal-title" className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                    {mode === "edit" ? "Edit vehicle listing" : "Create vehicle listing"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Add accurate details and clear photos so renters can book with confidence.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rp-icon-button"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div id="owner-vehicle-form-scroll-region" className="grid flex-1 overflow-y-auto bg-[#f7f9fc] xl:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.75fr)]">
            <div className="min-w-0 space-y-5 p-4 sm:p-6">
            <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.035)] sm:p-5">
              <VehicleFormSectionHeader
                step="01"
                icon={CarFront}
                title="Listing details"
                description="The core information renters will see first."
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="owner-vehicle-name" className={labelClass}>Vehicle Name</label>
                  <input {...listingInputProps("name")}
                    className={fieldClass("name")}
                    placeholder="Ex. Honda Civic RS"
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                  />
                  {fieldHint("name")}
                </div>
                <div>
                  <label htmlFor="owner-vehicle-location" className={labelClass}>Location</label>
                  <input {...listingInputProps("location")}
                    className={fieldClass("location")}
                    placeholder="Ex. Quezon City"
                    value={form.location}
                    onChange={(e) => updateField("location", e.target.value)}
                  />
                  {fieldHint("location")}
                </div>
              </div>

              <div>
                <label htmlFor="owner-vehicle-description" className={labelClass}>Description</label>
                <AutoResizeTextarea {...listingInputProps("description")}
                  className={`${fieldClass("description")} py-2.5`}
                  minRows={2}
                  maxRows={6}
                  placeholder="Describe the vehicle condition, notable features, and renter expectations."
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                />
                  {fieldHint("description")}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="owner-vehicle-dailyRentalRate" className={labelClass}>Hourly Rate</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">₱</span>
                    <input {...listingInputProps("dailyRentalRate")}
                      type="text"
                      inputMode="decimal"
                      className={fieldClass("dailyRentalRate", "pl-8")}
                      placeholder="0"
                      value={form.dailyRentalRate}
                      onChange={(e) => updateField("dailyRentalRate", e.target.value)}
                    />
                  </div>
                  {fieldHint("dailyRentalRate")}
                </div>
                <div>
                  <label id="owner-vehicle-availabilityStatus-label" className={labelClass}>Availability</label>
                  <div
                    id="owner-vehicle-availabilityStatus"
                    role="group"
                    tabIndex={-1}
                    aria-labelledby="owner-vehicle-availabilityStatus-label"
                    aria-invalid={Boolean(visibleFieldError("availabilityStatus"))}
                    aria-describedby="owner-vehicle-availabilityStatus-help"
                    className={`grid h-11 grid-cols-2 rounded-xl border p-1 focus:outline-none focus:ring-4 ${visibleFieldError("availabilityStatus")
                      ? "border-red-300 bg-red-50/80 focus:ring-red-100"
                      : "border-slate-200 bg-slate-100 focus:ring-blue-100"
                    }`}
                  >
                    {["available", "unavailable"].map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => updateChoice("availabilityStatus", status)}
                        className={`rounded-lg text-xs font-semibold capitalize transition ${form.availabilityStatus === status ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                  <p id="owner-vehicle-availabilityStatus-help" aria-live="polite" className={`mt-1 text-xs ${visibleFieldError("availabilityStatus") ? "font-medium text-red-700" : "text-slate-600"}`}>
                    {visibleFieldError("availabilityStatus")}
                  </p>
                </div>
                <div>
                  <label htmlFor="owner-vehicle-specPlateNumber" className={labelClass}>Plate Number</label>
                  <input {...listingInputProps("specPlateNumber")}
                    className={fieldClass("specPlateNumber")}
                    placeholder="Ex. ABC-1234"
                    value={form.specPlateNumber}
                    onChange={(e) => updateField("specPlateNumber", e.target.value)}
                  />
                  {fieldHint("specPlateNumber")}
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <div>
                  <p className="text-sm font-bold text-amber-950">Late-return policy</p>
                  <p className="mt-1 text-xs leading-5 text-amber-800">
                    This policy is disclosed to renters and locked into each new booking. Editing it later affects only future bookings.
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <VehicleSelectField
                    field="lateReturnFeeType"
                    label="Fee type"
                    value={form.lateReturnFeeType}
                    onChange={(event) => updateChoice("lateReturnFeeType", event.target.value)}
                    onBlur={() => markTouched("lateReturnFeeType")}
                    error={visibleFieldError("lateReturnFeeType")}
                    options={[
                      { value: "percentage", label: "Percentage" },
                      { value: "fixed_hourly", label: "Fixed per hour" },
                    ]}
                  />
                  <div>
                    <label htmlFor="owner-vehicle-lateReturnFeeValue" className={labelClass}>
                      {form.lateReturnFeeType === "fixed_hourly" ? "Fee per overdue hour" : "Percentage"}
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">
                        {form.lateReturnFeeType === "fixed_hourly" ? "₱" : "%"}
                      </span>
                      <input {...listingInputProps("lateReturnFeeValue")}
                        type="text"
                        inputMode="decimal"
                        className={fieldClass("lateReturnFeeValue", "pl-8")}
                        value={form.lateReturnFeeValue}
                        onChange={(event) => updateField("lateReturnFeeValue", event.target.value)}
                      />
                    </div>
                    {fieldHint("lateReturnFeeValue")}
                  </div>
                  <div>
                    <label htmlFor="owner-vehicle-lateReturnGraceMinutes" className={labelClass}>Grace period (minutes)</label>
                    <input {...listingInputProps("lateReturnGraceMinutes")}
                      type="text"
                      inputMode="numeric"
                      className={fieldClass("lateReturnGraceMinutes")}
                      value={form.lateReturnGraceMinutes}
                      onChange={(event) => updateField("lateReturnGraceMinutes", event.target.value)}
                    />
                    {fieldHint("lateReturnGraceMinutes")}
                  </div>
                </div>
                <p className="mt-3 text-xs font-medium text-amber-900">
                  Preview: {formatLateReturnPolicy(form)}
                  {form.lateReturnFeeType === "percentage" ? ". A selected driver’s hourly rate is included in the percentage base." : "."}
                </p>
              </div>
            </section>

            <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.035)] sm:p-5">
              <VehicleFormSectionHeader
                step="02"
                icon={Settings2}
                title="Vehicle specifications"
                description="Help renters compare capacity, transmission, and fuel type."
              />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-5">
                    <VehicleSelectField
                      field="specType"
                      label="Type"
                      value={form.specType}
                      onChange={(e) => {
                        updateChoice("specType", e.target.value);
                        setTouchedFields((prev) => ({ ...prev, specPlateNumber: true, specSeats: true }));
                        onClearFieldError?.("specPlateNumber");
                        onClearFieldError?.("specSeats");
                        onClearFieldError?.("images");
                      }}
                      onBlur={() => markTouched("specType")}
                      error={visibleFieldError("specType")}
                      options={[
                        { value: "car", label: "Car" },
                        { value: "motorcycle", label: "Motorcycle" },
                        { value: "van", label: "Van" },
                        { value: "truck", label: "Truck" },
                      ]}
                    />
                <div>
                  <label htmlFor="owner-vehicle-specSubType" className={labelClass}>Sub-type</label>
                  <input {...listingInputProps("specSubType")}
                    className={fieldClass("specSubType")}
                    placeholder="Ex. Sedan"
                    value={form.specSubType}
                    onChange={(e) => updateField("specSubType", e.target.value)}
                  />
                  {fieldHint("specSubType")}
                </div>
                <div>
                  <label htmlFor="owner-vehicle-specSeats" className={labelClass}>Seats</label>
                  <input {...listingInputProps("specSeats")}
                    type="text"
                    inputMode="numeric"
                    className={fieldClass("specSeats")}
                    placeholder="4"
                    value={form.specSeats}
                    onChange={(e) => updateField("specSeats", e.target.value)}
                  />
                  {fieldHint("specSeats")}
                </div>
                    <VehicleSelectField
                      field="specTransmission"
                      label="Transmission"
                      value={form.specTransmission}
                      onChange={(e) => updateChoice("specTransmission", e.target.value)}
                      onBlur={() => markTouched("specTransmission")}
                      error={visibleFieldError("specTransmission")}
                      options={[
                        { value: "Automatic", label: "Automatic" },
                        { value: "Manual", label: "Manual" },
                      ]}
                    />
                    <VehicleSelectField
                      field="specFuel"
                      label="Fuel"
                      value={form.specFuel}
                      onChange={(e) => updateChoice("specFuel", e.target.value)}
                      onBlur={() => markTouched("specFuel")}
                      error={visibleFieldError("specFuel")}
                      options={[
                        { value: "Gasoline", label: "Gasoline" },
                        { value: "Diesel", label: "Diesel" },
                        { value: "Electric", label: "Electric" },
                        { value: "Hybrid", label: "Hybrid" },
                      ]}
                    />
              </div>
            </section>

            <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.035)] sm:p-5">
              <VehicleFormSectionHeader
                step="03"
                icon={UserRoundCheck}
                title="Driver option"
                description="Choose whether this listing supports self-drive or a driver service."
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setTouchedFields((prev) => ({ ...prev, driverDailyRate: true }));
                    setForm((prev) => ({
                      ...prev,
                      driverOptionEnabled: true,
                    }));
                  }}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    form.driverOptionEnabled
                      ? "border-[#017FE6] bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#017FE6]"
                  }`}
                >
                  <p className="text-sm font-semibold">With driver</p>
                  <p className="mt-0.5 text-xs text-slate-500">Driver service enabled for this vehicle.</p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      driverOptionEnabled: false,
                      driverDailyRate: "",
                    }))
                  }
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    !form.driverOptionEnabled
                      ? "border-[#017FE6] bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:border-[#017FE6]"
                  }`}
                >
                  <p className="text-sm font-semibold">Without driver</p>
                  <p className="mt-0.5 text-xs text-slate-500">Self-drive only for this vehicle.</p>
                </button>
              </div>
              {form.driverOptionEnabled && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                  <label htmlFor="owner-vehicle-driverDailyRate" className={labelClass}>Driver hourly rate</label>
                  <div className="flex items-center gap-3">
                    <div className="relative w-full max-w-xs">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">₱</span>
                      <input {...listingInputProps("driverDailyRate")}
                        type="text"
                        inputMode="decimal"
                        className={fieldClass("driverDailyRate", "pl-8")}
                        placeholder="0"
                        value={form.driverDailyRate}
                        onChange={(event) => updateField("driverDailyRate", event.target.value)}
                      />
                    </div>
                    <span className="text-xs text-slate-500">Added to the vehicle rate per hour</span>
                  </div>
                  {fieldHint("driverDailyRate")}
                </div>
              )}
            </section>

            <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.035)] sm:p-5">
              <div className="relative">
                <VehicleFormSectionHeader
                  step="04"
                  icon={ImagePlus}
                  title="Photos and cover"
                  description="Use clear, recent photos that show the vehicle accurately."
                />
                <span className="absolute right-0 top-0 shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">Up to 8</span>
              </div>

              <p className="text-xs text-slate-500">
                Choose one cover image for the renter and owner cards. The rest stay in the gallery.
              </p>

              {mode === "edit" && form.specType !== originalVehicleType && form.existingImages.length > 0 && (
                <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  Existing photos will be checked against the <span className="font-semibold">{form.specType}</span> category when you save. If the category cannot be confirmed automatically, the listing stays unchanged until an administrator approves the photo review.
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="max-w-2xl">
                  <p className="text-sm font-semibold text-slate-800">Cover presentation</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Auto uses a full photo for opaque images and the RentifyPro background for transparent cutouts.
                  </p>

                  <div
                    id="owner-vehicle-coverDisplayMode"
                    className={`mt-3 grid grid-cols-3 gap-2 rounded-xl focus:outline-none focus:ring-4 ${visibleFieldError("coverDisplayMode") ? "ring-2 ring-red-200 focus:ring-red-100" : "focus:ring-blue-100"}`}
                    role="group"
                    tabIndex={-1}
                    aria-label="Cover presentation"
                    aria-invalid={Boolean(visibleFieldError("coverDisplayMode"))}
                    aria-describedby="owner-vehicle-coverDisplayMode-help"
                  >
                    {[
                      { value: "auto", label: "Auto" },
                      { value: "photo", label: "Photo" },
                      { value: "cutout", label: "Cutout" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={form.coverDisplayMode === option.value}
                        onClick={() => updateChoice("coverDisplayMode", option.value)}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                          form.coverDisplayMode === option.value
                            ? visibleFieldError("coverDisplayMode")
                              ? "border-red-400 bg-red-50 text-red-700 ring-2 ring-red-100"
                              : "border-[#017FE6] bg-blue-50 text-blue-700 ring-2 ring-blue-100"
                            : "border-slate-200 bg-white text-slate-600 hover:border-blue-300"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <p id="owner-vehicle-coverDisplayMode-help" aria-live="polite" className={`mt-2 text-xs ${visibleFieldError("coverDisplayMode") ? "font-medium text-red-700" : "text-slate-600"}`}>
                    {visibleFieldError("coverDisplayMode")}
                  </p>

                  <p className="mt-3 text-xs text-slate-500">
                    Use Photo for regular JPGs. Use Cutout only when the image background is transparent.
                  </p>
                </div>
              </div>

              <div
                id="owner-vehicle-images"
                role="group"
                tabIndex={-1}
                aria-invalid={Boolean(visibleFieldError("images"))}
                aria-describedby="owner-vehicle-images-help"
                className={`rounded-xl border border-dashed transition focus:outline-none focus:ring-4 ${visibleFieldError("images")
                  ? "border-red-400 bg-red-50/80 focus:ring-red-100"
                  : "border-slate-300 bg-slate-50 focus:ring-blue-100"
                }`}
              >
                <label className="group flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-blue-50/40">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ${visibleFieldError("images") ? "text-red-600 ring-red-200" : "text-[#017FE6] ring-slate-200"}`}>
                      <UploadCloud size={16} />
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${visibleFieldError("images") ? "text-red-800" : "text-slate-700"}`}>Upload vehicle photos</p>
                      <p className={`text-xs ${visibleFieldError("images") ? "text-red-700" : "text-slate-500"}`}>PNG, JPG, or WEBP format</p>
                    </div>
                  </div>
                  <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                    Choose Files
                  </span>
                  <input
                    id="owner-vehicle-images-input"
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      setTouchedFields((prev) => ({ ...prev, images: true }));
                      onClearFieldError?.("images");
                      const selected = Array.from(e.target.files || []);
                      if (!selected.length) return;
                      const combined = [...form.newImageFiles, ...selected];
                      try {
                        if (form.existingImages.length + combined.length > 8) throw new Error("Choose up to eight photos in total.");
                        validateVehicleImageFiles(combined);
                        onFileError?.("");
                      } catch (validationError) {
                        onFileError?.(validationError.message || "Please choose valid vehicle photos.");
                        e.target.value = "";
                        return;
                      }
                      setForm((prev) => ({
                        ...prev,
                        newImageFiles: combined,
                        ...(prev.coverImagePath || prev.coverUploadIndex !== ""
                          ? {}
                          : getFallbackCoverState({
                              existingImagePaths: prev.existingImagePaths,
                              newImageFiles: combined,
                            })),
                      }));
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <p id="owner-vehicle-images-help" aria-live="assertive" className={`text-xs ${visibleFieldError("images") ? "font-medium text-red-700" : "text-slate-600"}`}>
                {visibleFieldError("images")}
              </p>

              <p className="mt-3 text-sm text-slate-600">Photos are checked when you save. Use clear JPG, PNG, or WEBP images (320 by 200 pixels minimum, 5 MB maximum). Pending photos stay private; the cover must show the vehicle exterior.</p>
              <details className="mt-3">
                <summary className="cursor-pointer py-2 text-sm font-semibold">Your photo reviews</summary>
                <VehiclePhotoReviews vehicleType={form.specType} refreshSignal={form.newImageFiles.map((file) => file.reviewId || "").join(",")} onRefresh={() => onClearFieldError?.("images")} onSelect={(file) => {
                  if (form.existingImages.length + form.newImageFiles.length >= 8) { onFileError("Choose up to eight photos."); return; }
                  if (form.newImageFiles.some((item) => item.reviewId === file.reviewId)) { onFileError("This photo is already selected."); return; }
                  onClearFieldError?.("images");
                  setForm((prev) => {
                    const files = [...prev.newImageFiles, file];
                    return { ...prev, newImageFiles: files, ...(!prev.coverImagePath && prev.coverUploadIndex === "" ? getFallbackCoverState({ existingImagePaths: prev.existingImagePaths, newImageFiles: files }) : {}) };
                  });
                }} />
              </details>
              {form.newImageFiles.length > 0 && (
                <p className="text-xs text-slate-500">
                  {form.newImageFiles.length} new image(s) selected
                </p>
              )}

              {(form.existingImages.length > 0 || newImagePreviews.length > 0) && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {form.existingImages.map((image, index) => (
                    <div key={`existing-${index}`} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {form.coverImagePath === form.existingImagePaths[index] && form.coverUploadIndex === "" && (
                        <span className="absolute left-2 top-2 z-10 rounded-md bg-[#017FE6] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Cover
                        </span>
                      )}
                      <img src={image} alt="vehicle" className="h-24 w-full bg-slate-50 object-contain object-center p-1.5" />
                      <button
                        type="button"
                        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-slate-700 shadow transition hover:bg-red-500 hover:text-white"
                        onClick={() => {
                          markTouched("images");
                          onClearFieldError?.("images");
                          setForm((prev) => {
                            const nextExistingImages = prev.existingImages.filter((_, idx) => idx !== index);
                            const nextExistingImagePaths = prev.existingImagePaths.filter((_, idx) => idx !== index);
                            const removedPath = prev.existingImagePaths[index];
                            const shouldResetCover =
                              prev.coverImagePath === removedPath || (
                                prev.coverImagePath && !nextExistingImagePaths.includes(prev.coverImagePath)
                              );

                            return {
                              ...prev,
                              existingImages: nextExistingImages,
                              existingImagePaths: nextExistingImagePaths,
                              ...(shouldResetCover
                                ? getFallbackCoverState({
                                    existingImagePaths: nextExistingImagePaths,
                                    newImageFiles: prev.newImageFiles,
                                  })
                                : {}),
                            };
                          });
                        }}
                        aria-label="Remove existing image"
                      >
                        <X size={16} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className={`absolute bottom-2 left-2 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                          form.coverImagePath === form.existingImagePaths[index] && form.coverUploadIndex === ""
                            ? "bg-[#017FE6] text-white"
                            : "bg-white/90 text-slate-700 hover:bg-slate-100"
                        }`}
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            coverImagePath: prev.existingImagePaths[index],
                            coverUploadIndex: "",
                          }))
                        }
                      >
                        {form.coverImagePath === form.existingImagePaths[index] && form.coverUploadIndex === ""
                          ? "Selected cover"
                          : "Set as cover"}
                      </button>
                    </div>
                  ))}

                  {newImagePreviews.map((preview, index) => (
                    <div key={preview.key} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {form.coverImagePath === "" && String(form.coverUploadIndex) === String(index) && (
                        <span className="absolute left-2 top-2 z-10 rounded-md bg-[#017FE6] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Cover
                        </span>
                      )}
                      <img src={preview.url} alt={preview.name} className="h-24 w-full bg-slate-50 object-contain object-center p-1.5" />
                      <button
                        type="button"
                        className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-slate-700 shadow transition hover:bg-red-500 hover:text-white"
                        onClick={() => {
                          markTouched("images");
                          onClearFieldError?.("images");
                          setForm((prev) => {
                            const nextNewImageFiles = prev.newImageFiles.filter((_, idx) => idx !== index);
                            const currentCoverUploadIndex = Number.parseInt(String(prev.coverUploadIndex), 10);
                            const isCurrentCover =
                              prev.coverImagePath === "" &&
                              Number.isFinite(currentCoverUploadIndex) &&
                              currentCoverUploadIndex === index;

                            let nextCoverImagePath = prev.coverImagePath;
                            let nextCoverUploadIndex = prev.coverUploadIndex;

                            if (prev.coverImagePath === "" && Number.isFinite(currentCoverUploadIndex)) {
                              if (isCurrentCover) {
                                const fallbackCover = getFallbackCoverState({
                                  existingImagePaths: prev.existingImagePaths,
                                  newImageFiles: nextNewImageFiles,
                                });
                                nextCoverImagePath = fallbackCover.coverImagePath;
                                nextCoverUploadIndex = fallbackCover.coverUploadIndex;
                              } else if (currentCoverUploadIndex > index) {
                                nextCoverUploadIndex = String(currentCoverUploadIndex - 1);
                              }
                            }

                            return {
                              ...prev,
                              newImageFiles: nextNewImageFiles,
                              coverImagePath: nextCoverImagePath,
                              coverUploadIndex: nextCoverUploadIndex,
                            };
                          });
                        }}
                        aria-label="Remove new image"
                      >
                        <X size={16} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className={`absolute bottom-2 left-2 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                          form.coverImagePath === "" && String(form.coverUploadIndex) === String(index)
                            ? "bg-[#017FE6] text-white"
                            : "bg-white/90 text-slate-700 hover:bg-slate-100"
                        }`}
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            coverImagePath: "",
                            coverUploadIndex: String(index),
                          }))
                        }
                      >
                        {form.coverImagePath === "" && String(form.coverUploadIndex) === String(index)
                          ? "Selected cover"
                          : "Set as cover"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

            <aside className="border-t border-slate-200 bg-white p-5 xl:sticky xl:top-0 xl:self-start xl:border-l xl:border-t-0 xl:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#017FE6]">Renter view</p>
                  <h3 className="mt-1 text-base font-bold text-slate-900">Listing preview</h3>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${form.availabilityStatus === "available" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {form.availabilityStatus === "available" ? "Available" : "Unavailable"}
                </span>
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_32px_rgba(15,23,42,0.07)]">
                <div className="p-3 pb-0">
                  {coverPreviewUrl ? (
                    <VehicleCover
                      src={coverPreviewUrl}
                      alt="Selected vehicle cover preview"
                      displayMode={form.coverDisplayMode}
                      className="min-h-40"
                      contentClassName="p-3"
                    />
                  ) : (
                    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center">
                      <ImagePlus size={24} strokeWidth={2} className="text-slate-400" aria-hidden="true" />
                      <p className="mt-2 text-xs font-medium text-slate-500">Your cover photo will appear here</p>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {form.specType || "Vehicle"}{form.specSubType ? ` · ${form.specSubType}` : ""}
                  </p>
                  <h4 className="mt-1 truncate text-lg font-bold text-slate-900">{form.name.trim() || "Vehicle name"}</h4>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin size={16} strokeWidth={2} className="shrink-0 text-[#017FE6]" aria-hidden="true" />
                    <span className="truncate">{form.location.trim() || "Vehicle location"}</span>
                  </p>
                  <div className="mt-4 grid grid-cols-3 divide-x divide-slate-200 border-y border-slate-100 py-3 text-[11px] text-slate-600">
                    <span className="flex items-center gap-1 pr-2"><Users size={16} strokeWidth={2} aria-hidden="true" />{form.specSeats || "-"} seats</span>
                    <span className="truncate px-2 text-center">{form.specTransmission || "-"}</span>
                    <span className="truncate pl-2 text-right">{form.specFuel || "-"}</span>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Hourly rate</p>
                      <p className="mt-0.5 text-xl font-bold text-slate-900">{form.dailyRentalRate ? formatCurrency(form.dailyRentalRate) : "₱0"}<span className="ml-1 text-[11px] font-medium text-slate-400">/ hour</span></p>
                    </div>
                    {form.driverOptionEnabled && <span className="rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">Driver available</span>}
                  </div>
                  <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] font-medium leading-4 text-amber-800">
                    Late returns: {formatLateReturnPolicy(form)}
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-800">Listing readiness</p>
                  <span className="text-xs font-semibold text-slate-500">{completedChecks}/{listingChecks.length}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-[#017FE6] transition-all" style={{ width: `${(completedChecks / listingChecks.length) * 100}%` }} />
                </div>
                <div className="mt-4 space-y-2.5">
                  {listingChecks.map((item) => (
                    <div key={item.label} className="flex items-center gap-2 text-xs">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${item.complete ? "bg-emerald-100 text-emerald-700" : "bg-white text-slate-300 ring-1 ring-slate-200"}`}>
                        <Check size={16} strokeWidth={2} aria-hidden="true" />
                      </span>
                      <span className={item.complete ? "font-medium text-slate-700" : "text-slate-500"}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div className="min-w-0 flex-1" aria-live="polite">
              {error ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {error}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <BadgeCheck size={16} strokeWidth={2} className="shrink-0 text-[#017FE6]" aria-hidden="true" />
                  {canSubmit ? "Ready to save. Changes are reviewed before they appear to renters." : "Fix the highlighted fields to enable saving."}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !canSubmit}
              aria-disabled={loading || !canSubmit}
              title={!loading && !canSubmit ? "Fix the highlighted fields and complete all required details before saving." : undefined}
              className="rounded-xl bg-[#017FE6] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(1,127,230,0.25)] transition hover:bg-[#016fc8] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {loading ? "Checking photos and saving..." : mode === "edit" ? "Save Changes" : "Add Vehicle"}
            </button>
            </div>
          </div>
          </fieldset>
        </form>
      </div>
    </ModalPortal>
  );
}

function Vehicles() {
  const submissionRef = useRef(false);
  const deletionRef = useRef(false);
  const searchRef = useRef(null);
  const [vehicleToDelete, setVehicleToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [modalError, setModalError] = useState("");
  const [modalFieldErrors, setModalFieldErrors] = useState({});
  const [modalLoading, setModalLoading] = useState(false);
  const [editConfirmationOpen, setEditConfirmationOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(createInitialForm());

  const showModalFieldErrors = (errors) => {
    const normalizedErrors = normalizeVehicleFieldErrors(errors);
    setModalError("");
    setModalFieldErrors(normalizedErrors);
    const firstField = Object.keys(normalizedErrors)[0];
    if (firstField) focusVehicleField(firstField);
  };

  const setModalFieldError = (field, message) => {
    setModalError("");
    setModalFieldErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
    if (message) focusVehicleField(field);
  };

  const loadVehicles = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await API.getOwnerVehicles();
      setVehicles(response.vehicles || []);
    } catch (err) {
      setError(err.message || "Failed to load vehicles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVehicles();
  }, []);

  useEffect(() => {
    const openAdd = () => {
      setModalMode("create");
      setEditingId(null);
      setForm(createInitialForm());
      setModalError("");
      setModalFieldErrors({});
      setEditConfirmationOpen(false);
      setModalOpen(true);
    };
    window.addEventListener("open-add-vehicle", openAdd);
    return () => window.removeEventListener("open-add-vehicle", openAdd);
  }, []);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch =
        !query ||
        vehicle.name?.toLowerCase().includes(query) ||
        vehicle.location?.toLowerCase().includes(query) ||
        vehicle.specs?.plateNumber?.toLowerCase().includes(query);

      const matchesStatus = statusFilter === "all" || getVehicleOperationalStatus(vehicle) === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [vehicles, search, statusFilter]);

  const openEditModal = (vehicle) => {
    setModalMode("edit");
    setEditingId(vehicle._id);
    setForm({
      name: vehicle.name || "",
      description: vehicle.description || "",
      dailyRentalRate: String(vehicle.dailyRentalRate ?? ""),
      lateReturnFeeType: vehicle.lateReturnPolicy?.feeType || vehicle.lateReturnFeeType || "percentage",
      lateReturnFeeValue: String(vehicle.lateReturnPolicy?.value ?? vehicle.lateReturnFeeValue ?? 0),
      lateReturnGraceMinutes: String(vehicle.lateReturnPolicy?.graceMinutes ?? vehicle.lateReturnGraceMinutes ?? 0),
      location: vehicle.location || "",
      availabilityStatus: vehicle.availabilityStatus || "available",
      specType: vehicle.specs?.type || "car",
      specSubType: vehicle.specs?.subType || "",
      specSeats: String(vehicle.specs?.seats ?? 4),
      specTransmission: vehicle.specs?.transmission || "Automatic",
      specFuel: vehicle.specs?.fuel || "Gasoline",
      specPlateNumber: vehicle.specs?.plateNumber || "",
      driverOptionEnabled: Boolean(vehicle.driverOptionEnabled),
      driverDailyRate: vehicle.driverOptionEnabled ? String(vehicle.driverDailyRate || "") : "",
      existingImages: vehicle.images || [],
      existingImagePaths: vehicle.imagePaths || vehicle.images || [],
      newImageFiles: [],
      coverImagePath: vehicle.coverImagePath || vehicle.imagePaths?.[0] || "",
      coverUploadIndex: "",
      coverDisplayMode: vehicle.coverDisplayMode || "auto",
    });
    setModalError("");
    setModalFieldErrors({});
    setEditConfirmationOpen(false);
    setModalOpen(true);
  };

  const buildFormData = (approvedImageIds) => {
    const body = new FormData();
    body.append("name", form.name);
    body.append("description", form.description);
    body.append("dailyRentalRate", String(form.dailyRentalRate));
    body.append("lateReturnFeeType", form.lateReturnFeeType);
    body.append("lateReturnFeeValue", String(form.lateReturnFeeValue));
    body.append("lateReturnGraceMinutes", String(form.lateReturnGraceMinutes));
    body.append("location", form.location);
    body.append("availabilityStatus", form.availabilityStatus);
    body.append("specType", form.specType);
    body.append("specSubType", form.specSubType);
    body.append("specSeats", String(form.specSeats));
    body.append("specTransmission", form.specTransmission);
    body.append("specFuel", form.specFuel);
    body.append("specPlateNumber", form.specPlateNumber);
    body.append("driverOptionEnabled", String(form.driverOptionEnabled));
    body.append("driverDailyRate", String(form.driverDailyRate || 0));
    body.append("existingImages", JSON.stringify(form.existingImagePaths || []));
    if (form.coverImagePath) body.append("coverImagePath", form.coverImagePath);
    if (form.coverUploadIndex !== "") body.append("coverUploadIndex", String(form.coverUploadIndex));
    body.append("coverDisplayMode", form.coverDisplayMode || "auto");

    body.append("approvedImageIds", JSON.stringify(approvedImageIds));
    return body;
  };

  const submitModal = async () => {
    if (submissionRef.current) return;
    submissionRef.current = true;
    setModalLoading(true);
    setModalError("");
    setModalFieldErrors({});
    try {
      const validationErrors = getVehicleFormErrors(form);
      if (Object.keys(validationErrors).length) {
        showModalFieldErrors(validationErrors);
        return;
      }
      let reviews;
      try {
        validateVehicleImageFiles(form.newImageFiles);
        const currentReviews = form.newImageFiles.length ? (await API.getVehiclePhotos()).photos || [] : [];
        reviews = [];
        for (const file of form.newImageFiles) {
          let review = file.reviewType === form.specType ? currentReviews.find((photo) => photo.id === file.reviewId) : null;
          if (!review) {
            const upload = new FormData();
            upload.append("vehicleType", form.specType);
            upload.append("image", file);
            review = (await API.uploadVehiclePhoto(upload)).photo;
            file.reviewId = review.id;
            file.reviewType = form.specType;
          }
          reviews.push(review);
        }
      } catch (imageError) {
        showModalFieldErrors({ images: getVehicleSubmissionError(imageError) });
        return;
      }
      const unapproved = reviews.find((photo) => photo.status !== "approved");
      if (unapproved) {
        showModalFieldErrors({ images: `${unapproved.reason} Your listing has not changed. Open Your photo reviews below to check the decision, then refresh the reviews before saving again.` });
        return;
      }
      const approvedImageIds = reviews.map((photo) => photo.id);

      if (modalMode === "create") {
        await API.createOwnerVehicle(buildFormData(approvedImageIds));
      } else {
        await API.updateOwnerVehicle(editingId, buildFormData(approvedImageIds));
      }
      setModalOpen(false);
      setForm(createInitialForm());
      await loadVehicles();
      showActionToast(
        modalMode === "create"
          ? `${form.name.trim()} was added successfully and is now in your vehicle list.`
          : `${form.name.trim()} was updated successfully.`,
        { id: "owner-vehicle-save" }
      );
    } catch (err) {
      const serverErrors = err?.details?.errors;
      if (serverErrors && typeof serverErrors === "object" && Object.keys(serverErrors).length) {
        showModalFieldErrors(serverErrors);
      } else {
        setModalError(getVehicleSubmissionError(err));
      }
    } finally {
      setModalLoading(false);
      submissionRef.current = false;
    }
  };

  const requestModalSubmit = () => {
    if (modalMode === "edit") {
      setEditConfirmationOpen(true);
      return;
    }
    submitModal();
  };

  const confirmVehicleEdit = async () => {
    await submitModal();
    setEditConfirmationOpen(false);
  };

  const updateVehicleStatus = async (vehicle, operationalStatus) => {
    const availabilityStatus = operationalStatus === "available" ? "available" : "unavailable";
    const availabilityHoldReason =
      operationalStatus === "inspection" ? "inspection" : operationalStatus === "unavailable" ? "manual" : "none";
    try {
      setUpdatingStatusId(vehicle._id);
      setError("");
      const response = await API.setOwnerVehicleAvailability(
        vehicle._id,
        availabilityStatus,
        availabilityHoldReason
      );
      if (response?.success === false) throw new Error(response.message || "Failed to update vehicle status.");
      setVehicles((prev) =>
        prev.map((item) =>
          item._id === vehicle._id
            ? response.vehicle || {
                ...item,
                availabilityStatus,
                availabilityHoldReason,
              }
            : item
        )
      );
      const statusMessage = operationalStatus === "available"
        ? "Vehicle marked available."
        : operationalStatus === "inspection"
          ? "Vehicle moved to inspection."
          : "Vehicle marked unavailable.";
      showActionToast(statusMessage, { id: `owner-vehicle-${vehicle._id}` });
    } catch (err) {
      setError(err.message || "Failed to update vehicle status.");
    } finally {
      setUpdatingStatusId("");
    }
  };

  const deleteVehicle = async () => {
    if (!vehicleToDelete || deletionRef.current) return;
    const vehicleId = vehicleToDelete._id;
    deletionRef.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await API.deleteOwnerVehicle(vehicleId);
      if (response?.success === false) throw new Error(response.message || "Failed to delete vehicle.");
      setVehicles((prev) => prev.filter((vehicle) => vehicle._id !== vehicleId));
      setVehicleToDelete(null);
      showActionToast("Vehicle deleted from your listings.", { id: `owner-vehicle-${vehicleId}` });
    } catch (err) {
      setDeleteError(err.message || "Failed to delete vehicle. Please try again.");
    } finally {
      deletionRef.current = false;
      setDeleting(false);
    }
  };

  return (
    <div className="rp-owner-vehicles space-y-6">
      <OwnerPageHeader
        title="Vehicle Management"
        description="Manage vehicle details, images, availability, and driver options."
        actions={<HelpLink guide="list-vehicle" className="whitespace-nowrap">
          <span className="xl:hidden">Need help?</span>
          <span className="hidden xl:inline">Need help listing a vehicle?</span>
        </HelpLink>}
      />

      <div className="bg-white border rounded-xl p-4 flex flex-col md:flex-row gap-3">
        <input
          className="min-w-0 flex-1 rounded-lg border px-3 py-2"
          placeholder="Search by name, location, or plate number"
          ref={searchRef}
          aria-label="Search your vehicles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="relative md:min-w-48">
          <select
            className="h-full w-full cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 outline-none transition hover:border-slate-300 focus:border-[#0B75E7] focus:ring-4 focus:ring-[#0B75E7]/10"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Vehicles</option>
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
            <option value="inspection">Under Inspection</option>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <VehicleGridSkeleton label="Loading your vehicles" className="rp-owner-vehicle-grid" managed />}
      {!loading && filteredVehicles.length === 0 && (
        <div className="bg-white border rounded-xl p-6 text-sm text-gray-600">
          No vehicles found.
        </div>
      )}

      {!loading && <div className="rp-owner-vehicle-grid">
        {filteredVehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle._id}
            vehicle={vehicle}
            compactSpecs
            imageBadge={`${(vehicle.images || []).length} photo(s)`}
            details={<p>Late returns: {formatLateReturnPolicy(vehicle)}</p>}
            management={
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">
                  <Wrench size={16} strokeWidth={2} aria-hidden="true" /> Vehicle status
                </span>
                <select
                  value={getVehicleOperationalStatus(vehicle)}
                  disabled={updatingStatusId === vehicle._id}
                  onChange={(event) => updateVehicleStatus(vehicle, event.target.value)}
                  className="h-10 w-full min-w-0 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100 disabled:cursor-wait disabled:opacity-60"
                  aria-label={`Set status for ${vehicle.name}`}
                >
                  <option value="available">Available</option>
                  <option value="unavailable">Unavailable</option>
                  <option value="inspection">Under Inspection</option>
                </select>
              </label>
            }
            actions={<>
              <button type="button" onClick={() => openEditModal(vehicle)} className="rp-btn-secondary" aria-label={`Edit ${vehicle.name}`}>
                Edit
              </button>
              <button
                type="button"
                onClick={() => { setDeleteError(""); setVehicleToDelete(vehicle); }}
                className="bg-rose-50 text-rose-700 transition hover:bg-rose-100"
                aria-label={`Delete ${vehicle.name}`}
              >
                Delete
              </button>
            </>}
          />
        ))}
      </div>}
      {modalOpen && (
        <VehicleModal
          mode={modalMode}
          form={form}
          setForm={setForm}
          loading={modalLoading}
          error={modalError}
          serverFieldErrors={modalFieldErrors}
          onFileError={(message) => setModalFieldError("images", message)}
          onClearFieldError={(field) => setModalFieldErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev };
            delete next[field];
            return next;
          })}
          onClose={() => {
            setEditConfirmationOpen(false);
            setModalOpen(false);
          }}
          onSubmit={requestModalSubmit}
        />
      )}
      {editConfirmationOpen && (
        <ConfirmationModal
          title="Save vehicle changes?"
          message={`Save the changes to ${form.name.trim()}? Updated details and photos will be checked before they appear to renters.`}
          confirmLabel="Save Changes"
          busyLabel="Saving..."
          icon={Save}
          busy={modalLoading}
          onCancel={() => setEditConfirmationOpen(false)}
          onConfirm={confirmVehicleEdit}
        />
      )}
      {vehicleToDelete && (
        <ConfirmationModal
          title="Delete vehicle?"
          message={`Delete ${vehicleToDelete.name} from your listings? This cannot be undone.`}
          confirmLabel="Delete"
          busy={deleting}
          error={deleteError}
          fallbackFocusRef={searchRef}
          onCancel={() => { if (!deletionRef.current) setVehicleToDelete(null); }}
          onConfirm={deleteVehicle}
        />
      )}
    </div>
  );
}

export default Vehicles;
