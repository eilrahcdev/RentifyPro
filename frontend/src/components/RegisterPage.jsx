<<<<<<< HEAD
// User registration
// Step 1: personal details
// Step 2: ID and selfie check
// Step 3: review and submit

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  fileToBase64,
  stripDataUrlPrefix,
=======
<<<<<<< HEAD
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  fileToBase64,
  stripDataUrlPrefix,
  getMimeFromDataUrl,
=======
// User registration
// Step 1: personal details
// Step 2: ID and selfie check
// Step 3: review and submit

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  fileToBase64,
  stripDataUrlPrefix,
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  startCamera,
  stopCamera,
  captureBase64FromStream,
} from "../utils/cameraKyc";

import {
<<<<<<< HEAD
=======
<<<<<<< HEAD
  Mail,
  Phone,
  User,
  Loader,
  Upload,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  Car,
  Eye,
  EyeOff,
=======
>>>>>>> 8422a2f (fixed bugs and updates)
  preRegisterIdFace,
  preSelfieChallenge,
  preSelfieVerify,
} from "../utils/kycApi";

import {
  Mail, Phone, User, Loader, Upload, CheckCircle2,
  ArrowLeft, ArrowRight, ShieldCheck, Car, Check, Calendar, MapPin, ChevronDown,
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
} from "lucide-react";

import FormInput from "./FormInput";
import PasswordInput from "./PasswordInput";
<<<<<<< HEAD
import AuthShell from "./AuthShell";
import { RELATIONSHIP_OPTIONS, VALIDATION_RULES } from "../data/registerValidation";
import API from "../utils/api";

=======
<<<<<<< HEAD
import { VALIDATION_RULES } from "../data/registerValidation";
import API from "../utils/api";

// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE        = "http://localhost:5000";   // Node.js backend
const FACE_API_BASE   = "http://localhost:8000";   // Python face microservice
const BLINK_FRAMES    = 20;                        // frames to capture for blink
const BLINK_INTERVAL  = 100;                       // ms between frames
=======
import AuthShell from "./AuthShell";
import { RELATIONSHIP_OPTIONS, VALIDATION_RULES } from "../data/registerValidation";
import API from "../utils/api";

>>>>>>> 8422a2f (fixed bugs and updates)
const TOTAL_STEPS = 3;
const STEP_LABELS = ["Personal Details", "Face Verification", "Review"];
const ACTION_COOLDOWN_MS = 2000;
const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

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
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

