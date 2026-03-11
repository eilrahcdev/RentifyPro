import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  FileText,
  Loader,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Upload,
  User,
} from "lucide-react";

import {
  captureBase64FromStream,
  fileToBase64,
  startCamera,
  stopCamera,
  stripDataUrlPrefix,
} from "../utils/cameraKyc";
import { preRegisterIdFace, preSelfieChallenge, preSelfieVerify } from "../utils/kycApi";
import AuthShell from "../components/AuthShell";
import API from "../utils/api";
import { persistOwnerProfile } from "../owner/utils/ownerProfile";

const TOTAL_STEPS = 4;
const STEP_LABELS = ["Personal Details", "Account & Documents", "Face Verification", "Review"];
const ACTION_COOLDOWN_MS = 2000;
const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{20E3}\u{2028}\u{2029}]/u;

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
  password: "",
  confirmPassword: "",
  agree: false,
};

const initialFiles = {
  supportingDocument: null,
};

const initialKyc = {
  idCardFile: null,
  idRegistered: false,
  challengeId: "",
  selfieVerified: false,
  selfieDataUrl: "",
  selfieBase64Clean: "",
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
  return "Something went wrong. Please try again.";
}

export default function RegisterOwnerPage({
  onBack,
  onNavigateToSignIn,
  onNavigateToHome,
  onNavigateToRegisterOTP,
}) {
  const [form, setForm] = useState(initialForm);
  const [files, setFiles] = useState(initialFiles);
  const [kyc, setKyc] = useState(initialKyc);

  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [stepErrors, setStepErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [addressLoadError, setAddressLoadError] = useState("");

  const [kycUi, setKycUi] = useState({ showCamera: false, statusText: "" });
  const [cameraStream, setCameraStream] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [camError, setCamError] = useState("");
  const [camInfo, setCamInfo] = useState("");

  const videoRef = useRef(null);
  const idInputRef = useRef(null);
  const lastActionRef = useRef(0);

  const fullName = useMemo(() => `${form.firstName} ${form.lastName}`.trim(), [form.firstName, form.lastName]);
  const canShowBusinessFields = useMemo(() => form.ownerType === "business", [form.ownerType]);

  const canAct = useCallback(() => {
    const now = Date.now();
    if (now - lastActionRef.current < ACTION_COOLDOWN_MS) return false;
    lastActionRef.current = now;
    return true;
  }, []);

  const closeCamera = useCallback(() => {
    try {
      stopCamera(videoRef.current || cameraStream);
    } catch {
      // Ignore cleanup errors here.
    }
    setCameraStream(null);
    setKycUi((prev) => ({ ...prev, showCamera: false }));
    setCamError("");
    setCamInfo("");
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      try {
        stopCamera(cameraStream);
      } catch {
        // Ignore cleanup errors here.
      }
    };
  }, [cameraStream]);

  useEffect(() => {
    if (step !== 3 && kycUi.showCamera) closeCamera();
  }, [step, kycUi.showCamera, closeCamera]);

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
        setCities([]);
        setBarangays([]);

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
        setBarangays([]);
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

  useEffect(() => {
    const regionName = regions.find((entry) => entry.code === form.region)?.name || "";
    const provinceName = provinces.find((entry) => entry.code === form.province)?.name || "";
    const cityName = cities.find((entry) => entry.code === form.city)?.name || "";
    const barangayName = barangays.find((entry) => entry.code === form.barangay)?.name || "";
    const composedAddress = [barangayName, cityName, provinceName, regionName].filter(Boolean).join(", ");

    setForm((prev) => (prev.address === composedAddress ? prev : { ...prev, address: composedAddress }));
  }, [form.region, form.province, form.city, form.barangay, regions, provinces, cities, barangays]);

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === "businessEmail" ? value.toLowerCase().trim() : type === "checkbox" ? checked : value,
    }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }, []);

  const handleRegionChange = useCallback((e) => {
    const region = e.target.value;
    setForm((prev) => ({
      ...prev,
      region,
      province: "",
      city: "",
      barangay: "",
      address: "",
    }));
    setErrors((prev) => ({ ...prev, region: "", province: "", city: "", barangay: "", address: "" }));
  }, []);

  const handleProvinceChange = useCallback((e) => {
    const province = e.target.value;
    setForm((prev) => ({
      ...prev,
      province,
      city: "",
      barangay: "",
      address: "",
    }));
    setErrors((prev) => ({ ...prev, province: "", city: "", barangay: "", address: "" }));
  }, []);

  const handleCityChange = useCallback((e) => {
    const city = e.target.value;
    setForm((prev) => ({
      ...prev,
      city,
      barangay: "",
      address: "",
    }));
    setErrors((prev) => ({ ...prev, city: "", barangay: "", address: "" }));
  }, []);

  const handleBarangayChange = useCallback((e) => {
    const barangay = e.target.value;
    setForm((prev) => ({
      ...prev,
      barangay,
      address: "",
    }));
    setErrors((prev) => ({ ...prev, barangay: "", address: "" }));
  }, []);

  const handleFile = useCallback((e) => {
    const { name, files: picked } = e.target;
    setFiles((prev) => ({ ...prev, [name]: picked?.[0] || null }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  }, []);

  const validateStep1 = useCallback(() => {
    const next = {};

    if (!form.firstName.trim()) next.firstName = "First name is required.";
    else if (!/^[A-Za-z]+$/.test(form.firstName)) next.firstName = "Letters only (A-Z).";
    else if (EMOJI_REGEX.test(form.firstName)) next.firstName = "No emoji allowed.";

    if (!form.lastName.trim()) next.lastName = "Last name is required.";
    else if (!/^[A-Za-z]+$/.test(form.lastName)) next.lastName = "Letters only (A-Z).";
    else if (EMOJI_REGEX.test(form.lastName)) next.lastName = "No emoji allowed.";

    if (!form.businessEmail.trim()) next.businessEmail = "Email is required.";
    else if (/\s/.test(form.businessEmail)) next.businessEmail = "Email must not contain spaces.";
    else if (EMOJI_REGEX.test(form.businessEmail)) next.businessEmail = "Email must not contain emoji.";
    else if (!EMAIL_REGEX.test(form.businessEmail)) next.businessEmail = "Enter a valid email.";

    if (!form.phone.trim()) next.phone = "Phone number is required.";
    else if (!/^[0-9]{11}$/.test(form.phone)) next.phone = "Phone number must be exactly 11 digits.";

    if (!form.region) next.region = "Region is required.";
    if (provinces.length > 0 && !form.province) next.province = "Province is required.";
    if (!form.city) next.city = "City / Municipality is required.";
    if (!form.barangay) next.barangay = "Barangay is required.";
    if (!form.address.trim()) next.address = "Complete your address selection.";

    if (canShowBusinessFields) {
      if (!form.businessName.trim()) next.businessName = "Business name is required.";
      if (!form.permitNumber.trim()) next.permitNumber = "Permit number is required.";
    }

    if (!form.password) next.password = "Password is required.";
    else if (/\s/.test(form.password)) next.password = "Password must not contain spaces.";
    else if (EMOJI_REGEX.test(form.password)) next.password = "Password must not contain emoji.";
    else if (form.password.length < 8) next.password = "Password must be at least 8 characters.";
    else if (!/[A-Z]/.test(form.password)) next.password = "Password needs an uppercase letter.";
    else if (!/[a-z]/.test(form.password)) next.password = "Password needs a lowercase letter.";
    else if (!/[0-9]/.test(form.password)) next.password = "Password needs a number.";
    else if (!/[!@#$%^&*()_+\-=[\]{}|;':",.<>?/`~]/.test(form.password)) {
      next.password = "Password needs a special character.";
    }

    if (!form.confirmPassword) next.confirmPassword = "Please confirm password.";
    else if (form.password !== form.confirmPassword) next.confirmPassword = "Passwords do not match.";

    if (!form.agree) next.agree = "You must agree to the terms.";

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form, canShowBusinessFields, provinces.length]);

  const validateStep2 = useCallback(() => {
    const next = {};
    if (!files.supportingDocument) next.supportingDocument = "Please upload a supporting document.";
    setErrors((prev) => ({ ...prev, supportingDocument: next.supportingDocument || "" }));
    return Object.keys(next).length === 0;
  }, [files.supportingDocument]);

  const validateStep3 = useCallback(() => {
    const next = {};
    if (!kyc.idCardFile) next.idCardFile = "Please upload your government ID.";
    if (!kyc.idRegistered) next.idRegistered = "Please register your ID first.";
    if (!kyc.selfieVerified) next.selfieVerified = "Please verify your selfie matches the ID.";
    setStepErrors(next);
    return Object.keys(next).length === 0;
  }, [kyc]);

  const goNext = () => {
    if (!canAct()) return;
    setSuccessMessage("");
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step === 3 && !validateStep3()) return;
    setStep((prev) => Math.min(TOTAL_STEPS, prev + 1));
  };

  const goBack = () => {
    if (!canAct()) return;
    if (step === 1) return;
    setSuccessMessage("");
    setStepErrors({});
    setErrors({});
    setStep((prev) => Math.max(1, prev - 1));
  };

  const registerId = async () => {
    if (!canAct()) return;
    if (!kyc.idCardFile) {
      setStepErrors((prev) => ({ ...prev, idCardFile: "Upload your ID image first." }));
      return;
    }

    setIsLoading(true);
    setKycUi((prev) => ({ ...prev, statusText: "Registering ID face..." }));

    try {
      const dataUrl = await fileToBase64(kyc.idCardFile);
      const clean = stripDataUrlPrefix(dataUrl);
      const result = await preRegisterIdFace(form.businessEmail, fullName, "owner", clean);
      if (!result.success) throw new Error(result.message || "Failed to register ID.");

      setKyc((prev) => ({
        ...prev,
        idRegistered: true,
        challengeId: "",
        selfieVerified: false,
        selfieDataUrl: "",
        selfieBase64Clean: "",
      }));
      setStepErrors((prev) => ({ ...prev, idRegistered: "" }));
      setKycUi((prev) => ({ ...prev, statusText: "ID registered. Open camera to capture your selfie." }));
    } catch (error) {
      setStepErrors((prev) => ({ ...prev, idRegistered: friendlyError(error.message) }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    } finally {
      setIsLoading(false);
    }
  };

  const openCamera = async () => {
    if (!canAct()) return;
    setCamError("");
    setCamInfo("");
    setKycUi((prev) => ({ ...prev, showCamera: true, statusText: "Initializing camera..." }));

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      setDevices(cams);

      let deviceId = selectedDeviceId;
      if (!deviceId || !cams.find((d) => d.deviceId === deviceId)) {
        deviceId = cams[0]?.deviceId || "";
        setSelectedDeviceId(deviceId);
      }

      const stream = await startCamera(videoRef.current, {
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId }, facingMode: "user" } : { facingMode: "user" },
      });

      setCameraStream(stream);
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      const label = cams.find((d) => d.deviceId === deviceId)?.label || "Camera";
      setCamInfo(`${label} | ${settings.width || "?"}x${settings.height || "?"}`);
      setKycUi((prev) => ({ ...prev, statusText: "Camera ready. Capture your selfie." }));
    } catch (error) {
      const name = error?.name || "";
      let message = "Something went wrong with the camera.";
      if (name === "NotAllowedError") message = "Camera permission denied. Please allow access.";
      if (name === "NotReadableError") message = "Your camera is being used by another app.";
      if (name === "NotFoundError") message = "No camera found on this device.";
      setCamError(message);
      closeCamera();
    }
  };

  const switchCamera = async (deviceId) => {
    setSelectedDeviceId(deviceId);
    setCamError("");
    setCamInfo("");
    try {
      stopCamera(videoRef.current || cameraStream);
      setCameraStream(null);
      const stream = await startCamera(videoRef.current, {
        audio: false,
        video: { deviceId: { exact: deviceId }, facingMode: "user" },
      });
      setCameraStream(stream);
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      const label = devices.find((d) => d.deviceId === deviceId)?.label || "Camera";
      setCamInfo(`${label} | ${settings.width || "?"}x${settings.height || "?"}`);
    } catch {
      setCamError("Failed to switch camera. Please try again.");
    }
  };

  const captureSelfie = async () => {
    if (!canAct()) return;
    if (!cameraStream) {
      setStepErrors((prev) => ({ ...prev, selfieVerified: "Open camera first." }));
      return;
    }

    setIsLoading(true);
    setKycUi((prev) => ({ ...prev, statusText: "Capturing selfie..." }));

    try {
      const dataUrl = await captureBase64FromStream(cameraStream);
      if (!dataUrl) throw new Error("Failed to capture selfie.");
      const clean = stripDataUrlPrefix(dataUrl);

      setKyc((prev) => ({ ...prev, selfieDataUrl: dataUrl, selfieBase64Clean: clean }));
      setKycUi((prev) => ({ ...prev, statusText: "Checking selfie quality..." }));

      const result = await preSelfieChallenge(form.businessEmail, [clean]);
      if (!result.passed) throw new Error(result.message || "Selfie challenge failed.");

      setKyc((prev) => ({ ...prev, challengeId: result.challenge_id }));
      setStepErrors((prev) => ({ ...prev, selfieVerified: "" }));
      setKycUi((prev) => ({ ...prev, statusText: "Selfie captured. Click Verify to match with your ID." }));
    } catch (error) {
      setKyc((prev) => ({ ...prev, selfieDataUrl: "", selfieBase64Clean: "", challengeId: "" }));
      setStepErrors((prev) => ({ ...prev, selfieVerified: friendlyError(error.message) }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    } finally {
      setIsLoading(false);
    }
  };

  const verifySelfie = async () => {
    if (!canAct()) return;
    if (!kyc.challengeId || !kyc.selfieBase64Clean) {
      setStepErrors((prev) => ({ ...prev, selfieVerified: "Capture a selfie first." }));
      return;
    }

    setIsLoading(true);
    setKycUi((prev) => ({ ...prev, statusText: "Verifying face match..." }));

    try {
      const result = await preSelfieVerify(form.businessEmail, kyc.challengeId, kyc.selfieBase64Clean);
      if (!result.verified) throw new Error(result.message || "Face does not match ID.");
      setKyc((prev) => ({ ...prev, selfieVerified: true }));
      setStepErrors((prev) => ({ ...prev, selfieVerified: "" }));
      setKycUi((prev) => ({ ...prev, statusText: "Face verified successfully." }));
      closeCamera();
    } catch (error) {
      setKyc((prev) => ({ ...prev, selfieVerified: false }));
      setStepErrors((prev) => ({ ...prev, selfieVerified: friendlyError(error.message) }));
      setKycUi((prev) => ({ ...prev, statusText: "" }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading || !canAct()) return;
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (!validateStep2()) {
      setStep(2);
      return;
    }
    if (!validateStep3()) {
      setStep(3);
      return;
    }

    setIsLoading(true);
    setSuccessMessage("");

    try {
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
        businessName: canShowBusinessFields ? form.businessName : "",
        permitNumber: canShowBusinessFields ? form.permitNumber : "",
      });

      const profile = {
        firstName: form.firstName,
        lastName: form.lastName,
        name: fullName,
        email: form.businessEmail,
        phone: form.phone,
        address: form.address,
        region: form.region,
        province: form.province,
        city: form.city,
        barangay: form.barangay,
        ownerType: form.ownerType,
        businessName: canShowBusinessFields ? form.businessName : "",
        permitNumber: canShowBusinessFields ? form.permitNumber : "",
      };

      persistOwnerProfile(profile);
      window.dispatchEvent(new Event("owner-profile-updated"));

      setSuccessMessage(response?.message || "Registration successful. Redirecting to OTP verification...");
      await API.sendOTP(form.businessEmail).catch(() => {});
      setTimeout(() => onNavigateToRegisterOTP(form.businessEmail, form.phone, fullName), 1200);
    } catch (error) {
      const lower = (error?.message || "").toLowerCase();
      const msg = lower.includes("already")
        ? "This email is already registered."
        : lower.includes("too many")
        ? error.message
        : "Registration failed. Please try again.";
      if (lower.includes("password")) setErrors({ password: msg });
      else setErrors({ businessEmail: msg });
      setStep(1);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      badge="Guided account onboarding"
      panelTitle="Create your RentifyPro account."
      panelDescription="Finish setup in guided steps with secure identity checks and instant access."
      highlights={[
        "Clear step-by-step onboarding with progress tracking",
        "Supporting document, ID, and face verification",
        "Ready after successful OTP verification",
      ]}
      contentMaxWidth="max-w-4xl"
      contentContainerClassName="items-start py-2 sm:py-4"
    >
      <div className="rp-surface rp-glass rounded-[28px] border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
        <div className="mt-5 text-center">
          <span className="rp-chip bg-blue-50 text-blue-700 ring-1 ring-blue-100">Register</span>
          <h2 className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">Create your account</h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">Fast, secure onboarding in {TOTAL_STEPS} guided steps.</p>
        </div>

        <div className="mb-7 mt-6 flex items-center justify-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
            <React.Fragment key={s}>
              <div className="flex flex-col items-center gap-1">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${step > s ? "bg-[#017FE6] text-white" : step === s ? "bg-[#017FE6] text-white ring-4 ring-blue-100" : "bg-gray-100 text-gray-400"}`}>
                  {step > s ? <Check size={15} strokeWidth={3} /> : s}
                </div>
                <span className="text-[10px] font-medium text-gray-400 hidden sm:block">{STEP_LABELS[s - 1]}</span>
              </div>
              {s < TOTAL_STEPS && <div className={`h-1 w-10 sm:w-14 rounded-full transition-all self-start mt-[18px] ${step > s ? "bg-[#017FE6]" : "bg-gray-100"}`} />}
            </React.Fragment>
          ))}
        </div>

        {successMessage && (
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 flex items-center gap-2">
            <CheckCircle2 size={16} /> {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {step === 1 && (
            <>
              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900 mb-2">Owner Type</p>
                <p className="text-sm text-gray-500 mb-3">Choose if you are registering as an individual or business owner.</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { type: "individual", label: "Individual", sub: "Personal lessor", icon: User },
                    { type: "business", label: "Business", sub: "Company lessor", icon: Building2 },
                  ].map(({ type, label, sub, icon: Icon }) => (
                    <button key={type} type="button" onClick={() => setForm((prev) => ({ ...prev, ownerType: type }))} className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${form.ownerType === type ? "border-[#017FE6] bg-blue-50" : "border-gray-200 hover:border-[#017FE6]"}`}>
                      <Icon size={18} className="text-gray-600" />
                      <div className="text-left">
                        <p className="text-sm font-semibold text-gray-800">{label}</p>
                        <p className="text-xs text-gray-500">{sub}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900 mb-1">Step 1 — Personal Details</p>
                <p className="text-sm text-gray-500">Enter your information to create your owner account.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="First Name"
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  error={errors.firstName}
                  disabled={isLoading}
                  onlyLetters
                  icon={User}
                  placeholder="Juan"
                  helper="Use your legal first name as shown on your government ID."
                />
                <Field
                  label="Last Name"
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  error={errors.lastName}
                  disabled={isLoading}
                  onlyLetters
                  icon={User}
                  placeholder="Dela Cruz"
                  helper="Use your legal last name for matching during verification."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field
                  label="Email Address"
                  type="email"
                  name="businessEmail"
                  value={form.businessEmail}
                  onChange={handleChange}
                  error={errors.businessEmail}
                  disabled={isLoading}
                  icon={Mail}
                  placeholder="owner@email.com"
                  helper="OTP and security updates will be sent to this email."
                />
                <Field
                  label="Phone Number"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  error={errors.phone}
                  disabled={isLoading}
                  onlyNumbers
                  icon={Phone}
                  placeholder="09123456789"
                  helper="Enter an active 11-digit mobile number."
                />
              </div>

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

              {canShowBusinessFields && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field
                    label="Business Name"
                    name="businessName"
                    value={form.businessName}
                    onChange={handleChange}
                    error={errors.businessName}
                    disabled={isLoading}
                    icon={Building2}
                    placeholder="Sample Transport Services Inc."
                    helper="Use your registered business name."
                  />
                  <Field
                    label="Permit Number"
                    name="permitNumber"
                    value={form.permitNumber}
                    onChange={handleChange}
                    error={errors.permitNumber}
                    disabled={isLoading}
                    icon={Building2}
                    placeholder="DTI/SEC Permit No."
                    helper="Enter your official permit or registration number."
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <PasswordField
                  label="Password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  error={errors.password}
                  disabled={isLoading}
                  show={showPw}
                  toggle={() => setShowPw((prev) => !prev)}
                  helper="Use at least 8 characters with upper/lowercase, number, and symbol."
                  placeholder="Create a strong password"
                />
                <PasswordField
                  label="Confirm Password"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  error={errors.confirmPassword}
                  disabled={isLoading}
                  show={showCpw}
                  toggle={() => setShowCpw((prev) => !prev)}
                  helper="Re-enter your password exactly."
                  placeholder="Repeat your password"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input type="checkbox" name="agree" checked={form.agree} onChange={handleChange} disabled={isLoading} className="w-5 h-5 accent-[#017FE6] cursor-pointer flex-shrink-0 disabled:opacity-60" />
                  <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                    I agree to the <span className="text-[#017FE6] font-semibold">Terms and Conditions</span> and <span className="text-[#017FE6] font-semibold">Privacy Policy</span>
                  </span>
                </label>
                {errors.agree && <p className="text-red-500 text-sm font-medium">{errors.agree}</p>}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><FileText size={20} className="text-[#017FE6]" /></div>
                  <div>
                    <p className="font-semibold text-gray-900">Step 2 — Account & Documents</p>
                    <p className="text-sm text-gray-500 mt-1">Upload your supporting document for owner verification.</p>
                  </div>
                </div>
              </div>

              <FileInput
                label={canShowBusinessFields ? "Business Permit / DTI / SEC Registration" : "Supporting Document"}
                helper={canShowBusinessFields ? "Upload a document proving your business is registered." : "Upload a document proving your legitimacy as a vehicle owner."}
                name="supportingDocument"
                onChange={handleFile}
                error={errors.supportingDocument}
                file={files.supportingDocument}
                disabled={isLoading}
              />
            </>
          )}

          {step === 3 && (
            <>
              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><ShieldCheck size={20} className="text-[#017FE6]" /></div>
                  <div>
                    <p className="font-semibold text-gray-900">Step 3 — Identity Verification</p>
                    <p className="text-sm text-gray-500 mt-1">Upload your government ID, then capture a live selfie to verify your identity.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900">Government ID (front side)</p>
                <p className="text-sm text-gray-600 mt-1">Upload a clear photo of the entire ID card.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={idInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setKyc((prev) => ({ ...prev, idCardFile: file, idRegistered: false, challengeId: "", selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "" }));
                      setKycUi((prev) => ({ ...prev, statusText: "" }));
                      setStepErrors({});
                      setCamError("");
                      setCamInfo("");
                      closeCamera();
                    }}
                  />

                  {!kyc.idCardFile ? (
                    <button type="button" onClick={() => idInputRef.current?.click()} disabled={isLoading} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:opacity-95 transition disabled:opacity-60">
                      <Upload size={18} /> Upload
                    </button>
                  ) : (
                    <>
                      <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-800 min-w-0 truncate">
                        <span className="font-medium">Selected:</span> {kyc.idCardFile.name}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setKyc(initialKyc);
                          setKycUi({ showCamera: false, statusText: "" });
                          setStepErrors({});
                          closeCamera();
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
              </div>

              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900 mb-3">Verification Steps</p>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" disabled={isLoading || !kyc.idCardFile} onClick={registerId} className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${kyc.idRegistered ? "bg-green-500 text-white cursor-default" : "bg-gray-900 text-white hover:opacity-95"} disabled:opacity-50`}>
                    {isLoading && !kyc.idRegistered ? <><Loader size={15} className="animate-spin" /> Processing...</> : kyc.idRegistered ? "ID Registered" : "1. Register ID"}
                  </button>
                  <button type="button" disabled={isLoading || !kyc.idRegistered} onClick={kycUi.showCamera ? closeCamera : openCamera} className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 disabled:opacity-50 transition">
                    {kycUi.showCamera ? "Close Camera" : "2. Open Camera"}
                  </button>
                  <button type="button" disabled={isLoading || !cameraStream || !kyc.idRegistered} onClick={captureSelfie} className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${kyc.selfieBase64Clean ? "bg-blue-500 text-white" : "bg-gray-700 text-white hover:opacity-95"} disabled:opacity-50`}>
                    {isLoading && !kyc.selfieBase64Clean ? <><Loader size={15} className="animate-spin" /> Capturing...</> : kyc.selfieBase64Clean ? "3. Retake Selfie" : "3. Capture Selfie"}
                  </button>
                  <button type="button" disabled={isLoading || !kyc.selfieBase64Clean || !kyc.challengeId || kyc.selfieVerified} onClick={verifySelfie} className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${kyc.selfieVerified ? "bg-green-500 text-white cursor-default" : "bg-green-600 text-white hover:opacity-95"} disabled:opacity-50`}>
                    {isLoading && !kyc.selfieVerified ? <><Loader size={15} className="animate-spin" /> Verifying...</> : kyc.selfieVerified ? "Face Verified" : "4. Verify Face Match"}
                  </button>
                </div>

                {kycUi.statusText && <p className={`text-sm font-medium mt-3 ${kyc.selfieVerified ? "text-green-600" : "text-gray-600"}`}>{kycUi.statusText}</p>}
                {stepErrors.idRegistered && <p className="text-red-500 text-sm font-medium mt-2">{stepErrors.idRegistered}</p>}
                {stepErrors.selfieVerified && <p className="text-red-500 text-sm font-medium mt-1">{stepErrors.selfieVerified}</p>}
              </div>

              {kycUi.showCamera && (
                <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50 space-y-3">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl bg-black aspect-video object-cover" style={{ transform: "scaleX(-1)" }} />
                  {devices.length > 0 && (
                    <div>
                      <label className="text-xs text-gray-600 font-medium block mb-1">Camera device</label>
                      <select value={selectedDeviceId} onChange={(e) => switchCamera(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm">
                        {devices.map((d, idx) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${idx + 1}`}</option>)}
                      </select>
                    </div>
                  )}
                  {camError && <p className="text-sm text-red-600 p-2 bg-red-50 rounded-lg">{camError}</p>}
                  {camInfo && <p className="text-xs text-gray-600 p-2 bg-gray-100 rounded-lg break-words">{camInfo}</p>}
                  <button type="button" disabled={isLoading} onClick={closeCamera} className="w-full px-4 py-2 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-white transition disabled:opacity-50">Close Camera</button>
                  {kyc.selfieDataUrl && (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">Selfie Preview</p>
                      <img src={kyc.selfieDataUrl} alt="Selfie" className="w-full rounded-xl border border-gray-200" style={{ transform: "scaleX(-1)" }} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                <p className="font-semibold text-gray-900">Step 4 — Review & Submit</p>
                <p className="text-sm text-gray-500 mt-1">Confirm your details before creating your account.</p>
              </div>

              <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50 space-y-3">
                {[
                  { label: "Full Name", value: fullName || "-" },
                  { label: "Email", value: form.businessEmail || "-" },
                  { label: "Phone", value: form.phone || "-" },
                  { label: "Address", value: form.address || "-" },
                  { label: "Region", value: regions.find((entry) => entry.code === form.region)?.name || "-" },
                  { label: "Province", value: provinces.length > 0 ? (provinces.find((entry) => entry.code === form.province)?.name || "-") : "N/A" },
                  { label: "City / Municipality", value: cities.find((entry) => entry.code === form.city)?.name || "-" },
                  { label: "Barangay", value: barangays.find((entry) => entry.code === form.barangay)?.name || "-" },
                  { label: "Owner Type", value: canShowBusinessFields ? "Business" : "Individual" },
                  ...(canShowBusinessFields ? [{ label: "Business Name", value: form.businessName || "-" }, { label: "Permit Number", value: form.permitNumber || "-" }] : []),
                  { label: "Supporting Document", value: files.supportingDocument ? "Uploaded" : "Missing" },
                  { label: "Face Verification", value: kyc.selfieVerified ? "Verified" : "Not verified", highlight: kyc.selfieVerified },
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
            </>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={step === 1 ? onBack : goBack} disabled={isLoading} className="rp-btn-secondary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-50">
              <ArrowLeft size={18} /> {step === 1 ? "Register as User" : "Back"}
            </button>
            {step < TOTAL_STEPS ? (
              <button type="button" onClick={goNext} disabled={isLoading} className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                Next <ArrowRight size={18} />
              </button>
            ) : (
              <button type="submit" disabled={isLoading} className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                {isLoading ? <><Loader size={18} className="animate-spin" /> Registering...</> : "Register as Owner"}
              </button>
            )}
          </div>

          {step === 1 && (
            <p className="text-center text-gray-500 text-sm mt-1">
              Already have an account?{" "}
              <button type="button" onClick={onNavigateToSignIn} disabled={isLoading} className="text-[#017FE6] font-semibold hover:underline transition-colors disabled:opacity-50">
                Sign In
              </button>
            </p>
          )}
        </form>
      </div>
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
}) {
  const handleInputChange = (e) => {
    let nextValue = e.target.value;
    if (onlyLetters) nextValue = nextValue.replace(/[^A-Za-z]/g, "");
    if (onlyNumbers) nextValue = nextValue.replace(/[^0-9]/g, "");
    onChange({ target: { name, value: nextValue, type } });
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-gray-700">
        {label} <span className="text-red-500">*</span>
      </label>
      {helper ? <p className="text-xs text-gray-500">{helper}</p> : null}
      <div className="relative">
        <input
          type={type}
          name={name}
          value={value}
          onChange={handleInputChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full h-11 rounded-xl border px-4 text-[15px] placeholder:text-gray-400 outline-none shadow-sm transition ${Icon ? "pr-11" : ""} ${error ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-100" : "border-gray-300 hover:border-gray-400 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"} ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white"}`}
        />
        {Icon && <Icon size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
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
          value={value}
          onChange={onChange}
          disabled={disabled}
          className={`w-full h-11 appearance-none rounded-xl border px-4 pr-10 text-sm outline-none shadow-sm transition ${error ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-100" : "border-gray-300 hover:border-gray-400 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"} ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white text-gray-900"}`}
        >
          <option value="">{fallbackPlaceholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-500" />
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
}) {
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
        <input
          type={show ? "text" : "password"}
          name={name}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full h-11 rounded-xl border px-4 pr-11 text-[15px] placeholder:text-gray-400 outline-none shadow-sm transition ${error ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-100" : "border-gray-300 hover:border-gray-400 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"} ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-500" : "bg-white"}`}
        />
        <button type="button" onClick={toggle} disabled={disabled} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed">
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function FileInput({ label, helper, name, onChange, error, file, disabled = false }) {
  return (
    <div className="rounded-2xl border border-gray-200 p-4 bg-white space-y-2">
      <label className="block text-sm font-medium text-gray-700">{label} <span className="text-red-500">*</span></label>
      {helper && <p className="text-xs text-gray-500">{helper}</p>}
      <div className={`h-11 flex items-center justify-between gap-3 rounded-xl border px-4 ${error ? "border-red-300" : "border-gray-300"} ${disabled ? "bg-gray-100" : "bg-white"}`}>
        <span className={`text-sm truncate min-w-0 ${disabled ? "text-gray-400" : "text-gray-600"}`}>{file ? file.name : "No file selected"}</span>
        <label className={`inline-flex items-center gap-2 text-sm font-semibold flex-shrink-0 ${disabled ? "text-gray-400 cursor-not-allowed" : "text-[#017FE6] cursor-pointer hover:underline"}`}>
          <Upload size={16} /> Choose
          <input type="file" name={name} accept="image/*,.pdf" onChange={onChange} disabled={disabled} className="hidden" />
        </label>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
