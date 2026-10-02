import React, { useEffect, useState } from "react";
import { BadgeCheck, Camera, CheckCircle2, CircleAlert, RefreshCw, ShieldCheck } from "lucide-react";
import InfoModal from "../../components/InfoModal";
import API from "../../utils/api";
import { validateAvatarImageFile } from "../../utils/fileValidation";
import VerificationStepper from "../../verification/VerificationStepper";
import {
  getOwnerProfileFromStorage,
  getStoredUser,
  normalizeOwnerProfile,
  persistOwnerProfile,
} from "../utils/ownerProfile";
import OwnerPageHeader from "../components/OwnerPageHeader";

const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

const normalizePhMobileInput = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("9")) return "";
  return digits.slice(0, 10);
};

const InputField = ({ label, value, onChange, disabled, prefixText = "" }) => (
  <div>
    <label className="text-xs text-gray-500">{label}</label>
    <div className="relative">
      {prefixText ? (
        <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-medium text-gray-500">
          {prefixText}
        </span>
      ) : null}
      <input
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`relative z-0 mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
          disabled ? "bg-gray-100" : "bg-white"
        } ${prefixText ? "pl-14" : ""}`}
      />
    </div>
  </div>
);

const SelectField = ({ label, value, onChange, options, disabled, placeholder = "Select" }) => (
  <div>
    <label className="text-xs text-gray-500">{label}</label>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
        disabled ? "bg-gray-100" : "bg-white"
      }`}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.name}
        </option>
      ))}
    </select>
  </div>
);

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

const SectionCard = ({ title, sectionKey, editingSection, savingSection, onToggle, children }) => (
  <div className="rp-settings-card p-6">
    <div className="mb-4 flex items-center justify-between">
      <h3 className="font-semibold">{title}</h3>
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        disabled={savingSection === sectionKey}
        className="rounded-full border px-4 py-1 text-sm hover:bg-gray-100 disabled:opacity-60"
      >
        {savingSection === sectionKey
          ? "Saving..."
          : editingSection === sectionKey
            ? "Save"
            : "Edit"}
      </button>
    </div>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
  </div>
);

export default function Profile() {
  const [editingSection, setEditingSection] = useState(null);
  const [draftProfile, setDraftProfile] = useState(null);
  const [savingSection, setSavingSection] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [showPhotoConfirmation, setShowPhotoConfirmation] = useState(false);
  const [profile, setProfile] = useState(() => {
    const stored = getOwnerProfileFromStorage();
    const user = getStoredUser();
    return { ...DEFAULT_PROFILE, ...stored, email: stored.email || user.email || "" };
  });
  const [kycStatus, setKycStatus] = useState(() => String(getStoredUser().kycStatus || "not_started"));
  const [kycRemarks, setKycRemarks] = useState("");
  const [kycError, setKycError] = useState("");
  const [kycLoading, setKycLoading] = useState(false);
  const [kycLastChecked, setKycLastChecked] = useState(null);
  const [showKycStepper, setShowKycStepper] = useState(false);

  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);

  const current = draftProfile || profile;
  const displayName =
    `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.name || "Owner";
  const initials =
    `${profile.firstName?.[0] || ""}${profile.lastName?.[0] || ""}`.toUpperCase() || "O";
  const verification = KYC_STATUS_DETAILS[kycStatus] || KYC_STATUS_DETAILS.not_started;
  const canStartVerification = !["approved", "challenge_passed"].includes(kycStatus);

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
      } catch {
        // Keep local profile data if the API sync fails.
      }

      try {
        const response = await API.kycGetStatus();
        if (!mounted) return;
        setKycStatus(String(response?.status || "not_started"));
        setKycRemarks(String(response?.remarks || ""));
        setKycLastChecked(new Date());
      } catch {
        // The saved account status remains visible if the detailed KYC check is unavailable.
      }
    };
    syncFromApi();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    fetch(`${PSGC_BASE_URL}/regions/`)
      .then((response) => response.json())
      .then((data) => setRegions(Array.isArray(data) ? data : []))
      .catch(() => setRegions([]));
  }, []);

  useEffect(() => {
    if (!current.region) {
      setProvinces([]);
      return;
    }
    fetch(`${PSGC_BASE_URL}/regions/${current.region}/provinces/`)
      .then((response) => response.json())
      .then((data) => setProvinces(Array.isArray(data) ? data : []))
      .catch(() => setProvinces([]));
  }, [current.region]);

  useEffect(() => {
    if (!current.province) {
      setCities([]);
      return;
    }
    fetch(`${PSGC_BASE_URL}/provinces/${current.province}/cities-municipalities/`)
      .then((response) => response.json())
      .then((data) => setCities(Array.isArray(data) ? data : []))
      .catch(() => setCities([]));
  }, [current.province]);

  useEffect(() => {
    if (!current.city) {
      setBarangays([]);
      return;
    }
    fetch(`${PSGC_BASE_URL}/cities-municipalities/${current.city}/barangays/`)
      .then((response) => response.json())
      .then((data) => setBarangays(Array.isArray(data) ? data : []))
      .catch(() => setBarangays([]));
  }, [current.city]);

  const updateDraftField = (field, value) => {
    setDraftProfile((prev) => ({ ...(prev || profile), [field]: value }));
  };

  const openEdit = (sectionKey) => {
    setStatusMessage("");
    setStatusError("");
    setDraftProfile({ ...profile });
    setEditingSection(sectionKey);
  };

  const saveSection = async (sectionKey) => {
    const source = draftProfile || profile;
    const payload = {};

    if (sectionKey === "personal") {
      payload.name = `${source.firstName || ""} ${source.lastName || ""}`.trim();
    }
    if (sectionKey === "contact") payload.phone = source.phone || "";
    if (sectionKey === "location") {
      payload.address =
        source.address ||
        buildAddressFromSelections(source, { regions, provinces, cities, barangays });
      payload.region = source.region || "";
      payload.province = source.province || "";
      payload.city = source.city || "";
      payload.barangay = source.barangay || "";
    }
    if (sectionKey === "business") {
      payload.businessName = source.businessName || "";
      payload.permitNumber = source.permitNumber || "";
      payload.licenseNumber = source.licenseNumber || "";
    }

    setStatusMessage("");
    setStatusError("");
    setSavingSection(sectionKey);

    try {
      const response = await API.updateProfile(payload);
      const normalized = normalizeOwnerProfile(response?.user || { ...source, ...payload }, {
        ...source,
        ...payload,
        email: profile.email,
      });
      const persisted = persistOwnerProfile(normalized);
      setProfile((prev) => ({ ...prev, ...persisted, email: persisted.email || prev.email }));
      setEditingSection(null);
      setDraftProfile(null);
      setStatusMessage("Profile updated successfully.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      const fallbackProfile = persistOwnerProfile({
        ...profile,
        ...source,
        ...payload,
        name: payload.name || source.name || profile.name,
      });
      setProfile((prev) => ({ ...prev, ...fallbackProfile }));
      setEditingSection(null);
      setDraftProfile(null);
      setStatusError(error.message || "Could not update profile on server. Saved locally instead.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } finally {
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

  const syncAvatarAcrossApp = async (avatarValue = "") => {
    const normalizedAvatar = String(avatarValue || "").trim();
    setStatusMessage("");
    setStatusError("");

    const localProfile = persistOwnerProfile({ ...profile, avatar: normalizedAvatar });
    setProfile((prev) => ({ ...prev, ...localProfile, avatar: normalizedAvatar }));
    window.dispatchEvent(new Event("owner-profile-updated"));

    try {
      const response = await API.updateProfile({ avatar: normalizedAvatar });
      const synced = persistOwnerProfile(response?.user || { ...localProfile, avatar: normalizedAvatar });
      setProfile((prev) => ({ ...prev, ...synced, avatar: normalizedAvatar }));
      window.dispatchEvent(new Event("owner-profile-updated"));
      if (normalizedAvatar) setShowPhotoConfirmation(true);
      else setStatusMessage("Profile photo removed.");
    } catch (error) {
      setStatusError(error.message || "Profile photo saved locally. Cloud sync failed.");
    }
  };

  const handlePhotoUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      validateAvatarImageFile(file);
    } catch (validationError) {
      setStatusError(validationError.message || "Please choose a valid profile photo.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => syncAvatarAcrossApp(reader.result || "");
    reader.onerror = () => setStatusError("The selected profile photo could not be read.");
    reader.readAsDataURL(file);
  };

  const refreshKycStatus = async () => {
    setKycLoading(true);
    setKycError("");
    try {
      const response = await API.kycGetStatus();
      const nextStatus = String(response?.status || "not_started");
      setKycStatus(nextStatus);
      setKycRemarks(String(response?.remarks || ""));
      setKycLastChecked(new Date());

      const profileResponse = await API.getProfile();
      if (profileResponse?.user) {
        const normalized = normalizeOwnerProfile(profileResponse.user, profileResponse.user);
        const persisted = persistOwnerProfile(normalized);
        setProfile((prev) => ({ ...prev, ...persisted, email: persisted.email || prev.email }));
        window.dispatchEvent(new Event("owner-profile-updated"));
      }
    } catch (error) {
      setKycError(error.message || "Could not refresh verification status. Please try again.");
    } finally {
      setKycLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 pb-12">
      <OwnerPageHeader
        title="Account Settings"
        description="Manage your personal information and owner profile preferences."
      />

      {statusMessage && (
        <div className="rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700">
          {statusMessage}
        </div>
      )}
      {statusError && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {statusError}
        </div>
      )}

      <div
        className={`rp-settings-card relative flex items-center gap-4 overflow-visible p-6 ${
          showPhotoMenu ? "z-[60]" : "z-10"
        }`}
      >
        <div className="relative z-10">
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
              onClick={() => setShowPhotoMenu((prev) => !prev)}
              className="absolute bottom-0 right-0 rounded-full border bg-white p-1.5 shadow hover:bg-gray-100"
            >
              <Camera size={18} className="text-[#017FE6]" />
            </button>

            {showPhotoMenu && (
              <div className="absolute left-0 top-full z-[70] mt-2 w-40 origin-top-left rounded-lg border bg-white shadow-lg">
                <label className="block cursor-pointer px-4 py-2 text-sm hover:bg-gray-100">
                  Upload Photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      handlePhotoUpload(event);
                      setShowPhotoMenu(false);
                    }}
                    className="hidden"
                  />
                </label>
                {profile.avatar && (
                  <button
                    type="button"
                    onClick={() => {
                      syncAvatarAcrossApp("");
                      setShowPhotoMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-red-50"
                  >
                    Remove Photo
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            {displayName}
            <BadgeCheck size={18} className="text-[#017FE6]" />
          </h2>
          <p className="text-gray-500">{profile.email || "No email found"}</p>
          <span className={`text-sm font-medium ${kycStatus === "approved" ? "text-[#017FE6]" : "text-amber-700"}`}>
            {kycStatus === "approved" ? "Verified Owner" : "Owner verification in progress"}
          </span>
        </div>
      </div>

      <SectionCard title="Personal Information" sectionKey="personal" editingSection={editingSection} savingSection={savingSection} onToggle={toggleEdit}>
        <InputField label="First Name" value={editingSection === "personal" ? current.firstName : profile.firstName} disabled={editingSection !== "personal"} onChange={(event) => updateDraftField("firstName", event.target.value)} />
        <InputField label="Last Name" value={editingSection === "personal" ? current.lastName : profile.lastName} disabled={editingSection !== "personal"} onChange={(event) => updateDraftField("lastName", event.target.value)} />
      </SectionCard>

      <SectionCard title="Contact Information" sectionKey="contact" editingSection={editingSection} savingSection={savingSection} onToggle={toggleEdit}>
        <InputField label="Email" value={profile.email} disabled />
        <InputField label="Phone Number" value={editingSection === "contact" ? current.phone : profile.phone} disabled={editingSection !== "contact"} onChange={(event) => updateDraftField("phone", normalizePhMobileInput(event.target.value))} prefixText="+63" />
      </SectionCard>

      <SectionCard title="Location Information" sectionKey="location" editingSection={editingSection} savingSection={savingSection} onToggle={toggleEdit}>
        <InputField label="Full Address" value={editingSection === "location" ? current.address : profile.address} disabled={editingSection !== "location"} onChange={(event) => updateDraftField("address", event.target.value)} />
        <SelectField label="Region" value={editingSection === "location" ? current.region : profile.region} disabled={editingSection !== "location"} options={regions} onChange={(event) => setDraftProfile((prev) => ({ ...(prev || profile), region: event.target.value, province: "", city: "", barangay: "", address: "" }))} />
        <SelectField label={provinces.length ? "Province" : "Province (Not required)"} value={editingSection === "location" ? current.province : profile.province} disabled={editingSection !== "location" || !current.region || !provinces.length} options={provinces} placeholder={provinces.length ? "Select" : "Not required"} onChange={(event) => setDraftProfile((prev) => ({ ...(prev || profile), province: event.target.value, city: "", barangay: "", address: "" }))} />
        <SelectField label="City / Municipality" value={editingSection === "location" ? current.city : profile.city} disabled={editingSection !== "location" || !current.region || (provinces.length > 0 && !current.province)} options={cities} onChange={(event) => setDraftProfile((prev) => ({ ...(prev || profile), city: event.target.value, barangay: "", address: "" }))} />
        <SelectField label="Barangay" value={editingSection === "location" ? current.barangay : profile.barangay} disabled={editingSection !== "location" || !current.city} options={barangays} placeholder={current.city ? "Select barangay" : "Select a city / municipality first"} onChange={(event) => setDraftProfile((prev) => ({ ...(prev || profile), barangay: event.target.value, address: "" }))} />
      </SectionCard>

      {profile.ownerType === "business" && (
        <SectionCard title="Business Information" sectionKey="business" editingSection={editingSection} savingSection={savingSection} onToggle={toggleEdit}>
          <InputField label="Business Name" value={editingSection === "business" ? current.businessName : profile.businessName} disabled={editingSection !== "business"} onChange={(event) => updateDraftField("businessName", event.target.value)} />
          <InputField label="Business Permit Number" value={editingSection === "business" ? current.permitNumber : profile.permitNumber} disabled={editingSection !== "business"} onChange={(event) => updateDraftField("permitNumber", event.target.value)} />
          <InputField label="Business License Number" value={editingSection === "business" ? current.licenseNumber : profile.licenseNumber} disabled={editingSection !== "business"} onChange={(event) => updateDraftField("licenseNumber", event.target.value)} />
        </SectionCard>
      )}

      <div className="rp-settings-card p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold">Verification Status</h3>
            <p className="mt-1 text-sm text-slate-500">Identity approval is required before you can add vehicles.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canStartVerification && (
              <button
                type="button"
                onClick={() => setShowKycStepper((current) => !current)}
                className="inline-flex w-fit items-center gap-2 rounded-lg bg-[#017FE6] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0165B8]"
              >
                <ShieldCheck size={16} />
                {showKycStepper ? "Hide verification" : kycStatus === "rejected" ? "Resubmit verification" : "Verify now"}
              </button>
            )}
            <button
              type="button"
              onClick={refreshKycStatus}
              disabled={kycLoading}
              className="inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={16} className={kycLoading ? "animate-spin" : ""} />
              {kycLoading ? "Checking..." : "Refresh status"}
            </button>
          </div>
        </div>

        <div className={`mb-4 flex items-start gap-3 rounded-xl border p-4 ${KYC_TONE_CLASSES[verification.tone]}`}>
          {kycStatus === "approved" ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" /> : <CircleAlert size={20} className="mt-0.5 shrink-0" />}
          <div>
            <p className="font-semibold">{verification.label}</p>
            <p className="mt-1 text-sm">{verification.access}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Status label="Government ID" status={verification.idStatus} />
          {profile.ownerType === "business" && <Status label="Business Permit" status="Submitted" />}
          <Status label="Selfie Verification" status={verification.selfieStatus} />
          <Status label="Listing access" status={kycStatus === "approved" ? "Unlocked" : "Locked"} />
        </div>

        {kycRemarks && <p className="mt-4 text-sm text-slate-600">{kycRemarks}</p>}
        {kycError && <p role="alert" className="mt-4 text-sm text-red-700">{kycError}</p>}
        <p className="mt-4 text-xs text-slate-500">Last checked: {formatLastChecked(kycLastChecked)}</p>
        {showKycStepper && (
          <div className="mt-6 border-t border-slate-200 pt-6">
            <VerificationStepper onVerificationComplete={refreshKycStatus} />
          </div>
        )}
      </div>

      <InfoModal isOpen={showPhotoConfirmation} title="Profile Photo Updated" message="Your new profile photo has been uploaded successfully." confirmLabel="Done" onClose={() => setShowPhotoConfirmation(false)} />
    </div>
  );
}

const Status = ({ label, status = "Submitted" }) => {
  const color = ["Approved", "Verified", "Unlocked"].includes(status)
    ? "text-green-600"
    : ["Rejected", "Needs resubmission"].includes(status)
      ? "text-red-600"
      : status === "Locked"
        ? "text-slate-600"
        : "text-yellow-600";
  return (
    <div className={`flex items-center gap-2 text-sm ${color}`}>
      <ShieldCheck size={16} />
      <span>{label}</span>
      <span className="text-gray-400">- {status}</span>
    </div>
  );
};
