import PreKycReviewNotice from "./PreKycReviewNotice";
import { documentStatusLabel as formatDocumentStatus } from "../utils/workflowStatus";
// User registration
// Guided registration: account, personal details, location, identity, and review.

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  fileToBase64,
  stripDataUrlPrefix,
  getMimeFromDataUrl,
  validateDocumentImageFile,
} from "../utils/cameraKyc";

import {
  preRegisterIdFace,
  preSelfieVerify,
  getPreKycSessionToken,
} from "../utils/kycApi";

import {
  Mail, Phone, User, Loader, Upload, CircleCheck,
  ArrowLeft, ArrowRight, ShieldCheck, CarFront, Check, Calendar, MapPin,
} from "lucide-react";

import FormInput from "./FormInput";
import PasswordInput from "./PasswordInput";
import AuthShell from "./AuthShell";
import LegalPolicyModal from "./LegalPolicyModal";
import RegistrationDraftNotice from "./RegistrationDraftNotice";
import RegistrationProgress from "./RegistrationProgress";
import HelpLink from "./HelpLink";
import SelfieCapture from "./SelfieCapture";
import useRegistrationDraft from "../hooks/useRegistrationDraft";
import useRegistrationEmailCheck from "../hooks/useRegistrationEmailCheck";
import { getMinBirthDate, getMaxBirthDate, RELATIONSHIP_OPTIONS, VALIDATION_RULES } from "../data/registerValidation";
import { ID_DOCUMENT_TYPES } from "../data/kycDocumentTypes";
import API from "../utils/api";

const STEP_LABELS = ["Account", "About you", "Location & safety", "Identity", "Review"];
const TOTAL_STEPS = STEP_LABELS.length;
const ACTION_COOLDOWN_MS = 2000;
const RATE_LIMIT_FALLBACK_SECONDS = 5 * 60;
const REGISTER_RATE_LIMIT_STORAGE_KEY = "rentifypro.registerRateLimitUntil";
const PSGC_BASE_URL = "https://psgc.gitlab.io/api";
const normalizePhMobileInput = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("9")) return "";
  return digits.slice(0, 10);
};

const formatCountdown = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

const getRemainingRateLimitSeconds = (untilMs) => {
  const safeUntilMs = Number(untilMs) || 0;
  if (safeUntilMs <= 0) return 0;
  return Math.max(0, Math.ceil((safeUntilMs - Date.now()) / 1000));
};

const readStoredRateLimitUntil = () => {
  if (typeof window === "undefined") return 0;
  try {
    const stored = Number(window.localStorage.getItem(REGISTER_RATE_LIMIT_STORAGE_KEY) || 0);
    if (!Number.isFinite(stored) || stored <= Date.now()) {
      window.localStorage.removeItem(REGISTER_RATE_LIMIT_STORAGE_KEY);
      return 0;
    }
    return stored;
  } catch {
    return 0;
  }
};

// Turn service errors into user-friendly text
function friendlyError(msg) {
  if (!msg || typeof msg !== "string") return "Something went wrong. Please try again.";
  const lower = msg.toLowerCase();
  if (lower.includes("face") && lower.includes("not") && lower.includes("match")) return "Your selfie doesn't seem to match your ID photo. Please try again with better lighting and face the camera directly.";
  if (lower.includes("no face") || lower.includes("face detection failed")) return "We couldn't find a face in your image. Please make sure your face is clearly visible and well-lit.";
  if (lower.includes("blurry") || lower.includes("blur")) return "Your image is a bit blurry. Please hold your device steady and try again.";
  if (lower.includes("dark")) return "The image is too dark. Please move to a brighter area.";
  if (lower.includes("bright") || lower.includes("glare")) return "The image is too bright. Please avoid direct light or flash.";
  if (lower.includes("too many face")) return "We detected multiple people. Please make sure only you are in the frame.";
  if (lower.includes("too small")) return "Your face is too small in the image. Please move closer.";
  if (lower.includes("too close")) return "You're too close to the camera. Please move back a little.";
  if (lower.includes("expired") || lower.includes("timed out")) return "Your session timed out. Please capture a new selfie and try again.";
  if (lower.includes("not running") || lower.includes("econnrefused")) return "The verification service is temporarily unavailable. Please try again in a moment.";
  if (lower.includes("timeout") || lower.includes("etimedout")) return "The request took too long. Please try again.";
  if (lower.includes("too many")) return msg;
  if (/^[A-Z]/.test(msg) && !lower.includes("error") && !lower.includes("exception") && !lower.includes("500")) return msg;
  return "Something went wrong. Please try again.";
}

export default function RegisterPage(props) {
  const [attempt, setAttempt] = useState({ key: 0, reason: "" });
  const resetDraft = useCallback((reason) => setAttempt((previous) => ({ key: previous.key + 1, reason })), []);
  return <RegisterForm key={attempt.key} {...props} onResetDraft={resetDraft} draftResetReason={attempt.reason} />;
}

