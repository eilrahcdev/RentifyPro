import React, { useEffect, useState } from "react";
import {
  CarFront,
  ShieldCheck,
  User,
  Lock,
  BellRing,
  BadgeCheck,
  Shield,
  Camera,
} from "lucide-react";
import Navbar from "../components/Navbar";
import HelpLink from "../components/HelpLink";
import ChatWidget from "../components/ChatWidget";
import InfoModal from "../components/InfoModal";
import API from "../utils/api";
import { reconnectSocket } from "../utils/socket";
import VerificationStepper from "../verification/VerificationStepper";
import {
  getStoredUser,
  getUserProfileFromStorage,
  normalizeUserProfile,
  persistUserProfile,
} from "../utils/userProfile";
import {
  fileToBase64,
  stripDataUrlPrefix,
  getMimeFromDataUrl,
  validateSupportingDocumentFile,
} from "../utils/cameraKyc";
import { validateAvatarImageFile } from "../utils/fileValidation";
import { getPreKycSessionToken, preVerifySupportingDocument } from "../utils/kycApi";
import { RELATIONSHIP_OPTIONS } from "../data/registerValidation";
import { BIR_SUPPORTING_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../data/kycDocumentTypes";

const PSGC_BASE_URL = "https://psgc.gitlab.io/api";
const BIR_SUPPORTING_TYPES = new Set(BIR_SUPPORTING_DOCUMENT_TYPES);
const fetchPsgcOptions = async (path, signal) => {
  const response = await fetch(`${PSGC_BASE_URL}${path}`, { signal });
  if (!response.ok) throw new Error(`PSGC request failed with status ${response.status}.`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
};
const GENDER_OPTIONS = ["Male", "Female", "Prefer not to say"];
const KYC_STATUS_LABELS = {
  not_started: "Not started",
  id_uploaded: "ID uploaded",
  challenge_passed: "Document review pending",
  approved: "Approved",
  rejected: "Rejected",
};
const MIN_RENTER_AGE = 18;
const PHONE_REGEX = /^9[0-9]{9}$/;
const EMERGENCY_CONTACT_NAME_REGEX = /^[A-Za-z]+(?: [A-Za-z]+)*$/;
const normalizePhMobileInput = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("9")) return "";
  return digits.slice(0, 10);
};
const normalizeEmergencyContactNameInput = (value = "") => {
  let nextValue = String(value || "");
  nextValue = nextValue.replace(/[^A-Za-z ]/g, "");
  nextValue = nextValue.replace(/\s+/g, " ");
  if (nextValue.startsWith(" ")) nextValue = nextValue.slice(1);
  return nextValue.slice(0, 50);
};
const DEFAULT_PROFILE = {
  _id: "",
  firstName: "",
  lastName: "",
  name: "",
  initials: "U",
  avatar: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  region: "",
  province: "",
  city: "",
  barangay: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
  role: "user",
  isVerified: false,
};

const parseDateInput = (value) => {
  const clean = String(value || "").trim();
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const getAgeFromDate = (birthDate, today) => {
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  const dayDiff = today.getDate() - birthDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age;
};

const InputField = React.memo(function InputField({
  label,
  type = "text",
  value,
  onChange,
  disabled,
  max,
  maxLength,
  prefixText = "",
}) {
  const isPasswordField = type === "password";
  const sanitizePasswordValue = (rawValue = "") => String(rawValue).replace(/\s/g, "");

  const handleInputChange = (event) => {
    if (!isPasswordField || typeof onChange !== "function") {
      if (typeof onChange === "function") onChange(event);
      return;
    }
    const sanitizedValue = sanitizePasswordValue(event?.target?.value || "");
    onChange({ target: { value: sanitizedValue } });
  };

  const handleInputKeyDown = (event) => {
    if (isPasswordField && event.key === " ") event.preventDefault();
  };

  const handleInputPaste = (event) => {
    if (!isPasswordField || typeof onChange !== "function") return;
    const pastedText = String(event.clipboardData?.getData("text") || "");
    if (!/\s/.test(pastedText)) return;
    event.preventDefault();
    const sanitizedText = sanitizePasswordValue(pastedText);
    const input = event.currentTarget;
    const currentValue = String(input?.value || "");
    const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length;
    const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : currentValue.length;
    const nextValue = currentValue.slice(0, start) + sanitizedText + currentValue.slice(end);
    onChange({ target: { value: nextValue } });
  };

  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <div className="relative">
        {prefixText ? (
          <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm font-medium text-gray-500">
            {prefixText}
          </span>
        ) : null}
        <input
          type={type}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onPaste={handleInputPaste}
          disabled={disabled}
          max={max}
          maxLength={maxLength}
          className={`relative z-0 w-full mt-1 border rounded-lg px-3 py-2 text-sm ${
            disabled ? "bg-gray-100" : "bg-white"
          } ${prefixText ? "pl-14" : ""}`}
        />
      </div>
    </div>
  );
});