export default function RegisterPage({
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegisterOTP,
  onNavigateToOwnerRegister,
}) {
<<<<<<< HEAD
  // Form fields
=======
<<<<<<< HEAD

  // ─── Form State ─────────────────────────────────────────────────────────────
>>>>>>> 8422a2f (fixed bugs and updates)
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    dateOfBirth: "", gender: "",
    region: "", province: "", city: "", barangay: "",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelationship: "",
    password: "", confirmPassword: "", agree: false,
  });

  const [accountType, setAccountType] = useState("user");
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [addressLoadError, setAddressLoadError] = useState("");

  // KYC data
  const [kyc, setKyc] = useState({
    idCardFile: null,
    idRegistered: false,
    challengeId: "",
    selfieVerified: false,
    selfieDataUrl: "",
    selfieBase64Clean: "",
  });

  const [kycUi, setKycUi] = useState({ showCamera: false, statusText: "" });

  // Camera state
  const videoRef = useRef(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [camError, setCamError] = useState("");
  const [camInfo, setCamInfo] = useState("");

  // Page state
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [stepErrors, setStepErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

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
<<<<<<< HEAD
=======
  const idInputRef         = useRef(null);
=======
  // Form fields
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    dateOfBirth: "", gender: "",
    region: "", province: "", city: "", barangay: "",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelationship: "",
    password: "", confirmPassword: "", agree: false,
  });

  const [accountType, setAccountType] = useState("user");
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [addressLoadError, setAddressLoadError] = useState("");

  // KYC data
  const [kyc, setKyc] = useState({
    idCardFile: null,
    idRegistered: false,
    challengeId: "",
    selfieVerified: false,
    selfieDataUrl: "",
    selfieBase64Clean: "",
  });

  const [kycUi, setKycUi] = useState({ showCamera: false, statusText: "" });

  // Camera state
  const videoRef = useRef(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [camError, setCamError] = useState("");
  const [camInfo, setCamInfo] = useState("");

  // Page state
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [stepErrors, setStepErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

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
>>>>>>> 8422a2f (fixed bugs and updates)
  const idInputRef = useRef(null);

  // Small cooldown to avoid double clicks
  const lastActionRef = useRef(0);
  const canAct = () => {
    const now = Date.now();
    if (now - lastActionRef.current < ACTION_COOLDOWN_MS) return false;
    lastActionRef.current = now;
    return true;
  };
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

  const fullName = useMemo(
    () => `${form.firstName} ${form.lastName}`.trim(),
    [form.firstName, form.lastName]
  );

<<<<<<< HEAD
=======
<<<<<<< HEAD
  // ─── Helpers ────────────────────────────────────────────────────────────────
=======
>>>>>>> 8422a2f (fixed bugs and updates)
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
        setCities([]);
        setBarangays([]);

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
        setBarangays([]);
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

  // Input handlers

<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

<<<<<<< HEAD
  const handleRegionChange = (value) => {
    setForm((prev) => ({
      ...prev,
      region: value,
      province: "",
      city: "",
      barangay: "",
    }));
    setErrors((prev) => ({
      ...prev,
      region: "",
      province: "",
      city: "",
      barangay: "",
    }));
  };
=======
<<<<<<< HEAD
  const setKycField = (updates) =>
    setKyc((prev) => ({ ...prev, ...updates }));
>>>>>>> 8422a2f (fixed bugs and updates)

  const handleProvinceChange = (value) => {
    setForm((prev) => ({
      ...prev,
      province: value,
      city: "",
      barangay: "",
    }));
    setErrors((prev) => ({
      ...prev,
      province: "",
      city: "",
      barangay: "",
    }));
  };

  const handleCityChange = (value) => {
    setForm((prev) => ({
      ...prev,
      city: value,
      barangay: "",
    }));
    setErrors((prev) => ({
      ...prev,
      city: "",
      barangay: "",
    }));
  };

  const handleBarangayChange = (value) => {
    setForm((prev) => ({
      ...prev,
      barangay: value,
    }));
    setErrors((prev) => ({
      ...prev,
      barangay: "",
    }));
  };

  const handleAccountSelect = (type) => {
    if (type === "renter") {
<<<<<<< HEAD
      if (typeof onNavigateToOwnerRegister === "function") onNavigateToOwnerRegister();
=======
      onNavigateToOwnerRegister?.();
=======
  const handleRegionChange = (value) => {
    setForm((prev) => ({
      ...prev,
      region: value,
      province: "",
      city: "",
      barangay: "",
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
    setForm((prev) => ({
      ...prev,
      province: value,
      city: "",
      barangay: "",
    }));
    setErrors((prev) => ({
      ...prev,
      province: "",
      city: "",
      barangay: "",
    }));
  };

  const handleCityChange = (value) => {
    setForm((prev) => ({
      ...prev,
      city: value,
      barangay: "",
    }));
    setErrors((prev) => ({
      ...prev,
      city: "",
      barangay: "",
    }));
  };

  const handleBarangayChange = (value) => {
    setForm((prev) => ({
      ...prev,
      barangay: value,
    }));
    setErrors((prev) => ({
      ...prev,
      barangay: "",
    }));
  };

  const handleAccountSelect = (type) => {
    if (type === "renter") {
      if (typeof onNavigateToOwnerRegister === "function") onNavigateToOwnerRegister();
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      return;
    }
    setAccountType(type);
  };

<<<<<<< HEAD
  // Reset KYC

  const resetKyc = useCallback(() => {
    setKyc({
      idCardFile: null, idRegistered: false, challengeId: "",
      selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "",
    });
    setKycUi((p) => ({ ...p, statusText: "" }));
    setStepErrors({});
    setCamError(""); setCamInfo("");
  }, []);

  // Camera controls

  const closeCamera = useCallback(() => {
=======
<<<<<<< HEAD
  // ─── Camera helpers ─────────────────────────────────────────────────────────
  const closeCamera = () => {
>>>>>>> 8422a2f (fixed bugs and updates)
    try { stopCamera(videoRef.current || cameraStream); } catch {}
    setCameraStream(null);
    setKycUi((p) => ({ ...p, showCamera: false }));
    setCamError(""); setCamInfo("");
  }, [cameraStream]);

  useEffect(() => {
    return () => { try { stopCamera(cameraStream); } catch {} };
  }, [cameraStream]);

  const openCamera = async () => {
    if (!canAct()) return;
    setCamError(""); setCamInfo("");
    setKycUi((p) => ({ ...p, showCamera: true, statusText: "Initializing camera..." }));
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      let deviceId = selectedDeviceId;
      if (!deviceId || !cams.find((c) => c.deviceId === deviceId)) {
        deviceId = cams[0]?.deviceId || "";
        setSelectedDeviceId(deviceId);
      }
<<<<<<< HEAD
=======

=======
  // Reset KYC

  const resetKyc = useCallback(() => {
    setKyc({
      idCardFile: null, idRegistered: false, challengeId: "",
      selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "",
    });
    setKycUi((p) => ({ ...p, statusText: "" }));
    setStepErrors({});
    setCamError(""); setCamInfo("");
  }, []);

  // Camera controls

  const closeCamera = useCallback(() => {
    try { stopCamera(videoRef.current || cameraStream); } catch {}
    setCameraStream(null);
    setKycUi((p) => ({ ...p, showCamera: false }));
    setCamError(""); setCamInfo("");
  }, [cameraStream]);

  useEffect(() => {
    return () => { try { stopCamera(cameraStream); } catch {} };
  }, [cameraStream]);

  const openCamera = async () => {
    if (!canAct()) return;
    setCamError(""); setCamInfo("");
    setKycUi((p) => ({ ...p, showCamera: true, statusText: "Initializing camera..." }));
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      let deviceId = selectedDeviceId;
      if (!deviceId || !cams.find((c) => c.deviceId === deviceId)) {
        deviceId = cams[0]?.deviceId || "";
        setSelectedDeviceId(deviceId);
      }
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      const constraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, facingMode: "user" }
          : { facingMode: "user" },
      };
<<<<<<< HEAD
=======
<<<<<<< HEAD

>>>>>>> 8422a2f (fixed bugs and updates)
      const stream = await startCamera(videoRef.current, constraints);
      setCameraStream(stream);
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      const label = cams.find((c) => c.deviceId === deviceId)?.label || "Camera";
      setCamInfo(`✅ ${label} | ${settings.width || "?"}x${settings.height || "?"}`);
      setKycUi((p) => ({ ...p, statusText: "✅ Camera ready. Capture your selfie." }));
    } catch (e) {
      const name = e?.name || "";
      let msg = "Something went wrong with the camera. Please try again.";
      if (name === "NotAllowedError") msg = "Camera permission was denied. Please allow camera access in your browser settings.";
      if (name === "NotReadableError") msg = "Your camera is being used by another app. Please close it and try again.";
      if (name === "NotFoundError") msg = "No camera was found on your device.";
      setCamError(msg);
<<<<<<< HEAD
      closeCamera();
=======
      setKycUi((prev) => ({ ...prev, cameraOpen: false }));
      setPhase("idle", "");
=======
      const stream = await startCamera(videoRef.current, constraints);
      setCameraStream(stream);
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      const label = cams.find((c) => c.deviceId === deviceId)?.label || "Camera";
      setCamInfo(`✅ ${label} | ${settings.width || "?"}x${settings.height || "?"}`);
      setKycUi((p) => ({ ...p, statusText: "✅ Camera ready. Capture your selfie." }));
    } catch (e) {
      const name = e?.name || "";
      let msg = "Something went wrong with the camera. Please try again.";
      if (name === "NotAllowedError") msg = "Camera permission was denied. Please allow camera access in your browser settings.";
      if (name === "NotReadableError") msg = "Your camera is being used by another app. Please close it and try again.";
      if (name === "NotFoundError") msg = "No camera was found on your device.";
      setCamError(msg);
      closeCamera();
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    }
  };

  const switchCamera = async (deviceId) => {
<<<<<<< HEAD
    setSelectedDeviceId(deviceId);
    setCamError(""); setCamInfo("");
=======
<<<<<<< HEAD
    setSelectedDevice(deviceId);
    setCamError("");
    setCamInfo("");
=======
    setSelectedDeviceId(deviceId);
    setCamError(""); setCamInfo("");
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    try {
      stopCamera(videoRef.current || cameraStream);
      setCameraStream(null);
      const stream = await startCamera(videoRef.current, {
        audio: false,
        video: { deviceId: { exact: deviceId }, facingMode: "user" },
      });
      setCameraStream(stream);
<<<<<<< HEAD
      const track = stream.getVideoTracks()[0];
=======
<<<<<<< HEAD
      const track    = stream.getVideoTracks()[0];
>>>>>>> 8422a2f (fixed bugs and updates)
      const settings = track?.getSettings?.() || {};
      const label = devices.find((d) => d.deviceId === deviceId)?.label || "Camera";
      setCamInfo(`✅ ${label} | ${settings.width || "?"}x${settings.height || "?"}`);
<<<<<<< HEAD
    } catch {
      setCamError("Failed to switch camera. Please try again.");
=======
    } catch (e) {
      setCamError(`Failed to switch: ${e?.message}`);
=======
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      const label = devices.find((d) => d.deviceId === deviceId)?.label || "Camera";
      setCamInfo(`✅ ${label} | ${settings.width || "?"}x${settings.height || "?"}`);
    } catch {
      setCamError("Failed to switch camera. Please try again.");
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    }
  };

  useEffect(() => {
<<<<<<< HEAD
    if (step !== 2 && kycUi.showCamera) closeCamera();
  }, [step, kycUi.showCamera, closeCamera]);

  // Step 1 validation
=======
<<<<<<< HEAD
    if (step !== 2 && kycUi.cameraOpen) closeCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
>>>>>>> 8422a2f (fixed bugs and updates)

  const validateStep1 = () => {
    const newErrors = {};
    newErrors.firstName = VALIDATION_RULES.firstName(form.firstName);
    newErrors.lastName = VALIDATION_RULES.lastName(form.lastName);
    newErrors.email = VALIDATION_RULES.email(form.email);
    newErrors.phone = VALIDATION_RULES.phone(form.phone);
    newErrors.dateOfBirth = VALIDATION_RULES.dateOfBirth(form.dateOfBirth);
    newErrors.gender = VALIDATION_RULES.gender(form.gender);
    newErrors.region = VALIDATION_RULES.region(form.region);
    newErrors.province = provinces.length > 0 ? VALIDATION_RULES.province(form.province) : "";
    newErrors.city = VALIDATION_RULES.city(form.city);
    newErrors.barangay = VALIDATION_RULES.barangay(form.barangay);
    newErrors.emergencyContactName = VALIDATION_RULES.emergencyContactName(form.emergencyContactName);
    newErrors.emergencyContactPhone = VALIDATION_RULES.emergencyContactPhone(form.emergencyContactPhone);
    newErrors.emergencyContactRelationship = VALIDATION_RULES.emergencyContactRelationship(
      form.emergencyContactRelationship
    );
    newErrors.password = VALIDATION_RULES.password(form.password);
    newErrors.confirmPassword = VALIDATION_RULES.confirmPassword(form.password, form.confirmPassword);
    newErrors.agree = VALIDATION_RULES.agree(form.agree);

    const fieldOrder = [
      ["firstName", firstNameRef],
      ["lastName", lastNameRef],
      ["email", emailRef],
      ["phone", phoneRef],
      ["dateOfBirth", dobRef],
      ["gender", genderRef],
      ["region", regionRef],
      ["province", provinceRef],
      ["city", cityRef],
      ["barangay", barangayRef],
      ["emergencyContactName", emergencyNameRef],
      ["emergencyContactPhone", emergencyPhoneRef],
      ["emergencyContactRelationship", emergencyRelationshipRef],
      ["password", passwordRef],
      ["confirmPassword", confirmPasswordRef],
    ];

    const firstInvalidField = fieldOrder.find(([field]) => newErrors[field]);
    setErrors(newErrors);

    if (firstInvalidField) {
      firstInvalidField[1]?.current?.focus?.();
      return false;
    }

    if (newErrors.agree) return false;
    return true;
  };

  // Step 2 validation

  const validateStep2 = () => {
    const nextErrors = {};
    if (!kyc.idCardFile) nextErrors.idCardFile = "Please upload your full ID card.";
    if (!kyc.idRegistered) nextErrors.idRegistered = "Please register your ID first.";
    if (!kyc.selfieVerified) nextErrors.selfieVerified = "Please verify your selfie matches the ID.";
    setStepErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  // Step navigation

  const goNext = () => {
    if (!canAct()) return;
    setSuccessMessage("");
    if (step === 1) { if (!validateStep1()) return; setStep(2); return; }
    if (step === 2) { if (!validateStep2()) return; setStep(3); return; }
  };

  const goBack = () => {
<<<<<<< HEAD
    if (!canAct()) return;
=======
=======
    if (step !== 2 && kycUi.showCamera) closeCamera();
  }, [step, kycUi.showCamera, closeCamera]);

  // Step 1 validation

  const validateStep1 = () => {
    const newErrors = {};
    newErrors.firstName = VALIDATION_RULES.firstName(form.firstName);
    newErrors.lastName = VALIDATION_RULES.lastName(form.lastName);
    newErrors.email = VALIDATION_RULES.email(form.email);
    newErrors.phone = VALIDATION_RULES.phone(form.phone);
    newErrors.dateOfBirth = VALIDATION_RULES.dateOfBirth(form.dateOfBirth);
    newErrors.gender = VALIDATION_RULES.gender(form.gender);
    newErrors.region = VALIDATION_RULES.region(form.region);
    newErrors.province = provinces.length > 0 ? VALIDATION_RULES.province(form.province) : "";
    newErrors.city = VALIDATION_RULES.city(form.city);
    newErrors.barangay = VALIDATION_RULES.barangay(form.barangay);
    newErrors.emergencyContactName = VALIDATION_RULES.emergencyContactName(form.emergencyContactName);
    newErrors.emergencyContactPhone = VALIDATION_RULES.emergencyContactPhone(form.emergencyContactPhone);
    newErrors.emergencyContactRelationship = VALIDATION_RULES.emergencyContactRelationship(
      form.emergencyContactRelationship
    );
    newErrors.password = VALIDATION_RULES.password(form.password);
    newErrors.confirmPassword = VALIDATION_RULES.confirmPassword(form.password, form.confirmPassword);
    newErrors.agree = VALIDATION_RULES.agree(form.agree);

    const fieldOrder = [
      ["firstName", firstNameRef],
      ["lastName", lastNameRef],
      ["email", emailRef],
      ["phone", phoneRef],
      ["dateOfBirth", dobRef],
      ["gender", genderRef],
      ["region", regionRef],
      ["province", provinceRef],
      ["city", cityRef],
      ["barangay", barangayRef],
      ["emergencyContactName", emergencyNameRef],
      ["emergencyContactPhone", emergencyPhoneRef],
      ["emergencyContactRelationship", emergencyRelationshipRef],
      ["password", passwordRef],
      ["confirmPassword", confirmPasswordRef],
    ];

    const firstInvalidField = fieldOrder.find(([field]) => newErrors[field]);
    setErrors(newErrors);

    if (firstInvalidField) {
      firstInvalidField[1]?.current?.focus?.();
      return false;
    }

    if (newErrors.agree) return false;
    return true;
  };

  // Step 2 validation

  const validateStep2 = () => {
    const nextErrors = {};
    if (!kyc.idCardFile) nextErrors.idCardFile = "Please upload your full ID card.";
    if (!kyc.idRegistered) nextErrors.idRegistered = "Please register your ID first.";
    if (!kyc.selfieVerified) nextErrors.selfieVerified = "Please verify your selfie matches the ID.";
    setStepErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  // Step navigation

  const goNext = () => {
    if (!canAct()) return;
    setSuccessMessage("");
    if (step === 1) { if (!validateStep1()) return; setStep(2); return; }
    if (step === 2) { if (!validateStep2()) return; setStep(3); return; }
  };

  const goBack = () => {
    if (!canAct()) return;
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    if (step === 1) return;
    setSuccessMessage("");
    setStepErrors({});
    setErrors({});
    setStep((s) => Math.max(1, s - 1));
  };

<<<<<<< HEAD
  // KYC step 1: save ID face

  const registerId = async () => {
    if (!canAct()) return;
=======
<<<<<<< HEAD
  // ─── KYC STEP A: Register ID card ──────────────────────────────────────────
  // Calls Node → Python /api/kyc/id/register
  const registerId = async () => {
=======
  // KYC step 1: save ID face

  const registerId = async () => {
    if (!canAct()) return;
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    if (!kyc.idCardFile) {
      setStepErrors((p) => ({ ...p, idCardFile: "Upload your ID image first." }));
      return;
    }
<<<<<<< HEAD
=======
<<<<<<< HEAD

>>>>>>> 8422a2f (fixed bugs and updates)
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Registering ID face..." }));
    try {
      const dataUrl = await fileToBase64(kyc.idCardFile);
      const clean = stripDataUrlPrefix(dataUrl);
      const result = await preRegisterIdFace(form.email, fullName, "user", clean);
      if (!result.success) throw new Error(result.message || "We couldn't register your ID. Please try a clearer photo.");
      setKyc((prev) => ({
        ...prev,
        idRegistered: true,
        challengeId: "",
        selfieVerified: false,
        selfieDataUrl: "",
        selfieBase64Clean: "",
      }));
      setStepErrors((p) => ({ ...p, idRegistered: "" }));
      setKycUi((p) => ({ ...p, statusText: "✅ ID registered. Open camera to capture your selfie." }));
    } catch (e) {
<<<<<<< HEAD
      const msg = friendlyError(e.message);
      setStepErrors((p) => ({ ...p, idRegistered: msg }));
      setKycUi((p) => ({ ...p, statusText: "" }));
=======
      setStepErrors((p) => ({ ...p, idRegistered: e?.message || "ID registration failed." }));
      setPhase("idle", "");
=======
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Registering ID face..." }));
    try {
      const dataUrl = await fileToBase64(kyc.idCardFile);
      const clean = stripDataUrlPrefix(dataUrl);
      const result = await preRegisterIdFace(form.email, fullName, "user", clean);
      if (!result.success) throw new Error(result.message || "We couldn't register your ID. Please try a clearer photo.");
      setKyc((prev) => ({
        ...prev,
        idRegistered: true,
        challengeId: "",
        selfieVerified: false,
        selfieDataUrl: "",
        selfieBase64Clean: "",
      }));
      setStepErrors((p) => ({ ...p, idRegistered: "" }));
      setKycUi((p) => ({ ...p, statusText: "✅ ID registered. Open camera to capture your selfie." }));
    } catch (e) {
      const msg = friendlyError(e.message);
      setStepErrors((p) => ({ ...p, idRegistered: msg }));
      setKycUi((p) => ({ ...p, statusText: "" }));
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    } finally {
      setIsLoading(false);
    }
  };

<<<<<<< HEAD
  // KYC step 2: capture selfie
=======
<<<<<<< HEAD
  // ─── KYC STEP B: Blink challenge ────────────────────────────────────────────
  // Captures 20 frames → calls Node → Python /api/kyc/selfie/challenge
  const startBlinkCapture = () => {
    if (!cameraStream) {
      setCamError("Open camera first.");
      return;
    }
>>>>>>> 8422a2f (fixed bugs and updates)

  const captureSelfie = async () => {
    if (!canAct()) return;
    if (!cameraStream) {
      setStepErrors((p) => ({ ...p, selfieVerified: "Open camera first." }));
      return;
    }
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Capturing selfie..." }));
    try {
      const dataUrl = await captureBase64FromStream(cameraStream);
      if (!dataUrl) throw new Error("Failed to capture selfie.");
      const clean = stripDataUrlPrefix(dataUrl);

      setKyc((prev) => ({ ...prev, selfieDataUrl: dataUrl, selfieBase64Clean: clean }));

      setKycUi((p) => ({ ...p, statusText: "Checking selfie quality..." }));
      const result = await preSelfieChallenge(form.email, [clean]);

      if (!result.passed) {
        throw new Error(result.message || "Selfie check failed. Please try again.");
      }

      setKyc((prev) => ({ ...prev, challengeId: result.challenge_id }));
      setStepErrors((p) => ({ ...p, selfieVerified: "" }));
      setKycUi((p) => ({ ...p, statusText: "✅ Selfie captured. Click Verify to match with your ID." }));
    } catch (e) {
<<<<<<< HEAD
=======
      setStepErrors((p) => ({ ...p, selfieCaptured: e?.message || "Capture failed." }));
=======
  // KYC step 2: capture selfie

  const captureSelfie = async () => {
    if (!canAct()) return;
    if (!cameraStream) {
      setStepErrors((p) => ({ ...p, selfieVerified: "Open camera first." }));
      return;
    }
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Capturing selfie..." }));
    try {
      const dataUrl = await captureBase64FromStream(cameraStream);
      if (!dataUrl) throw new Error("Failed to capture selfie.");
      const clean = stripDataUrlPrefix(dataUrl);

      setKyc((prev) => ({ ...prev, selfieDataUrl: dataUrl, selfieBase64Clean: clean }));

      setKycUi((p) => ({ ...p, statusText: "Checking selfie quality..." }));
      const result = await preSelfieChallenge(form.email, [clean]);

      if (!result.passed) {
        throw new Error(result.message || "Selfie check failed. Please try again.");
      }

      setKyc((prev) => ({ ...prev, challengeId: result.challenge_id }));
      setStepErrors((p) => ({ ...p, selfieVerified: "" }));
      setKycUi((p) => ({ ...p, statusText: "✅ Selfie captured. Click Verify to match with your ID." }));
    } catch (e) {
>>>>>>> 8422a2f (fixed bugs and updates)
      setKyc((prev) => ({ ...prev, selfieDataUrl: "", selfieBase64Clean: "", challengeId: "" }));
      const msg = friendlyError(e.message);
      setStepErrors((p) => ({ ...p, selfieVerified: msg }));
      setKycUi((p) => ({ ...p, statusText: "" }));
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    } finally {
      setIsLoading(false);
    }
  };

<<<<<<< HEAD
  // KYC step 3: match selfie with ID

=======
<<<<<<< HEAD
  // ─── KYC STEP D: Verify selfie vs ID ────────────────────────────────────────
  // Calls Node → Python /api/kyc/selfie/verify (uses challenge_id for liveness)
>>>>>>> 8422a2f (fixed bugs and updates)
  const verifySelfie = async () => {
    if (!canAct()) return;
    if (!kyc.challengeId || !kyc.selfieBase64Clean) {
      setStepErrors((p) => ({ ...p, selfieVerified: "Capture a selfie first." }));
      return;
    }
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Verifying face match..." }));
    try {
      const result = await preSelfieVerify(form.email, kyc.challengeId, kyc.selfieBase64Clean);
      if (!result.verified) throw new Error(result.message || "Face does not match ID.");
      setKyc((prev) => ({ ...prev, selfieVerified: true }));
      setStepErrors((p) => ({ ...p, selfieVerified: "" }));
      setKycUi((p) => ({ ...p, statusText: "✅ Face verified successfully!" }));
      closeCamera();
    } catch (e) {
<<<<<<< HEAD
=======
      setKycField({ selfieVerified: false });
      setStepErrors((p) => ({
        ...p,
        selfieVerified: e?.message || "Verification failed.",
      }));
      setPhase("selfie-ready", "");
=======
  // KYC step 3: match selfie with ID

  const verifySelfie = async () => {
    if (!canAct()) return;
    if (!kyc.challengeId || !kyc.selfieBase64Clean) {
      setStepErrors((p) => ({ ...p, selfieVerified: "Capture a selfie first." }));
      return;
    }
    setIsLoading(true);
    setKycUi((p) => ({ ...p, statusText: "Verifying face match..." }));
    try {
      const result = await preSelfieVerify(form.email, kyc.challengeId, kyc.selfieBase64Clean);
      if (!result.verified) throw new Error(result.message || "Face does not match ID.");
      setKyc((prev) => ({ ...prev, selfieVerified: true }));
      setStepErrors((p) => ({ ...p, selfieVerified: "" }));
      setKycUi((p) => ({ ...p, statusText: "✅ Face verified successfully!" }));
      closeCamera();
    } catch (e) {
>>>>>>> 8422a2f (fixed bugs and updates)
      setKyc((prev) => ({ ...prev, selfieVerified: false }));
      const msg = friendlyError(e.message);
      setStepErrors((p) => ({ ...p, selfieVerified: msg }));
      setKycUi((p) => ({ ...p, statusText: "" }));
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    } finally {
      setIsLoading(false);
    }
  };

<<<<<<< HEAD
  // Final submit

=======
<<<<<<< HEAD
  // ─── FINAL REGISTER (Step 3 submit) ─────────────────────────────────────────
>>>>>>> 8422a2f (fixed bugs and updates)
  const handleFinalRegister = async (e) => {
    e.preventDefault();
    if (!canAct()) return;
    if (accountType !== "user") {
      if (typeof onNavigateToOwnerRegister === "function") onNavigateToOwnerRegister();
      return;
    }
    if (!validateStep1()) { setStep(1); return; }
    if (!validateStep2()) { setStep(2); return; }
    setIsLoading(true);
    setSuccessMessage("");
    try {
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
      });
      setSuccessMessage(response?.message || "Registration successful! Redirecting to OTP verification...");
      await API.sendOTP(form.email).catch(() => {});
      setTimeout(() => { onNavigateToRegisterOTP(form.email, form.phone, fullName); }, 1500);
    } catch (error) {
<<<<<<< HEAD
=======
      const msg = error?.message?.includes("already exists")
        ? "This email is already registered."
        : error?.message || "Registration failed. Please try again.";
=======
  // Final submit

  const handleFinalRegister = async (e) => {
    e.preventDefault();
    if (!canAct()) return;
    if (accountType !== "user") {
      if (typeof onNavigateToOwnerRegister === "function") onNavigateToOwnerRegister();
      return;
    }
    if (!validateStep1()) { setStep(1); return; }
    if (!validateStep2()) { setStep(2); return; }
    setIsLoading(true);
    setSuccessMessage("");
    try {
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
      });
      setSuccessMessage(response?.message || "Registration successful! Redirecting to OTP verification...");
      await API.sendOTP(form.email).catch(() => {});
      setTimeout(() => { onNavigateToRegisterOTP(form.email, form.phone, fullName); }, 1500);
    } catch (error) {
>>>>>>> 8422a2f (fixed bugs and updates)
      const msg = error?.message?.includes("already")
        ? "This email address is already registered."
        : error?.message?.includes("Too many")
        ? error.message
        : "Registration failed. Please try again.";
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      setErrors({ email: msg });
      setStep(1);
      setTimeout(() => emailRef.current?.focus(), 0);
    } finally {
      setIsLoading(false);
    }
  };

<<<<<<< HEAD
  // File upload card

=======
<<<<<<< HEAD
  // ─── Phase-derived UI helpers ────────────────────────────────────────────────
  const phase          = kycUi.phase;
  const isBlinkRecording = phase === "blink-recording";
  const isVerifying    = phase === "verifying" || phase === "blink-processing";
  const kycComplete    = kyc.selfieVerified;

  // KYC progress tracker for UI badges
  const kycSteps = [
    { key: "idRegistered",  label: "ID Registered",   done: kyc.idRegistered  },
    { key: "blinkDone",     label: "Liveness Check",  done: kyc.blinkDone     },
    { key: "selfieCaptured",label: "Selfie Captured", done: kyc.selfieCaptured },
    { key: "selfieVerified",label: "Face Verified",   done: kyc.selfieVerified },
  ];

  // ─── Sub-components ──────────────────────────────────────────────────────────
=======
  // File upload card

>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  const FileCard = ({ title, description, file, onPick, onRemove, accept, inputRef, icon: Icon, error }) => (
    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
          <Icon size={20} className="text-gray-700" />
        </div>
<<<<<<< HEAD
        <div className="flex-1 min-w-0">
=======
<<<<<<< HEAD
        <div className="flex-1">
>>>>>>> 8422a2f (fixed bugs and updates)
          <p className="font-semibold text-gray-900">{title}</p>
          <p className="text-sm text-gray-600 mt-1">{description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={inputRef} type="file" accept={accept} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
            {!file ? (
<<<<<<< HEAD
              <button type="button" onClick={() => inputRef?.current?.click()} disabled={isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:opacity-95 transition disabled:opacity-60">
=======
              <button
                type="button"
                onClick={() => inputRef?.current?.click()}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:opacity-95 disabled:opacity-60"
              >
=======
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">{title}</p>
          <p className="text-sm text-gray-600 mt-1">{description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={inputRef} type="file" accept={accept} className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }} />
            {!file ? (
              <button type="button" onClick={() => inputRef?.current?.click()} disabled={isLoading}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white font-semibold hover:opacity-95 transition disabled:opacity-60">
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
                <Upload size={18} /> Upload
              </button>
            ) : (
              <>
<<<<<<< HEAD
                <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-800 min-w-0 truncate">
                  <span className="font-medium">Selected:</span> {file.name}
                </div>
                <button type="button" onClick={onRemove} disabled={isLoading}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-800 font-semibold hover:bg-gray-50 transition disabled:opacity-60 flex-shrink-0">
=======
<<<<<<< HEAD
                <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-800 flex-1 min-w-[220px]">
                  <span className="font-medium">Selected:</span> {file.name}
                </div>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-800 font-semibold hover:bg-gray-50 disabled:opacity-60"
                >
=======
                <div className="px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-800 min-w-0 truncate">
                  <span className="font-medium">Selected:</span> {file.name}
                </div>
                <button type="button" onClick={onRemove} disabled={isLoading}
                  className="px-4 py-2 rounded-xl border border-gray-200 text-gray-800 font-semibold hover:bg-gray-50 transition disabled:opacity-60 flex-shrink-0">
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
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

<<<<<<< HEAD
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
          disabled={disabled}
          className={`w-full appearance-none rounded-xl border bg-white px-4 py-3 pr-12 text-[15px] text-slate-900 shadow-sm transition-all duration-200 focus:outline-none ${
            error
              ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          } ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${
            error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-[#017FE6]"
          }`}
        >
          <ChevronDown size={16} />
=======
<<<<<<< HEAD
  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex overflow-hidden bg-gray-50">

      {/* LEFT PANEL */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="/porsche 911.png"
          alt="RentifyPro vehicle"
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
        <div className="absolute inset-0 bg-black/40 z-10" />
        <div className="relative z-20 flex flex-col items-center justify-start w-full h-full px-12 pt-16">
          <button type="button" onClick={onNavigateToHome} className="text-4xl font-bold mb-4 text-white hover:opacity-90">
            Rentify<span className="text-white">Pro</span>
          </button>
          <p className="text-lg text-gray-200">Book your ride in minutes.</p>
>>>>>>> 8422a2f (fixed bugs and updates)
        </div>
      </div>
      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
    </div>
  );

  // Render

  return (
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      badge="Guided account onboarding"
      panelTitle="Create your RentifyPro account."
      panelDescription="Finish setup in guided steps with secure identity checks and instant booking access."
      highlights={[
        "Clear 3-step onboarding with progress tracking",
        "Secure KYC and face verification flow",
        "Ready for bookings after successful verification",
      ]}
      contentMaxWidth="max-w-4xl"
      contentContainerClassName="items-start py-2 sm:py-4"
    >
      <div className="rp-surface rp-glass rounded-[28px] border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
        {/* header */}
        <div className="mb-6 text-center">
          <span className="rp-chip bg-blue-50 text-blue-700 ring-1 ring-blue-100">Register</span>
          <h2 className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">Create your account</h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Fast, secure onboarding in {TOTAL_STEPS} guided steps.
          </p>
        </div>

        {/* step indicator */}
        <div className="mb-7 flex items-center justify-center gap-2">
                {[1, 2, 3].map((s) => (
                  <React.Fragment key={s}>
                    <div className="flex flex-col items-center gap-1">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                        step > s ? "bg-[#017FE6] text-white" : step === s ? "bg-[#017FE6] text-white ring-4 ring-blue-100" : "bg-gray-100 text-gray-400"
                      }`}>{step > s ? <Check size={15} strokeWidth={3} /> : s}</div>
                      <span className="text-[10px] font-medium text-gray-400 hidden sm:block">
                        {STEP_LABELS[s - 1]}
                      </span>
                    </div>
                    {s < 3 && <div className={`h-1 w-10 sm:w-14 rounded-full transition-all self-start mt-[18px] ${step > s ? "bg-[#017FE6]" : "bg-gray-100"}`} />}
                  </React.Fragment>
                ))}
        </div>

        {/* success message */}
        {successMessage && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <CheckCircle2 size={18} />
            </div>
            <p className="text-sm font-medium text-emerald-700">{successMessage}</p>
          </div>
        )}

        <form onSubmit={handleFinalRegister} className="space-y-4" noValidate>
                {/* step 1 */}
                {step === 1 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-1">Register as</p>
                      <p className="text-sm text-gray-500 mb-3">Choose what type of account you want to create.</p>
                      <div className="grid grid-cols-2 gap-3">
                        <button type="button" onClick={() => handleAccountSelect("user")}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${accountType === "user" ? "border-[#017FE6] bg-blue-50" : "border-gray-200 hover:border-[#017FE6]"}`}>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 text-xs ${accountType === "user" ? "border-[#017FE6] bg-[#017FE6] text-white" : "border-gray-300"}`}>
                            {accountType === "user" && "✓"}
                          </div>
                          <User size={18} className="text-gray-600" />
                          <div className="text-left"><p className="font-semibold text-gray-800 text-sm">User</p><p className="text-xs text-gray-500">Rent vehicles</p></div>
                        </button>
                        <button type="button" onClick={() => handleAccountSelect("renter")}
                          className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-[#017FE6] transition">
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center shrink-0" />
                          <Car size={18} className="text-gray-600" />
                          <div className="text-left"><p className="font-semibold text-gray-800 text-sm">Owner</p><p className="text-xs text-gray-500">List vehicles</p></div>
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-1">Step 1 — Personal Details</p>
                      <p className="text-sm text-gray-500">Enter your information to create your account.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="First Name" value={form.firstName} onChange={(e) => handleChange("firstName", e.target.value)} error={errors.firstName} disabled={isLoading} placeholder="John" required icon={User} onlyLetters inputRef={firstNameRef} />
                      <FormInput label="Last Name" value={form.lastName} onChange={(e) => handleChange("lastName", e.target.value)} error={errors.lastName} disabled={isLoading} placeholder="Doe" required icon={User} onlyLetters inputRef={lastNameRef} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="Email Address" type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value.toLowerCase().trim())} error={errors.email} disabled={isLoading} placeholder="john@gmail.com" required icon={Mail} inputRef={emailRef} showEmailHint />
                      <FormInput label="Phone Number" type="tel" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} error={errors.phone} disabled={isLoading} placeholder="09123456789" required icon={Phone} onlyNumbers inputRef={phoneRef} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="Date of Birth" type="date" value={form.dateOfBirth} onChange={(e) => handleChange("dateOfBirth", e.target.value)} error={errors.dateOfBirth} disabled={isLoading} required icon={Calendar} inputRef={dobRef} />
                      <SelectField label="Gender" value={form.gender} onChange={(value) => handleChange("gender", value)} options={[
                        { value: "Male", label: "Male" },
                        { value: "Female", label: "Female" },
                        { value: "Prefer not to say", label: "Prefer not to say" },
                      ]} error={errors.gender} disabled={isLoading} required inputRef={genderRef} />
                    </div>
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
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white space-y-4">
                      <div>
                        <p className="font-semibold text-gray-900">Emergency Contact</p>
                        <p className="text-sm text-gray-500 mt-1">Add someone we can reach if you need urgent support during a booking.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormInput label="Contact Name" value={form.emergencyContactName} onChange={(e) => handleChange("emergencyContactName", e.target.value)} error={errors.emergencyContactName} disabled={isLoading} placeholder="Maria Dela Cruz" required icon={User} inputRef={emergencyNameRef} />
                        <FormInput label="Phone Number" type="tel" value={form.emergencyContactPhone} onChange={(e) => handleChange("emergencyContactPhone", e.target.value)} error={errors.emergencyContactPhone} disabled={isLoading} placeholder="09123456789" required icon={Phone} onlyNumbers inputRef={emergencyPhoneRef} />
                      </div>
                      <SelectField label="Relationship" value={form.emergencyContactRelationship} onChange={(value) => handleChange("emergencyContactRelationship", value)} options={RELATIONSHIP_OPTIONS.map((option) => ({ value: option, label: option }))} error={errors.emergencyContactRelationship} disabled={isLoading} required inputRef={emergencyRelationshipRef} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <PasswordInput label="Password" value={form.password} onChange={(e) => handleChange("password", e.target.value)} error={errors.password} disabled={isLoading} required showStrength inputRef={passwordRef} />
                      <PasswordInput label="Confirm Password" value={form.confirmPassword} onChange={(e) => handleChange("confirmPassword", e.target.value)} error={errors.confirmPassword} disabled={isLoading} required showStrength={false} inputRef={confirmPasswordRef} />
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input type="checkbox" checked={form.agree} onChange={(e) => handleChange("agree", e.target.checked)} disabled={isLoading} className="w-5 h-5 accent-[#017FE6] cursor-pointer flex-shrink-0" />
                        <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                          I agree to the <span className="text-[#017FE6] font-semibold hover:underline cursor-pointer">Terms & Conditions</span> and <span className="text-[#017FE6] font-semibold hover:underline cursor-pointer">Privacy Policy</span>
                        </span>
                      </label>
                      {errors.agree && <p className="text-red-500 text-sm font-medium">{errors.agree}</p>}
                    </div>
                  </>
                )}

                {/* step 2 */}
                {step === 2 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <ShieldCheck size={20} className="text-[#017FE6]" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">Step 2 — Identity Verification</p>
                          <p className="text-sm text-gray-500 mt-1">
                            Upload your <span className="font-semibold text-gray-700">full ID card</span>, then capture a live selfie to verify your identity.
                          </p>
                        </div>
                      </div>
                    </div>

                    <FileCard
                      title="Government ID (Front — full card)"
                      description="Upload a clear photo showing the entire ID card with readable text and no cropped edges."
                      file={kyc.idCardFile}
                      onPick={(f) => {
                        setKyc((prev) => ({ ...prev, idCardFile: f, idRegistered: false, challengeId: "", selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "" }));
                        setKycUi((p) => ({ ...p, statusText: "" }));
                        setStepErrors({});
                        setCamError(""); setCamInfo(""); closeCamera();
                      }}
                      onRemove={() => { resetKyc(); closeCamera(); }}
                      accept="image/*" inputRef={idInputRef} icon={Upload}
                      error={stepErrors.idCardFile}
                    />

                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-3">Verification Steps</p>
                      <div className="grid grid-cols-2 gap-3">
                        <button type="button" disabled={isLoading || !kyc.idCardFile} onClick={registerId}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${
                            kyc.idRegistered ? "bg-green-500 text-white cursor-default" : "bg-gray-900 text-white hover:opacity-95"
                          } disabled:opacity-50`}>
                          {isLoading && !kyc.idRegistered
                            ? <><Loader size={15} className="animate-spin" /> Processing...</>
                            : kyc.idRegistered ? "✓ ID Registered" : "1. Register ID"}
                        </button>

                        <button type="button" disabled={isLoading || !kyc.idRegistered} onClick={kycUi.showCamera ? closeCamera : openCamera}
                          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 disabled:opacity-50 transition">
                          {kycUi.showCamera ? "Close Camera" : "2. Open Camera"}
                        </button>

                        <button type="button" disabled={isLoading || !cameraStream || !kyc.idRegistered} onClick={captureSelfie}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${
                            kyc.selfieBase64Clean ? "bg-blue-500 text-white" : "bg-gray-700 text-white hover:opacity-95"
                          } disabled:opacity-50`}>
                          {isLoading && !kyc.selfieBase64Clean
                            ? <><Loader size={15} className="animate-spin" /> Capturing...</>
                            : kyc.selfieBase64Clean ? "✓ Retake Selfie" : "3. Capture Selfie"}
                        </button>

                        <button type="button" disabled={isLoading || !kyc.selfieBase64Clean || !kyc.challengeId || kyc.selfieVerified} onClick={verifySelfie}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${
                            kyc.selfieVerified ? "bg-green-500 text-white cursor-default" : "bg-green-600 text-white hover:opacity-95"
                          } disabled:opacity-50`}>
                          {isLoading && !kyc.selfieVerified
                            ? <><Loader size={15} className="animate-spin" /> Verifying...</>
                            : kyc.selfieVerified ? "✓ Face Verified!" : "4. Verify Face Match"}
                        </button>
                      </div>

                      {kycUi.statusText && (
                        <p className={`text-sm font-medium mt-3 ${kyc.selfieVerified ? "text-green-600" : "text-gray-600"}`}>
                          {kycUi.statusText}
                        </p>
                      )}
                      {stepErrors.idRegistered && <p className="text-red-500 text-sm font-medium mt-2">{stepErrors.idRegistered}</p>}
                      {stepErrors.selfieVerified && <p className="text-red-500 text-sm font-medium mt-1">{stepErrors.selfieVerified}</p>}
                    </div>

                    {kycUi.showCamera && (
                      <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50 space-y-3">
                        <video ref={videoRef} autoPlay playsInline muted
                          className="w-full rounded-xl bg-black aspect-video object-cover"
                          style={{ transform: "scaleX(-1)" }} />
                        {devices.length > 0 && (
                          <div>
                            <label className="text-xs text-gray-600 font-medium block mb-1">Camera device</label>
                            <select value={selectedDeviceId} onChange={(e) => switchCamera(e.target.value)}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm">
                              {devices.map((d, idx) => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${idx + 1}`}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {camError && <p className="text-sm text-red-600 p-2 bg-red-50 rounded-lg">{camError}</p>}
                        {camInfo && <p className="text-xs text-gray-600 p-2 bg-gray-100 rounded-lg break-words">{camInfo}</p>}
                        <button type="button" disabled={isLoading} onClick={closeCamera}
                          className="w-full px-4 py-2 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-white transition disabled:opacity-50">
                          Close Camera
                        </button>
                        {kyc.selfieDataUrl && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-2">Captured Selfie Preview</p>
                            <img src={kyc.selfieDataUrl} alt="Captured selfie" className="w-full rounded-xl border border-gray-200" style={{ transform: "scaleX(-1)" }} />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* step 3 */}
                {step === 3 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900">Step 3 — Review & Submit</p>
                      <p className="text-sm text-gray-500 mt-1">Confirm your details before creating your account.</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50 space-y-3">
                      {[
                        { label: "Full Name", value: fullName || "—" },
                        { label: "Email", value: form.email || "—" },
                        { label: "Phone", value: form.phone || "—" },
                        { label: "Account Type", value: "User (Renter)" },
                        { label: "KYC Verified", value: kyc.selfieVerified ? "✅ Verified" : "⚠️ Not Verified", highlight: kyc.selfieVerified },
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

                {/* navigation */}
                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={goBack} disabled={step === 1 || isLoading}
                    className="rp-btn-secondary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-50">
                    <ArrowLeft size={18} /> Back
                  </button>
                  {step < TOTAL_STEPS ? (
                    <button type="button" onClick={goNext} disabled={isLoading}
                      className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                      Next <ArrowRight size={18} />
                    </button>
                  ) : (
                    <button type="submit" disabled={isLoading}
                      className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                      {isLoading ? <><Loader size={18} className="animate-spin" /> Creating...</> : "Create Account"}
                    </button>
                  )}
                </div>

                {step === 1 && (
                  <p className="text-center text-gray-500 text-sm mt-1">
                    Already have an account?{" "}
                    <button type="button" onClick={onNavigateToSignIn} disabled={isLoading}
                      className="text-[#017FE6] font-semibold hover:underline transition-colors disabled:opacity-50">
                      Sign In
                    </button>
                  </p>
                )}
        </form>
      </div>
    </AuthShell>
  );
}
<<<<<<< HEAD

=======
=======
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
          disabled={disabled}
          className={`w-full appearance-none rounded-xl border bg-white px-4 py-3 pr-12 text-[15px] text-slate-900 shadow-sm transition-all duration-200 focus:outline-none ${
            error
              ? "border-red-300 bg-red-50/80 focus:border-red-400 focus:ring-4 focus:ring-red-100"
              : "border-slate-200 hover:border-slate-300 focus:border-[#017FE6] focus:ring-4 focus:ring-blue-100"
          } ${disabled ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div
          className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border p-1.5 ${
            error ? "border-red-200 bg-red-50 text-red-500" : "border-slate-200 bg-slate-50 text-[#017FE6]"
          }`}
        >
          <ChevronDown size={16} />
        </div>
      </div>
      {error && <p className="text-sm font-medium text-red-500">{error}</p>}
    </div>
  );

  // Render

  return (
    <AuthShell
      onNavigateToHome={onNavigateToHome}
      badge="Guided account onboarding"
      panelTitle="Create your RentifyPro account."
      panelDescription="Finish setup in guided steps with secure identity checks and instant booking access."
      highlights={[
        "Clear 3-step onboarding with progress tracking",
        "Secure KYC and face verification flow",
        "Ready for bookings after successful verification",
      ]}
      contentMaxWidth="max-w-4xl"
      contentContainerClassName="items-start py-2 sm:py-4"
    >
      <div className="rp-surface rp-glass rounded-[28px] border-white/70 p-6 shadow-[0_20px_45px_rgba(15,23,42,0.12)] sm:p-8">
        {/* header */}
        <div className="mb-6 text-center">
          <span className="rp-chip bg-blue-50 text-blue-700 ring-1 ring-blue-100">Register</span>
          <h2 className="mt-3 text-3xl font-extrabold text-slate-900 sm:text-4xl">Create your account</h2>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Fast, secure onboarding in {TOTAL_STEPS} guided steps.
          </p>
        </div>

        {/* step indicator */}
        <div className="mb-7 flex items-center justify-center gap-2">
                {[1, 2, 3].map((s) => (
                  <React.Fragment key={s}>
                    <div className="flex flex-col items-center gap-1">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                        step > s ? "bg-[#017FE6] text-white" : step === s ? "bg-[#017FE6] text-white ring-4 ring-blue-100" : "bg-gray-100 text-gray-400"
                      }`}>{step > s ? <Check size={15} strokeWidth={3} /> : s}</div>
                      <span className="text-[10px] font-medium text-gray-400 hidden sm:block">
                        {STEP_LABELS[s - 1]}
                      </span>
                    </div>
                    {s < 3 && <div className={`h-1 w-10 sm:w-14 rounded-full transition-all self-start mt-[18px] ${step > s ? "bg-[#017FE6]" : "bg-gray-100"}`} />}
                  </React.Fragment>
                ))}
        </div>

        {/* success message */}
        {successMessage && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <CheckCircle2 size={18} />
            </div>
            <p className="text-sm font-medium text-emerald-700">{successMessage}</p>
          </div>
        )}

        <form onSubmit={handleFinalRegister} className="space-y-4" noValidate>
                {/* step 1 */}
                {step === 1 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-1">Register as</p>
                      <p className="text-sm text-gray-500 mb-3">Choose what type of account you want to create.</p>
                      <div className="grid grid-cols-2 gap-3">
                        <button type="button" onClick={() => handleAccountSelect("user")}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 transition ${accountType === "user" ? "border-[#017FE6] bg-blue-50" : "border-gray-200 hover:border-[#017FE6]"}`}>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 text-xs ${accountType === "user" ? "border-[#017FE6] bg-[#017FE6] text-white" : "border-gray-300"}`}>
                            {accountType === "user" && "✓"}
                          </div>
                          <User size={18} className="text-gray-600" />
                          <div className="text-left"><p className="font-semibold text-gray-800 text-sm">User</p><p className="text-xs text-gray-500">Rent vehicles</p></div>
                        </button>
                        <button type="button" onClick={() => handleAccountSelect("renter")}
                          className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-200 hover:border-[#017FE6] transition">
                          <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex items-center justify-center shrink-0" />
                          <Car size={18} className="text-gray-600" />
                          <div className="text-left"><p className="font-semibold text-gray-800 text-sm">Owner</p><p className="text-xs text-gray-500">List vehicles</p></div>
                        </button>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-1">Step 1 — Personal Details</p>
                      <p className="text-sm text-gray-500">Enter your information to create your account.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="First Name" value={form.firstName} onChange={(e) => handleChange("firstName", e.target.value)} error={errors.firstName} disabled={isLoading} placeholder="John" required icon={User} onlyLetters inputRef={firstNameRef} />
                      <FormInput label="Last Name" value={form.lastName} onChange={(e) => handleChange("lastName", e.target.value)} error={errors.lastName} disabled={isLoading} placeholder="Doe" required icon={User} onlyLetters inputRef={lastNameRef} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="Email Address" type="email" value={form.email} onChange={(e) => handleChange("email", e.target.value.toLowerCase().trim())} error={errors.email} disabled={isLoading} placeholder="john@gmail.com" required icon={Mail} inputRef={emailRef} showEmailHint />
                      <FormInput label="Phone Number" type="tel" value={form.phone} onChange={(e) => handleChange("phone", e.target.value)} error={errors.phone} disabled={isLoading} placeholder="09123456789" required icon={Phone} onlyNumbers inputRef={phoneRef} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormInput label="Date of Birth" type="date" value={form.dateOfBirth} onChange={(e) => handleChange("dateOfBirth", e.target.value)} error={errors.dateOfBirth} disabled={isLoading} required icon={Calendar} inputRef={dobRef} />
                      <SelectField label="Gender" value={form.gender} onChange={(value) => handleChange("gender", value)} options={[
                        { value: "Male", label: "Male" },
                        { value: "Female", label: "Female" },
                        { value: "Prefer not to say", label: "Prefer not to say" },
                      ]} error={errors.gender} disabled={isLoading} required inputRef={genderRef} />
                    </div>
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
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white space-y-4">
                      <div>
                        <p className="font-semibold text-gray-900">Emergency Contact</p>
                        <p className="text-sm text-gray-500 mt-1">Add someone we can reach if you need urgent support during a booking.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormInput label="Contact Name" value={form.emergencyContactName} onChange={(e) => handleChange("emergencyContactName", e.target.value)} error={errors.emergencyContactName} disabled={isLoading} placeholder="Maria Dela Cruz" required icon={User} inputRef={emergencyNameRef} />
                        <FormInput label="Phone Number" type="tel" value={form.emergencyContactPhone} onChange={(e) => handleChange("emergencyContactPhone", e.target.value)} error={errors.emergencyContactPhone} disabled={isLoading} placeholder="09123456789" required icon={Phone} onlyNumbers inputRef={emergencyPhoneRef} />
                      </div>
                      <SelectField label="Relationship" value={form.emergencyContactRelationship} onChange={(value) => handleChange("emergencyContactRelationship", value)} options={RELATIONSHIP_OPTIONS.map((option) => ({ value: option, label: option }))} error={errors.emergencyContactRelationship} disabled={isLoading} required inputRef={emergencyRelationshipRef} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <PasswordInput label="Password" value={form.password} onChange={(e) => handleChange("password", e.target.value)} error={errors.password} disabled={isLoading} required showStrength inputRef={passwordRef} />
                      <PasswordInput label="Confirm Password" value={form.confirmPassword} onChange={(e) => handleChange("confirmPassword", e.target.value)} error={errors.confirmPassword} disabled={isLoading} required showStrength={false} inputRef={confirmPasswordRef} />
                    </div>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <input type="checkbox" checked={form.agree} onChange={(e) => handleChange("agree", e.target.checked)} disabled={isLoading} className="w-5 h-5 accent-[#017FE6] cursor-pointer flex-shrink-0" />
                        <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                          I agree to the <span className="text-[#017FE6] font-semibold hover:underline cursor-pointer">Terms & Conditions</span> and <span className="text-[#017FE6] font-semibold hover:underline cursor-pointer">Privacy Policy</span>
                        </span>
                      </label>
                      {errors.agree && <p className="text-red-500 text-sm font-medium">{errors.agree}</p>}
                    </div>
                  </>
                )}

                {/* step 2 */}
                {step === 2 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <ShieldCheck size={20} className="text-[#017FE6]" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">Step 2 — Identity Verification</p>
                          <p className="text-sm text-gray-500 mt-1">
                            Upload your <span className="font-semibold text-gray-700">full ID card</span>, then capture a live selfie to verify your identity.
                          </p>
                        </div>
                      </div>
                    </div>

                    <FileCard
                      title="Government ID (Front — full card)"
                      description="Upload a clear photo showing the entire ID card with readable text and no cropped edges."
                      file={kyc.idCardFile}
                      onPick={(f) => {
                        setKyc((prev) => ({ ...prev, idCardFile: f, idRegistered: false, challengeId: "", selfieVerified: false, selfieDataUrl: "", selfieBase64Clean: "" }));
                        setKycUi((p) => ({ ...p, statusText: "" }));
                        setStepErrors({});
                        setCamError(""); setCamInfo(""); closeCamera();
                      }}
                      onRemove={() => { resetKyc(); closeCamera(); }}
                      accept="image/*" inputRef={idInputRef} icon={Upload}
                      error={stepErrors.idCardFile}
                    />

                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900 mb-3">Verification Steps</p>
                      <div className="grid grid-cols-2 gap-3">
                        <button type="button" disabled={isLoading || !kyc.idCardFile} onClick={registerId}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${
                            kyc.idRegistered ? "bg-green-500 text-white cursor-default" : "bg-gray-900 text-white hover:opacity-95"
                          } disabled:opacity-50`}>
                          {isLoading && !kyc.idRegistered
                            ? <><Loader size={15} className="animate-spin" /> Processing...</>
                            : kyc.idRegistered ? "✓ ID Registered" : "1. Register ID"}
                        </button>

                        <button type="button" disabled={isLoading || !kyc.idRegistered} onClick={kycUi.showCamera ? closeCamera : openCamera}
                          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#017FE6] to-[#0165B8] hover:opacity-95 disabled:opacity-50 transition">
                          {kycUi.showCamera ? "Close Camera" : "2. Open Camera"}
                        </button>

                        <button type="button" disabled={isLoading || !cameraStream || !kyc.idRegistered} onClick={captureSelfie}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${
                            kyc.selfieBase64Clean ? "bg-blue-500 text-white" : "bg-gray-700 text-white hover:opacity-95"
                          } disabled:opacity-50`}>
                          {isLoading && !kyc.selfieBase64Clean
                            ? <><Loader size={15} className="animate-spin" /> Capturing...</>
                            : kyc.selfieBase64Clean ? "✓ Retake Selfie" : "3. Capture Selfie"}
                        </button>

                        <button type="button" disabled={isLoading || !kyc.selfieBase64Clean || !kyc.challengeId || kyc.selfieVerified} onClick={verifySelfie}
                          className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl font-semibold text-sm transition ${
                            kyc.selfieVerified ? "bg-green-500 text-white cursor-default" : "bg-green-600 text-white hover:opacity-95"
                          } disabled:opacity-50`}>
                          {isLoading && !kyc.selfieVerified
                            ? <><Loader size={15} className="animate-spin" /> Verifying...</>
                            : kyc.selfieVerified ? "✓ Face Verified!" : "4. Verify Face Match"}
                        </button>
                      </div>

                      {kycUi.statusText && (
                        <p className={`text-sm font-medium mt-3 ${kyc.selfieVerified ? "text-green-600" : "text-gray-600"}`}>
                          {kycUi.statusText}
                        </p>
                      )}
                      {stepErrors.idRegistered && <p className="text-red-500 text-sm font-medium mt-2">{stepErrors.idRegistered}</p>}
                      {stepErrors.selfieVerified && <p className="text-red-500 text-sm font-medium mt-1">{stepErrors.selfieVerified}</p>}
                    </div>

                    {kycUi.showCamera && (
                      <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50 space-y-3">
                        <video ref={videoRef} autoPlay playsInline muted
                          className="w-full rounded-xl bg-black aspect-video object-cover"
                          style={{ transform: "scaleX(-1)" }} />
                        {devices.length > 0 && (
                          <div>
                            <label className="text-xs text-gray-600 font-medium block mb-1">Camera device</label>
                            <select value={selectedDeviceId} onChange={(e) => switchCamera(e.target.value)}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 bg-white text-sm">
                              {devices.map((d, idx) => (
                                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${idx + 1}`}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {camError && <p className="text-sm text-red-600 p-2 bg-red-50 rounded-lg">{camError}</p>}
                        {camInfo && <p className="text-xs text-gray-600 p-2 bg-gray-100 rounded-lg break-words">{camInfo}</p>}
                        <button type="button" disabled={isLoading} onClick={closeCamera}
                          className="w-full px-4 py-2 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-white transition disabled:opacity-50">
                          Close Camera
                        </button>
                        {kyc.selfieDataUrl && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-2">Captured Selfie Preview</p>
                            <img src={kyc.selfieDataUrl} alt="Captured selfie" className="w-full rounded-xl border border-gray-200" style={{ transform: "scaleX(-1)" }} />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* step 3 */}
                {step === 3 && (
                  <>
                    <div className="rounded-2xl border border-gray-200 p-4 bg-white">
                      <p className="font-semibold text-gray-900">Step 3 — Review & Submit</p>
                      <p className="text-sm text-gray-500 mt-1">Confirm your details before creating your account.</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50 space-y-3">
                      {[
                        { label: "Full Name", value: fullName || "—" },
                        { label: "Email", value: form.email || "—" },
                        { label: "Phone", value: form.phone || "—" },
                        { label: "Account Type", value: "User (Renter)" },
                        { label: "KYC Verified", value: kyc.selfieVerified ? "✅ Verified" : "⚠️ Not Verified", highlight: kyc.selfieVerified },
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

                {/* navigation */}
                <div className="flex items-center gap-3 pt-1">
                  <button type="button" onClick={goBack} disabled={step === 1 || isLoading}
                    className="rp-btn-secondary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-50">
                    <ArrowLeft size={18} /> Back
                  </button>
                  {step < TOTAL_STEPS ? (
                    <button type="button" onClick={goNext} disabled={isLoading}
                      className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                      Next <ArrowRight size={18} />
                    </button>
                  ) : (
                    <button type="submit" disabled={isLoading}
                      className="rp-btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-70">
                      {isLoading ? <><Loader size={18} className="animate-spin" /> Creating...</> : "Create Account"}
                    </button>
                  )}
                </div>

                {step === 1 && (
                  <p className="text-center text-gray-500 text-sm mt-1">
                    Already have an account?{" "}
                    <button type="button" onClick={onNavigateToSignIn} disabled={isLoading}
                      className="text-[#017FE6] font-semibold hover:underline transition-colors disabled:opacity-50">
                      Sign In
                    </button>
                  </p>
                )}
        </form>
      </div>
    </AuthShell>
  );
}

>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
