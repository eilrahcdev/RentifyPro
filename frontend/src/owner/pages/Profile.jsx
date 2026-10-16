import ProfileSection from "../../components/ProfileSection";
import { useEffect, useId, useRef, useState } from "react";
import { BadgeCheck, Camera, CheckCircle2, CircleAlert, RefreshCw, ShieldCheck } from "lucide-react";
import API from "../../utils/api";
import { validateAvatarImageFile } from "../../utils/fileValidation";
import VerificationStepper from "../../verification/VerificationStepper";
import AccountVerificationDocuments from "../../components/AccountVerificationDocuments";
import {
  getOwnerProfileFromStorage,
  getStoredUser,
  normalizeOwnerProfile,
  persistOwnerProfile,
} from "../utils/ownerProfile";
import OwnerPageHeader from "../components/OwnerPageHeader";
import useOwnerLocations from "../hooks/useOwnerLocations";
import OwnerAccountControls from "../components/OwnerAccountControls";
import { PHONE_REGEX } from "../../data/registerValidation";

const normalizePhMobileInput = (value = "") => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("63")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
};

const InputField = ({ label, value, onChange, disabled, prefixText = "", error = "", ...inputProps }) => {
  const id = useId();
  return <div className="min-w-0">
    <label htmlFor={id} className="text-xs text-slate-600">{label}</label>
    <div className="relative">
      {prefixText ? (
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-medium text-gray-500">
          {prefixText}
        </span>
      ) : null}
      <input
        {...inputProps}
        id={id}
        value={value || ""}
        onChange={onChange}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`relative z-0 mt-1 min-h-11 w-full rounded-lg border px-3 py-2 text-base sm:text-sm ${
          disabled ? "bg-gray-100" : "bg-white"
        } ${prefixText ? "pl-14" : ""}`}
      />
    </div>
    {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}
  </div>
};

const SelectField = ({ label, value, onChange, options, disabled, placeholder = "Select", error = "" }) => {
  const id = useId();
  return <div className="min-w-0">
    <label htmlFor={id} className="text-xs text-slate-600">{label}</label>
    <select
      id={id}
      value={value || ""}
      onChange={onChange}
      disabled={disabled}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? `${id}-error` : undefined}
      className={`mt-1 min-h-11 w-full rounded-lg border px-3 py-2 text-base sm:text-sm ${
        disabled ? "bg-gray-100" : "bg-white"
      }`}
    >
      <option value="">{placeholder}</option>
      {value && !options.some((option) => option.code === value) && <option value={value}>{value}</option>}
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.name}
        </option>
      ))}
    </select>
    {error && <p id={`${id}-error`} className="mt-1 text-sm text-red-700">{error}</p>}
  </div>
};

const DEFAULT_PROFILE = {
  firstName: "",
  lastName: "",
  name: "",
  email: "",
  avatar: "",
  phone: "",
  address: "",
  region: "",
  province: "",
  city: "",
  barangay: "",
  ownerType: "individual",
  businessName: "",
  permitNumber: "",
  licenseNumber: "",
  kycStatus: "not_started",
};

const KYC_STATUS_DETAILS = {
  not_started: {
    label: "Verification not started",
    tone: "slate",
    idStatus: "Not submitted",
    selfieStatus: "Not started",
    access: "Locked until identity verification is approved.",
  },
  id_uploaded: {
    label: "Continue verification",
    tone: "amber",
    idStatus: "Submitted",
    selfieStatus: "Pending",
    access: "Locked until identity verification is approved.",
  },
  challenge_passed: {
    label: "Document review pending",
    tone: "amber",
    idStatus: "Awaiting approval",
    selfieStatus: "Verified",
    access: "Locked until your government ID is approved.",
  },
  approved: {
    label: "Identity verified",
    tone: "green",
    idStatus: "Approved",
    selfieStatus: "Verified",
    access: "You can add and manage vehicle listings.",
  },
  rejected: {
    label: "Verification needs attention",
    tone: "red",
    idStatus: "Needs resubmission",
    selfieStatus: "Review required",
    access: "Locked until a corrected identity document is approved.",
  },
};

const KYC_TONE_CLASSES = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  red: "border-red-200 bg-red-50 text-red-800",
};

