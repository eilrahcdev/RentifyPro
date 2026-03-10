import React, { useEffect, useState } from "react";
import {
  Bot,
  Car,
  ShieldCheck,
  User,
  Lock,
  BellRing,
  BadgeCheck,
  Shield,
  Camera,
} from "lucide-react";
import Navbar from "../components/Navbar";
import ChatWidget from "../components/ChatWidget";
import API from "../utils/api";
import {
  getStoredUser,
  getUserProfileFromStorage,
  normalizeUserProfile,
  persistUserProfile,
} from "../utils/userProfile";
import { RELATIONSHIP_OPTIONS } from "../data/registerValidation";

const PSGC_BASE_URL = "https://psgc.gitlab.io/api";
const GENDER_OPTIONS = ["Male", "Female", "Prefer not to say"];
const MIN_RENTER_AGE = 18;
const PHONE_REGEX = /^[0-9]{11}$/;
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
  walletAddress: null,
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
}) {
  return (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        disabled={disabled}
        max={max}
        className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${
          disabled ? "bg-gray-100" : "bg-white"
        }`}
      />
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
          <option key={option.value} value={option.value}>
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
    payload.emergencyContactName = profile.emergencyContactName || "";
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
  onNavigateToVehicleOwnerProceed,
  isLoggedIn,
  user,
  onLogout,
}) => {
  const [showAI, setShowAI] = useState(false);
  const [activeTab, setActiveTab] = useState("Profile Settings");
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
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingSection, setSavingSection] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [isAddressEdited, setIsAddressEdited] = useState(false);

  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);

  const current = draftProfile || profile;
  const activeUserIdentity = String(user?._id || user?.email || "").trim().toLowerCase();

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
  }, [activeUserIdentity]);

  const syncAvatarAcrossApp = async (avatarValue = "") => {
    const normalizedAvatar = String(avatarValue || "").trim();
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
      setStatusMessage("Profile photo updated.");
      setStatusError("");
    } catch (error) {
      setStatusError(error.message || "Profile photo saved locally. Cloud sync failed.");
    }
  };

  useEffect(() => {
    let active = true;
    fetch(`${PSGC_BASE_URL}/regions/`)
      .then((response) => response.json())
      .then((data) => {
        if (active) setRegions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setRegions([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!current.region) {
      setProvinces([]);
      setCities([]);
      setBarangays([]);
      return;
    }

    let active = true;

    const loadProvincesOrCities = async () => {
      try {
        const provinceResponse = await fetch(`${PSGC_BASE_URL}/regions/${current.region}/provinces/`);
        if (!provinceResponse.ok) throw new Error("Failed to load provinces.");
        const provinceData = await provinceResponse.json();
        const provinceList = Array.isArray(provinceData) ? provinceData : [];
        if (!active) return;

        setProvinces(provinceList);
        setBarangays([]);

        if (provinceList.length === 0) {
          const cityResponse = await fetch(
            `${PSGC_BASE_URL}/regions/${current.region}/cities-municipalities/`
          );
          if (!cityResponse.ok) throw new Error("Failed to load cities.");
          const cityData = await cityResponse.json();
          if (!active) return;
          setCities(Array.isArray(cityData) ? cityData : []);
        } else if (!current.province) {
          setCities([]);
        }
      } catch {
        if (!active) return;
        setProvinces([]);
        setCities([]);
        setBarangays([]);
      }
    };

    loadProvincesOrCities();
    return () => {
      active = false;
    };
  }, [current.region, current.province]);

  useEffect(() => {
    if (!current.region || provinces.length === 0 || !current.province) {
      if (!current.province && provinces.length > 0) {
        setCities([]);
        setBarangays([]);
      }
      return;
    }

    let active = true;
    fetch(`${PSGC_BASE_URL}/provinces/${current.province}/cities-municipalities/`)
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setCities(Array.isArray(data) ? data : []);
        setBarangays([]);
      })
      .catch(() => {
        if (!active) return;
        setCities([]);
        setBarangays([]);
      });

    return () => {
      active = false;
    };
  }, [current.province, current.region, provinces.length]);

  useEffect(() => {
    if (!current.city) {
      setBarangays([]);
      return;
    }

    let active = true;
    fetch(`${PSGC_BASE_URL}/cities-municipalities/${current.city}/barangays/`)
      .then((response) => response.json())
      .then((data) => {
        if (active) setBarangays(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setBarangays([]);
      });

    return () => {
      active = false;
    };
  }, [current.city]);

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

    const reader = new FileReader();
    reader.onloadend = async () => {
      await syncAvatarAcrossApp(reader.result || "");
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    syncAvatarAcrossApp("");
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
        setStatusError("Please enter a valid 11-digit phone number.");
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
    <div className="min-h-screen bg-white">
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
        onLogout={onLogout}
      />

      <div className="pt-24 bg-gray-50 min-h-screen">
        <div className="max-w-7xl mx-auto px-6 flex flex-col lg:flex-row gap-6">
          <aside className="w-full lg:w-72 space-y-6 lg:sticky top-24 self-start mt-4">
            <div className="bg-white rounded-xl shadow p-5 space-y-1">
              {[
                { label: "Profile Settings", icon: User },
                { label: "Change Password", icon: Lock },
                { label: "Notifications Settings", icon: BellRing },
                { label: "Verification", icon: ShieldCheck },
                { label: "Login Activity", icon: Shield },
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

            <div className="bg-white rounded-xl shadow p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#E6F2FF] flex items-center justify-center">
                  <Car size={18} className="text-[#017FE6]" />
                </div>
                <h4 className="font-semibold text-m text-gray-900 leading-none">
                  Become a Vehicle Owner
                </h4>
              </div>

              <p className="text-sm text-gray-500 leading-relaxed">
                List your vehicles and earn money by renting them to verified users.
              </p>

              <p className="text-sm text-gray-500">
                Start building your rental fleet today.
              </p>

              <button
                onClick={() => onNavigateToVehicleOwnerProceed()}
                className="w-full bg-[#017FE6] text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-[#0165B8] transition"
              >
                Register as Vehicle Owner
              </button>
            </div>
          </aside>

          <main className="flex-1 space-y-8 pb-12">
            <div className="pb-6 mb-6 border-b">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Account Settings</h1>
              <p className="text-base text-gray-500 max-w-xl">
                Manage your personal information and account preferences
              </p>
            </div>

            {loadingProfile && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700">
                Loading your latest profile details...
              </div>
            )}
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

            <div className="bg-white rounded-xl shadow p-6 flex items-center gap-4">
              <div className="relative">
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
                    <div className="absolute top-full left-0 mt-2 mr-1 w-40 bg-white rounded-lg shadow-lg border z-50 origin-top-right">
                      <label className="block px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer">
                        Upload Photo
                        <input
                          type="file"
                          accept="image/*"
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
                          String(event.target.value || "")
                            .replace(/\D/g, "")
                            .slice(0, 11)
                        )
                      }
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
                      disabled={editingSection !== "location" || !current.city}
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
                    />
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
                        updateDraftField("emergencyContactName", event.target.value)
                      }
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
                        updateDraftField("emergencyContactPhone", event.target.value)
                      }
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
                      }))}
                      onChange={(event) =>
                        updateDraftField("emergencyContactRelationship", event.target.value)
                      }
                    />
                  </>
                ),
              },
            ].map((section) => (
              <div key={section.key} className="bg-white rounded-xl shadow p-6">
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
          </main>
        </div>
      </div>

      {!showAI && (
        <button
          onClick={() => setShowAI(true)}
          aria-label="AI Assistant"
          className="fixed bottom-6 right-6 z-[70] w-14 h-14 flex items-center justify-center rounded-full bg-[#017FE6] hover:bg-[#0165B8] text-white shadow-2xl transition-all duration-300 hover:scale-105"
        >
          <Bot size={24} />
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-400 rounded-full border-2 border-white" />
        </button>
      )}

      <ChatWidget isOpen={showAI} onClose={() => setShowAI(false)} />
    </div>
  );
};

export default AccountSettings;