const RadioGroupField = React.memo(function RadioGroupField({
  label,
  value,
  onChange,
  disabled,
  options,
  name,
}) {
  return (
    <div className="mt-1">
      <label className="text-xs text-gray-500 block mb-2">{label}</label>
      <div className="flex flex-wrap gap-6 items-center mt-1">
        {options.map((option) => (
          <label
            key={option}
            className={`flex items-center gap-2 text-sm ${
              disabled ? "text-gray-400 cursor-not-allowed" : "text-gray-700"
            }`}
          >
            <input
              type="radio"
              name={name || label}
              value={option}
              checked={value === option}
              disabled={disabled}
              onChange={() => onChange(option)}
              className="accent-[#017FE6] translate-y-[1px]"
            />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
});

const SelectField = React.memo(function SelectField({
  label,
  value,
  onChange,
  disabled,
  options,
  placeholder = "Select",
}) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${
          disabled ? "bg-gray-100" : "bg-white"
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled} hidden={option.hidden}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
});

const buildAddressFromSelections = (profile, lists) => {
  const regionName = lists.regions.find((region) => region.code === profile.region)?.name || "";
  const provinceName =
    lists.provinces.find((province) => province.code === profile.province)?.name || "";
  const cityName = lists.cities.find((city) => city.code === profile.city)?.name || "";
  const barangayName =
    lists.barangays.find((barangay) => barangay.code === profile.barangay)?.name || "";

  return [barangayName, cityName, provinceName, regionName].filter(Boolean).join(", ");
};

const buildProfilePayload = (sectionKey, profile, lists) => {
  const payload = {
    name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim(),
  };

  if (sectionKey === "personal") {
    payload.dateOfBirth = profile.dateOfBirth || "";
    payload.gender = profile.gender || "";
  }

  if (sectionKey === "location") {
    payload.address = profile.address || buildAddressFromSelections(profile, lists);
    payload.region = profile.region || "";
    payload.province = profile.province || "";
    payload.city = profile.city || "";
    payload.barangay = profile.barangay || "";
  }

  if (sectionKey === "contact") {
    payload.phone = profile.phone || "";
  }

  if (sectionKey === "emergency") {
    payload.emergencyContactName = String(profile.emergencyContactName || "").trim();
    payload.emergencyContactPhone = profile.emergencyContactPhone || "";
    payload.emergencyContactRelationship = profile.emergencyContactRelationship || "";
  }

  return payload;
};

const AccountSettings = ({
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToVehicles,
  onNavigateToRegister,
  onNavigateToAbout,
  onNavigateToBookingHistory,
  onNavigateToChat,
  onNavigateToNotifications,
  onNavigateToAccountSettings,
  onNavigateToReports,
  isLoggedIn,
  user,
  onLogout,
}) => {
  const [showAI, setShowAI] = useState(false);
  const [activeTab, setActiveTab] = useState(() =>
    isLoggedIn && user?.role !== "admin" && user?.kycStatus !== "approved"
      ? "Verification"
      : "Profile Settings"
  );
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState(
    getUserProfileFromStorage().avatar || null
  );

  const [profile, setProfile] = useState(() => ({
    ...DEFAULT_PROFILE,
    ...getUserProfileFromStorage(),
  }));
  const [draftProfile, setDraftProfile] = useState(null);
  const [editingSection, setEditingSection] = useState(null);
  const [, setLoadingProfile] = useState(false);
  const [savingSection, setSavingSection] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [showPhotoConfirmation, setShowPhotoConfirmation] = useState(false);
  const [isAddressEdited, setIsAddressEdited] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [notificationSettings, setNotificationSettings] = useState({
    email: true,
    sms: false,
    bookingUpdates: true,
    promotions: false,
  });
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationError, setNotificationError] = useState("");
  const [verificationOtp, setVerificationOtp] = useState("");
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [kycStatus, setKycStatus] = useState("");
  const [kycRemarks, setKycRemarks] = useState("");
  const [kycError, setKycError] = useState("");
  const [kycLoading, setKycLoading] = useState(false);
  const [showKycStepper, setShowKycStepper] = useState(false);
  const [loginActivity, setLoginActivity] = useState([]);
  const [loginActivityLoading, setLoginActivityLoading] = useState(false);
  const [loginActivityError, setLoginActivityError] = useState("");
  const [ownerUpgradeLoading, setOwnerUpgradeLoading] = useState(false);
  const [ownerUpgradeMessage, setOwnerUpgradeMessage] = useState("");
  const [ownerUpgradeError, setOwnerUpgradeError] = useState("");
  const [supportingDocFile, setSupportingDocFile] = useState(null);
  const [supportingDocType, setSupportingDocType] = useState("");
  const [supportingTin, setSupportingTin] = useState("");
  const [supportingBranchCode, setSupportingBranchCode] = useState("");
  const [supportingDocStatus, setSupportingDocStatus] = useState("");
  const [supportingDocLoading, setSupportingDocLoading] = useState(false);
  const [ownerForm, setOwnerForm] = useState({
    ownerType: "",
    businessName: "",
    licenseNumber: "",
    permitNumber: "",
  });

  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [barangaysLoading, setBarangaysLoading] = useState(false);
  const [barangayLoadError, setBarangayLoadError] = useState("");
  const [barangayReloadKey, setBarangayReloadKey] = useState(0);

  const current = draftProfile || profile;
  const activeUserIdentity = String(user?._id || user?.email || "").trim().toLowerCase();
  const isOwner = String(profile.role || user?.role || "").trim().toLowerCase() === "owner";

  useEffect(() => {
    let mounted = true;

    const storedUser = getStoredUser();
    const localSeed = normalizeUserProfile(user || storedUser, user || storedUser);
    setProfile({ ...DEFAULT_PROFILE, ...localSeed });
    setProfilePhoto(localSeed.avatar || null);

    const syncProfile = async () => {
      setLoadingProfile(true);
      try {
        const response = await API.getProfile();
        if (!mounted || !response?.user) return;
        const normalized = persistUserProfile(response.user);
        setProfile({ ...DEFAULT_PROFILE, ...normalized });
        setProfilePhoto(normalized.avatar || null);
        window.dispatchEvent(new Event("user-profile-updated"));
      } catch {
        if (!mounted) return;
        const storedProfile = getUserProfileFromStorage();
        setProfile({ ...DEFAULT_PROFILE, ...storedProfile });
        setProfilePhoto(storedProfile.avatar || null);
      } finally {
        if (mounted) setLoadingProfile(false);
      }
    };

    syncProfile();
    return () => {
      mounted = false;
    };
  }, [activeUserIdentity, user]);

  const syncAvatarAcrossApp = async (avatarValue = "") => {
    const normalizedAvatar = String(avatarValue || "").trim();
    setStatusMessage("");
    setStatusError("");

    const persisted = persistUserProfile({
      ...getStoredUser(),
      ...profile,
      avatar: normalizedAvatar,
    });

    setProfile((prev) => ({ ...prev, ...persisted, avatar: normalizedAvatar }));
    setProfilePhoto(normalizedAvatar || null);
    window.dispatchEvent(new Event("user-profile-updated"));

    try {
      const response = await API.updateProfile({ avatar: normalizedAvatar });
      const synced = persistUserProfile(response?.user || { ...persisted, avatar: normalizedAvatar });
      setProfile((prev) => ({ ...prev, ...synced }));
      setProfilePhoto(synced.avatar || null);
      window.dispatchEvent(new Event("user-profile-updated"));
      if (normalizedAvatar) {
        setShowPhotoConfirmation(true);
      } else {
        setStatusMessage("Profile photo removed.");
      }
    } catch (error) {
      setStatusError(error.message || "Profile photo saved locally. Cloud sync failed.");
    }
  };

  useEffect(() => {
    const controller = new AbortController();

    fetchPsgcOptions("/regions/", controller.signal)
      .then(setRegions)
      .catch((error) => {
        if (error.name !== "AbortError") setRegions([]);
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    setProvinces([]);
    setCities([]);
    setBarangays([]);
    setBarangaysLoading(false);
    setBarangayLoadError("");

    if (!current.region) {
      return;
    }

    const controller = new AbortController();

    const loadProvincesOrCities = async () => {
      try {
        const provinceList = await fetchPsgcOptions(
          `/regions/${current.region}/provinces/`,
          controller.signal
        );

        setProvinces(provinceList);

        if (provinceList.length === 0) {
          const cityList = await fetchPsgcOptions(
            `/regions/${current.region}/cities-municipalities/`,
            controller.signal
          );
          setCities(cityList);
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        setProvinces([]);
        setCities([]);
        setBarangays([]);
      }
    };

    loadProvincesOrCities();
    return () => {
      controller.abort();
    };
  }, [current.region]);

  useEffect(() => {
    if (!current.region || provinces.length === 0 || !current.province) {
      if (!current.province && provinces.length > 0) {
        setCities([]);
        setBarangays([]);
      }
      return;
    }

    setCities([]);
    setBarangays([]);
    setBarangaysLoading(false);
    setBarangayLoadError("");

    const controller = new AbortController();
    fetchPsgcOptions(
      `/provinces/${current.province}/cities-municipalities/`,
      controller.signal
    )
      .then(setCities)
      .catch((error) => {
        if (error.name === "AbortError") return;
        setCities([]);
        setBarangays([]);
      })

    return () => {
      controller.abort();
    };
  }, [current.province, current.region, provinces.length]);

  useEffect(() => {
    if (!current.city) {
      setBarangays([]);
      setBarangaysLoading(false);
      setBarangayLoadError("");
      return;
    }

    if (cities.length === 0) return;

    const controller = new AbortController();
    let active = true;

    const loadBarangays = async () => {
      setBarangays([]);
      setBarangaysLoading(true);
      setBarangayLoadError("");

      try {
        const barangayList = await fetchPsgcOptions(
          `/cities-municipalities/${current.city}/barangays/`,
          controller.signal
        );
        if (!active) return;
        setBarangays(barangayList);
      } catch (error) {
        if (!active || error.name === "AbortError") return;
        setBarangays([]);
        setBarangayLoadError("Could not load barangays. Please try again.");
      } finally {
        if (active) setBarangaysLoading(false);
      }
    };

    loadBarangays();

    return () => {
      active = false;
      controller.abort();
    };
  }, [barangayReloadKey, cities.length, current.city]);

  useEffect(() => {
    if (activeTab === "Notifications Settings") {
      loadNotificationSettings();
    }
    if (activeTab === "Login Activity") {
      loadLoginActivity();
    }
    if (activeTab === "Verification") {
      loadKycStatus();
    }
    if (activeTab === "Become a Vehicle Owner") {
      setOwnerUpgradeMessage("");
      setOwnerUpgradeError("");
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "Become a Vehicle Owner") return;
    setOwnerForm({
      ownerType: profile.ownerType || "",
      businessName: profile.businessName || "",
      licenseNumber: profile.licenseNumber || "",
      permitNumber: profile.permitNumber || "",
    });
  }, [
    activeTab,
    profile.ownerType,
    profile.businessName,
    profile.licenseNumber,
    profile.permitNumber,
  ]);

  useEffect(() => {
    if (supportingDocFile || supportingDocType) {
      setSupportingDocStatus("");
    }
  }, [supportingDocFile, supportingDocType]);

  useEffect(() => {
    if (editingSection !== "location" || isAddressEdited || !draftProfile) return;

    const nextAddress = buildAddressFromSelections(draftProfile, {
      regions,
      provinces,
      cities,
      barangays,
    });

    setDraftProfile((prev) => {
      if (!prev || prev.address === nextAddress) return prev;
      return { ...prev, address: nextAddress };
    });
  }, [barangays, cities, draftProfile, editingSection, isAddressEdited, provinces, regions]);

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
    reader.onloadend = async () => {
      await syncAvatarAcrossApp(reader.result || "");
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    syncAvatarAcrossApp("");
  };

  const submitPasswordChange = async () => {
    setPasswordMessage("");
    setPasswordError("");
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError("Please fill in all password fields.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }

    setPasswordLoading(true);
    try {
      const response = await API.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      reconnectSocket();
      setPasswordMessage(response.message || "Password updated.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error) {
      setPasswordError(error.message || "Failed to change password.");
    } finally {
      setPasswordLoading(false);
    }
  };

  const loadNotificationSettings = async () => {
    setNotificationLoading(true);
    setNotificationError("");
    try {
      const response = await API.getNotificationSettings();
      setNotificationSettings((prev) => ({ ...prev, ...(response.settings || {}) }));
    } catch (error) {
      setNotificationError(error.message || "Failed to load notification settings.");
    } finally {
      setNotificationLoading(false);
    }
  };

  const saveNotificationSettings = async () => {
    setNotificationLoading(true);
    setNotificationMessage("");
    setNotificationError("");
    try {
      const response = await API.updateNotificationSettings(notificationSettings);
      setNotificationSettings((prev) => ({ ...prev, ...(response.settings || notificationSettings) }));
      setNotificationMessage("Notification settings saved.");
    } catch (error) {
      setNotificationError(error.message || "Failed to update notification settings.");
    } finally {
      setNotificationLoading(false);
    }
  };

  const sendVerificationCode = async () => {
    if (!profile.email) return;
    setVerificationLoading(true);
    setVerificationMessage("");
    setVerificationError("");
    try {
      await API.sendOTP(profile.email);
      setVerificationMessage("Verification code sent to your email.");
    } catch (error) {
      setVerificationError(error.message || "Failed to send verification code.");
    } finally {
      setVerificationLoading(false);
    }
  };

  const verifyEmailCode = async () => {
    if (!profile.email || !verificationOtp) {
      setVerificationError("Enter the verification code first.");
      return;
    }
    setVerificationLoading(true);
    setVerificationMessage("");
    setVerificationError("");
    try {
      const response = await API.verifyOTP(profile.email, verificationOtp);
      const updated = persistUserProfile(response.user || { ...profile, isVerified: true });
      setProfile((prev) => ({ ...prev, ...updated, isVerified: true }));
      setVerificationOtp("");
      setVerificationMessage("Email verified successfully.");
      window.dispatchEvent(new Event("user-profile-updated"));
    } catch (error) {
      setVerificationError(error.message || "Verification failed.");
    } finally {
      setVerificationLoading(false);
    }
  };

  const loadKycStatus = async () => {
    setKycLoading(true);
    setKycError("");
    try {
      const response = await API.kycGetStatus();
      const nextStatus = response?.status || "not_started";
      setKycStatus(nextStatus);
      setKycRemarks(response?.remarks || "");

      if (nextStatus === "approved") {
        try {
          const profileResponse = await API.getProfile();
          if (profileResponse?.user) {
            const normalized = persistUserProfile(profileResponse.user);
            setProfile((previous) => ({ ...previous, ...normalized }));
          }
        } catch {
          // Keep the authoritative KYC status visible even if profile refresh fails.
        }
      }
    } catch (error) {
      setKycError(error.message || "Could not refresh verification. Try Refresh Status again.");
    } finally {
      setKycLoading(false);
    }
  };

  const loadLoginActivity = async () => {
    setLoginActivityLoading(true);
    setLoginActivityError("");
    try {
      const response = await API.getLoginActivity({ limit: 10 });
      setLoginActivity(response.activity || []);
    } catch (error) {
      setLoginActivityError(error.message || "Failed to load login activity.");
    } finally {
      setLoginActivityLoading(false);
    }
  };

  const verifySupportingDoc = async () => {
    if (!supportingDocType) {
      setSupportingDocStatus("Please select your supporting document type first.");
      return;
    }
    if (!supportingDocFile) {
      setSupportingDocStatus("Please upload your supporting document first.");
      return;
    }
    if (!profile.email) {
      setSupportingDocStatus("We could not find your email. Please refresh and try again.");
      return;
    }
    if (BIR_SUPPORTING_TYPES.has(supportingDocType)) {
      if (!String(ownerForm.businessName || "").trim()) {
        setSupportingDocStatus("Enter the business name shown on your BIR document.");
        return;
      }
      if (!/^\d{9}$/.test(supportingTin) || !/^\d{3,5}$/.test(supportingBranchCode)) {
        setSupportingDocStatus("Enter the 9-digit TIN and the branch code shown on your BIR document.");
        return;
      }
    }
    setSupportingDocLoading(true);
    setSupportingDocStatus("");
    try {
      await validateSupportingDocumentFile(supportingDocFile);
      const dataUrl = await fileToBase64(supportingDocFile);
      const clean = stripDataUrlPrefix(dataUrl);
      const mime = getMimeFromDataUrl(dataUrl);
      const response = await preVerifySupportingDocument(profile.email, clean, mime, "owner", {
        documentType: supportingDocType,
        userProfile: {
          full_name: profile.name,
          first_name: String(profile.firstName || "").trim(),
          last_name: String(profile.lastName || "").trim(),
          email: profile.email,
          owner_type: ownerForm.ownerType || profile.ownerType,
          business_name: ownerForm.businessName || profile.businessName,
          permit_number: ownerForm.permitNumber || profile.permitNumber,
          tax_identification_number: BIR_SUPPORTING_TYPES.has(supportingDocType) ? supportingTin : "",
          branch_code: BIR_SUPPORTING_TYPES.has(supportingDocType) ? supportingBranchCode : "",
          address: profile.address,
        },
      });
      setSupportingDocStatus(
        response.message ||
          "Supporting document queued for automated screening and Super Admin review."
      );
    } catch (error) {
      setSupportingDocStatus(error.message || "Supporting document verification failed.");
    } finally {
      setSupportingDocLoading(false);
    }
  };

  const handleUpgradeToOwner = async () => {
    setOwnerUpgradeLoading(true);
    setOwnerUpgradeError("");
    setOwnerUpgradeMessage("");
    try {
      const preKycToken = await getPreKycSessionToken(profile.email, "owner");
      const response = await API.upgradeToOwner({
        ownerType: ownerForm.ownerType || "",
        businessName: ownerForm.businessName || "",
        licenseNumber: ownerForm.licenseNumber || "",
        permitNumber: ownerForm.permitNumber || "",
        preKycToken,
      });
      const updated = persistUserProfile(
        response.user || {
          ...profile,
          role: "owner",
          ownerType: ownerForm.ownerType,
          businessName: ownerForm.businessName,
          licenseNumber: ownerForm.licenseNumber,
          permitNumber: ownerForm.permitNumber,
        }
      );
      setProfile((prev) => ({ ...prev, ...updated, role: "owner" }));
      setOwnerUpgradeMessage(response.message || "You are now registered as a vehicle owner.");
      window.dispatchEvent(new Event("user-profile-updated"));
    } catch (error) {
      setOwnerUpgradeError(error.message || "Failed to upgrade to owner.");
    } finally {
      setOwnerUpgradeLoading(false);
    }
  };

  const updateDraftField = (field, value) => {
    setDraftProfile((prev) => ({
      ...(prev || profile),
      [field]: value,
    }));
    setStatusMessage("");
    setStatusError("");
  };

  const openEdit = (sectionKey) => {
    setEditingSection(sectionKey);
    setDraftProfile({ ...profile });
    setIsAddressEdited(Boolean(profile.address));
    setStatusMessage("");
    setStatusError("");
  };

  const saveSection = async (sectionKey) => {
    if (!draftProfile) return;
    if (sectionKey === "contact") {
      const phone = String(draftProfile.phone || "").trim();
      if (!PHONE_REGEX.test(phone)) {
        setStatusError("Please enter a valid 10-digit phone number that starts with 9.");
        setStatusMessage("");
        return;
      }
    }

    if (sectionKey === "personal") {
      const effectiveRole = String(profile.role || user?.role || "user").toLowerCase();
      if (effectiveRole === "user") {
        const parsedDob = parseDateInput(draftProfile.dateOfBirth);
        if (!draftProfile.dateOfBirth) {
          setStatusError("Date of birth is required for renter profiles.");
          setStatusMessage("");
          return;
        }
        if (!parsedDob) {
          setStatusError("Please enter a valid date of birth.");
          setStatusMessage("");
          return;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsedDob > today) {
          setStatusError("Date of birth cannot be in the future.");
          setStatusMessage("");
          return;
        }
        const age = getAgeFromDate(parsedDob, today);
        if (age < MIN_RENTER_AGE) {
          setStatusError("Looks like you're under 18. RentifyPro accounts are for ages 18+.");
          setStatusMessage("");
          return;
        }
      }
    }

    if (sectionKey === "emergency") {
      const emergencyContactName = String(draftProfile.emergencyContactName || "").trim();
      if (!emergencyContactName) {
        setStatusError("Emergency contact name is required.");
        setStatusMessage("");
        return;
      }
      if (!EMERGENCY_CONTACT_NAME_REGEX.test(emergencyContactName)) {
        setStatusError(
          "Emergency contact name can only contain letters and single spaces between names."
        );
        setStatusMessage("");
        return;
      }
      if (emergencyContactName.length > 50) {
        setStatusError("Emergency contact name is too long (max 50 characters).");
        setStatusMessage("");
        return;
      }
    }

    setSavingSection(sectionKey);
    setStatusMessage("");
    setStatusError("");

    const nextProfile = {
      ...draftProfile,
      address:
        sectionKey === "location"
          ? draftProfile.address ||
            buildAddressFromSelections(draftProfile, {
              regions,
              provinces,
              cities,
              barangays,
            })
          : draftProfile.address,
    };

    try {
      const response = await API.updateProfile(
        buildProfilePayload(sectionKey, nextProfile, {
          regions,
          provinces,
          cities,
          barangays,
        })
      );
      const normalized = persistUserProfile(response?.user || nextProfile);
      setProfile((prev) => ({ ...prev, ...normalized }));
      setProfilePhoto(normalized.avatar || profilePhoto);
      setDraftProfile(null);
      setEditingSection(null);
      setIsAddressEdited(false);
      setStatusMessage("Profile updated successfully.");
      window.dispatchEvent(new Event("user-profile-updated"));
    } catch (error) {
      setStatusError(error.message || "Could not update your profile.");
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

  return (
    <div className="rp-renter-page min-h-screen">
      <Navbar
        activePage=""
        isLoggedIn={isLoggedIn}
        user={user}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToVehicles={onNavigateToVehicles}
        onNavigateToBookingHistory={onNavigateToBookingHistory}
        onNavigateToAbout={onNavigateToAbout}
        onNavigateToChat={onNavigateToChat}
        onNavigateToNotifications={onNavigateToNotifications}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onNavigateToReports={onNavigateToReports}
        onLogout={onLogout}
      />

      <div className="min-h-screen bg-transparent pt-24">
        <div className="rp-page-shell mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:flex-row">
          <aside className="w-full lg:w-72 space-y-6 lg:sticky top-24 self-start mt-4">
            <div className="rp-minimal-card space-y-1 p-5">
              {[
                { label: "Profile Settings", icon: User },
                { label: "Change Password", icon: Lock },
                { label: "Notifications Settings", icon: BellRing },
                { label: "Verification", icon: ShieldCheck },
                { label: "Login Activity", icon: Shield },
                { label: "Become a Vehicle Owner", icon: CarFront },
              ].map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => setActiveTab(label)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-lg text-sm font-medium transition ${
                    activeTab === label
                      ? "bg-[#017FE6]/10 text-[#017FE6]"
                      : "hover:bg-gray-100 text-gray-700"
                  }`}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>

          </aside>

          <main className="flex-1 space-y-8 pb-12">
            <div className="rp-page-header mb-6">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Account Settings</h1>
              <p className="text-base text-gray-500 max-w-xl">
                Manage your personal information and account preferences
              </p>
            </div>

            {activeTab === "Profile Settings" && (
              <>
                {statusMessage && (
                  <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">
                    {statusMessage}
                  </div>
                )}
                {statusError && (
                  <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
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
                      <div className="w-24 h-24 rounded-full overflow-hidden bg-[#017FE6] flex items-center justify-center">
                        {profilePhoto ? (
                          <img
                            src={profilePhoto}
                            alt="Profile"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-white text-2xl font-bold">
                            {profile.initials || user?.initials || "U"}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => setShowPhotoMenu((prev) => !prev)}
                        className="absolute bottom-0 right-0 bg-white border rounded-full p-1.5 shadow hover:bg-gray-100"
                      >
                        <Camera size={18} className="text-[#017FE6]" />
                      </button>

                      {showPhotoMenu && (
                        <div className="absolute top-full left-0 z-[70] mt-2 mr-1 w-40 origin-top-right rounded-lg border bg-white shadow-lg">
                          <label className="block px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer">
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

                          {profilePhoto && (
                            <button
                              onClick={() => {
                                handleRemovePhoto();
                                setShowPhotoMenu(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50"
                            >
                              Remove Photo
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                      {profile.name || user?.name || "User"}
                      <BadgeCheck size={18} className="text-[#017FE6]" />
                    </h2>

                    <p className="text-m text-gray-500">{profile.email || user?.email}</p>

                    <span className="text-sm text-[#017FE6] font-medium">
                      {profile.isVerified ? "Verified User" : "Verification Pending"}
                    </span>
                  </div>
                </div>

                {[
              {
                key: "personal",
                title: "Personal Information",
                content: (
                  <>
                    <InputField label="First Name" value={profile.firstName} disabled />
                    <InputField label="Last Name" value={profile.lastName} disabled />
                    <InputField
                      label="Date of Birth"
                      type="date"
                      max={new Date().toISOString().split("T")[0]}
                      value={
                        editingSection === "personal"
                          ? draftProfile?.dateOfBirth ?? profile.dateOfBirth
                          : profile.dateOfBirth
                      }
                      disabled={editingSection !== "personal"}
                      onChange={(event) => updateDraftField("dateOfBirth", event.target.value)}
                    />
                    <RadioGroupField
                      label="Gender"
                      value={
                        editingSection === "personal"
                          ? draftProfile?.gender ?? profile.gender
                          : profile.gender
                      }
                      disabled={editingSection !== "personal"}
                      options={GENDER_OPTIONS}
                      onChange={(value) => updateDraftField("gender", value)}
                      name="gender"
                    />
                  </>
                ),
              },
              {
                key: "contact",
                title: "Contact Information",
                content: (
                  <>
                    <InputField label="Email" value={profile.email} disabled />
                    <InputField
                      label="Phone Number"
                      type="tel"
                      value={
                        editingSection === "contact"
                          ? draftProfile?.phone ?? profile.phone
                          : profile.phone
                      }
                      disabled={editingSection !== "contact"}
                      onChange={(event) =>
                        updateDraftField(
                          "phone",
                          normalizePhMobileInput(event.target.value)
                        )
                      }
                      prefixText="+63"
                    />
                  </>
                ),
              },
              {
                key: "location",
                title: "Location Information",
                content: (
                  <>
                    <InputField
                      label="Full Address"
                      value={
                        editingSection === "location"
                          ? draftProfile?.address ?? profile.address
                          : profile.address
                      }
                      disabled={editingSection !== "location"}
                      onChange={(event) => {
                        setIsAddressEdited(event.target.value.trim() !== "");
                        updateDraftField("address", event.target.value);
                      }}
                    />
                    <SelectField
                      label="Region"
                      value={
                        editingSection === "location"
                          ? draftProfile?.region ?? profile.region
                          : profile.region
                      }
                      disabled={editingSection !== "location"}
                      options={regions.map((region) => ({
                        label: region.name,
                        value: region.code,
                      }))}
                      onChange={(event) => {
                        setIsAddressEdited(false);
                        setDraftProfile((prev) => ({
                          ...(prev || profile),
                          region: event.target.value,
                          province: "",
                          city: "",
                          barangay: "",
                          address: "",
                        }));
                      }}
                    />
                    <SelectField
                      label={provinces.length > 0 ? "Province" : "Province (Not required)"}
                      value={
                        editingSection === "location"
                          ? draftProfile?.province ?? profile.province
                          : profile.province
                      }
                      disabled={editingSection !== "location" || !current.region || provinces.length === 0}
                      options={provinces.map((province) => ({
                        label: province.name,
                        value: province.code,
                      }))}
                      onChange={(event) => {
                        setIsAddressEdited(false);
                        setDraftProfile((prev) => ({
                          ...(prev || profile),
                          province: event.target.value,
                          city: "",
                          barangay: "",
                          address: "",
                        }));
                      }}
                      placeholder={provinces.length > 0 ? "Select" : "Not required"}
                    />
                    <SelectField
                      label="City / Municipality"
                      value={
                        editingSection === "location"
                          ? draftProfile?.city ?? profile.city
                          : profile.city
                      }
                      disabled={
                        editingSection !== "location" ||
                        !current.region ||
                        (provinces.length > 0 && !current.province)
                      }
                      options={cities.map((city) => ({
                        label: city.name,
                        value: city.code,
                      }))}
                      onChange={(event) => {
                        setIsAddressEdited(false);
                        setDraftProfile((prev) => ({
                          ...(prev || profile),
                          city: event.target.value,
                          barangay: "",
                          address: "",
                        }));
                      }}
                    />
                    <SelectField
                      label="Barangay"
                      value={
                        editingSection === "location"
                          ? draftProfile?.barangay ?? profile.barangay
                          : profile.barangay
                      }
                      disabled={
                        editingSection !== "location" ||
                        !current.city ||
                        barangaysLoading
                      }
                      options={barangays.map((barangay) => ({
                        label: barangay.name,
                        value: barangay.code,
                      }))}
                      onChange={(event) => {
                        setIsAddressEdited(false);
                        setDraftProfile((prev) => ({
                          ...(prev || profile),
                          barangay: event.target.value,
                          address: "",
                        }));
                      }}
                      placeholder={
                        !current.city
                          ? "Select a city / municipality first"
                          : barangaysLoading
                            ? "Loading barangays..."
                            : barangayLoadError
                              ? "Barangays unavailable"
                              : "Select barangay"
                      }
                    />
                    {editingSection === "location" && barangayLoadError && current.city && (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <span>{barangayLoadError}</span>
                        <button
                          type="button"
                          onClick={() => setBarangayReloadKey((value) => value + 1)}
                          className="shrink-0 font-semibold text-amber-900 underline underline-offset-2"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </>
                ),
              },
              {
                key: "emergency",
                title: "Emergency Contact Information",
                content: (
                  <>
                    <InputField
                      label="Contact Name"
                      value={
                        editingSection === "emergency"
                          ? draftProfile?.emergencyContactName ?? profile.emergencyContactName
                          : profile.emergencyContactName
                      }
                      disabled={editingSection !== "emergency"}
                      onChange={(event) =>
                        updateDraftField(
                          "emergencyContactName",
                          normalizeEmergencyContactNameInput(event.target.value)
                        )
                      }
                      maxLength={50}
                    />
                    <InputField
                      label="Phone Number"
                      value={
                        editingSection === "emergency"
                          ? draftProfile?.emergencyContactPhone ?? profile.emergencyContactPhone
                          : profile.emergencyContactPhone
                      }
                      disabled={editingSection !== "emergency"}
                      onChange={(event) =>
                        updateDraftField("emergencyContactPhone", normalizePhMobileInput(event.target.value))
                      }
                      prefixText="+63"
                    />
                    <SelectField
                      label="Relationship"
                      value={
                        editingSection === "emergency"
                          ? draftProfile?.emergencyContactRelationship ??
                            profile.emergencyContactRelationship
                          : profile.emergencyContactRelationship
                      }
                      disabled={editingSection !== "emergency"}
                      options={RELATIONSHIP_OPTIONS.map((option) => ({
                        label: option,
                        value: option,
                      })).concat(
                        profile.emergencyContactRelationship === "Other"
                          ? [{ label: "Other", value: "Other", disabled: true, hidden: true }]
                          : []
                      )}
                      onChange={(event) =>
                        updateDraftField("emergencyContactRelationship", event.target.value)
                      }
                    />
                  </>
                ),
              },
            ].map((section) => (
              <div key={section.key} className="rp-settings-card p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">{section.title}</h3>

                  <button
                    onClick={() => toggleEdit(section.key)}
                    disabled={savingSection === section.key}
                    className="text-sm border px-4 py-1 rounded-full hover:bg-gray-100 disabled:opacity-60"
                  >
                    {savingSection === section.key
                      ? "Saving..."
                      : editingSection === section.key
                        ? "Save"
                        : "Edit"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{section.content}</div>
              </div>
            ))}
              </>
            )}

            {activeTab === "Change Password" && (
              <div className="rp-settings-card space-y-4 p-6">
                <div className="space-y-1">
                  <h3 className="font-semibold text-lg">Change Password</h3>
                  <p className="text-sm text-gray-500">
                    Use a strong password with at least 8 characters, mixed case, numbers, and symbols.
                  </p>
                </div>

                {passwordMessage && (
                  <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-sm text-green-700">
                    {passwordMessage}
                  </div>
                )}
                {passwordError && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-700">
                    {passwordError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <InputField
                    label="Current Password"
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) =>
                      setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
                    }
                  />
                  <InputField
                    label="New Password"
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) =>
                      setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))
                    }
                  />
                  <div className="md:col-span-2">
                    <InputField
                      label="Confirm New Password"
                      type="password"
                      value={passwordForm.confirmPassword}
                      onChange={(event) =>
                        setPasswordForm((prev) => ({
                          ...prev,
                          confirmPassword: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <button
                  onClick={submitPasswordChange}
                  disabled={passwordLoading}
                  className="px-5 py-2.5 rounded-lg bg-[#017FE6] text-white text-sm font-semibold hover:bg-[#0165B8] disabled:opacity-60"
                >
                  {passwordLoading ? "Updating..." : "Update Password"}
                </button>
              </div>
            )}

            {activeTab === "Notifications Settings" && (
              <div className="rp-settings-card space-y-4 p-6">
                <div className="space-y-1">
                  <h3 className="font-semibold text-lg">Notification Settings</h3>
                  <p className="text-sm text-gray-500">
                    Choose how you want to hear from RentifyPro.
                  </p>
                </div>

                {notificationLoading && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-700">
                    Loading your notification preferences...
                  </div>
                )}
                {notificationMessage && (
                  <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-sm text-green-700">
                    {notificationMessage}
                  </div>
                )}
                {notificationError && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-700">
                    {notificationError}
                  </div>
                )}

                <div className="space-y-4">
                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#017FE6]"
                      checked={Boolean(notificationSettings.email)}
                      disabled={notificationLoading}
                      onChange={(event) =>
                        setNotificationSettings((prev) => ({
                          ...prev,
                          email: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      <span className="font-medium">Email notifications</span>
                      <span className="block text-xs text-gray-500">
                        Receive important updates in your inbox.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#017FE6]"
                      checked={Boolean(notificationSettings.sms)}
                      disabled={notificationLoading}
                      onChange={(event) =>
                        setNotificationSettings((prev) => ({
                          ...prev,
                          sms: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      <span className="font-medium">SMS alerts</span>
                      <span className="block text-xs text-gray-500">
                        Get time-sensitive updates via text message.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#017FE6]"
                      checked={Boolean(notificationSettings.bookingUpdates)}
                      disabled={notificationLoading}
                      onChange={(event) =>
                        setNotificationSettings((prev) => ({
                          ...prev,
                          bookingUpdates: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      <span className="font-medium">Booking updates</span>
                      <span className="block text-xs text-gray-500">
                        Stay informed about booking confirmations and changes.
                      </span>
                    </span>
                  </label>

                  <label className="flex items-start gap-3 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[#017FE6]"
                      checked={Boolean(notificationSettings.promotions)}
                      disabled={notificationLoading}
                      onChange={(event) =>
                        setNotificationSettings((prev) => ({
                          ...prev,
                          promotions: event.target.checked,
                        }))
                      }
                    />
                    <span>
                      <span className="font-medium">Promotions</span>
                      <span className="block text-xs text-gray-500">
                        Receive deals and product updates.
                      </span>
                    </span>
                  </label>
                </div>

                <button
                  onClick={saveNotificationSettings}
                  disabled={notificationLoading}
                  className="px-5 py-2.5 rounded-lg bg-[#017FE6] text-white text-sm font-semibold hover:bg-[#0165B8] disabled:opacity-60"
                >
                  {notificationLoading ? "Saving..." : "Save Settings"}
                </button>
              </div>
            )}

            {activeTab === "Verification" && (
              <div className="space-y-6">
                <div className="rp-settings-card space-y-4 p-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-lg">Email Verification</h3>
                      <p className="text-sm text-gray-500">
                        Confirm your email address to secure your account.
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold px-3 py-1 rounded-full ${
                        profile.isVerified
                          ? "bg-green-100 text-green-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {profile.isVerified ? "Verified" : "Pending"}
                    </span>
                  </div>

                  {verificationMessage && (
                    <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-sm text-green-700">
                      {verificationMessage}
                    </div>
                  )}
                  {verificationError && (
                    <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-700">
                      {verificationError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InputField label="Email" value={profile.email} disabled />
                    <InputField
                      label="Verification Code"
                      value={verificationOtp}
                      onChange={(event) => setVerificationOtp(event.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={sendVerificationCode}
                      disabled={verificationLoading || !profile.email}
                      className="px-4 py-2 rounded-lg border text-sm font-semibold hover:bg-gray-100 disabled:opacity-60"
                    >
                      {verificationLoading ? "Sending..." : "Send Code"}
                    </button>
                    <button
                      onClick={verifyEmailCode}
                      disabled={verificationLoading || !verificationOtp}
                      className="px-4 py-2 rounded-lg bg-[#017FE6] text-white text-sm font-semibold hover:bg-[#0165B8] disabled:opacity-60"
                    >
                      {verificationLoading ? "Verifying..." : "Verify Email"}
                    </button>
                  </div>
                </div>

                <div className="rp-settings-card space-y-4 p-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-lg">ID & Selfie Verification</h3>
                      <p className="text-sm text-gray-500">
                        Complete your identity verification to unlock rentals and owner access.
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold px-3 py-1 rounded-full ${
                        kycStatus === "approved"
                          ? "bg-green-100 text-green-700"
                          : kycStatus === "rejected"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {KYC_STATUS_LABELS[kycStatus] || "Not started"}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {!['approved', 'challenge_passed'].includes(kycStatus) && (
                      <button
                        type="button"
                        onClick={() => setShowKycStepper((prev) => !prev)}
                        className="px-4 py-2 rounded-lg bg-[#017FE6] text-sm font-semibold text-white hover:bg-[#0165B8]"
                      >
                        {showKycStepper ? "Hide verification" : kycStatus === "rejected" ? "Resubmit verification" : "Verify now"}
                      </button>
                    )}
                    <button
                      onClick={loadKycStatus}
                      disabled={kycLoading}
                      className="px-4 py-2 rounded-lg border text-sm font-semibold hover:bg-gray-100"
                    >
                      {kycLoading ? "Checking..." : "Refresh Status"}
                    </button>
                    <HelpLink guide="verify-identity">Need help verifying?</HelpLink>
                  </div>

                  {kycError && <p role="alert" className="text-sm text-rose-700">{kycError}</p>}
                  {kycRemarks && <p role="status" className="text-sm text-slate-600">{kycRemarks}</p>}
                  {kycStatus === "challenge_passed" && <p className="text-sm text-amber-700">Your selfie passed. Document approval is still pending. Refresh your status after review.</p>}
                  {showKycStepper && (
                    <div className="pt-2">
                      <VerificationStepper onVerificationComplete={loadKycStatus} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "Login Activity" && (
              <div className="rp-settings-card space-y-4 p-6">
                <div className="space-y-1">
                  <h3 className="font-semibold text-lg">Login Activity</h3>
                  <p className="text-sm text-gray-500">
                    Track recent sign-ins to your account.
                  </p>
                </div>

                {loginActivityError && (
                  <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-700">
                    {loginActivityError}
                  </div>
                )}

                {loginActivityLoading ? (
                  null
                ) : loginActivity.length ? (
                  <div className="divide-y">
                    {loginActivity.map((entry) => {
                      const createdAt = entry.createdAt ? new Date(entry.createdAt) : null;
                      const timestamp =
                        createdAt && !Number.isNaN(createdAt.getTime())
                          ? createdAt.toLocaleString()
                          : "Unknown time";
                      return (
                        <div
                          key={entry._id || `${entry.ip || "ip"}-${entry.createdAt || "time"}`}
                          className="py-3"
                        >
                          <p className="text-sm font-medium text-gray-800">{timestamp}</p>
                          <p className="text-xs text-gray-500">
                            IP: {entry.ip || "Unknown"} -{" "}
                            {entry.userAgent || "Unknown device"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No login activity recorded yet.</p>
                )}
              </div>
            )}

            {activeTab === "Become a Vehicle Owner" && (
              isOwner ? (
                <div className="rp-settings-card space-y-2 p-6">
                  <h3 className="font-semibold text-lg">You are already a Vehicle Owner</h3>
                  <p className="text-sm text-gray-500">
                    Your account is already upgraded. You can list vehicles from your owner dashboard.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="rp-settings-card space-y-4 p-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-lg">Become a Vehicle Owner</h3>
                      <p className="text-sm text-gray-500">
                        Verify your details and list vehicles for rent on RentifyPro.
                      </p>
                    </div>
                    {isOwner && (
                      <span className="text-xs font-semibold px-3 py-1 rounded-full bg-green-100 text-green-700">
                        Owner Account
                      </span>
                    )}
                  </div>

                  {ownerUpgradeMessage && (
                    <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-sm text-green-700">
                      {ownerUpgradeMessage}
                    </div>
                  )}
                  {ownerUpgradeError && (
                    <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-sm text-red-700">
                      {ownerUpgradeError}
                    </div>
                  )}

                  <div className="grid gap-3 text-sm text-gray-600">
                    <div className="flex items-center justify-between bg-gray-50 border rounded-lg px-3 py-2">
                      <span>Email verification</span>
                      <span className={profile.isVerified ? "text-green-600 font-medium" : "text-yellow-600"}>
                        {profile.isVerified ? "Verified" : "Required"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between bg-gray-50 border rounded-lg px-3 py-2">
                      <span>Supporting document</span>
                      <span
                        className={
                          supportingDocStatus.toLowerCase().includes("verified")
                            ? "text-green-600 font-medium"
                            : "text-gray-500"
                        }
                      >
                        {supportingDocStatus || "Not verified yet"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rp-settings-card space-y-4 p-6">
                  <div className="space-y-1">
                    <h4 className="font-semibold text-lg">Supporting Document</h4>
                    <p className="text-sm text-gray-500">
                      Upload a valid Philippine business permit or registration document.
                    </p>
                  </div>

                  <SelectField
                    label="Document Type"
                    value={supportingDocType}
                    onChange={(event) => {
                      setSupportingDocType(event.target.value);
                      setSupportingTin("");
                      setSupportingBranchCode("");
                    }}
                    options={SUPPORTING_DOCUMENT_TYPES.map((entry) => ({ label: entry, value: entry }))}
                    placeholder="Select document type"
                    disabled={supportingDocLoading}
                  />

                  {BIR_SUPPORTING_TYPES.has(supportingDocType) && (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <label className="space-y-1 text-sm font-semibold text-gray-700">
                        <span>Business name on document</span>
                        <input value={ownerForm.businessName} onChange={(event) => setOwnerForm((previous) => ({ ...previous, businessName: event.target.value }))} maxLength={120} className="w-full rounded-xl border border-gray-300 px-3 py-2 font-normal" />
                      </label>
                      <label className="space-y-1 text-sm font-semibold text-gray-700">
                        <span>Taxpayer Identification Number (TIN)</span>
                        <input value={supportingTin} onChange={(event) => setSupportingTin(event.target.value.replace(/\D/g, "").slice(0, 9))} inputMode="numeric" autoComplete="off" placeholder="9 digits" className="w-full rounded-xl border border-gray-300 px-3 py-2 font-normal" />
                      </label>
                      <label className="space-y-1 text-sm font-semibold text-gray-700">
                        <span>Branch code</span>
                        <input value={supportingBranchCode} onChange={(event) => setSupportingBranchCode(event.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" autoComplete="off" placeholder="As shown" className="w-full rounded-xl border border-gray-300 px-3 py-2 font-normal" />
                      </label>
                    </div>
                  )}

                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={async (event) => {
                      const file = event.target.files?.[0] || null;
                      if (!file) return setSupportingDocFile(null);
                      try {
                        await validateSupportingDocumentFile(file);
                        setSupportingDocFile(file);
                        setSupportingDocStatus("");
                      } catch (validationError) {
                        setSupportingDocFile(null);
                        setSupportingDocStatus(validationError.message || "Please choose a valid supporting document.");
                        event.target.value = "";
                      }
                    }}
                    className="block w-full text-sm text-gray-600"
                  />

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={verifySupportingDoc}
                      disabled={supportingDocLoading || !supportingDocType || !supportingDocFile}
                      className="px-4 py-2 rounded-lg border text-sm font-semibold hover:bg-gray-100 disabled:opacity-60"
                    >
                      {supportingDocLoading ? "Verifying..." : "Verify Document"}
                    </button>
                  </div>

                  {supportingDocStatus && (
                    <div
                      className={`border rounded-lg px-4 py-3 text-sm ${
                        supportingDocStatus.toLowerCase().includes("verified")
                          ? "bg-green-50 border-green-100 text-green-700"
                          : "bg-yellow-50 border-yellow-100 text-yellow-700"
                      }`}
                    >
                      {supportingDocStatus}
                    </div>
                  )}
                </div>

                <div className="rp-settings-card space-y-4 p-6">
                  <div className="space-y-1">
                    <h4 className="font-semibold text-lg">Owner Details</h4>
                    <p className="text-sm text-gray-500">
                      Provide the details you want to display on your owner profile.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SelectField
                      label="Owner Type"
                      value={ownerForm.ownerType}
                      options={[
                        { label: "Individual", value: "individual" },
                        { label: "Business", value: "business" },
                      ]}
                      onChange={(event) =>
                        setOwnerForm((prev) => ({
                          ...prev,
                          ownerType: event.target.value,
                        }))
                      }
                    />
                    <InputField
                      label="Business Name"
                      value={ownerForm.businessName}
                      onChange={(event) =>
                        setOwnerForm((prev) => ({ ...prev, businessName: event.target.value }))
                      }
                    />
                    <InputField
                      label="Business License No."
                      value={ownerForm.licenseNumber}
                      onChange={(event) =>
                        setOwnerForm((prev) => ({ ...prev, licenseNumber: event.target.value }))
                      }
                    />
                    <InputField
                      label="Business Permit No."
                      value={ownerForm.permitNumber}
                      onChange={(event) =>
                        setOwnerForm((prev) => ({ ...prev, permitNumber: event.target.value }))
                      }
                    />
                  </div>

                  <button
                    onClick={handleUpgradeToOwner}
                    disabled={ownerUpgradeLoading || isOwner || !profile.isVerified}
                    className="px-5 py-2.5 rounded-lg bg-[#017FE6] text-white text-sm font-semibold hover:bg-[#0165B8] disabled:opacity-60"
                  >
                    {ownerUpgradeLoading ? "Submitting..." : isOwner ? "Already an Owner" : "Upgrade to Owner"}
                  </button>

                  {!profile.isVerified && (
                    <p className="text-xs text-gray-500">
                      Verify your email before upgrading to a vehicle owner account.
                    </p>
                  )}
                  </div>
                </div>
              )
            )}
          </main>
        </div>
      </div>

      {!showAI && (
        <button
          onClick={() => setShowAI(true)}
          aria-label="Open Rentify AI"
          className="fixed bottom-8 right-10 z-[70] flex h-16 w-16 items-center justify-center transition-all duration-300 hover:scale-105 hover:opacity-95"
        >
          <img
            src="/rentify-ai-logo-bubble-optimized.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain drop-shadow-xl"
          />
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white" />
        </button>
      )}

      <ChatWidget
        isOpen={showAI}
        onOpen={() => setShowAI(true)}
        onClose={() => setShowAI(false)}
        onViewAvailableVehicles={onNavigateToVehicles}
      />

      <InfoModal
        isOpen={showPhotoConfirmation}
        title="Profile Photo Updated"
        message="Your new profile photo has been uploaded successfully."
        confirmLabel="Done"
        onClose={() => setShowPhotoConfirmation(false)}
      />
    </div>
  );
};

export default AccountSettings;