function RegisterForm({
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegisterOTP,
  onNavigateToOwnerRegister,
  onResetDraft,
  draftResetReason,
}) {
  // Form fields
  const [isLoading, setIsLoading] = useState(false);
  const draft = useRegistrationDraft("user", {
    firstName: "", lastName: "", email: "", phone: "",
    dateOfBirth: "", gender: "",
    region: "", province: "", city: "", barangay: "",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelationship: "",
    password: "", confirmPassword: "", agree: false,
  }, { busy: isLoading, onReset: onResetDraft, resetReason: draftResetReason });
  const { form, setForm } = draft;
  const { check: checkEmail, cancel: cancelEmailCheck, isChecking: isCheckingEmail } = useRegistrationEmailCheck();

  const [accountType, setAccountType] = useState("user");
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [addressLoadError, setAddressLoadError] = useState("");

  // KYC data
  const [kyc, setKyc] = useState({
    idType: "",
    idCardFile: null,
    idRegistered: false,
    idReadyForSelfie: false,
    selfieVerified: false,
    selfieDataUrl: "",
    selfieBase64Clean: "",
  });

  const [kycUi, setKycUi] = useState({ statusText: "" });
  const [documentReviewStatus, setDocumentReviewStatus] = useState("not_uploaded");
  const idPreviewUrl = useMemo(
    () => (kyc.idCardFile ? URL.createObjectURL(kyc.idCardFile) : ""),
    [kyc.idCardFile]
  );
  const identityStage = !kyc.idRegistered
    ? "id"
    : ["reupload_required", "rejected"].includes(documentReviewStatus)
      ? "id_blocked"
    : !kyc.idReadyForSelfie
      ? "id_checking"
      : !kyc.selfieBase64Clean
        ? "camera"
        : !kyc.selfieVerified
          ? "selfie"
          : "complete";
  const handleIdStatus = useCallback((status, document) => {
    setDocumentReviewStatus(status);
    const ready = document?.identityReadyForSelfie === true;
    setKyc((previous) => {
      if (previous.idReadyForSelfie === ready) return previous;
      return {
        ...previous,
        idReadyForSelfie: ready,
        ...(!ready ? { selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "" } : {}),
      };
    });
    if (ready) {
      setKycUi((previous) => ({ ...previous, statusText: "ID details matched. You can now take your selfie." }));
    } else if (!["queued", "processing", "retry_wait"].includes(status)) {
      setKycUi((previous) => ({ ...previous, statusText: "" }));
    }
  }, []);
  const isDocumentApproved = documentReviewStatus === "verified";

  // Page state
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [stepErrors, setStepErrors] = useState({});
  const [rateLimitUntil, setRateLimitUntil] = useState(() => readStoredRateLimitUntil());
  const [rateLimitSeconds, setRateLimitSeconds] = useState(() =>
    getRemainingRateLimitSeconds(readStoredRateLimitUntil())
  );
  const [successMessage, setSuccessMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [legalModalType, setLegalModalType] = useState("");
  const isRateLimited = rateLimitSeconds > 0;
  const isFormLocked = isLoading || isRateLimited;

  const clearRateLimit = useCallback(() => {
    setRateLimitUntil(0);
    setRateLimitSeconds(0);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(REGISTER_RATE_LIMIT_STORAGE_KEY);
    } catch {
      // Ignore storage write failures.
    }
  }, []);

  const activateRateLimit = useCallback((seconds, retryAfterAt = "") => {
    const fallbackSeconds = Math.max(1, Math.floor(Number(seconds) || RATE_LIMIT_FALLBACK_SECONDS));
    const parsedRetryAfterAt = Date.parse(String(retryAfterAt || "").trim());
    const untilMs =
      Number.isFinite(parsedRetryAfterAt) && parsedRetryAfterAt > Date.now()
        ? parsedRetryAfterAt
        : Date.now() + fallbackSeconds * 1000;

    setRateLimitUntil(untilMs);
    setRateLimitSeconds(getRemainingRateLimitSeconds(untilMs));

    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(REGISTER_RATE_LIMIT_STORAGE_KEY, String(untilMs));
    } catch {
      // Ignore storage write failures.
    }
  }, []);

  // Input refs
  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const dobRef = useRef(null);
  const genderRef = useRef(null);
  const regionRef = useRef(null);
  const provinceRef = useRef(null);
  const cityRef = useRef(null);
  const barangayRef = useRef(null);
  const emergencyNameRef = useRef(null);
  const emergencyPhoneRef = useRef(null);
  const emergencyRelationshipRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);
  const idTypeRef = useRef(null);
  const idInputRef = useRef(null);

  // Small cooldown to avoid double clicks
  const lastActionRef = useRef(0);
  const canAct = () => {
    if (isFormLocked) return false;
    const now = Date.now();
    if (now - lastActionRef.current < ACTION_COOLDOWN_MS) return false;
    lastActionRef.current = now;
    return true;
  };

  const fullName = useMemo(
    () => `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    [form.firstName, form.lastName]
  );

  const selectedAddress = useMemo(() => {
    const regionName = regions.find((region) => region.code === form.region)?.name || "";
    const provinceName = provinces.find((province) => province.code === form.province)?.name || "";
    const cityName = cities.find((city) => city.code === form.city)?.name || "";
    const barangayName = barangays.find((barangay) => barangay.code === form.barangay)?.name || "";

    return [barangayName, cityName, provinceName, regionName].filter(Boolean).join(", ");
  }, [barangays, cities, form.barangay, form.city, form.province, form.region, provinces, regions]);

  useEffect(() => {
    let active = true;

    const loadRegions = async () => {
      try {
        setAddressLoadError("");
        const response = await fetch(`${PSGC_BASE_URL}/regions/`);
        if (!response.ok) throw new Error("Failed to load regions.");
        const data = await response.json();
        if (active) setRegions(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setRegions([]);
        setAddressLoadError("Could not load location options. Please refresh and try again.");
      }
    };

    loadRegions();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!form.region) {
      setProvinces([]);
      setCities([]);
      setBarangays([]);
      return;
    }

    let active = true;

    const loadProvincesOrCities = async () => {
      try {
        setAddressLoadError("");
        const provinceResponse = await fetch(`${PSGC_BASE_URL}/regions/${form.region}/provinces/`);
        if (!provinceResponse.ok) throw new Error("Failed to load provinces.");
        const provinceData = await provinceResponse.json();
        const provinceList = Array.isArray(provinceData) ? provinceData : [];
        if (!active) return;

        setProvinces(provinceList);

        if (provinceList.length === 0) {
          const cityResponse = await fetch(
            `${PSGC_BASE_URL}/regions/${form.region}/cities-municipalities/`
          );
          if (!cityResponse.ok) throw new Error("Failed to load cities.");
          const cityData = await cityResponse.json();
          if (!active) return;
          setCities(Array.isArray(cityData) ? cityData : []);
        }
      } catch {
        if (!active) return;
        setProvinces([]);
        setCities([]);
        setBarangays([]);
        setAddressLoadError("Could not load location options. Please refresh and try again.");
      }
    };

    loadProvincesOrCities();
    return () => {
      active = false;
    };
  }, [form.region]);

  useEffect(() => {
    if (!form.region || provinces.length === 0 || !form.province) {
      if (!form.region || provinces.length > 0) {
        setCities((prev) => (prev.length > 0 && !form.province ? [] : prev));
        setBarangays((prev) => (prev.length > 0 ? [] : prev));
      }
      return;
    }

    let active = true;

    const loadCities = async () => {
      try {
        setAddressLoadError("");
        const response = await fetch(
          `${PSGC_BASE_URL}/provinces/${form.province}/cities-municipalities/`
        );
        if (!response.ok) throw new Error("Failed to load cities.");
        const data = await response.json();
        if (!active) return;
        setCities(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setCities([]);
        setBarangays([]);
        setAddressLoadError("Could not load location options. Please refresh and try again.");
      }
    };

    loadCities();
    return () => {
      active = false;
    };
  }, [form.province, form.region, provinces.length]);

  useEffect(() => {
    if (!form.city) {
      setBarangays([]);
      return;
    }

    let active = true;

    const loadBarangays = async () => {
      try {
        setAddressLoadError("");
        const response = await fetch(
          `${PSGC_BASE_URL}/cities-municipalities/${form.city}/barangays/`
        );
        if (!response.ok) throw new Error("Failed to load barangays.");
        const data = await response.json();
        if (!active) return;
        setBarangays(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setBarangays([]);
        setAddressLoadError("Could not load location options. Please refresh and try again.");
      }
    };

    loadBarangays();
    return () => {
      active = false;
    };
  }, [form.city]);

  useEffect(() => {
    if (rateLimitUntil <= 0) {
      setRateLimitSeconds(0);
      return undefined;
    }

    const syncCountdown = () => {
      const remaining = getRemainingRateLimitSeconds(rateLimitUntil);
      setRateLimitSeconds(remaining);
      if (remaining <= 0) {
        clearRateLimit();
      }
    };

    syncCountdown();
    const timer = setInterval(syncCountdown, 1000);
    return () => clearInterval(timer);
  }, [rateLimitUntil, clearRateLimit]);

  // Input handlers

  const validateStep1Field = useCallback(
    (field, sourceForm = form) => {
      switch (field) {
        case "firstName":
          return VALIDATION_RULES.firstName(sourceForm.firstName);
        case "lastName":
          return VALIDATION_RULES.lastName(sourceForm.lastName);
        case "email":
          return VALIDATION_RULES.email(sourceForm.email);
        case "phone":
          return VALIDATION_RULES.phone(sourceForm.phone);
        case "dateOfBirth":
          return VALIDATION_RULES.dateOfBirth(sourceForm.dateOfBirth);
        case "gender":
          return VALIDATION_RULES.gender(sourceForm.gender);
        case "region":
          return VALIDATION_RULES.region(sourceForm.region);
        case "province":
          return provinces.length > 0 ? VALIDATION_RULES.province(sourceForm.province) : "";
        case "city":
          return VALIDATION_RULES.city(sourceForm.city);
        case "barangay":
          return VALIDATION_RULES.barangay(sourceForm.barangay);
        case "emergencyContactName":
          return VALIDATION_RULES.emergencyContactName(sourceForm.emergencyContactName);
        case "emergencyContactPhone":
          return VALIDATION_RULES.emergencyContactPhone(sourceForm.emergencyContactPhone);
        case "emergencyContactRelationship":
          return VALIDATION_RULES.emergencyContactRelationship(sourceForm.emergencyContactRelationship);
        case "password":
          return VALIDATION_RULES.password(sourceForm.password);
        case "confirmPassword":
          if (VALIDATION_RULES.password(sourceForm.password)) return "";
          return VALIDATION_RULES.confirmPassword(sourceForm.password, sourceForm.confirmPassword);
        case "agree":
          return VALIDATION_RULES.agree(sourceForm.agree);
        default:
          return "";
      }
    },
    [form, provinces.length]
  );

  const handleChange = (field, value) => {
    if (field === "email") cancelEmailCheck();
    const nextForm = { ...form, [field]: value };
    setForm(nextForm);
    setFormError("");
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({
      ...prev,
      [field]: "",
      ...(field === "password" ? { confirmPassword: "" } : {}),
    }));
    if (["firstName", "lastName", "email", "dateOfBirth", "gender"].includes(field)) {
      setKyc((prev) => ({
        ...prev,
        idRegistered: false,
        idReadyForSelfie: false,
        selfieVerified: false,
        selfieDataUrl: "",
        selfieBase64Clean: "",
      }));
      setStepErrors((prev) => ({ ...prev, idRegistered: "", selfieVerified: "" }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    }
  };

  const handleFieldBlur = (field) => {
    if (!touched[field]) return;
    const nextForm = { ...form };
    setErrors((prev) => {
      const nextErrors = { ...prev, [field]: validateStep1Field(field, nextForm) };
      if (field === "password" && (touched.confirmPassword || nextForm.confirmPassword)) {
        nextErrors.confirmPassword = validateStep1Field("confirmPassword", nextForm);
      }
      return nextErrors;
    });
  };

  const handleRegionChange = (value) => {
    const nextForm = {
      ...form,
      region: value,
      province: "",
      city: "",
      barangay: "",
    };
    setForm(nextForm);
    setTouched((prev) => ({
      ...prev,
      region: true,
      province: false,
      city: false,
      barangay: false,
    }));
    setErrors((prev) => ({
      ...prev,
      region: "",
      province: "",
      city: "",
      barangay: "",
    }));
  };

  const handleProvinceChange = (value) => {
    const nextForm = {
      ...form,
      province: value,
      city: "",
      barangay: "",
    };
    setForm(nextForm);
    setTouched((prev) => ({
      ...prev,
      province: true,
      city: false,
      barangay: false,
    }));
    setErrors((prev) => ({
      ...prev,
      province: "",
      city: "",
      barangay: "",
    }));
  };

  const handleCityChange = (value) => {
    const nextForm = {
      ...form,
      city: value,
      barangay: "",
    };
    setForm(nextForm);
    setTouched((prev) => ({
      ...prev,
      city: true,
      barangay: false,
    }));
    setErrors((prev) => ({
      ...prev,
      city: "",
      barangay: "",
    }));
  };

  const handleBarangayChange = (value) => {
    const nextForm = { ...form, barangay: value };
    setForm(nextForm);
    setTouched((prev) => ({ ...prev, barangay: true }));
    setErrors((prev) => ({
      ...prev,
      barangay: "",
    }));
  };

  const handleAccountSelect = (type) => {
    if (type === "owner") {
      if (typeof onNavigateToOwnerRegister === "function") onNavigateToOwnerRegister();
      return;
    }
    setAccountType(type);
  };

  // Reset KYC

  const resetKyc = useCallback(() => {
    setKyc({
      idType: "",
      idCardFile: null, idRegistered: false, idReadyForSelfie: false,
      selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "",
    });
    setKycUi((p) => ({ ...p, statusText: "" }));
    setDocumentReviewStatus("not_uploaded");
    setStepErrors({});
  }, []);

  useEffect(() => () => {
    if (idPreviewUrl) URL.revokeObjectURL(idPreviewUrl);
  }, [idPreviewUrl]);

  const fieldRefs = {
    firstName: firstNameRef,
    lastName: lastNameRef,
    email: emailRef,
    phone: phoneRef,
    dateOfBirth: dobRef,
    gender: genderRef,
    region: regionRef,
    province: provinceRef,
    city: cityRef,
    barangay: barangayRef,
    emergencyContactName: emergencyNameRef,
    emergencyContactPhone: emergencyPhoneRef,
    emergencyContactRelationship: emergencyRelationshipRef,
    password: passwordRef,
    confirmPassword: confirmPasswordRef,
  };

  const validateFields = (fields) => {
    const nextErrors = {};
    fields.forEach((field) => {
      nextErrors[field] = validateStep1Field(field, form);
    });
    setTouched((previous) => ({
      ...previous,
      ...Object.fromEntries(fields.map((field) => [field, true])),
    }));
    setErrors((previous) => ({ ...previous, ...nextErrors }));
    const firstInvalidField = fields.find((field) => nextErrors[field]);
    if (firstInvalidField) {
      fieldRefs[firstInvalidField]?.current?.focus?.();
      return false;
    }
    return true;
  };

  const validateAccountStep = () => validateFields(["email", "phone", "password", "confirmPassword"]);
  const validateAboutStep = () => validateFields(["firstName", "lastName", "dateOfBirth", "gender"]);
  const validateLocationStep = () => validateFields([
    "region",
    "province",
    "city",
    "barangay",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelationship",
  ]);
  const validateReviewStep = () => validateFields(["agree"]);

  const validateIdentityStep = () => {
    const nextErrors = {};
    if (!kyc.idType) nextErrors.idType = "Please select your ID type.";
    if (!kyc.idCardFile) nextErrors.idCardFile = "Please upload your full ID card.";
    if (!kyc.idRegistered) nextErrors.idRegistered = "Please upload your ID first.";
    else if (!kyc.idReadyForSelfie) nextErrors.idRegistered = "Wait for your ID details to match before taking your selfie.";
    else if (!kyc.selfieVerified) nextErrors.selfieVerified = "Please verify your selfie matches the ID.";
    setStepErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  // Step navigation

  const goNext = async () => {
    if (!canAct()) return;
    setSuccessMessage("");
    if (step === 1) {
      if (!validateAccountStep()) return;
      setFormError("");
      setIsLoading(true);
      try {
        const result = await checkEmail(form.email);
        if (!result) return;
        if (result.available) {
          setStep(2);
        } else if (result.fieldError) {
          setErrors((previous) => ({ ...previous, email: result.message }));
          setTimeout(() => emailRef.current?.focus(), 0);
        } else {
          setFormError(result.message);
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }
    if (step === 2 && !validateAboutStep()) return;
    if (step === 3 && !validateLocationStep()) return;
    if (step === 4 && !validateIdentityStep()) return;
    setStep((current) => Math.min(TOTAL_STEPS, current + 1));
  };

  const goBack = () => {
    if (!canAct()) return;
    if (step === 1) return;
    setSuccessMessage("");
    setStepErrors({});
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
  };

  // KYC step 1: save ID face

  const registerId = async () => {
    if (!canAct()) return;
    if (!kyc.idType) {
      setStepErrors((p) => ({ ...p, idType: "Select your ID type first." }));
      idTypeRef.current?.focus?.();
      return;
    }
    if (!kyc.idCardFile) {
      setStepErrors((p) => ({ ...p, idCardFile: "Upload your ID image first." }));
      return;
    }
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Uploading ID securely..." }));
    try {
      await validateDocumentImageFile(kyc.idCardFile);
      const dataUrl = await fileToBase64(kyc.idCardFile);
      const clean = stripDataUrlPrefix(dataUrl);
      const mime = getMimeFromDataUrl(dataUrl);
      const result = await preRegisterIdFace(form.email, fullName, "user", clean, mime, {
        idType: kyc.idType,
        userProfile: {
          full_name: fullName,
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          date_of_birth: form.dateOfBirth,
        },
      });
      if (!result.success) throw new Error(result.message || "We couldn't register your ID. Please try a clearer photo.");
      setKyc((prev) => ({
        ...prev,
        idRegistered: true,
        idReadyForSelfie: false,
        selfieVerified: false,
        selfieDataUrl: "",
        selfieBase64Clean: "",
      }));
      setDocumentReviewStatus("queued");
      setStepErrors((p) => ({ ...p, idType: "", idRegistered: "" }));
      setKycUi((p) => ({ ...p, statusText: "ID uploaded. We are checking that its personal details match your registration." }));
    } catch (e) {
      const msg = friendlyError(e.message);
      setStepErrors((p) => ({ ...p, idRegistered: msg }));
      setKycUi((p) => ({ ...p, statusText: "" }));
    } finally {
      setIsLoading(false);
    }
  };

  // KYC step 2: the shared capture component owns the camera lifecycle.

  const handleSelfieCapture = ({ dataUrl, base64 }) => {
    setKyc((previous) => ({
      ...previous,
      selfieVerified: false,
      selfieDataUrl: dataUrl,
      selfieBase64Clean: base64,
    }));
    setStepErrors((previous) => ({ ...previous, selfieVerified: "" }));
    setKycUi((previous) => ({ ...previous, statusText: "" }));
  };

  const retakeSelfie = () => {
    setKyc((previous) => ({
      ...previous,
      selfieVerified: false,
      selfieDataUrl: "",
      selfieBase64Clean: "",
    }));
    setStepErrors((previous) => ({ ...previous, selfieVerified: "" }));
    setKycUi((previous) => ({ ...previous, statusText: "" }));
  };

  // KYC step 3: match selfie with ID

  const verifySelfie = async () => {
    if (!canAct()) return;
    if (!kyc.selfieBase64Clean) {
      setStepErrors((p) => ({ ...p, selfieVerified: "Capture a selfie first." }));
      return;
    }
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Verifying face match..." }));
    try {
      const result = await preSelfieVerify(form.email, kyc.selfieBase64Clean, "user");
      if (!result.verified) throw new Error(result.message || "Face does not match ID.");
      setKyc((prev) => ({ ...prev, selfieVerified: true }));
      setStepErrors((p) => ({ ...p, selfieVerified: "" }));
      setKycUi((p) => ({ ...p, statusText: "" }));
    } catch (e) {
      setKyc((prev) => ({ ...prev, selfieVerified: false }));
      const msg = friendlyError(e.message);
      setStepErrors((p) => ({ ...p, selfieVerified: msg }));
      setKycUi((p) => ({ ...p, statusText: "" }));
    } finally {
      setIsLoading(false);
    }
  };

  // Final submit

  const handleFinalRegister = async (e) => {
    e.preventDefault();
    if (!canAct()) return;
    if (accountType !== "user") {
      if (typeof onNavigateToOwnerRegister === "function") onNavigateToOwnerRegister();
      return;
    }
    if (!validateAccountStep()) { setStep(1); return; }
    if (!validateAboutStep()) { setStep(2); return; }
    if (!validateLocationStep()) { setStep(3); return; }
    if (!validateIdentityStep()) { setStep(4); return; }
    if (!validateReviewStep()) return;
    if (!isDocumentApproved) {
      setFormError(["reupload_required", "rejected"].includes(documentReviewStatus)
        ? "Your government ID needs a new upload. Return to Identity, follow the correction shown under Document review, and try again."
        : "Your government ID is still being checked. Refresh the document status and submit after it is approved.");
      return;
    }
    setIsLoading(true);
    setSuccessMessage("");
    setFormError("");
    try {
      const preKycToken = await getPreKycSessionToken(form.email, "user");
      const response = await API.register({
        name: fullName,
        email: form.email,
        phone: form.phone,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        address: selectedAddress,
        region: form.region,
        province: form.province,
        city: form.city,
        barangay: form.barangay,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        emergencyContactRelationship: form.emergencyContactRelationship,
        password: form.password,
        role: "user",
        preKycToken,
      });
      const registeredEmail = String(response?.user?.email || form.email || "").trim().toLowerCase();
      draft.complete();
      setSuccessMessage(response?.message || "Registration successful! Redirecting to OTP verification...");
      clearRateLimit();
      await API.sendOTP(registeredEmail).catch(() => {});
      setTimeout(() => { onNavigateToRegisterOTP(registeredEmail, form.phone, fullName); }, 1500);
    } catch (error) {
      const raw = error?.message || "";
      const lower = raw.toLowerCase();
      const retryAfterSeconds = Number(error?.retryAfterSeconds || error?.details?.retryAfterSeconds || 0);
      const retryAfterAt = error?.retryAfterAt || error?.details?.retryAfterAt || "";
      const isRateLimitError = Number(error?.status) === 429 || lower.includes("too many");
      if (isRateLimitError) {
        const waitSeconds = retryAfterSeconds > 0 ? retryAfterSeconds : RATE_LIMIT_FALLBACK_SECONDS;
        activateRateLimit(waitSeconds, retryAfterAt);
        setErrors({});
        setStepErrors({});
        setFormError("");
        return;
      }
      const serverErrors = error?.details?.errors;
      if (serverErrors && typeof serverErrors === "object") {
        const fieldErrors = { ...serverErrors };
        if (fieldErrors.name) {
          fieldErrors.firstName = fieldErrors.name;
          delete fieldErrors.name;
        }
        setErrors(fieldErrors);
        setStepErrors({});
        setFormError("");
        setStep(1);
        const fieldRefs = {
          firstName: firstNameRef,
          email: emailRef,
          phone: phoneRef,
          dateOfBirth: dobRef,
          gender: genderRef,
          region: regionRef,
          province: provinceRef,
          city: cityRef,
          barangay: barangayRef,
          emergencyContactName: emergencyNameRef,
          emergencyContactPhone: emergencyPhoneRef,
          emergencyContactRelationship: emergencyRelationshipRef,
          password: passwordRef,
        };
        const firstServerField = Object.keys(fieldErrors).find((field) => fieldErrors[field]);
        setTimeout(() => fieldRefs[firstServerField]?.current?.focus?.(), 0);
        return;
      }
      const phoneConflict = lower.includes("phone") && lower.includes("already");
      const msg = raw.includes("already")
        ? phoneConflict
          ? "This phone number is already registered."
          : "This email address is already registered."
        : raw.includes("Too many")
        ? raw
        : /^[A-Z]/.test(raw) && !/request failed/i.test(raw)
        ? raw
        : "Registration failed. Please try again.";

      if (phoneConflict) {
        setErrors({ phone: msg });
        setFormError("");
        setStep(1);
        setTimeout(() => phoneRef.current?.focus(), 0);
        return;
      }

      if (lower.includes("email") && (lower.includes("already") || lower.includes("invalid"))) {
        setErrors({ email: msg });
        setFormError("");
        setStep(1);
        setTimeout(() => emailRef.current?.focus(), 0);
        return;
      }

      if (lower.includes("password")) {
        setErrors({ password: msg });
        setFormError("");
        setStep(1);
        setTimeout(() => passwordRef.current?.focus(), 0);
        return;
      }

      setErrors({});
      setFormError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // File upload card

  const FileCard = ({ title, description, file, previewUrl, onPick, onRemove, accept, inputRef, icon: Icon, error }) => (
    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
          <Icon size={20} className="text-gray-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">{title}</p>
          <p className="text-sm text-gray-600 mt-1">{description}</p>
          {previewUrl && (
            <img src={previewUrl} alt="Selected government ID preview" className="mt-3 max-h-64 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={inputRef} type="file" accept={accept} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
            {!file ? (
              <button type="button" onClick={() => inputRef?.current?.click()} disabled={isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:opacity-95 transition disabled:opacity-60">
                <Upload size={18} /> Upload
              </button>
            ) : (
              <>
                <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-800 min-w-0 truncate">
                  <span className="font-medium">Selected:</span> {file.name}
                </div>
                <button type="button" onClick={onRemove} disabled={isLoading}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-800 font-semibold hover:bg-gray-50 transition disabled:opacity-60 flex-shrink-0">
                  Remove
                </button>
              </>
            )}
          </div>
          {error && <p className="text-red-500 text-sm font-medium mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );

  const SelectField = ({
    label,
    value,
    onChange,
    options,
    error,
    disabled,
    required = false,
    inputRef,
    placeholder = "Select an option",
    onBlur,
  }) => (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <select
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className={`w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-slate-900 shadow-sm transition-all duration-200 focus:outline-none ${
            error
              ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          } ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
        >
          <option value="" disabled hidden>{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
    </div>
  );

  // Render

  return (
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      disableNavigation={isRateLimited}
      badge="Guided account onboarding"
      panelTitle="Create your RentifyPro account."
      panelDescription="Complete your details, identity check, and email confirmation in focused steps."
      highlights={[
        "Clear 5-step onboarding with progress tracking",
        "Secure face verification flow",
        "Ready for bookings after successful verification",
      ]}
      contentMaxWidth="max-w-4xl"
      contentContainerClassName="items-start py-2 sm:py-4"
    >
      <div {...draft.activityProps} className="rp-surface rp-glass min-w-0 overflow-hidden rounded-3xl border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
        {/* header */}
        <div className="mb-6 text-center">
          <span className="rp-chip bg-blue-50 text-blue-700 ring-1 ring-blue-100">Register</span>
          <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-4xl">Create your account</h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Fast, secure onboarding in {TOTAL_STEPS} guided steps.
          </p>
        </div>

        <RegistrationProgress currentStep={step} steps={STEP_LABELS} />
        {step === 4 && <HelpLink guide="verify-identity" className="mt-3">Need help with your ID or selfie?</HelpLink>}

        <RegistrationDraftNotice draft={draft} busy={isLoading} />

        {/* success message */}
        {successMessage && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-emerald-700">{successMessage}</p>
          </div>
        )}

        <form onSubmit={(event) => {
          event.preventDefault();
          if (step < TOTAL_STEPS) void goNext();
          else void handleFinalRegister(event);
        }} className="space-y-4" noValidate>
          {isCheckingEmail && <p role="status" className="sr-only">Checking email availability.</p>}
          {formError && (
            <div
              role="alert"
              className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            >
              {formError}
            </div>
          )}

          <fieldset disabled={isFormLocked} className="space-y-4">
                {/* step 1 */}
                {[1, 2, 3].includes(step) && (
                  <>
                    {step === 1 && (
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-1">Register as</p>
                      <p className="text-sm text-gray-500 mb-3">Choose what type of account you want to create.</p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <button type="button" onClick={() => handleAccountSelect("user")}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${accountType === "user" ? "border-[#017FE6] bg-blue-50" : "border-gray-200 hover:border-[#017FE6]"}`}>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 text-xs ${accountType === "user" ? "border-[#017FE6] bg-[#017FE6] text-white" : "border-gray-300"}`}>
                            {accountType === "user" && <Check size={16} strokeWidth={2} aria-hidden="true" />}
                          </div>
                          <User size={18} className="text-gray-600" />
                          <div className="min-w-0 text-left"><p className="font-semibold text-gray-800 text-sm">Renter</p><p className="text-xs text-gray-500">Rent vehicles</p></div>
                        </button>
                        <button type="button" onClick={() => handleAccountSelect("owner")}
                          className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-[#017FE6] transition">
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center shrink-0" />
                          <CarFront size={18} strokeWidth={2} className="text-gray-600" aria-hidden="true" />
                          <div className="min-w-0 text-left"><p className="font-semibold text-gray-800 text-sm">Vehicle Owner</p><p className="text-xs text-gray-500">List vehicles after verification</p></div>
                        </button>
                      </div>
                    </div>
                    )}

                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-1">Step {step} — {STEP_LABELS[step - 1]}</p>
                      <p className="text-sm text-gray-500">
                        {step === 1 && "Set up the contact details and password for your account."}
                        {step === 2 && "Enter the personal details shown on your government ID."}
                        {step === 3 && "Add your location and a trusted emergency contact."}
                      </p>
                    </div>

                    {step === 2 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="First Name" value={form.firstName} onChange={(e) => handleChange("firstName", e.target.value)} onBlur={() => handleFieldBlur("firstName")} error={errors.firstName} disabled={isLoading} placeholder="John" required icon={User} onlyLetters inputRef={firstNameRef} maxLength={50} />
                      <FormInput label="Last Name" value={form.lastName} onChange={(e) => handleChange("lastName", e.target.value)} onBlur={() => handleFieldBlur("lastName")} error={errors.lastName} disabled={isLoading} placeholder="Doe" required icon={User} onlyLetters inputRef={lastNameRef} maxLength={50} />
                    </div>
                    )}
                    {step === 1 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="Enter Email" type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value.toLowerCase().trim())} onBlur={() => handleFieldBlur("email")} error={errors.email} disabled={isLoading} placeholder="Enter Email" required icon={Mail} inputRef={emailRef} showEmailHint maxLength={254} />
                      <FormInput label="Phone Number" type="tel" value={form.phone} onChange={(e) => handleChange("phone", normalizePhMobileInput(e.target.value))} onBlur={() => handleFieldBlur("phone")} error={errors.phone} disabled={isLoading} placeholder="9XXXXXXXXX" required icon={Phone} onlyNumbers inputRef={phoneRef} maxLength={10} prefixText="+63" />
                    </div>
                    )}
                    {step === 2 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="Date of Birth" type="date" min={getMinBirthDate()} max={getMaxBirthDate()} value={form.dateOfBirth} onChange={(e) => handleChange("dateOfBirth", e.target.value)} onBlur={() => handleFieldBlur("dateOfBirth")} error={errors.dateOfBirth} disabled={isLoading} required icon={Calendar} inputRef={dobRef} />
                      <SelectField label="Gender" value={form.gender} onChange={(value) => handleChange("gender", value)} options={[
                        { value: "Male", label: "Male" },
                        { value: "Female", label: "Female" },
                        { value: "Prefer not to say", label: "Prefer not to say" },
                      ]} onBlur={() => handleFieldBlur("gender")} error={errors.gender} disabled={isLoading} required inputRef={genderRef} />
                    </div>
                    )}
                    {step === 3 && (
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white space-y-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <MapPin size={18} className="text-[#017FE6]" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">Location Information</p>
                          <p className="text-sm text-gray-500 mt-1">Select your region, city, and barangay so your profile is complete from the start.</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <SelectField
                          label="Region"
                          value={form.region}
                          onChange={handleRegionChange}
                          options={regions.map((region) => ({ value: region.code, label: region.name }))}
                          error={errors.region}
                          onBlur={() => handleFieldBlur("region")}
                          disabled={isLoading}
                          required
                          inputRef={regionRef}
                        />
                        <SelectField
                          label={provinces.length > 0 ? "Province" : "Province (Not required)"}
                          value={form.province}
                          onChange={handleProvinceChange}
                          options={provinces.map((province) => ({ value: province.code, label: province.name }))}
                          error={errors.province}
                          onBlur={() => handleFieldBlur("province")}
                          disabled={isLoading || !form.region || provinces.length === 0}
                          required={provinces.length > 0}
                          inputRef={provinceRef}
                          placeholder={provinces.length > 0 ? "Select province" : "Province not required"}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <SelectField
                          label="City / Municipality"
                          value={form.city}
                          onChange={handleCityChange}
                          options={cities.map((city) => ({ value: city.code, label: city.name }))}
                          error={errors.city}
                          onBlur={() => handleFieldBlur("city")}
                          disabled={isLoading || !form.region || (provinces.length > 0 && !form.province)}
                          required
                          inputRef={cityRef}
                        />
                        <SelectField
                          label="Barangay"
                          value={form.barangay}
                          onChange={handleBarangayChange}
                          options={barangays.map((barangay) => ({ value: barangay.code, label: barangay.name }))}
                          error={errors.barangay}
                          onBlur={() => handleFieldBlur("barangay")}
                          disabled={isLoading || !form.city}
                          required
                          inputRef={barangayRef}
                        />
                      </div>

                      <div className={`rounded-xl border px-4 py-3 text-sm ${selectedAddress ? "border-gray-200 bg-gray-50 text-gray-700" : "border-dashed border-gray-300 bg-white text-gray-400"}`}>
                        {selectedAddress || "Your selected location will appear here."}
                      </div>
                      {addressLoadError && <p className="text-xs text-red-500">{addressLoadError}</p>}
                    </div>
                    )}
                    {step === 3 && (
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white space-y-4">
                      <div>
                        <p className="font-semibold text-gray-900">Emergency Contact</p>
                        <p className="text-sm text-gray-500 mt-1">Add someone we can reach if you need urgent support during a booking.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormInput
                          label="Contact Name"
                          value={form.emergencyContactName}
                          onChange={(e) => handleChange("emergencyContactName", e.target.value)}
                          onBlur={() => handleFieldBlur("emergencyContactName")}
                          error={errors.emergencyContactName}
                          disabled={isLoading}
                          placeholder="Maria Dela Cruz"
                          required
                          icon={User}
                          onlyLetters
                          inputRef={emergencyNameRef}
                          maxLength={50}
                        />
                        <FormInput label="Phone Number" type="tel" value={form.emergencyContactPhone} onChange={(e) => handleChange("emergencyContactPhone", normalizePhMobileInput(e.target.value))} onBlur={() => handleFieldBlur("emergencyContactPhone")} error={errors.emergencyContactPhone} disabled={isLoading} placeholder="9XXXXXXXXX" required icon={Phone} onlyNumbers inputRef={emergencyPhoneRef} maxLength={10} prefixText="+63" />
                      </div>
                      <SelectField label="Relationship" value={form.emergencyContactRelationship} onChange={(value) => handleChange("emergencyContactRelationship", value)} onBlur={() => handleFieldBlur("emergencyContactRelationship")} options={RELATIONSHIP_OPTIONS.map((option) => ({ value: option, label: option }))} error={errors.emergencyContactRelationship} disabled={isLoading} required inputRef={emergencyRelationshipRef} />
                    </div>
                    )}
                    {step === 1 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <PasswordInput label="Create Password" value={form.password} onChange={(e) => handleChange("password", e.target.value)} onBlur={() => handleFieldBlur("password")} error={errors.password} disabled={isLoading} placeholder="Create Password" required showStrength inputRef={passwordRef} maxLength={128} />
                      <PasswordInput label="Confirm Password" value={form.confirmPassword} onChange={(e) => handleChange("confirmPassword", e.target.value)} onBlur={() => handleFieldBlur("confirmPassword")} error={errors.confirmPassword} disabled={isLoading} placeholder="Confirm Password" required showStrength={false} inputRef={confirmPasswordRef} maxLength={128} />
                    </div>
                    )}
                  </>
                )}

                {/* step 2 */}
                {step === 4 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <ShieldCheck size={20} className="text-[#017FE6]" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">Step 4 — Identity verification</p>
                          <p className="text-sm text-gray-500 mt-1">
                            Upload your <span className="font-semibold text-gray-700">full ID card</span>, then capture a live selfie to verify your identity.
                          </p>
                        </div>
                      </div>
                    </div>

                    {identityStage === "id" && <>
                    <SelectField
                      label="ID Type"
                      value={kyc.idType}
                      onChange={(value) => {
                        setKyc((prev) => ({
                          ...prev,
                          idType: value,
                          idRegistered: false,
                          idReadyForSelfie: false,
                          selfieVerified: false,
                          selfieDataUrl: "",
                          selfieBase64Clean: "",
                        }));
                        setStepErrors((prev) => ({
                          ...prev,
                          idType: "",
                          idRegistered: "",
                          selfieVerified: "",
                        }));
                        setKycUi((prev) => ({ ...prev, statusText: "" }));
                      }}
                      options={ID_DOCUMENT_TYPES.map((entry) => ({ value: entry, label: entry }))}
                      error={stepErrors.idType}
                      disabled={isLoading}
                      required
                      inputRef={idTypeRef}
                      placeholder="Select the ID type you uploaded"
                    />

                      <FileCard
                        title="Government ID (Front — full card)"
                        description="Upload a clear photo of a Philippine government ID showing the entire card with readable text and no cropped edges."
                      file={kyc.idCardFile}
                      previewUrl={idPreviewUrl}
                      onPick={async (f) => {
                        try {
                          await validateDocumentImageFile(f);
                        } catch (validationError) {
                          setStepErrors((prev) => ({ ...prev, idCardFile: validationError.message || "Please choose a valid ID image." }));
                          if (idInputRef.current) idInputRef.current.value = "";
                          return;
                        }
                        setKyc((prev) => ({ ...prev, idCardFile: f, idRegistered: false, idReadyForSelfie: false, selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "" }));
                        setKycUi((p) => ({ ...p, statusText: "" }));
                        setStepErrors({});
                      }}
                      onRemove={resetKyc}
                      accept="image/jpeg,image/png" inputRef={idInputRef} icon={Upload}
                      error={stepErrors.idCardFile}
                    />
                    <button type="button" disabled={isLoading || !kyc.idType || !kyc.idCardFile} onClick={registerId}
                      className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-50">
                      {isLoading ? <><Loader size={16} className="animate-spin" aria-hidden="true" /> Uploading ID...</> : "Upload and check ID"}
                    </button>
                    </>}

                    {identityStage === "id_checking" && (
                      <div role="status" aria-live="polite" className="rounded-2xl bg-blue-50 p-4 text-blue-950">
                        <div className="flex items-center gap-3 font-semibold">
                          <Loader size={20} className="shrink-0 animate-spin text-blue-700" aria-hidden="true" />
                          Checking your ID details
                        </div>
                        <p className="mt-2 text-sm leading-6 text-blue-900">We are comparing the name and birth date on your ID with your registration. The selfie step will unlock automatically after they match.</p>
                      </div>
                    )}

                    {identityStage === "id_blocked" && (
                      <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm font-medium leading-6 text-rose-800">Selfie verification is unavailable until your ID details match. Check the reason below, then correct your registration details or upload a matching ID.</p>
                    )}

                    {(["camera", "selfie", "complete"].includes(identityStage)) && (
                      <SelfieCapture
                        previewUrl={kyc.selfieDataUrl}
                        matched={identityStage === "complete"}
                        matchedDescription="Your selfie matched your ID photo. Your government ID may still require document review."
                        disabled={isLoading}
                        submitting={isLoading && identityStage === "selfie"}
                        error={stepErrors.selfieVerified}
                        onCapture={handleSelfieCapture}
                        onRetake={retakeSelfie}
                        onSubmit={verifySelfie}
                      />
                    )}
                    {kycUi.statusText && <p role="status" className="text-sm font-medium text-slate-600">{kycUi.statusText}</p>}
                    {stepErrors.idRegistered && <p className="text-red-500 text-sm font-medium">{stepErrors.idRegistered}</p>}
                  </>
                )}

                {/* step 5 */}
                {step === 5 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900">Step 5 — Review & submit</p>
                      <p className="text-sm text-gray-500 mt-1">Confirm your details before creating your account.</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50 space-y-3">
                      {[
                        { label: "Full Name", value: fullName || "—" },
                        { label: "Email", value: form.email || "—" },
                        { label: "Phone", value: form.phone || "—" },
                        { label: "ID Type", value: kyc.idType || "—" },
                        { label: "Account Type", value: "User (Renter)" },
                        { label: "Face Match", value: kyc.selfieVerified ? "Verified" : "Not Verified", highlight: kyc.selfieVerified },
                        { label: "Document Review", value: formatDocumentStatus(documentReviewStatus), highlight: documentReviewStatus === "verified" },
                      ].map(({ label, value, highlight }, i, arr) => (
                        <React.Fragment key={label}>
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-500">{label}</p>
                            <p className={`text-sm font-semibold ${highlight ? "text-green-600" : "text-gray-900"}`}>{value}</p>
                          </div>
                          {i < arr.length - 1 && <div className="h-px bg-gray-200" />}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <input type="checkbox" checked={form.agree} onChange={(e) => handleChange("agree", e.target.checked)} onBlur={() => handleFieldBlur("agree")} disabled={isLoading} className="mt-0.5 h-5 w-5 flex-shrink-0 cursor-pointer accent-[#017FE6]" />
                        <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                          I agree to the{" "}
                          <button type="button" onClick={() => setLegalModalType("terms")} className="font-semibold text-[#017FE6] hover:underline">Terms and Conditions</button>{" "}
                          and{" "}
                          <button type="button" onClick={() => setLegalModalType("privacy")} className="font-semibold text-[#017FE6] hover:underline">Privacy Policy</button>.
                        </span>
                      </label>
                      {errors.agree && <p className="text-red-500 text-sm font-medium">{errors.agree}</p>}
                    </div>
                  </>
                )}

                {(step === 4 || step === 5) && (
                  <PreKycReviewNotice
                    email={form.email}
                    enabled={kyc.idRegistered}
                    onIdStatus={handleIdStatus}
                    onCorrectDetails={() => setStep(2)}
                    onResubmit={() => {
                      resetKyc();
                      setStep(4);
                    }}
                  />
                )}

                {/* navigation */}
                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={goBack} disabled={step === 1 || isFormLocked}
                    className="rp-btn-secondary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-50">
                    <ArrowLeft size={18} /> Back
                  </button>
                  {step < TOTAL_STEPS ? (
                    <button type="button" onClick={goNext} disabled={isFormLocked}
                      className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                      {isRateLimited ? (
                        `Try again in ${formatCountdown(rateLimitSeconds)}`
                      ) : isCheckingEmail ? (
                        <><Loader size={18} className="animate-spin" aria-hidden="true" /> Checking email...</>
                      ) : (
                        <>
                          Next <ArrowRight size={18} />
                        </>
                      )}
                    </button>
                  ) : (
                    <button type="submit" disabled={isFormLocked || !isDocumentApproved}
                      className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                      {isLoading ? (
                        <>
                          <Loader size={18} className="animate-spin" /> Creating...
                        </>
                      ) : isRateLimited ? (
                        `Try again in ${formatCountdown(rateLimitSeconds)}`
                      ) : !isDocumentApproved ? (
                        "Waiting for ID approval"
                      ) : (
                        "Create Account"
                      )}
                    </button>
                  )}
                </div>

                {step === 1 && (
                  <p className="text-center text-gray-500 text-sm mt-1">
                    Already have an account?{" "}
                    <button type="button" onClick={onNavigateToSignIn} disabled={isFormLocked}
                      className="text-[#017FE6] font-semibold hover:underline transition-colors disabled:opacity-50">
                      Sign In
                    </button>
                  </p>
                )}
          </fieldset>
          {isRateLimited && (
            <p className="text-center text-xs font-semibold text-amber-600">
              Too many attempts. You can register again in {formatCountdown(rateLimitSeconds)}.
            </p>
          )}
        </form>
      </div>
      <LegalPolicyModal
        isOpen={Boolean(legalModalType)}
        documentType={legalModalType === "privacy" ? "privacy" : "terms"}
        onClose={() => setLegalModalType("")}
        onSwitchToTerms={() => setLegalModalType("terms")}
        onSwitchToPrivacy={() => setLegalModalType("privacy")}
      />
    </AuthShell>
  );
}
