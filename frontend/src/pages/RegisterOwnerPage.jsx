import RegistrationActions from "../components/RegistrationActions";
import ResponsiveDisclosure from "../components/ResponsiveDisclosure";
import useRegistrationNavigation from "../hooks/useRegistrationNavigation";
import PreKycReviewNotice from "../components/PreKycReviewNotice";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CircleCheck,
  Eye,
  EyeOff,
  FileText,
  LoaderCircle as Loader,
  Lock,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Upload,
  User,
} from "lucide-react";

import {
  fileToBase64,
  getMimeFromDataUrl,
  stripDataUrlPrefix,
  validateDocumentImageFile,
  validateSupportingDocumentFile,
} from "../utils/cameraKyc";
import {
  preRegisterIdFace,
  preSelfieVerify,
  preVerifySupportingDocument,
  getPreKycSessionToken,
} from "../utils/kycApi";
import AuthShell from "../components/AuthShell";
import LegalPolicyModal from "../components/LegalPolicyModal";
import RegistrationDraftNotice from "../components/RegistrationDraftNotice";
import { supportingDocumentCanContinue } from "../utils/registrationVerification";
import RegistrationProgress from "../components/RegistrationProgress";
import RegistrationEmailVerification from "../components/RegistrationEmailVerification";
import HelpLink from "../components/HelpLink";
import PasswordStrengthIndicator from "../components/PasswordStrengthIndicator";
import SelfieCapture from "../components/SelfieCapture";
import DocumentCapture from "../components/DocumentCapture";
import RegistrationDocumentActions from "../components/RegistrationDocumentActions";
import useRegistrationDocumentUpload from "../hooks/useRegistrationDocumentUpload";
import useRegistrationDraft from "../hooks/useRegistrationDraft";
import useRegistrationEmailCheck from "../hooks/useRegistrationEmailCheck";
import API from "../utils/api";
import { ALLOWED_EMAIL_DOMAINS, NAME_REGEX } from "../data/registerValidation";
import { BIR_SUPPORTING_DOCUMENT_TYPES, ID_DOCUMENT_TYPES, SUPPORTING_DOCUMENT_TYPES } from "../data/kycDocumentTypes";

const STEP_LABELS = ["Account", "Address", "Business details", "Verification", "Review"];
const TOTAL_STEPS = STEP_LABELS.length;
const BIR_DOCUMENT_TYPES = new Set(BIR_SUPPORTING_DOCUMENT_TYPES);
const DOCUMENT_NUMBER_LABELS = {
  "DTI Business Name Registration": "DTI registration number",
  "SEC Certificate of Registration": "SEC registration number",
  "Mayor's/Business Permit": "Business permit number",
  "Barangay Business Clearance": "Clearance or reference number (if shown)",
  "CDA Certificate of Registration": "CDA registration number",
};
const ACTION_COOLDOWN_MS = 2000;
const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
// The joined/variation-selector code points are intentionally included to reject complete emoji sequences.
// eslint-disable-next-line no-misleading-character-class
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2028}\u{2029}]/u;
const PH_LOCAL_MOBILE_REGEX = /^9\d{9}$/;

const normalizeNameInput = (value = "") => {
  let nextValue = String(value);
  nextValue = nextValue.replace(/[^A-Za-z ]/g, "");
  nextValue = nextValue.replace(/\s+/g, " ");
  if (nextValue.startsWith(" ")) nextValue = nextValue.slice(1);
  return nextValue;
};

const normalizePhMobileInput = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (!digits.startsWith("9")) return "";
  return digits.slice(0, 10);
};

const initialForm = {
  firstName: "",
  lastName: "",
  businessEmail: "",
  phone: "",
  region: "",
  province: "",
  city: "",
  barangay: "",
  address: "",
  ownerType: "individual",
  businessName: "",
  permitNumber: "",
  taxIdentificationNumber: "",
  branchCode: "",
  password: "",
  confirmPassword: "",
  agree: false,
};

const initialFiles = {
  supportingDocument: null,
};

const initialKyc = {
  idType: "",
  savedDocument: null,
  idCardFile: null,
  idRegistered: false,
  idReadyForSelfie: false,
  selfieVerified: false,
  selfieDataUrl: "",
  selfieBase64Clean: "",
  selfieDocumentRevision: "",
};

function friendlyError(msg) {
  if (!msg || typeof msg !== "string") return "Something went wrong. Please try again.";
  const lower = msg.toLowerCase();
  if (lower.includes("face") && lower.includes("not") && lower.includes("match")) {
    return "Your selfie does not match your ID photo. Try better lighting and face the camera directly.";
  }
  if (lower.includes("no face") || lower.includes("face detection failed")) {
    return "We could not find a face in your image. Make sure your face is clearly visible.";
  }
  if (lower.includes("blurry") || lower.includes("blur")) return "The image is blurry. Please try again.";
  if (lower.includes("dark")) return "The image is too dark. Move to a brighter area.";
  if (lower.includes("bright") || lower.includes("glare")) return "The image is too bright. Avoid direct light.";
  if (lower.includes("too many face")) return "Multiple faces were detected. Make sure only you are in frame.";
  if (lower.includes("expired") || lower.includes("timed out")) return "Session timed out. Capture a new selfie and try again.";
  if (lower.includes("not running") || lower.includes("econnrefused")) return "Verification service is temporarily unavailable.";
  if (lower.includes("timeout") || lower.includes("etimedout")) return "Request timed out. Please try again.";
  if (lower.includes("too many")) return msg;
  if (/^[A-Z]/.test(msg) && !lower.includes("error") && !lower.includes("exception") && !lower.includes("500"))
    return msg;
  return "Something went wrong. Please try again.";
}