const formatLastChecked = (value) => {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
};

const buildAddressFromSelections = (profile, lists) => {
  const regionName = lists.regions.find((item) => item.code === profile.region)?.name || "";
  const provinceName = lists.provinces.find((item) => item.code === profile.province)?.name || "";
  const cityName = lists.cities.find((item) => item.code === profile.city)?.name || "";
  const barangayName = lists.barangays.find((item) => item.code === profile.barangay)?.name || "";
  return [barangayName, cityName, provinceName, regionName].filter(Boolean).join(", ");
};

const SectionCard = ({ title, summary, sectionKey, editingSection, savingSection, busy, readOnly, onToggle, onCancel, children }) => (
  <ProfileSection title={title} summary={summary} editing={editingSection === sectionKey}
    saving={savingSection === sectionKey} disabled={busy} readOnly={readOnly}
    onCancel={onCancel} onEdit={() => onToggle(sectionKey)}>{children}</ProfileSection>
);

export default function Profile() {
  const [editingSection, setEditingSection] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [savingSection, setSavingSection] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [accountBusy, setAccountBusy] = useState(false);
  const saveInProgress = useRef(false);
  const photoInputRef = useRef(null);
  const photoButtonRef = useRef(null);
  const photoMenuRef = useRef(null);
  const photoMenuId = useId();
  const [profile, setProfile] = useState(() => {
    const stored = getOwnerProfileFromStorage();
    const user = getStoredUser();
    return { ...DEFAULT_PROFILE, ...stored, email: stored.email || user.email || "" };
  });
  const [kycStatus, setKycStatus] = useState(() => String(getStoredUser().kycStatus || "not_started"));
  const [kycRemarks, setKycRemarks] = useState("");
  const [accountVerification, setAccountVerification] = useState(null);
  const kycRequest = useRef(0);
  const [kycInitialStep, setKycInitialStep] = useState(1);
  const [kycError, setKycError] = useState("");
  const [kycLoading, setKycLoading] = useState(false);
  const [kycLastChecked, setKycLastChecked] = useState(null);
  const [showKycStepper, setShowKycStepper] = useState(false);

  const current = drafts[editingSection] || profile;
  const location = drafts.location || profile;
  const locations = useOwnerLocations(location);
  const regions = locations.regions.data;
  const provinces = locations.provinces.data;
  const cities = locations.cities.data;
  const barangays = locations.barangays.data;
  const busy = Boolean(savingSection || avatarSaving || profileLoading || kycLoading || accountBusy);
  const displayName =
    `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.name || "Owner";
  const initials =
    `${profile.firstName?.[0] || ""}${profile.lastName?.[0] || ""}`.toUpperCase() || "O";
  const verification = KYC_STATUS_DETAILS[kycStatus] || KYC_STATUS_DETAILS.not_started;
  const canStartVerification = !accountVerification?.documents?.length && !["approved", "challenge_passed"].includes(kycStatus);

  useEffect(() => {
    let mounted = true;
    const syncFromApi = async () => {
      try {
        const response = await API.getProfile();
        if (!mounted || !response?.user) return;
        const normalized = normalizeOwnerProfile(response.user, response.user);
        const persisted = persistOwnerProfile(normalized);
        setProfile((prev) => ({ ...prev, ...persisted, email: persisted.email || prev.email }));
        setKycStatus(persisted.kycStatus || "not_started");
        window.dispatchEvent(new Event("owner-profile-updated"));
      } catch (error) {
        if (mounted) setStatusError(error.message || "Could not load your current profile. Reload before editing.");
      } finally {
        if (mounted) setProfileLoading(false);
      }

      const requestId = ++kycRequest.current;
      try {
        const response = await API.kycGetStatus();
        if (!mounted || requestId !== kycRequest.current) return;
        if (typeof response?.status !== "string") throw new Error("Verification status was not confirmed. Refresh status to retry.");
        setKycStatus(String(response?.status || "not_started"));
        setKycRemarks(String(response?.remarks || ""));
        setAccountVerification(response?.verification || null);
        setKycLastChecked(new Date());
      } catch (error) {
        if (mounted && requestId === kycRequest.current) setKycError(error.message || "Could not load verification status. Try Refresh status.");
      }
    };
    syncFromApi();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!showPhotoMenu) return undefined;
    photoMenuRef.current?.querySelector("button")?.focus();
    const dismiss = (event) => {
      if (!photoMenuRef.current?.contains(event.target) && !photoButtonRef.current?.contains(event.target)) setShowPhotoMenu(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setShowPhotoMenu(false);
        photoButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", onKeyDown); };
  }, [showPhotoMenu]);

  const updateDraftField = (field, value) => {
    setDrafts((prev) => ({ ...prev, [editingSection]: { ...(prev[editingSection] || profile), [field]: value } }));
    setFieldErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const openEdit = (sectionKey) => {
    if (saveInProgress.current || busy || !["contact", "location"].includes(sectionKey)) return;
    setStatusMessage("");
    setStatusError("");
    setFieldErrors({});
    setDrafts((prev) => ({ ...prev, [sectionKey]: prev[sectionKey] || { ...profile } }));
    setEditingSection(sectionKey);
  };

  const cancelEdit = () => {
    if (saveInProgress.current) return;
    setDrafts((prev) => { const next = { ...prev }; delete next[editingSection]; return next; });
    setFieldErrors({});
    setEditingSection(null);
  };

  const updateLocation = (field, value) => {
    const clear = field === "region" ? { province: "", city: "", barangay: "" }
      : field === "province" ? { city: "", barangay: "" } : field === "city" ? { barangay: "" } : {};
    setDrafts((prev) => ({ ...prev, location: { ...(prev.location || profile), ...clear, [field]: value } }));
    setFieldErrors({});
  };

  const saveSection = async (sectionKey) => {
    if (saveInProgress.current || busy) return;
    const source = drafts[sectionKey] || profile;
    const payload = {};
    const errors = {};
    if (sectionKey === "contact") {
      payload.phone = source.phone || "";
      if (!PHONE_REGEX.test(payload.phone)) errors.phone = "Enter exactly 10 digits starting with 9.";
    }
    if (sectionKey === "location") {
      if (locations.error || locations.loading) {
        setStatusError(locations.error || "Wait for the location options to finish loading.");
        return;
      }
      payload.address = String(source.address || "").trim();
      payload.region = source.region || "";
      payload.province = source.province || "";
      payload.city = source.city || "";
      payload.barangay = source.barangay || "";
      for (const [field, label] of [["address", "Full address"], ["region", "Region"], ["city", "City / municipality"], ["barangay", "Barangay"]]) {
        if (!payload[field]) errors[field] = `${label} is required.`;
      }
      if (provinces.length && !payload.province) errors.province = "Province is required.";
      for (const [field, options] of [["region", regions], ["province", provinces], ["city", cities], ["barangay", barangays]]) {
        if (payload[field] && !options.some((option) => option.code === payload[field])) errors[field] = "Choose an option from the current location list.";
      }
      if (payload.address.length > 255) errors.address = "Full address must use no more than 255 characters.";
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setStatusError("Check the highlighted fields before saving.");
      return;
    }

    setStatusMessage("");
    setStatusError("");
    setSavingSection(sectionKey);
    saveInProgress.current = true;

    try {
      const response = await API.updateProfile(payload);
      if (!response?.user) throw new Error("Your saved profile could not be confirmed. Reload and try again.");
      const normalized = normalizeOwnerProfile(response.user, response.user);
      const persisted = persistOwnerProfile(normalized);
      setProfile((prev) => ({ ...prev, ...persisted, email: persisted.email || prev.email }));
      setEditingSection(null);
      setDrafts((prev) => { const next = { ...prev }; delete next[sectionKey]; return next; });
      setFieldErrors({});
      setStatusMessage("Profile updated successfully.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      setFieldErrors(error.details?.errors || {});
      setStatusError(error.message || "Could not save your changes. Your draft is still available to retry.");
    } finally {
      saveInProgress.current = false;
      setSavingSection("");
    }
  };

  const toggleEdit = async (sectionKey) => {
    if (editingSection === sectionKey) {
      await saveSection(sectionKey);
      return;
    }
    openEdit(sectionKey);
  };

  const savePhoto = async (file = null) => {
    if (saveInProgress.current || busy || editingSection) return;
    saveInProgress.current = true;
    setAvatarSaving(true);
    setStatusMessage("");
    setStatusError("");

    try {
      let avatar = "";
      if (file) {
        validateAvatarImageFile(file);
        avatar = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("The selected profile photo could not be read."));
          reader.readAsDataURL(file);
        });
      }
      const response = await API.updateProfile({ avatar });
      if (!response?.user) throw new Error("Your saved photo could not be confirmed. Reload and try again.");
      const synced = persistOwnerProfile(normalizeOwnerProfile(response.user, response.user));
      setProfile((prev) => ({ ...prev, ...synced }));
      window.dispatchEvent(new Event("owner-profile-updated"));
      setStatusMessage(file ? "Profile photo updated." : "Profile photo removed.");
    } catch (error) {
      setStatusError(error.message || "Could not save the photo. Your previous photo is unchanged.");
    } finally {
      saveInProgress.current = false;
      setAvatarSaving(false);
    }
  };

  const handlePhotoUpload = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void savePhoto(file);
  };

  const refreshKycStatus = async () => {
    if (saveInProgress.current || busy || editingSection) return;
    const requestId = ++kycRequest.current;
    setKycLoading(true);
    setKycError("");
    try {
      const response = await API.kycGetStatus();
      if (requestId !== kycRequest.current) return;
      if (typeof response?.status !== "string") throw new Error("Verification status was not confirmed. Refresh status to retry; saved progress is preserved.");
      const nextStatus = String(response?.status || "not_started");
      setKycStatus(nextStatus);
      setKycRemarks(String(response?.remarks || ""));
      setAccountVerification(response?.verification || null);
      setKycLastChecked(new Date());

      const profileResponse = await API.getProfile();
      if (requestId !== kycRequest.current) return;
      if (profileResponse?.user) {
        const normalized = normalizeOwnerProfile(profileResponse.user, profileResponse.user);
        const persisted = persistOwnerProfile(normalized);
        setProfile((prev) => ({ ...prev, ...persisted, email: persisted.email || prev.email }));
        window.dispatchEvent(new Event("owner-profile-updated"));
      }
    } catch (error) {
      if (requestId === kycRequest.current) setKycError(error.message || "Could not refresh verification status. Please try again.");
    } finally {
      if (requestId === kycRequest.current) setKycLoading(false);
    }
  };

  const sectionProps = { editingSection, savingSection, busy, onToggle: toggleEdit, onCancel: cancelEdit };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 pb-12">
      <OwnerPageHeader
        title="Account Settings"
        description="Manage your personal information and owner profile preferences."
      />

      {statusMessage && (
        <div role="status" className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
          {statusMessage}
        </div>
      )}
      {statusError && (
        <div role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {statusError}
        </div>
      )}

      <div
        className={`rp-settings-card rp-profile-summary relative flex flex-col items-start gap-4 overflow-visible p-6 min-[360px]:flex-row ${
          showPhotoMenu ? "z-[60]" : "z-10"
        }`}
      >
        <div className="relative z-10 shrink-0">
          <div className="relative">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-[#017FE6] text-2xl font-bold text-white">
              {profile.avatar ? (
                <img src={profile.avatar} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <button
              type="button"
              aria-label="Change profile photo"
              ref={photoButtonRef}
              aria-expanded={showPhotoMenu}
              aria-controls={photoMenuId}
              disabled={busy || Boolean(editingSection)}
              onClick={() => setShowPhotoMenu((prev) => !prev)}
              className="rp-profile-photo-action absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center rounded-full border bg-white shadow hover:bg-gray-100 disabled:opacity-60"
            >
              <Camera size={18} className="text-[#017FE6]" />
            </button>

            {showPhotoMenu && (
              <div id={photoMenuId} ref={photoMenuRef} className="absolute left-0 top-full z-[70] mt-2 w-40 origin-top-left rounded-lg border bg-white shadow-lg">
                <button type="button" onClick={() => {
                  setShowPhotoMenu(false);
                  photoButtonRef.current?.focus();
                  photoInputRef.current?.click();
                }} className="min-h-11 w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-gray-100">
                  Upload Photo
                </button>
                {profile.avatar && (
                  <button
                    type="button"
                    onClick={() => {
                      void savePhoto();
                      setShowPhotoMenu(false);
                      photoButtonRef.current?.focus();
                    }}
                    className="min-h-11 w-full px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                  >
                    Remove Photo
                  </button>
                )}
              </div>
            )}
            <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp"
              aria-label="Choose profile photo" onChange={handlePhotoUpload} className="hidden" />
          </div>
        </div>

        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <h2 className="flex items-start gap-2 text-xl font-semibold">
            <span className="min-w-0">{displayName}</span>
            {kycStatus === "approved" && <BadgeCheck size={18} aria-label="Identity approved" className="mt-1 shrink-0 text-[#075eb9]" />}
          </h2>
          <p className="text-slate-600">{profile.email || "No email found"}</p>
          <div className="flex flex-wrap items-center gap-x-3 text-sm font-medium text-slate-700">
            <span>{kycStatus === "approved" ? "Verified Owner" : verification.label}</span>
            <a href="#owner-verification" className="inline-flex min-h-11 items-center font-semibold text-[#075eb9] underline underline-offset-4">View verification</a>
          </div>
          {avatarSaving && <p role="status" className="mt-1 text-sm text-slate-600">Saving profile photo...</p>}
          {profileLoading && <p role="status" className="mt-1 text-sm text-slate-600">Loading current profile...</p>}
        </div>
      </div>

      <SectionCard title="Personal Information" sectionKey="personal" summary={profile.name} {...sectionProps} readOnly>
        <InputField label="First Name" value={profile.firstName} disabled />
        <InputField label="Last Name" value={profile.lastName} disabled />
        <p className="text-sm text-slate-600 md:col-span-2">Your registered name is tied to document verification and cannot be changed here.</p>
      </SectionCard>

      <SectionCard title="Contact Information" sectionKey="contact" summary={profile.email} {...sectionProps}>
        <InputField label="Email" value={profile.email} disabled />
        <InputField label="Phone Number" value={editingSection === "contact" ? current.phone : profile.phone} disabled={editingSection !== "contact" || busy} onChange={(event) => updateDraftField("phone", normalizePhMobileInput(event.target.value))} prefixText="+63" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={14} required error={fieldErrors.phone} />
      </SectionCard>

      <SectionCard title="Location Information" sectionKey="location" summary={profile.address} {...sectionProps}>
        <InputField label="Full Address" value={editingSection === "location" ? current.address : profile.address} disabled={editingSection !== "location" || busy} onChange={(event) => updateDraftField("address", event.target.value)} maxLength={255} autoComplete="street-address" required error={fieldErrors.address} />
        <SelectField label="Region" value={editingSection === "location" ? current.region : profile.region} disabled={editingSection !== "location" || busy || locations.regions.status !== "ready"} options={regions} onChange={(event) => updateLocation("region", event.target.value)} error={fieldErrors.region} />
        <SelectField label={locations.provinces.status === "ready" && !provinces.length ? "Province (Not required)" : "Province"} value={editingSection === "location" ? current.province : profile.province} disabled={editingSection !== "location" || busy || locations.provinces.status !== "ready" || !provinces.length} options={provinces} placeholder={locations.provinces.status === "ready" && !provinces.length ? "Not required" : "Select province"} onChange={(event) => updateLocation("province", event.target.value)} error={fieldErrors.province} />
        <SelectField label="City / Municipality" value={editingSection === "location" ? current.city : profile.city} disabled={editingSection !== "location" || busy || locations.cities.status !== "ready"} options={cities} onChange={(event) => updateLocation("city", event.target.value)} error={fieldErrors.city} />
        <SelectField label="Barangay" value={editingSection === "location" ? current.barangay : profile.barangay} disabled={editingSection !== "location" || busy || locations.barangays.status !== "ready"} options={barangays} placeholder="Select barangay" onChange={(event) => updateLocation("barangay", event.target.value)} error={fieldErrors.barangay} />
        {editingSection === "location" && <div className="space-y-2 text-sm text-slate-600 md:col-span-2">
          <p>Review your full address after changing the location selections. Selected area: {buildAddressFromSelections(current, { regions, provinces, cities, barangays }) || "Choose your location."}</p>
          {locations.loading && <p role="status">Loading location options...</p>}
          {locations.error && <div role="alert"><p>{locations.error}</p><button type="button" onClick={locations.retry} disabled={busy} className="rp-btn-secondary mt-2 min-h-11 px-4">Retry location options</button></div>}
        </div>}
      </SectionCard>

      {profile.ownerType === "business" && (
        <SectionCard title="Business Information" sectionKey="business" summary={profile.businessName} {...sectionProps} readOnly>
          <InputField label="Business Name" value={profile.businessName} disabled />
          <InputField label="Registered Document Number" value={profile.permitNumber} disabled />
          <InputField label="Business License Number" value={profile.licenseNumber} disabled />
          <p className="text-sm text-slate-600 md:col-span-2">Registered business details are tied to the supporting document submitted during registration.</p>
        </SectionCard>
      )}

      <div className="rp-settings-card p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 id="owner-verification" tabIndex={-1} className="font-semibold">Verification Status</h3>
            <p className="mt-1 text-sm text-slate-600">Required ID, selfie, and business document approvals determine listing access.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canStartVerification && (
              <button
                type="button"
                onClick={() => { setKycInitialStep(1); setShowKycStepper((current) => !current); }}
                disabled={busy || Boolean(editingSection)}
                className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#075eb9] px-3 py-2 text-sm font-semibold text-white hover:bg-[#064e99] disabled:opacity-60"
              >
                {showKycStepper ? "Hide verification" : kycStatus === "rejected" ? "Resubmit verification" : "Verify now"}
              </button>
            )}
            <button
              type="button"
              onClick={refreshKycStatus}
              disabled={busy || Boolean(editingSection) || kycLoading}
              className="inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {kycLoading && <RefreshCw size={16} className="animate-spin" aria-hidden="true" />}
              {kycLoading ? "Checking..." : "Refresh status"}
            </button>
          </div>
        </div>

        {!accountVerification && <div className={`mb-4 flex items-start gap-3 rounded-xl border p-4 ${KYC_TONE_CLASSES[verification.tone]}`}>
          {kycStatus === "approved" ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" /> : <CircleAlert size={20} className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">{verification.label}</p>
            <p className="mt-1 text-sm">{verification.access}</p>
          </div>
        </div>}

        {!accountVerification && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Status label="Government ID" status={verification.idStatus} />
          <Status label="Selfie Verification" status={verification.selfieStatus} />
          <Status label="Listing access" status={kycStatus === "approved" ? "Unlocked" : "Locked"} />
        </div>}
        <AccountVerificationDocuments verification={accountVerification} onRefresh={refreshKycStatus} disabled={busy || Boolean(editingSection) || kycLoading} stale={Boolean(kycError)}
          onSelfie={() => { setKycInitialStep(2); setShowKycStepper(true); }} />

        {kycRemarks && <p className="mt-4 text-sm text-slate-600">{kycRemarks}</p>}
        {kycError && <p role="alert" className="mt-4 text-sm text-red-700">{kycError}</p>}
        <p className="mt-4 text-xs text-slate-500">Last checked: {formatLastChecked(kycLastChecked)}</p>
        {showKycStepper && (
          <div className="mt-6 border-t border-slate-200 pt-6">
            <VerificationStepper key={kycInitialStep} initialStep={kycInitialStep} onVerificationComplete={refreshKycStatus} />
          </div>
        )}
      </div>

      <OwnerAccountControls disabled={busy || Boolean(editingSection)} onBusyChange={setAccountBusy} />
    </div>
  );
}

const Status = ({ label, status = "Submitted" }) => {
  const color = ["Approved", "Verified", "Unlocked"].includes(status)
    ? "text-green-700"
    : ["Rejected", "Needs resubmission"].includes(status)
      ? "text-red-700"
      : status === "Locked"
        ? "text-slate-600"
        : "text-amber-800";
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${color}`}>
      <ShieldCheck size={16} aria-hidden="true" />
      <span>{label}</span>
      <span>{status}</span>
    </div>
  );
};