function validateOwnerPassword(value) {
  if (!value) return "Password is required.";
  if (/\s/.test(value)) return "Password must not contain spaces.";
  if (EMOJI_REGEX.test(value)) return "Password must not contain emoji.";
  if (value.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(value)) return "Password needs an uppercase letter.";
  if (!/[a-z]/.test(value)) return "Password needs a lowercase letter.";
  if (!/[0-9]/.test(value)) return "Password needs a number.";
  if (!/[!@#$%^&*()_+\-=[\]{}|;':",.<>?/`~]/.test(value)) {
    return "Password needs a special character.";
  }
  return "";
}

export default function RegisterOwnerPage(props) {
  const [attempt, setAttempt] = useState({ key: 0, reason: "" });
  const resetDraft = useCallback((reason) => setAttempt((previous) => ({ key: previous.key + 1, reason })), []);
  return <RegisterOwnerForm key={attempt.key} {...props} onResetDraft={resetDraft} draftResetReason={attempt.reason} />;
}

function RegisterOwnerForm({
  onBack,
  onNavigateToSignIn,
  onNavigateToHome,
  onResetDraft,
  draftResetReason,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const draft = useRegistrationDraft("owner", initialForm, {
    busy: isLoading, onReset: onResetDraft, resetReason: draftResetReason,
  });
  const { form, setForm } = draft;
  const { recovery, trackProgress } = draft;
  const { check: checkEmail, cancel: cancelEmailCheck, isChecking: isCheckingEmail } = useRegistrationEmailCheck();
  const [files, setFiles] = useState(initialFiles);
  const [kyc, setKyc] = useState(initialKyc);
  const [supportingDocType, setSupportingDocType] = useState("");
  const [supportingDocStatus, setSupportingDocStatus] = useState({ submitted: false, message: "" });
  const [savedSupportingDocument, setSavedSupportingDocument] = useState(null);
  const [documentRefreshKey, setDocumentRefreshKey] = useState(0);
  const [idRevision, setIdRevision] = useState("");
  const [supportingRevision, setSupportingRevision] = useState("");
  const documentUploadInFlight = useRef(false);
  const [documentStatuses, setDocumentStatuses] = useState({ id: "not_uploaded", supporting: "not_uploaded" });
  const [supportingResult, setSupportingResult] = useState(null);
  const documentUpload = useRegistrationDocumentUpload(form.businessEmail, "owner", async (docType, revision) => {
    setDocumentStatuses(previous => ({ ...previous, [docType]: "reupload_required" }));
    if (docType === "id") {
      setKyc(previous => ({ ...previous, idRegistered: false, idReadyForSelfie: false, selfieVerified: false,
        selfieDataUrl: "", selfieBase64Clean: "",
        savedDocument: previous.savedDocument && revision ? { ...previous.savedDocument, documentRevision: revision } : previous.savedDocument }));
      setIdRevision("");
      setStepErrors(previous => ({ ...previous, idRegistered: "" }));
      setKycUi(previous => ({ ...previous, statusText: "" }));
    } else {
      setSupportingDocStatus({ submitted: false, message: "" });
      setSupportingRevision("");
      setSupportingResult(null);
      setSavedSupportingDocument(previous => previous && revision ? { ...previous, documentRevision: revision } : previous);
      setErrors(previous => ({ ...previous, supportingDocument: "" }));
    }
    setDocumentRefreshKey(previous => previous + 1);
  }, () => draft.recover());
  const cancelDocument = async (docType, revision) => {
    setIsLoading(true);
    try { await documentUpload.cancel(docType, revision); } finally { setIsLoading(false); }
  };
  const handleDocumentsChange = useCallback((documents) => {
    setSupportingResult(documents.find(document => document.docType === "supporting") || null);
    const nextStatuses = { id: "not_uploaded", supporting: "not_uploaded" };
    documents.forEach((document) => {
      if (document.docType === "id" || document.docType === "supporting") {
        nextStatuses[document.docType] = document.status;
      }
    });
    setDocumentStatuses(nextStatuses);
  }, []);

  const [step, setStep] = useState(1);
  useEffect(() => {
    if (!recovery) return;
    const id = recovery.documents.find(document => document.docType === "id");
    const supporting = recovery.documents.find(document => document.docType === "supporting");
    setSupportingResult(supporting || null);
    setStep(recovery.step);
    setVerificationView(recovery.verificationPhase === "email" ? "email" : "");
    setReviewingId(recovery.verificationPhase === "documents");
    setSupportingDocType(recovery.fields.supportingDocType || "");
    setSavedSupportingDocument(supporting?.available ? supporting : null);
    setSupportingDocStatus({ submitted: Boolean(supporting?.profileMatches && supporting.reasonCode !== "DOCUMENT_CHECK_CANCELLED"), message: supporting?.reason || "" });
    setSupportingRevision(supporting?.documentRevision || "");
    setKyc(previous => ({ ...previous, idType: recovery.fields.idType || "", savedDocument: id?.available ? id : null,
      idRegistered: Boolean(id?.profileMatches && id.reasonCode !== "DOCUMENT_CHECK_CANCELLED"), idReadyForSelfie: id?.identityReadyForSelfie === true,
      selfieVerified: recovery.selfieVerified === true,
      selfieDataUrl: id?.identityReadyForSelfie && previous.selfieDocumentRevision === id.documentRevision ? previous.selfieDataUrl : "",
      selfieBase64Clean: id?.identityReadyForSelfie && previous.selfieDocumentRevision === id.documentRevision ? previous.selfieBase64Clean : "" }));
    setStepErrors(previous => ({ ...previous,
      ...(id?.available && id.profileMatches ? { idRegistered: "" } : {}),
      ...(recovery.selfieVerified ? { selfieVerified: "" } : {}) }));
    setIdRevision(id?.documentRevision || "");
    setDocumentStatuses({ id: id?.status || "not_uploaded", supporting: supporting?.status || "not_uploaded" });
  }, [recovery]);
  const handleVerificationChange = useCallback(verified => {
    setKyc(previous => previous.selfieVerified === verified ? previous : { ...previous, selfieVerified: verified });
  }, []);
  const { formRef, formId, revealError } = useRegistrationNavigation(step);
  const actionsSpaceRef = useRef(null);
  const [errors, setErrors] = useState({});
  const [touchedStep1, setTouchedStep1] = useState({});
  const [stepErrors, setStepErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");
  const submitting = useRef(false);
  const [formError, setFormError] = useState("");
  const [legalModalType, setLegalModalType] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [addressLoadError, setAddressLoadError] = useState("");

  const [kycUi, setKycUi] = useState({ statusText: "" });
  const [reviewingId, setReviewingId] = useState(false);
  const [verificationView, setVerificationView] = useState("");
  const identityHeadingRef = useRef(null);
  const idPreviewUrl = useMemo(
    () => (kyc.idCardFile ? URL.createObjectURL(kyc.idCardFile) : ""),
    [kyc.idCardFile]
  );
  const identityStage = !kyc.idRegistered
    ? "id"
    : ["reupload_required", "rejected"].includes(documentStatuses.id)
      ? "id_blocked"
    : !kyc.idReadyForSelfie
      ? "id_checking"
      : kyc.selfieVerified ? "complete"
      : !kyc.selfieBase64Clean
        ? "camera"
        : !kyc.selfieVerified
          ? "selfie"
          : "complete";
  const supportingComplete = supportingDocStatus.submitted && supportingDocumentCanContinue({ ...supportingResult, status: documentStatuses.supporting });
  const documentsComplete = kyc.idReadyForSelfie && supportingComplete;
  const showingSelfie = draft.emailVerified && documentsComplete && verificationView !== "email" && !reviewingId && ["camera", "selfie", "complete"].includes(identityStage);
  const verificationPhase = !draft.emailVerified || verificationView === "email" ? "email" : showingSelfie ? "face" : "documents";
  useEffect(() => {
    trackProgress(step, { idType: kyc.idType, supportingDocType }, verificationPhase);
  }, [trackProgress, step, kyc.idType, supportingDocType, verificationPhase]);
  useEffect(() => {
    if (step === 4 && !document.querySelector('[aria-label="Confirm cancellation"]')) identityHeadingRef.current?.focus({ preventScroll: true });
  }, [step, showingSelfie]);
  const handleIdStatus = useCallback((status, document) => {
    const ready = document?.identityReadyForSelfie === true;
    if (ready) setStepErrors(previous => ({ ...previous, idRegistered: "" }));
    setKyc((previous) => {
      if (previous.idReadyForSelfie === ready) return previous;
      return {
        ...previous,
        idReadyForSelfie: ready,
        ...(!ready ? { selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "" } : {}),
      };
    });
    if (ready) {
      setKycUi((previous) => ({ ...previous, statusText: "" }));
    } else if (!["queued", "processing", "retry_wait"].includes(status)) {
      setKycUi((previous) => ({ ...previous, statusText: "" }));
    }
    setDocumentStatuses((previous) => ({ ...previous, id: status }));
  }, []);

  const idInputRef = useRef(null);
  const emailRef = useRef(null);
  const lastActionRef = useRef(0);

  const fullName = useMemo(
    () => `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    [form.firstName, form.lastName]
  );
  const canShowBusinessFields = useMemo(() => form.ownerType === "business", [form.ownerType]);

  const canAct = useCallback(() => {
    if (isLoading || draft.cancelling || !draft.ready || ["expired", "conflict", "loading"].includes(draft.status)) return false;
    const now = Date.now();
    if (now - lastActionRef.current < ACTION_COOLDOWN_MS) return false;
    lastActionRef.current = now;
    return true;
  }, [isLoading, draft.cancelling, draft.ready, draft.status]);

  useEffect(() => () => {
    if (idPreviewUrl) URL.revokeObjectURL(idPreviewUrl);
  }, [idPreviewUrl]);

  useEffect(() => {
    let active = true;
    const loadRegions = async () => {
      try {
        setAddressLoadError("");
        const res = await fetch(`${PSGC_BASE_URL}/regions/`);
        if (!res.ok) throw new Error("Failed to load regions.");
        const data = await res.json();
        if (active) setRegions(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setRegions([]);
        setAddressLoadError("Could not load address options. Please refresh and try again.");
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
        const provinceRes = await fetch(`${PSGC_BASE_URL}/regions/${form.region}/provinces/`);
        if (!provinceRes.ok) throw new Error("Failed to load provinces.");
        const provinceData = await provinceRes.json();
        const provinceList = Array.isArray(provinceData) ? provinceData : [];
        if (!active) return;

        setProvinces(provinceList);

        if (provinceList.length === 0) {
          const cityRes = await fetch(`${PSGC_BASE_URL}/regions/${form.region}/cities-municipalities/`);
          if (!cityRes.ok) throw new Error("Failed to load cities.");
          const cityData = await cityRes.json();
          if (!active) return;
          setCities(Array.isArray(cityData) ? cityData : []);
        }
      } catch {
        if (!active) return;
        setProvinces([]);
        setCities([]);
        setBarangays([]);
        setAddressLoadError("Could not load address options. Please refresh and try again.");
      }
    };

    loadProvincesOrCities();
    return () => {
      active = false;
    };
  }, [form.region]);

  useEffect(() => {
    if (!form.province) {
      if (provinces.length > 0) setCities([]);
      setBarangays([]);
      return;
    }

    let active = true;
    const loadCities = async () => {
      try {
        setAddressLoadError("");
        const res = await fetch(`${PSGC_BASE_URL}/provinces/${form.province}/cities-municipalities/`);
        if (!res.ok) throw new Error("Failed to load cities.");
        const data = await res.json();
        if (!active) return;
        setCities(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setCities([]);
        setBarangays([]);
        setAddressLoadError("Could not load address options. Please refresh and try again.");
      }
    };

    loadCities();
    return () => {
      active = false;
    };
  }, [form.province, provinces.length]);

  useEffect(() => {
    if (!form.city) {
      setBarangays([]);
      return;
    }

    let active = true;
    const loadBarangays = async () => {
      try {
        setAddressLoadError("");
        const res = await fetch(`${PSGC_BASE_URL}/cities-municipalities/${form.city}/barangays/`);
        if (!res.ok) throw new Error("Failed to load barangays.");
        const data = await res.json();
        if (!active) return;
        setBarangays(Array.isArray(data) ? data : []);
      } catch {
        if (!active) return;
        setBarangays([]);
        setAddressLoadError("Could not load address options. Please refresh and try again.");
      }
    };

    loadBarangays();
    return () => {
      active = false;
    };
  }, [form.city]);

  const validateStep1Field = useCallback(
    (field, values = form) => {
      const trimmedFirstName = values.firstName.trim();
      const trimmedLastName = values.lastName.trim();

      switch (field) {
        case "firstName":
          if (!trimmedFirstName) return "First name is required.";
          if (!NAME_REGEX.test(trimmedFirstName)) return "First name can only contain letters and spaces between names.";
          if (EMOJI_REGEX.test(values.firstName)) return "No emoji allowed.";
          if (trimmedFirstName.length > 50) return "First name is too long (max 50 characters).";
          return "";
        case "lastName":
          if (!trimmedLastName) return "Last name is required.";
          if (!NAME_REGEX.test(trimmedLastName)) return "Last name can only contain letters and spaces between names.";
          if (EMOJI_REGEX.test(values.lastName)) return "No emoji allowed.";
          if (trimmedLastName.length > 50) return "Last name is too long (max 50 characters).";
          return "";
        case "businessEmail": {
          if (!values.businessEmail.trim()) return "Email is required.";
          if (/\s/.test(values.businessEmail)) return "Email must not contain spaces.";
          if (EMOJI_REGEX.test(values.businessEmail)) return "Email must not contain emoji.";
          if (values.businessEmail.length > 254) return "Email is too long (max 254 characters).";
          if (!EMAIL_REGEX.test(values.businessEmail)) return "Enter a valid email.";
          const domain = values.businessEmail.split("@")[1]?.toLowerCase() || "";
          if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
            return "Please use a valid email address from a supported provider.";
          }
          return "";
        }
        case "phone":
          if (!values.phone.trim()) return "Phone number is required.";
          if (!PH_LOCAL_MOBILE_REGEX.test(values.phone)) {
            return "Phone number must be exactly 10 digits and start with 9.";
          }
          if (values.phone.length > 10) return "Phone number is too long (max 10 digits).";
          return "";
        case "region":
          return values.region ? "" : "Region is required.";
        case "province":
          if (provinces.length > 0 && !values.province) return "Province is required.";
          return "";
        case "city":
          return values.city ? "" : "City / Municipality is required.";
        case "barangay":
          return values.barangay ? "" : "Barangay is required.";
        case "address":
          if (!values.address.trim()) return "Complete your address selection.";
          if (values.address.length > 255) return "Address is too long (max 255 characters).";
          return "";
        case "businessName":
          if (!values.businessName.trim()) return "Business name is required.";
          if (values.businessName.length > 120) return "Business name is too long (max 120 characters).";
          return "";
        case "permitNumber":
          if (!values.permitNumber.trim() && supportingDocType !== "Barangay Business Clearance") return "Enter the number shown on your document.";
          if (values.permitNumber.length > 50) return "Document number is too long (max 50 characters).";
          return "";
        case "taxIdentificationNumber":
          if (!/^\d{9}$/.test(values.taxIdentificationNumber)) return "Enter the 9-digit TIN shown on your BIR document.";
          return "";
        case "branchCode":
          if (!/^\d{3,5}$/.test(values.branchCode)) return "Enter the 3- to 5-digit branch code shown on your BIR document.";
          return "";
        case "password":
          return validateOwnerPassword(values.password);
        case "confirmPassword":
          if (validateOwnerPassword(values.password)) return "";
          if (!values.confirmPassword) return "Please confirm password.";
          if (/\s/.test(values.confirmPassword)) return "Password must not contain spaces.";
          if (values.password !== values.confirmPassword) return "Passwords do not match.";
          return "";
        case "agree":
          return values.agree ? "" : "You must agree to the terms.";
        default:
          return "";
      }
    },
    [form, provinces.length, supportingDocType]
  );

  useEffect(() => {
    const regionName = regions.find((entry) => entry.code === form.region)?.name || "";
    const provinceName = provinces.find((entry) => entry.code === form.province)?.name || "";
    const cityName = cities.find((entry) => entry.code === form.city)?.name || "";
    const barangayName = barangays.find((entry) => entry.code === form.barangay)?.name || "";
    const composedAddress = [barangayName, cityName, provinceName, regionName].filter(Boolean).join(", ");

    const nextForm = { ...form, address: composedAddress };
    setForm((prev) => (prev.address === composedAddress ? prev : { ...prev, address: composedAddress }));
    if (step === 2 && touchedStep1.address) {
      setErrors((prev) => ({ ...prev, address: validateStep1Field("address", nextForm) }));
    }
  }, [
    form,
    step,
    touchedStep1.address,
    regions,
    provinces,
    cities,
    barangays,
    validateStep1Field,
    setForm,
  ]);

  const handleStep1Blur = useCallback(
    (field, values = form) => {
      if (![1, 2, 3, 5].includes(step)) return;
      if (!touchedStep1[field]) return;
      setErrors((prev) => {
        const next = { ...prev, [field]: validateStep1Field(field, values) };
        if (field === "password" && (touchedStep1.confirmPassword || values.confirmPassword)) {
          next.confirmPassword = validateStep1Field("confirmPassword", values);
        }
        return next;
      });
    },
    [form, step, touchedStep1, validateStep1Field]
  );

  const handleChange = useCallback(
    (e) => {
      const { name, value, type, checked } = e.target;
      if (name === "businessEmail") cancelEmailCheck();
      const normalizedPhone = name === "phone" ? normalizePhMobileInput(value) : value;
      const nextValue =
        name === "businessEmail"
          ? value.toLowerCase().trim()
          : type === "checkbox"
            ? checked
            : normalizedPhone;
      setForm(previous => ({ ...previous, [name]: nextValue }));
      setFormError("");
      if ([1, 2, 3, 5].includes(step)) {
        setTouchedStep1((prev) => ({ ...prev, [name]: true }));
      }
      setErrors((prev) => ({ ...prev, [name]: "" }));
      if (name === "password") {
        setErrors((prev) => ({ ...prev, confirmPassword: "" }));
      }
      if (["businessName", "permitNumber", "taxIdentificationNumber", "branchCode"].includes(name)) {
        setSupportingDocStatus({ submitted: false, message: "" });
        setDocumentStatuses((previous) => ({ ...previous, supporting: "not_uploaded" }));
        setErrors((prev) => ({ ...prev, supportingDocument: "" }));
      }
      if (["firstName", "lastName"].includes(name)) {
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
    },
    [step, setForm, cancelEmailCheck]
  );

  const handleRegionChange = useCallback((e) => {
    const region = e.target.value;
    const nextForm = {
      ...form,
      region,
      province: "",
      city: "",
      barangay: "",
      address: "",
    };
    setForm(nextForm);
    setTouchedStep1((prev) => ({
      ...prev,
      region: true,
      province: false,
      city: false,
      barangay: false,
      address: false,
    }));
    setErrors((prev) => ({
      ...prev,
      region: "",
      province: "",
      city: "",
      barangay: "",
      address: "",
    }));
  }, [form, setForm]);

  const handleProvinceChange = useCallback((e) => {
    const province = e.target.value;
    const nextForm = {
      ...form,
      province,
      city: "",
      barangay: "",
      address: "",
    };
    setForm(nextForm);
    setTouchedStep1((prev) => ({
      ...prev,
      province: true,
      city: false,
      barangay: false,
      address: false,
    }));
    setErrors((prev) => ({
      ...prev,
      province: "",
      city: "",
      barangay: "",
      address: "",
    }));
  }, [form, setForm]);

  const handleCityChange = useCallback((e) => {
    const city = e.target.value;
    const nextForm = {
      ...form,
      city,
      barangay: "",
      address: "",
    };
    setForm(nextForm);
    setTouchedStep1((prev) => ({
      ...prev,
      city: true,
      barangay: false,
      address: false,
    }));
    setErrors((prev) => ({
      ...prev,
      city: "",
      barangay: "",
      address: "",
    }));
  }, [form, setForm]);

  const handleBarangayChange = useCallback((e) => {
    const barangay = e.target.value;
    const nextForm = {
      ...form,
      barangay,
      address: "",
    };
    setForm(nextForm);
    setTouchedStep1((prev) => ({
      ...prev,
      barangay: true,
      address: false,
    }));
    setErrors((prev) => ({
      ...prev,
      barangay: "",
      address: "",
    }));
  }, [form, setForm]);

  const handleOwnerTypeSelect = useCallback(
    (type) => {
      const nextForm = {
        ...form,
        ownerType: type,
      };
      setForm(nextForm);
      setErrors((prev) => ({
        ...prev,
        businessName: "",
        permitNumber: "",
        taxIdentificationNumber: "",
        branchCode: "",
        supportingDocument: "",
      }));
      setSupportingDocStatus({ submitted: false, message: "" });
      setDocumentStatuses((previous) => ({ ...previous, supporting: "not_uploaded" }));
    },
    [form, setForm]
  );

  const selectSupportingFile = useCallback(async (file) => {
    if (file) {
      try {
        await validateSupportingDocumentFile(file);
      } catch (validationError) {
        setErrors((prev) => ({ ...prev, supportingDocument: validationError.message || "Please choose a valid document." }));
        return false;
      }
    }
    setFiles((prev) => ({ ...prev, supportingDocument: file }));
    setErrors((prev) => ({ ...prev, supportingDocument: "" }));
    setSavedSupportingDocument(null);
    setSupportingDocStatus({ submitted: false, message: "" });
    setDocumentStatuses((previous) => ({ ...previous, supporting: "not_uploaded" }));
    return true;
  }, []);

  const handleFile = useCallback(async (event) => {
    const target = event.target;
    const file = target.files?.[0];
    if (file && !await selectSupportingFile(file)) target.value = "";
  }, [selectSupportingFile]);

  const selectIdFile = useCallback(async (file) => {
    try {
      await validateDocumentImageFile(file);
    } catch (validationError) {
      setStepErrors((prev) => ({ ...prev, idCardFile: validationError.message || "Please choose a valid ID image." }));
      return false;
    }
    setKyc((prev) => ({ ...prev, savedDocument: null, idCardFile: file, idRegistered: false, idReadyForSelfie: false, selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "" }));
    setDocumentStatuses((previous) => ({ ...previous, id: "not_uploaded" }));
    setIdRevision("");
    setKycUi((prev) => ({ ...prev, statusText: "" }));
    setStepErrors({});
    return true;
  }, []);

  const handleSupportingDocTypeChange = useCallback((e) => {
    const value = String(e?.target?.value || "");
    setSupportingDocType(value);
    setSupportingDocStatus({ submitted: false, message: "" });
    setDocumentStatuses((previous) => ({ ...previous, supporting: "not_uploaded" }));
    setForm((previous) => ({ ...previous, permitNumber: "", taxIdentificationNumber: "", branchCode: "" }));
    setErrors((prev) => ({ ...prev, supportingDocType: "", supportingDocument: "", permitNumber: "", taxIdentificationNumber: "", branchCode: "" }));
  }, [setForm]);

  const handleIdTypeChange = useCallback((e) => {
    const value = String(e?.target?.value || "");
    setDocumentStatuses((previous) => ({ ...previous, id: "not_uploaded" }));
    setIdRevision("");
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
  }, []);

  const validateFields = useCallback((fields) => {
    const next = {};
    for (const field of fields) {
      const message = validateStep1Field(field, form);
      if (message) next[field] = message;
    }
    setTouchedStep1((previous) => ({
      ...previous,
      ...Object.fromEntries(fields.map((field) => [field, true])),
    }));
    setErrors((prev) => {
      const merged = { ...prev };
      for (const field of fields) {
        if (next[field]) merged[field] = next[field];
        else delete merged[field];
      }
      return merged;
    });
    return Object.keys(next).length === 0;
  }, [form, validateStep1Field]);

  const validateAccountStep = useCallback(
    (requirePassword = true) => validateFields(["firstName", "lastName", "businessEmail", "phone", ...(requirePassword ? ["password", "confirmPassword"] : [])]),
    [validateFields]
  );
  const validateAddressStep = useCallback(
    () => validateFields(["region", "province", "city", "barangay", "address"]),
    [validateFields]
  );
  const validateReviewStep = useCallback(() => validateFields(["agree"]), [validateFields]);

  const validateSupportingDocumentStep = useCallback((requireUpload = true) => {
    const next = {};
    const detailFields = ["businessName"];
    if (supportingDocType) {
      detailFields.push(...(BIR_DOCUMENT_TYPES.has(supportingDocType)
        ? ["taxIdentificationNumber", "branchCode"] : ["permitNumber"]));
    }
    const detailsValid = validateFields(detailFields);
    if (!supportingDocType) next.supportingDocType = "Please select a document type.";
    if (requireUpload && !files.supportingDocument && !savedSupportingDocument) next.supportingDocument = "Please upload a supporting document.";
    setErrors((prev) => ({
      ...prev,
      supportingDocType: next.supportingDocType || "",
      supportingDocument: next.supportingDocument || "",
    }));
    return detailsValid && Object.keys(next).length === 0;
  }, [files.supportingDocument, savedSupportingDocument, supportingDocType, validateFields]);

  const verifySupportingDoc = async () => {
    if (documentUploadInFlight.current) return false;
    if (supportingDocStatus.submitted) return true;
    if (!supportingDocType) {
      setErrors((prev) => ({ ...prev, supportingDocType: "Please select a document type." }));
      return false;
    }
    if (!files.supportingDocument && !savedSupportingDocument) {
      setErrors((prev) => ({ ...prev, supportingDocument: "Please upload a supporting document." }));
      return false;
    }
    if (!form.businessEmail) {
      setErrors((prev) => ({ ...prev, supportingDocument: "Please enter your email first." }));
      return false;
    }
    documentUploadInFlight.current = true;
    setIsLoading(true);
    setSuccessMessage("");
    setFormError("");
    const attempt = documentUpload.begin("supporting");
    try {
      if (!await draft.flush({ force: true })) throw new Error("Save your progress before uploading. Retry saving and then continue.");
      if (files.supportingDocument) await validateSupportingDocumentFile(files.supportingDocument);
      if (documentUpload.wasCancelled(attempt)) return false;
      const uploadOptions = await documentUpload.prepare(attempt);
      const dataUrl = files.supportingDocument ? await fileToBase64(files.supportingDocument) : "";
      const clean = stripDataUrlPrefix(dataUrl);
      const mime = getMimeFromDataUrl(dataUrl);
      const result = await preVerifySupportingDocument(form.businessEmail, clean, mime, "owner", {
        ...uploadOptions,
        documentType: supportingDocType,
        documentRevision: savedSupportingDocument?.documentRevision || "",
        userProfile: {
          full_name: fullName,
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          business_name: form.businessName,
          permit_number: form.permitNumber,
          tax_identification_number: form.taxIdentificationNumber,
          branch_code: form.branchCode,
        },
      });
      if (documentUpload.wasCancelled(attempt)) return false;
      if (!result.success) throw new Error(result.message || "Supporting document verification failed.");

      setSupportingDocStatus({
        submitted: true,
        message:
          result.message ||
          "Supporting document uploaded securely. Automated checks have started.",
      });
      setDocumentStatuses((previous) => ({ ...previous, supporting: result.documentStatus || "queued" }));
      setSupportingRevision(result.documentRevision || "");
      setDocumentRefreshKey((previous) => previous + 1);
      setErrors((prev) => ({ ...prev, supportingDocType: "", supportingDocument: "" }));
      return true;
    } catch (error) {
      if (documentUpload.wasCancelled(attempt)) return false;
      setSupportingDocStatus({ submitted: false, message: "" });
      void draft.recover();
      setErrors((prev) => ({
        ...prev,
        supportingDocument: error?.message || "Supporting document verification failed.",
      }));
      return false;
    } finally {
      await documentUpload.finish(attempt);
      documentUploadInFlight.current = false;
      setIsLoading(false);
    }
  };

  const validateIdentityStep = useCallback(() => {
    const next = {};
    if (!draft.emailVerified) next.emailVerified = "Verify your email before continuing.";
    if (!supportingComplete) next.supportingDocument = "Wait for your business document checks to finish before continuing.";
    if (!kyc.idType) next.idType = "Please select your ID type.";
    if (!kyc.idCardFile && !kyc.savedDocument) next.idCardFile = "Please upload your government ID.";
    if (!kyc.idRegistered) next.idRegistered = "Please upload your ID first.";
    else if (!kyc.idReadyForSelfie) next.idRegistered = "Wait for your ID details to match before taking your selfie.";
    else if (!kyc.selfieVerified) next.selfieVerified = "Please verify your selfie matches the ID.";
    setStepErrors(next);
    return Object.keys(next).length === 0;
  }, [kyc, draft.emailVerified, supportingComplete]);

  const goNext = async () => {
    if (!canAct()) return;
    setSuccessMessage("");
    if (step === 1) {
      if (!validateAccountStep(!draft.recovery)) { revealError(); return; }
      setFormError("");
      setIsLoading(true);
      try {
        const result = await checkEmail(form.businessEmail);
        if (!result) return;
        if (result.available) {
          setStep(2);
        } else if (result.fieldError) {
          setErrors((previous) => ({ ...previous, businessEmail: result.message }));
          setTimeout(() => emailRef.current?.focus(), 0);
        } else {
          setFormError(result.message);
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }
    if (step === 2 && !validateAddressStep()) { revealError(); return; }
    if (step === 3) {
      if (!validateSupportingDocumentStep(false)) { revealError(); return; }
    }
    if (step === 4 && verificationPhase === "email") {
      if (!draft.emailVerified) { setStepErrors({ emailVerified: "Verify your email before continuing." }); return; }
      setVerificationView(""); setStepErrors({}); return;
    }
    if (step === 4 && reviewingId && documentsComplete) {
      setReviewingId(false);
      setStepErrors({});
      return;
    }
    if (step === 4 && !validateIdentityStep()) { revealError(); return; }
    setStep((prev) => Math.min(TOTAL_STEPS, prev + 1));
  };

  const goBack = () => {
    if (!canAct()) return;
    if (step === 1) return;
    setSuccessMessage("");
    setStepErrors({});
    setErrors({});
    if (step === 4 && verificationPhase === "face") {
      setReviewingId(true);
      return;
    }
    if (step === 4 && verificationPhase === "documents") { setVerificationView("email"); return; }
    setVerificationView(""); setReviewingId(false);
    setStep((prev) => Math.max(1, prev - 1));
  };

  const registerId = async () => {
    if (!canAct()) return;
    if (!kyc.idType) {
      setStepErrors((prev) => ({ ...prev, idType: "Select your ID type first." }));
      return;
    }
    if (!kyc.idCardFile && !kyc.savedDocument) {
      setStepErrors((prev) => ({ ...prev, idCardFile: "Upload your ID image first." }));
      return;
    }

    setIsLoading(true);
    setReviewingId(false);
    setStepErrors(previous => ({ ...previous, idRegistered: "" }));
    setKycUi((prev) => ({ ...prev, statusText: "Uploading ID securely..." }));

    let uploadStarted = false;
    const attempt = documentUpload.begin("id");
    try {
      if (!await draft.flush({ force: true })) throw new Error("Save your progress before uploading. Retry saving and then continue.");
      if (kyc.idCardFile) await validateDocumentImageFile(kyc.idCardFile);
      if (documentUpload.wasCancelled(attempt)) return;
      const uploadOptions = await documentUpload.prepare(attempt);
      const dataUrl = kyc.idCardFile ? await fileToBase64(kyc.idCardFile) : "";
      const clean = stripDataUrlPrefix(dataUrl);
      const mime = getMimeFromDataUrl(dataUrl);
      uploadStarted = true;
      const result = await preRegisterIdFace(form.businessEmail, fullName, "owner", clean, mime, {
        ...uploadOptions,
        idType: kyc.idType,
        documentRevision: kyc.savedDocument?.documentRevision || "",
        userProfile: {
          full_name: fullName,
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
        },
      });
      if (documentUpload.wasCancelled(attempt)) return;
      if (!result.success) throw new Error(result.message || "Failed to register ID.");

      setKyc((prev) => ({
        ...prev,
        idRegistered: true,
        idReadyForSelfie: false,
        selfieVerified: false,
        selfieDataUrl: "",
        selfieBase64Clean: "",
      }));
      setDocumentStatuses((previous) => ({ ...previous, id: result.documentStatus || "queued" }));
      setIdRevision(result.documentRevision || "");
      setDocumentRefreshKey((previous) => previous + 1);
      setStepErrors((prev) => ({ ...prev, idType: "", idRegistered: "" }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    } catch (error) {
      if (documentUpload.wasCancelled(attempt)) return;
      const recovered = uploadStarted ? await draft.recover() : null;
      const savedId = recovered?.documents.find(document => document.docType === "id" && document.available && document.profileMatches);
      setStepErrors((prev) => ({ ...prev, idRegistered: savedId ? "" : friendlyError(error.message) }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    } finally {
      await documentUpload.finish(attempt);
      setIsLoading(false);
    }
  };

  const handleSelfieCapture = ({ dataUrl, base64 }) => {
    setKyc((previous) => ({
      ...previous,
      selfieVerified: false,
      selfieDataUrl: dataUrl,
      selfieBase64Clean: base64,
      selfieDocumentRevision: idRevision,
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

  const verifySelfie = async () => {
    if (!canAct()) return;
    if (!kyc.selfieBase64Clean) {
      setStepErrors((prev) => ({ ...prev, selfieVerified: "Capture a selfie first." }));
      return;
    }

    setIsLoading(true);
    setStepErrors(previous => ({ ...previous, selfieVerified: "" }));
    setKycUi((prev) => ({ ...prev, statusText: "Verifying face match..." }));

    try {
      if (!await draft.flush()) throw new Error("Save your progress before verification. Retry saving and then continue.");
      const result = await preSelfieVerify(form.businessEmail, kyc.selfieBase64Clean, "owner");
      if (!result.verified) throw Object.assign(new Error(result.message || "Face does not match ID."), { verified: false });
      setKyc((prev) => ({ ...prev, selfieVerified: true }));
      setStepErrors((prev) => ({ ...prev, selfieVerified: "" }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    } catch (error) {
      const recovered = [401, 403, 409].includes(error.status) || (error.verified !== false && (!error.status || error.status >= 500))
        ? await draft.recover() : null;
      setKyc((prev) => ({ ...prev, selfieVerified: recovered?.selfieVerified === true }));
      setStepErrors((prev) => ({ ...prev, selfieVerified: recovered?.selfieVerified ? "" : friendlyError(error.message) }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting.current || draft.completed || draft.registrationComplete || isLoading || !canAct()) return;
    if (!validateAccountStep()) {
      setStep(1);
      return;
    }
    if (!validateAddressStep()) {
      setStep(2);
      return;
    }
    if (!validateSupportingDocumentStep()) {
      setStep(3);
      return;
    }
    if (!validateIdentityStep()) {
      setStep(4);
      return;
    }
    if (!validateReviewStep()) return;

    submitting.current = true;
    setIsLoading(true);
    setSuccessMessage("");
    setFormError("");

    try {
      if (!await draft.flush()) throw new Error("Save your progress before submitting. Retry saving and then continue.");
      const preKycToken = await getPreKycSessionToken(form.businessEmail, "owner");
      const response = await API.register({
        name: fullName,
        email: form.businessEmail,
        password: form.password,
        role: "owner",
        phone: form.phone,
        address: form.address,
        region: form.region,
        province: form.province,
        city: form.city,
        barangay: form.barangay,
        ownerType: form.ownerType,
        businessName: form.businessName,
        permitNumber: form.permitNumber,
        taxIdentificationNumber: form.taxIdentificationNumber,
        branchCode: form.branchCode,
        preKycToken,
      });
      if (response?.success !== true || !response.user?._id || response.user.isVerified !== true || response.user.role !== "owner"
        || String(response.user.email || "").trim().toLowerCase() !== form.businessEmail.trim().toLowerCase()) {
        throw new Error("Account creation was not confirmed. Recover your saved progress and try again.");
      }
      draft.complete(response.user.kycStatus);
      setSuccessMessage(response?.message || "Account created. Sign in to continue.");
    } catch (error) {
      const lower = (error?.message || "").toLowerCase();
      if (!error.status || error.status >= 500) void draft.recover();
      const raw = error?.message || "";
      const serverErrors = error?.details?.errors;
      if (serverErrors && typeof serverErrors === "object") {
        const fieldErrors = { ...serverErrors };
        if (fieldErrors.email) {
          fieldErrors.businessEmail = fieldErrors.email;
          delete fieldErrors.email;
        }
        if (fieldErrors.name) {
          fieldErrors.firstName = fieldErrors.name;
          delete fieldErrors.name;
        }
        setErrors(fieldErrors);
        setFormError("");
        setStep(1);
        return;
      }
      const phoneConflict = lower.includes("phone") && lower.includes("already");
      const msg = lower.includes("already")
        ? phoneConflict
          ? "This phone number is already registered."
          : "This email is already registered."
        : lower.includes("too many")
        ? raw
        : /^[A-Z]/.test(raw) && !/request failed/i.test(raw)
        ? raw
        : "Registration failed. Please try again.";
      if (lower.includes("password")) {
        setErrors({ password: msg });
        setFormError("");
        setStep(1);
      } else if (phoneConflict) {
        setErrors({ phone: msg });
        setFormError("");
        setStep(1);
      } else if (lower.includes("email") && (lower.includes("already") || lower.includes("invalid"))) {
        setErrors({ businessEmail: msg });
        setFormError("");
        setStep(1);
      } else {
        setErrors({});
        setFormError(msg);
      }
    } finally {
      submitting.current = false;
      setIsLoading(false);
    }
  };

  const supportingDocumentUpload = <>
              <FileInput
                label="Supporting Business Document"
                helper="Upload the selected Philippines-issued document showing the business details you entered."
                name="supportingDocument"
                onChange={handleFile}
                error={errors.supportingDocument}
                file={files.supportingDocument}
                disabled={isLoading}
                onCapture={selectSupportingFile}
              />
              {savedSupportingDocument && !files.supportingDocument && <p className="text-sm text-slate-700">Your business document is saved privately. Choose a file to replace it.</p>}
              <RegistrationDocumentActions upload={documentUpload} docType="supporting" revision={supportingRevision} status={documentStatuses.supporting} busy={isLoading} onCancel={cancelDocument}>
              <button type="button" onClick={verifySupportingDoc} disabled={isLoading || supportingDocStatus.submitted || !supportingDocType || (!files.supportingDocument && !savedSupportingDocument)}
                className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-50">
                {documentUpload.active?.docType === "supporting" && documentUpload.active.phase === "uploading" ? <><Loader size={16} className="animate-spin" aria-hidden="true" /> Uploading document...</>
                  : ["queued", "processing"].includes(documentStatuses.supporting) ? <><Loader size={16} className="animate-spin" aria-hidden="true" /> Checking document...</>
                  : supportingDocStatus.submitted ? "Document uploaded" : "Upload and check document"}
              </button>
              </RegistrationDocumentActions>
  </>;

  const documentReviewNotice = <PreKycReviewNotice
    key={`${idRevision}:${supportingRevision}:${kyc.idRegistered}:${supportingDocStatus.submitted}`}
    email={form.businessEmail}
    role="owner"
    enabled={kyc.idRegistered || supportingDocStatus.submitted}
    refreshKey={documentRefreshKey}
    ignoreSupportingDocument={!supportingDocStatus.submitted}
    ignoreIdDocument={!kyc.idRegistered}
    idRevision={idRevision}
    supportingRevision={supportingRevision}
    onDocumentsChange={handleDocumentsChange}
    onIdStatus={handleIdStatus}
    onVerificationChange={handleVerificationChange}
    selfieComplete={kyc.selfieVerified}
    onCorrectDetails={(type) => {
      if (type === "id") { setStep(1); return; }
      setSupportingDocStatus({ submitted: false, message: "" });
      setDocumentStatuses((current) => ({ ...current, supporting: "not_uploaded" }));
      setStep(3);
    }}
    onResubmit={(type) => {
      if (type === "supporting") {
        setSupportingDocStatus({ submitted: false, message: "" });
        setFiles((current) => ({ ...current, supportingDocument: null }));
        setDocumentStatuses((current) => ({ ...current, supporting: "not_uploaded" }));
        setStep(3);
      } else {
        setKyc(initialKyc);
        setKycUi({ statusText: "" });
        setDocumentStatuses((current) => ({ ...current, id: "not_uploaded" }));
        setStepErrors({});
        setStep(4);
      }
    }}
  />;

  return (
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      badge="Guided account onboarding"
      panelTitle="Create your RentifyPro account."
      panelDescription="Complete your owner details, document checks, and email confirmation in focused steps."
      highlights={[
        "Clear 5-step onboarding with progress tracking",
        "Supporting document, ID, and face verification",
        "Ready after successful OTP verification",
      ]}
      contentMaxWidth="max-w-4xl"
      contentContainerClassName="items-start py-2 sm:py-4"
    >
      <div {...draft.activityProps} className="rp-surface rp-glass rp-registration-card min-w-0 rounded-3xl border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
        <div className="rp-registration-header mt-5 text-center">
          <span className="rp-chip bg-blue-50 text-blue-700 ring-1 ring-blue-100">Register</span>
          <h2 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-4xl">Create your account</h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">Fast, secure onboarding in {TOTAL_STEPS} guided steps.</p>
        </div>

        <div className="mt-6">
          <RegistrationProgress currentStep={step} steps={STEP_LABELS} />
          {(step === 3 || step === 4) && <HelpLink guide="owner-verification" className="mt-3">Need help with verification?</HelpLink>}
        </div>

        {step === 1 && (
          <section aria-labelledby="owner-preparation-title" className="rp-registration-preparation mt-5 border-t border-slate-200 pt-4">
            <h3 id="owner-preparation-title" className="hidden text-sm font-bold text-slate-900 lg:block">What you’ll need</h3>
            <ResponsiveDisclosure label="What you’ll need">
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                <li>A readable Philippines-issued business document.</li>
                <li>A government ID and a camera for a live selfie.</li>
                <li>Access to your registration email.</li>
              </ul>
            </ResponsiveDisclosure>
          </section>
        )}

        <RegistrationDraftNotice draft={draft} busy={isLoading} onNavigateToSignIn={onNavigateToSignIn} onNavigateToHome={onNavigateToHome} />

        {successMessage && !draft.completed && !draft.registrationComplete && (
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 flex items-center gap-2">
            <CircleCheck size={18} strokeWidth={2} aria-hidden="true" /> {successMessage}
          </div>
        )}

        <form onSubmit={(event) => {
          event.preventDefault();
          if (step < TOTAL_STEPS) void goNext();
          else void handleSubmit(event);
        }} id={formId} ref={formRef} hidden={draft.completed || draft.registrationComplete} tabIndex={-1} aria-label={`Registration step ${step} of ${TOTAL_STEPS}`} className="rp-registration-form space-y-4" noValidate>
          {isCheckingEmail && <p role="status" className="sr-only">Checking email availability.</p>}
          {formError && (
            <div
              role="alert"
              className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            >
              {formError}
            </div>
          )}

          <fieldset disabled={(isLoading && !documentUpload.active) || draft.cancelling || draft.completed || draft.registrationComplete || !draft.ready || ["expired", "conflict", "loading"].includes(draft.status)} className="min-w-0 space-y-4">
          {[1, 2].includes(step) && (
            <>
              <div className="rp-registration-step-intro rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900 mb-1">Step {step} — {STEP_LABELS[step - 1]}</p>
                <p className="text-sm text-gray-500">
                  {step === 1 && "Enter your legal name, contact details, and password."}
                  {step === 2 && "Select the address tied to your owner registration."}
                </p>
              </div>

              {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="First Name"
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  onBlur={() => handleStep1Blur("firstName")}
                  error={errors.firstName}
                  disabled={isLoading}
                  onlyLetters
                  icon={User}
                  placeholder="Juan"
                  helper="Use your legal first name as shown on your government ID."
                  maxLength={50}
                />
                <Field
                  label="Last Name"
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  onBlur={() => handleStep1Blur("lastName")}
                  error={errors.lastName}
                  disabled={isLoading}
                  onlyLetters
                  icon={User}
                  placeholder="Dela Cruz"
                  helper="Use your legal last name for matching during verification."
                  maxLength={50}
                />
              </div>
              )}

              {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Enter Email"
                  type="email"
                  name="businessEmail"
                  inputRef={emailRef}
                  value={form.businessEmail}
                  onChange={handleChange}
                  onBlur={() => handleStep1Blur("businessEmail")}
                  error={errors.businessEmail}
                  disabled={isLoading}
                  icon={Mail}
                  placeholder="Enter Email"
                  helper="Enter Email"
                  maxLength={254}
                />
                <Field
                  label="Phone Number"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  onBlur={() => handleStep1Blur("phone")}
                  error={errors.phone}
                  disabled={isLoading}
                  onlyNumbers
                  icon={Phone}
                  placeholder="9XXXXXXXXX"
                  helper="Enter your 10-digit mobile number."
                  maxLength={10}
                  prefixText="+63"
                />
              </div>
              )}

              {step === 2 && (
              <div className="rounded-2xl border border-gray-200 p-4 bg-white space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <MapPin size={18} className="text-[#017FE6]" />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Business Address</p>
                    <p className="text-sm text-gray-500 mt-1">
                      Select your address from dropdown options. No manual typing required.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectField
                    label="Region"
                    name="region"
                    value={form.region}
                    onChange={handleRegionChange}
                    onBlur={() => handleStep1Blur("region", form)}
                    options={regions.map((region) => ({ value: region.code, label: region.name }))}
                    error={errors.region}
                    disabled={isLoading}
                    helper="Start by selecting your region."
                    placeholder="Select region"
                  />
                  <SelectField
                    label={provinces.length > 0 ? "Province" : "Province (N/A for this region)"}
                    name="province"
                    value={form.province}
                    onChange={handleProvinceChange}
                    onBlur={() => handleStep1Blur("province", form)}
                    options={provinces.map((province) => ({ value: province.code, label: province.name }))}
                    error={errors.province}
                    disabled={isLoading || !form.region || provinces.length === 0}
                    required={provinces.length > 0}
                    helper={provinces.length > 0 ? "Select the province tied to your selected region." : "This region does not use province selection."}
                    placeholder={provinces.length > 0 ? "Select province" : "Province not required for this region"}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectField
                    label="City / Municipality"
                    name="city"
                    value={form.city}
                    onChange={handleCityChange}
                    onBlur={() => handleStep1Blur("city", form)}
                    options={cities.map((city) => ({ value: city.code, label: city.name }))}
                    error={errors.city}
                    disabled={isLoading || !form.region || (provinces.length > 0 && !form.province)}
                    helper="Select your city or municipality."
                    placeholder="Select city / municipality"
                  />
                  <SelectField
                    label="Barangay"
                    name="barangay"
                    value={form.barangay}
                    onChange={handleBarangayChange}
                    onBlur={() => handleStep1Blur("barangay", form)}
                    options={barangays.map((barangay) => ({ value: barangay.code, label: barangay.name }))}
                    error={errors.barangay}
                    disabled={isLoading || !form.city}
                    helper="Pick the barangay to complete your address."
                    placeholder="Select barangay"
                  />
                </div>

                <div className={`rounded-xl border px-4 py-3 text-sm ${errors.address ? "border-red-300 bg-red-50/40 text-red-600" : "border-gray-200 bg-gray-50 text-gray-700"}`}>
                  {form.address || "Selected address will appear here after choosing region, city, and barangay."}
                </div>
                {errors.address && <p className="text-xs text-red-500">{errors.address}</p>}
                {addressLoadError && <p className="text-xs text-red-500">{addressLoadError}</p>}
              </div>
              )}

              {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PasswordField
                  label="Create Password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  onBlur={() => handleStep1Blur("password")}
                  error={errors.password}
                  disabled={isLoading}
                  show={showPw}
                  toggle={() => setShowPw((prev) => !prev)}
                  helper="Create Password"
                  placeholder="Create Password"
                  maxLength={128}
                  showStrength
                />
                <PasswordField
                  label="Confirm Password"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  onBlur={() => handleStep1Blur("confirmPassword")}
                  error={errors.confirmPassword}
                  disabled={isLoading}
                  show={showCpw}
                  toggle={() => setShowCpw((prev) => !prev)}
                  helper="Confirm Password"
                  placeholder="Confirm Password"
                  maxLength={128}
                />
              </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><FileText size={20} className="text-[#017FE6]" /></div>
                  <div>
                    <p className="font-semibold text-gray-900">Step 3 — Business details</p>
                    <p className="text-sm text-gray-500 mt-1">Enter the details visible on your business document. You will upload it after email verification.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900 mb-2">Owner Type</p>
                <p className="text-sm text-gray-500 mb-3">Choose if you are registering as an individual or business owner.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { type: "individual", label: "Individual", sub: "Personal lessor" },
                    { type: "business", label: "Business", sub: "Company lessor" },
                  ].map(({ type, label, sub }) => (
                    <button key={type} type="button" onClick={() => handleOwnerTypeSelect(type)} className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${form.ownerType === type ? "border-[#017FE6] bg-blue-50" : "border-gray-200 hover:border-[#017FE6]"}`}>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-gray-800">{label}</p>
                        <p className="text-xs text-gray-500">{sub}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <SelectField
                label="Supporting Document Type"
                name="supportingDocType"
                value={supportingDocType}
                onChange={handleSupportingDocTypeChange}
                options={SUPPORTING_DOCUMENT_TYPES.map((entry) => ({ value: entry, label: entry }))}
                error={errors.supportingDocType}
                disabled={isLoading}
                required
                placeholder="Select the document type you uploaded"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label={form.ownerType === "individual" ? "Business / Trade Name" : "Business Name"}
                  name="businessName"
                  alignRows
                  value={form.businessName}
                  onChange={handleChange}
                  onBlur={() => handleStep1Blur("businessName")}
                  error={errors.businessName}
                  disabled={isLoading}
                  icon={Building2}
                  placeholder="Name shown on your document"
                  helper="Use the business or trade name shown in your supporting document."
                  maxLength={120}
                />
                {BIR_DOCUMENT_TYPES.has(supportingDocType) ? (
                  <>
                    <Field
                      label="Taxpayer Identification Number (TIN)"
                      name="taxIdentificationNumber"
                      alignRows
                      value={form.taxIdentificationNumber}
                      onChange={handleChange}
                      onBlur={() => handleStep1Blur("taxIdentificationNumber")}
                      error={errors.taxIdentificationNumber}
                      disabled={isLoading}
                      icon={FileText}
                      placeholder="9 digits"
                      helper="Enter the 9-digit TIN on this BIR document."
                      maxLength={9}
                      onlyNumbers
                    />
                    <Field
                      label="Branch Code"
                      name="branchCode"
                      horizontal
                      value={form.branchCode}
                      onChange={handleChange}
                      onBlur={() => handleStep1Blur("branchCode")}
                      error={errors.branchCode}
                      disabled={isLoading}
                      icon={FileText}
                      placeholder="As shown on your document"
                      helper="Enter the branch code next to the TIN."
                      maxLength={5}
                      onlyNumbers
                    />
                  </>
                ) : supportingDocType ? (
                  <Field
                    label={DOCUMENT_NUMBER_LABELS[supportingDocType] || "Document number"}
                    name="permitNumber"
                    alignRows
                    value={form.permitNumber}
                    onChange={handleChange}
                    onBlur={() => handleStep1Blur("permitNumber")}
                    error={errors.permitNumber}
                    disabled={isLoading}
                    icon={FileText}
                    placeholder="Number shown on your document"
                    helper={supportingDocType === "Barangay Business Clearance"
                      ? "Leave blank if your clearance has no reference number; it will need manual review."
                      : "Copy the number exactly as shown on your document."}
                    maxLength={50}
                    required={supportingDocType !== "Barangay Business Clearance"}
                  />
                ) : null}
              </div>


            </>
          )}

          {step === 4 && (
            <>
              {verificationPhase === "email" ? <RegistrationEmailVerification email={form.businessEmail} draft={draft} disabled={isLoading} onVerified={() => setVerificationView("")} /> : <>
              <div data-identity-view={showingSelfie ? "selfie" : "id"} className="rounded-2xl border border-gray-200 p-4 bg-white">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><ShieldCheck size={20} className="text-[#017FE6]" /></div>
                  <div>
                    <h2 ref={identityHeadingRef} tabIndex={-1} className="font-semibold text-gray-900">
                      Step 4 — {showingSelfie ? "Face Recognition" : "ID Verification"}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">{showingSelfie
                      ? "Your ID check passed. Capture a live selfie to match your ID photo."
                      : "Upload your government ID to check its type and registration details."}</p>
                  </div>
                </div>
              </div>

              {!showingSelfie && <>
              {supportingDocumentUpload}
              <SelectField
                label="ID Type"
                name="idType"
                value={kyc.idType}
                onChange={handleIdTypeChange}
                options={ID_DOCUMENT_TYPES.map((entry) => ({ value: entry, label: entry }))}
                error={stepErrors.idType}
                disabled={isLoading}
                required
                placeholder="Select the ID type you uploaded"
              />

              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900">Government ID (front side)</p>
                <p className="text-sm text-gray-600 mt-1">Take or upload a clear photo of a Philippine government ID. JPG or PNG, up to 5 MB.</p>
                {idPreviewUrl && <img src={idPreviewUrl} alt="Selected government ID preview" className="mt-3 max-h-64 w-full rounded-xl border border-slate-200 bg-slate-50 object-contain" />}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={idInputRef}
                    type="file"
                    disabled={isLoading}
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={async (e) => {
                      const target = e.target;
                      const file = target.files?.[0];
                      if (!file) return;
                      if (!await selectIdFile(file)) target.value = "";
                    }}
                  />
                  <DocumentCapture onPick={selectIdFile} disabled={isLoading} />
                  {!kyc.idCardFile ? (
                    <button type="button" onClick={() => idInputRef.current?.click()} disabled={isLoading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:opacity-95 transition disabled:opacity-60">
                      {kyc.savedDocument ? "Replace ID" : "Upload"}
                    </button>
                  ) : (
                    <>
                      <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-800 min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
                        <span className="font-medium">Selected:</span> {kyc.idCardFile.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setKyc(initialKyc);
                          setDocumentStatuses((previous) => ({ ...previous, id: "not_uploaded" }));
                          setIdRevision("");
                          setKycUi({ statusText: "" });
                          setStepErrors({});
                        }}
                        disabled={isLoading}
                        className="px-4 py-2 rounded-xl border border-gray-200 text-gray-800 font-semibold hover:bg-gray-50 transition disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
                {stepErrors.idCardFile && <p className="text-red-500 text-sm font-medium mt-2">{stepErrors.idCardFile}</p>}
                {kyc.savedDocument && !kyc.idCardFile && <p className="mt-2 text-sm text-slate-700">Your government ID is saved privately. Choose a file to replace it.</p>}
              </div>

                <RegistrationDocumentActions upload={documentUpload} docType="id" revision={idRevision} status={documentStatuses.id} busy={isLoading} onCancel={cancelDocument}>
                <button type="button" disabled={isLoading || kyc.idRegistered || !kyc.idType || (!kyc.idCardFile && !kyc.savedDocument)} onClick={registerId} className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-50">
                  {documentUpload.active?.docType === "id" && documentUpload.active.phase === "uploading" ? <><Loader size={16} className="animate-spin" aria-hidden="true" /> Uploading ID...</>
                    : ["queued", "processing"].includes(documentStatuses.id) ? <><Loader size={16} className="animate-spin" aria-hidden="true" /> Checking document...</>
                    : kyc.idRegistered ? "ID uploaded" : "Upload and check ID"}
                </button>
                </RegistrationDocumentActions>
              </>}

              <div inert={isLoading}>{documentReviewNotice}</div>

              {showingSelfie && (
                <SelfieCapture
                  previewUrl={kyc.selfieDataUrl}
                  matched={identityStage === "complete"}
                  matchedDescription="Your selfie matched your ID photo. Your ID and business document still require final approval."
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
              {stepErrors.supportingDocument && <p role="alert" className="text-sm text-red-600">{stepErrors.supportingDocument}</p>}
              </>}
              {!draft.emailVerified && stepErrors.emailVerified && <p role="alert" className="text-sm text-red-600">{stepErrors.emailVerified}</p>}
            </>
          )}

          {step === 5 && documentReviewNotice}

          {step === 5 && (
            <>
              {draft.recovery && <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm text-slate-700">Re-enter your password to submit this recovered registration.</p>
                <PasswordField label="Create Password" name="password" value={form.password} onChange={handleChange} error={errors.password} disabled={isLoading} show={showPw} toggle={() => setShowPw(previous => !previous)} showStrength maxLength={128} />
                <PasswordField label="Confirm Password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} error={errors.confirmPassword} disabled={isLoading} show={showCpw} toggle={() => setShowCpw(previous => !previous)} maxLength={128} />
              </div>}
              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900">Step 5 — Review & submit</p>
                <p className="text-sm text-gray-500 mt-1">Confirm your details before creating your account.</p>
              </div>

              <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50 space-y-3">
                {[
                  { label: "Full Name", value: fullName || "-" },
                  { label: "Email", value: form.businessEmail || "-" },
                  { label: "Email Verification", value: draft.emailVerified ? "Verified" : "Not verified", highlight: draft.emailVerified },
                  { label: "Phone", value: form.phone || "-" },
                  { label: "Address", value: form.address || "-" },
                  { label: "Region", value: regions.find((entry) => entry.code === form.region)?.name || "-" },
                  { label: "Province", value: provinces.length > 0 ? (provinces.find((entry) => entry.code === form.province)?.name || "-") : "N/A" },
                  { label: "City / Municipality", value: cities.find((entry) => entry.code === form.city)?.name || "-" },
                  { label: "Barangay", value: barangays.find((entry) => entry.code === form.barangay)?.name || "-" },
                  { label: "Owner Type", value: canShowBusinessFields ? "Business" : "Individual" },
                  { label: "Business Name", value: form.businessName || "-" },
                  { label: BIR_DOCUMENT_TYPES.has(supportingDocType) ? "TIN" : DOCUMENT_NUMBER_LABELS[supportingDocType] || "Document number", value: BIR_DOCUMENT_TYPES.has(supportingDocType) ? `•••-•••-${form.taxIdentificationNumber.slice(-3)}` : form.permitNumber || "Not shown" },
                  ...(BIR_DOCUMENT_TYPES.has(supportingDocType) ? [{ label: "Branch Code", value: form.branchCode || "-" }] : []),
                  { label: "Supporting Document Type", value: supportingDocType || "-" },
                  { label: "Supporting Document", value: files.supportingDocument || savedSupportingDocument ? "Uploaded" : "Missing" },
                  { label: "ID Type", value: kyc.idType || "-" },
                  { label: "Identity verification", value: kyc.selfieVerified ? "Selfie matched" : "Not verified", highlight: kyc.selfieVerified },
                ].map(({ label, value, highlight }, i, arr) => (
                  <React.Fragment key={label}>
                    <div className="rp-registration-review-row">
                      <p className="text-sm text-gray-500">{label}</p>
                      <p className={`text-sm font-semibold ${highlight ? "text-green-600" : "text-gray-900"}`}>{value}</p>
                    </div>
                    {i < arr.length - 1 && <div className="h-px bg-gray-200" />}
                  </React.Fragment>
                ))}
              </div>
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <input type="checkbox" name="agree" checked={form.agree} onChange={handleChange} onBlur={() => handleStep1Blur("agree")} disabled={isLoading} className="mt-0.5 h-5 w-5 flex-shrink-0 cursor-pointer accent-[#017FE6]" />
                  <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                    I agree to the{" "}<button type="button" onClick={() => setLegalModalType("terms")} className="font-semibold text-[#017FE6] hover:underline">Terms and Conditions</button>{" "}and{" "}<button type="button" onClick={() => setLegalModalType("privacy")} className="font-semibold text-[#017FE6] hover:underline">Privacy Policy</button>.
                  </span>
                </label>
                {errors.agree && <p className="text-red-500 text-sm font-medium">{errors.agree}</p>}
              </div>
            </>
          )}

          {!draft.completed && !draft.registrationComplete && <RegistrationActions spaceRef={actionsSpaceRef}>
            <button type="button" onClick={step === 1 ? onBack : goBack} disabled={isLoading} className="rp-btn-secondary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-50">
              {step === 4 && verificationPhase === "face" ? "Back to ID" : step === 4 && verificationPhase === "documents" ? "Back to Email" : step === 1 ? "Register as Renter" : "Back"}
            </button>
            {step < TOTAL_STEPS ? (
              <button type="button" onClick={goNext} disabled={isLoading} className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                {isCheckingEmail ? <><Loader size={18} className="animate-spin" aria-hidden="true" /> Checking email...</> : "Next"}
              </button>
            ) : (
              <button type="submit" form={formId} disabled={isLoading || draft.completed || !draft.emailVerified || !documentsComplete || !kyc.selfieVerified} className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                {isLoading ? <><Loader size={18} className="animate-spin" /> Registering...</> : "Create Account"}
              </button>
            )}
          </RegistrationActions>}

          {step === 1 && (
            <p className="rp-registration-signin text-center text-slate-600 text-sm mt-1">
              Already have an account?{" "}
              <button type="button" onClick={onNavigateToSignIn} disabled={isLoading} className="text-[#017FE6] font-semibold hover:underline transition-colors disabled:opacity-50">
                Sign In
              </button>
            </p>
          )}
          </fieldset>
        </form>
      </div>
      <div ref={actionsSpaceRef} className="rp-registration-actions-space" aria-hidden="true" />
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

function Field({
  label,
  type = "text",
  name,
  value,
  onChange,
  error,
  disabled = false,
  onlyLetters = false,
  onlyNumbers = false,
  icon: Icon,
  placeholder = "",
  helper = "",
  maxLength,
  prefixText = "",
  required = true,
  onBlur,
  inputRef,
  alignRows = false,
  horizontal = false,
}) {
  const handleInputChange = (e) => {
    let nextValue = e.target.value;
    if (onlyLetters) nextValue = normalizeNameInput(nextValue);
    if (onlyNumbers) nextValue = nextValue.replace(/[^0-9]/g, "");
    if (type === "email") nextValue = nextValue.replace(/\s/g, "");
    onChange({ target: { name, value: nextValue, type } });
  };

  const handleInputKeyDown = (e) => {
    if (type === "email" && e.key === " ") {
      e.preventDefault();
    }
  };

  const handleInputPaste = (e) => {
    if (type !== "email") return;
    const pastedText = String(e.clipboardData?.getData("text") || "");
    if (!/\s/.test(pastedText)) return;
    e.preventDefault();
    const sanitizedText = pastedText.replace(/\s/g, "");
    const input = e.currentTarget;
    const currentValue = String(input?.value || "");
    const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length;
    const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : currentValue.length;
    const nextValue = currentValue.slice(0, start) + sanitizedText + currentValue.slice(end);
    onChange({ target: { name, value: nextValue, type } });
  };

  return (
    <div className={horizontal
      ? "min-w-0 space-y-1.5 sm:space-y-0 sm:col-span-2 sm:grid sm:grid-cols-2 sm:gap-x-3 sm:gap-y-1.5"
      : alignRows ? "min-w-0 space-y-1.5 sm:space-y-0 sm:grid sm:row-span-4 sm:grid-rows-subgrid sm:gap-y-1.5" : "space-y-1.5"}>
      <label htmlFor={horizontal ? name : undefined} className="block text-sm font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {helper ? <p className={`text-xs text-gray-500 ${horizontal ? "sm:col-start-1 sm:row-start-2" : ""}`}>{helper}</p> : null}
      <div className={`relative ${horizontal ? "sm:col-start-2 sm:row-start-1 sm:row-span-2 sm:self-center" : ""}`}>
        {prefixText ? (
          <span className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-sm font-medium text-gray-500">
            {prefixText}
          </span>
        ) : null}
        <input
          id={horizontal ? name : undefined}
          ref={inputRef}
          type={type}
          name={name}
          aria-invalid={Boolean(error)}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onPaste={handleInputPaste}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={onlyNumbers ? "numeric" : undefined}
          autoComplete={["taxIdentificationNumber", "branchCode"].includes(name) ? "off" : undefined}
          className={`relative z-0 w-full h-11 rounded-xl border px-4 text-[15px] placeholder:text-gray-400 outline-none shadow-sm transition ${Icon ? "pr-14" : ""} ${prefixText ? "pl-14" : ""} ${error ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-100" : "border-gray-300 hover:border-gray-400 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"} ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white"}`}
        />
        {Icon && <div aria-hidden="true" className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-[#017FE6]"}`}>
          <Icon size={16} strokeWidth={2} />
        </div>}
      </div>
      {error && <p className={`text-xs text-red-500 ${horizontal ? "sm:col-start-2 sm:row-start-3" : ""}`}>{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  error,
  disabled = false,
  required = true,
  helper = "",
  placeholder = "",
  onBlur,
}) {
  const fallbackPlaceholder = placeholder || `Select ${label.toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-gray-700">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </label>
      {helper ? <p className="text-xs text-gray-500">{helper}</p> : null}
      <div className="relative">
        <select
          name={name}
          aria-invalid={Boolean(error)}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
          className={`w-full h-11 rounded-xl border px-4 text-sm outline-none shadow-sm transition ${error ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-100" : "border-gray-300 hover:border-gray-400 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"} ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white text-gray-900"}`}
        >
          <option value="" disabled hidden>{fallbackPlaceholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function PasswordField({
  label,
  name,
  value,
  onChange,
  error,
  disabled = false,
  show,
  toggle,
  helper = "",
  placeholder = "",
  maxLength,
  onBlur,
  showStrength = false,
}) {
  const sanitizePasswordValue = (rawValue = "") => String(rawValue).replace(/\s/g, "");

  const handlePasswordChange = (event) => {
    const sanitizedValue = sanitizePasswordValue(event?.target?.value || "");
    onChange({ target: { name, value: sanitizedValue, type: "password" } });
  };

  const handlePasswordKeyDown = (event) => {
    if (event.key === " ") event.preventDefault();
  };

  const handlePasswordPaste = (event) => {
    const pastedText = String(event.clipboardData?.getData("text") || "");
    if (!/\s/.test(pastedText)) return;
    event.preventDefault();
    const sanitizedText = sanitizePasswordValue(pastedText);
    const input = event.currentTarget;
    const currentValue = String(input?.value || "");
    const start = Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length;
    const end = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : currentValue.length;
    const nextValue = currentValue.slice(0, start) + sanitizedText + currentValue.slice(end);
    onChange({ target: { name, value: nextValue, type: "password" } });
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-gray-700">
        {label} <span className="text-red-500">*</span>
      </label>
      {helper ? (
        <p className="min-h-8 text-xs leading-4 text-gray-500">{helper}</p>
      ) : (
        <div className="min-h-8" />
      )}
      <div className="relative">
        <div aria-hidden="true" className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
          <Lock size={16} strokeWidth={2} />
        </div>
        <input
          type={show ? "text" : "password"}
          name={name}
          aria-invalid={Boolean(error)}
          value={value}
          onChange={handlePasswordChange}
          onKeyDown={handlePasswordKeyDown}
          onPaste={handlePasswordPaste}
          onBlur={onBlur}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={maxLength}
          className={`w-full h-11 rounded-xl border px-4 pl-12 pr-12 text-[15px] placeholder:text-gray-400 outline-none shadow-sm transition ${error ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-100" : "border-gray-300 hover:border-gray-400 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"} ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white"}`}
        />
        <button type="button" onClick={toggle} disabled={disabled} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
          className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
          {show ? <EyeOff size={18} strokeWidth={2} aria-hidden="true" /> : <Eye size={18} strokeWidth={2} aria-hidden="true" />}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {showStrength && <PasswordStrengthIndicator value={value} />}
    </div>
  );
}

function FileInput({ label, helper, name, onChange, onCapture, error, file, disabled = false }) {
  return (
    <div className="rounded-2xl border border-gray-200 p-4 bg-white space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label} <span className="text-red-500">*</span></label>
      {helper && <p className="text-xs text-gray-500">{helper}</p>}
      <p className="text-xs text-slate-600">JPG, PNG or PDF, up to 5 MB. PDFs can contain up to 5 pages.</p>
      {onCapture && <DocumentCapture onPick={onCapture} label="business document" kind="supporting" disabled={disabled} />}
      <div className={`h-11 flex items-center justify-between gap-3 rounded-xl border px-4 ${error ? "border-red-300" : "border-gray-300"} ${disabled ? "bg-gray-100" : "bg-white"}`}>
        <span className={`text-sm truncate min-w-0 ${disabled ? "text-gray-400" : "text-gray-600"}`}>{file ? file.name : "No file selected"}</span>
        <label className={`inline-flex items-center gap-2 text-sm font-semibold flex-shrink-0 ${disabled ? "text-gray-400 cursor-not-allowed" : "text-[#017FE6] cursor-pointer hover:underline"}`}>
          <Upload size={16} /> Choose
          <input type="file" name={name} accept="image/jpeg,image/png,application/pdf" onChange={onChange} disabled={disabled} className="hidden" />
        </label>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
