import React, { useState, useEffect } from "react";
import {
<<<<<<< HEAD
=======
<<<<<<< HEAD
  Camera,
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  BadgeCheck,
  ShieldCheck,
  User,
  Building2,
<<<<<<< HEAD
  Wallet,
} from "lucide-react";
=======
<<<<<<< HEAD
  CreditCard,
} from "lucide-react";
=======
  Wallet,
} from "lucide-react";
>>>>>>> 8422a2f (fixed bugs and updates)
import API from "../../utils/api";
import {
  getOwnerProfileFromStorage,
  getStoredUser,
  normalizeOwnerProfile,
  persistOwnerProfile,
} from "../utils/ownerProfile";
import { connectMetaMaskWallet, getEthereumProvider } from "../../blockchain/metamask";
import { shortAddress } from "../../blockchain/config";
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)

const InputField = ({ label, value, onChange, disabled }) => (
  <div>
    <label className="text-xs text-gray-500">{label}</label>
    <input
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm ${
        disabled ? "bg-gray-100" : "bg-white"
      }`}
    />
  </div>
);

const SelectField = ({ label, value, onChange, options, disabled }) => (
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
      <option value="">Select</option>
<<<<<<< HEAD
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.name}
=======
<<<<<<< HEAD
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.name}
=======
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.name}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
        </option>
      ))}
    </select>
  </div>
);

<<<<<<< HEAD
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
  walletAddress: "",
};
=======
<<<<<<< HEAD
>>>>>>> 8422a2f (fixed bugs and updates)

export default function Profile() {
  const [editing, setEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");

  const [profile, setProfile] = useState(() => {
    const stored = getOwnerProfileFromStorage();
    const user = getStoredUser();
    return {
      ...DEFAULT_PROFILE,
      ...stored,
      email: stored.email || user.email || "",
    };
  });

<<<<<<< HEAD
=======
  /* AVATAR */
  const [photo, setPhoto] = useState(
    localStorage.getItem("ownerProfilePhoto")
  );

  /* PSGC */
=======
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
  walletAddress: "",
};

export default function Profile() {
  const [editing, setEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");

  const [profile, setProfile] = useState(() => {
    const stored = getOwnerProfileFromStorage();
    const user = getStoredUser();
    return {
      ...DEFAULT_PROFILE,
      ...stored,
      email: stored.email || user.email || "",
    };
  });

>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);

<<<<<<< HEAD
=======
<<<<<<< HEAD

>>>>>>> 8422a2f (fixed bugs and updates)
  useEffect(() => {
    let mounted = true;
    const syncFromApi = async () => {
      try {
        const response = await API.getProfile();
        if (!mounted || !response?.user) return;

        const normalized = normalizeOwnerProfile(response.user, response.user);
        const persisted = persistOwnerProfile(normalized);

        setProfile((prev) => ({
          ...prev,
          ...persisted,
          email: persisted.email || prev.email,
        }));
        window.dispatchEvent(new Event("owner-profile-updated"));
      } catch {
        // Keep local profile data if the API sync fails.
      }
    };

    syncFromApi();

    return () => {
      mounted = false;
    };
  }, []);

  const saveProfile = async () => {
    setStatusMessage("");
    setStatusError("");
    setIsSaving(true);

    const payload = {
      name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim(),
      phone: profile.phone,
      ownerType: profile.ownerType,
      businessName: profile.ownerType === "business" ? profile.businessName : "",
      permitNumber: profile.ownerType === "business" ? profile.permitNumber : "",
      licenseNumber: profile.licenseNumber,
      address: profile.address,
      region: profile.region,
      province: profile.province,
      city: profile.city,
      barangay: profile.barangay,
      walletAddress: profile.walletAddress || "",
    };

    try {
      const response = await API.updateProfile(payload);
      const normalized = normalizeOwnerProfile(response?.user || payload, {
        ...getStoredUser(),
        email: profile.email,
      });
      const persisted = persistOwnerProfile({
        ...normalized,
        email: normalized.email || profile.email,
      });

      setProfile((prev) => ({
        ...prev,
        ...persisted,
        email: persisted.email || prev.email,
      }));
      setEditing(false);
      setStatusMessage("Profile updated successfully.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      // Keep the local update so edits are not lost.
      const fallbackProfile = persistOwnerProfile({
        ...profile,
        name: payload.name || profile.name,
      });
      setProfile((prev) => ({ ...prev, ...fallbackProfile }));
      setEditing(false);
      setStatusError(error.message || "Could not update profile on server. Saved locally instead.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } finally {
      setIsSaving(false);
    }
  };

  const connectWalletAddress = async () => {
    setWalletError("");
    setStatusError("");
    setStatusMessage("");
    setWalletLoading(true);

    try {
      const connection = await connectMetaMaskWallet();
      const response = await API.updateProfile({ walletAddress: connection.address });

      const normalized = normalizeOwnerProfile(response?.user || {}, {
        ...profile,
        walletAddress: connection.address,
      });
      const persisted = persistOwnerProfile({
        ...profile,
        ...normalized,
        walletAddress: normalized.walletAddress || connection.address,
      });

      setProfile((prev) => ({
        ...prev,
        ...persisted,
        walletAddress: persisted.walletAddress || connection.address,
      }));

      setStatusMessage(`Wallet connected: ${shortAddress(persisted.walletAddress || connection.address)}`);
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      setWalletError(error?.message || "Failed to connect wallet.");
    } finally {
      setWalletLoading(false);
    }
  };

  useEffect(() => {
    fetch("https://psgc.gitlab.io/api/regions/")
      .then((response) => response.json())
      .then(setRegions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!profile.region) {
      setProvinces([]);
      return;
    }
    fetch(`https://psgc.gitlab.io/api/regions/${profile.region}/provinces/`)
      .then((response) => response.json())
      .then(setProvinces)
      .catch(() => {});
  }, [profile.region]);

  useEffect(() => {
    if (!profile.province) {
      setCities([]);
      return;
    }
    fetch(`https://psgc.gitlab.io/api/provinces/${profile.province}/cities-municipalities/`)
      .then((response) => response.json())
      .then(setCities)
      .catch(() => {});
  }, [profile.province]);

  useEffect(() => {
<<<<<<< HEAD
=======
    if (!profile.city) return;
    fetch(
      `https://psgc.gitlab.io/api/cities-municipalities/${profile.city}/barangays/`
    )
      .then((r) => r.json())
      .then(setBarangays);
=======
  useEffect(() => {
    let mounted = true;
    const syncFromApi = async () => {
      try {
        const response = await API.getProfile();
        if (!mounted || !response?.user) return;

        const normalized = normalizeOwnerProfile(response.user, response.user);
        const persisted = persistOwnerProfile(normalized);

        setProfile((prev) => ({
          ...prev,
          ...persisted,
          email: persisted.email || prev.email,
        }));
        window.dispatchEvent(new Event("owner-profile-updated"));
      } catch {
        // Keep local profile data if the API sync fails.
      }
    };

    syncFromApi();

    return () => {
      mounted = false;
    };
  }, []);

  const saveProfile = async () => {
    setStatusMessage("");
    setStatusError("");
    setIsSaving(true);

    const payload = {
      name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim(),
      phone: profile.phone,
      ownerType: profile.ownerType,
      businessName: profile.ownerType === "business" ? profile.businessName : "",
      permitNumber: profile.ownerType === "business" ? profile.permitNumber : "",
      licenseNumber: profile.licenseNumber,
      address: profile.address,
      region: profile.region,
      province: profile.province,
      city: profile.city,
      barangay: profile.barangay,
      walletAddress: profile.walletAddress || "",
    };

    try {
      const response = await API.updateProfile(payload);
      const normalized = normalizeOwnerProfile(response?.user || payload, {
        ...getStoredUser(),
        email: profile.email,
      });
      const persisted = persistOwnerProfile({
        ...normalized,
        email: normalized.email || profile.email,
      });

      setProfile((prev) => ({
        ...prev,
        ...persisted,
        email: persisted.email || prev.email,
      }));
      setEditing(false);
      setStatusMessage("Profile updated successfully.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      // Keep the local update so edits are not lost.
      const fallbackProfile = persistOwnerProfile({
        ...profile,
        name: payload.name || profile.name,
      });
      setProfile((prev) => ({ ...prev, ...fallbackProfile }));
      setEditing(false);
      setStatusError(error.message || "Could not update profile on server. Saved locally instead.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } finally {
      setIsSaving(false);
    }
  };

  const connectWalletAddress = async () => {
    setWalletError("");
    setStatusError("");
    setStatusMessage("");
    setWalletLoading(true);

    try {
      const connection = await connectMetaMaskWallet();
      const response = await API.updateProfile({ walletAddress: connection.address });

      const normalized = normalizeOwnerProfile(response?.user || {}, {
        ...profile,
        walletAddress: connection.address,
      });
      const persisted = persistOwnerProfile({
        ...profile,
        ...normalized,
        walletAddress: normalized.walletAddress || connection.address,
      });

      setProfile((prev) => ({
        ...prev,
        ...persisted,
        walletAddress: persisted.walletAddress || connection.address,
      }));

      setStatusMessage(`Wallet connected: ${shortAddress(persisted.walletAddress || connection.address)}`);
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      setWalletError(error?.message || "Failed to connect wallet.");
    } finally {
      setWalletLoading(false);
    }
  };

  useEffect(() => {
    fetch("https://psgc.gitlab.io/api/regions/")
      .then((response) => response.json())
      .then(setRegions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!profile.region) {
      setProvinces([]);
      return;
    }
    fetch(`https://psgc.gitlab.io/api/regions/${profile.region}/provinces/`)
      .then((response) => response.json())
      .then(setProvinces)
      .catch(() => {});
  }, [profile.region]);

  useEffect(() => {
    if (!profile.province) {
      setCities([]);
      return;
    }
    fetch(`https://psgc.gitlab.io/api/provinces/${profile.province}/cities-municipalities/`)
      .then((response) => response.json())
      .then(setCities)
      .catch(() => {});
  }, [profile.province]);

  useEffect(() => {
>>>>>>> 8422a2f (fixed bugs and updates)
    if (!profile.city) {
      setBarangays([]);
      return;
    }
    fetch(`https://psgc.gitlab.io/api/cities-municipalities/${profile.city}/barangays/`)
      .then((response) => response.json())
      .then(setBarangays)
      .catch(() => {});
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
  }, [profile.city]);

  return (
    <div className="p-6 space-y-6">
<<<<<<< HEAD
=======
<<<<<<< HEAD
      {/* HEADER */}
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Owner Profile</h1>
        <button
          onClick={() => (editing ? saveProfile() : setEditing(true))}
<<<<<<< HEAD
          disabled={isSaving}
          className="px-4 py-2 rounded-full border hover:bg-gray-100 disabled:opacity-60"
=======
<<<<<<< HEAD
          className="px-4 py-2 rounded-full border hover:bg-gray-100"
>>>>>>> 8422a2f (fixed bugs and updates)
        >
          {editing ? (isSaving ? "Saving..." : "Save") : "Edit"}
        </button>
      </div>

      {statusMessage && (
        <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {statusMessage}
        </p>
      )}
      {statusError && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {statusError}
        </p>
      )}

      <div className="bg-white rounded-xl shadow p-6 flex gap-6 items-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-[#017FE6] text-white flex items-center justify-center text-2xl font-bold overflow-hidden">
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.name || "Owner"} className="w-full h-full object-cover" />
            ) : (
              `${profile.firstName?.[0] || ""}${profile.lastName?.[0] || ""}`.toUpperCase() || "O"
            )}
          </div>
<<<<<<< HEAD
=======

          {editing && (
            <>
              <label className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow cursor-pointer">
                <Camera size={18} />
                <input type="file" hidden onChange={uploadPhoto} />
              </label>

              {photo && (
                <button
                  onClick={removePhoto}
                  className="text-xs text-red-500 block mt-1"
                >
                  Remove
                </button>
              )}
            </>
          )}
=======
          disabled={isSaving}
          className="px-4 py-2 rounded-full border hover:bg-gray-100 disabled:opacity-60"
        >
          {editing ? (isSaving ? "Saving..." : "Save") : "Edit"}
        </button>
      </div>

      {statusMessage && (
        <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {statusMessage}
        </p>
      )}
      {statusError && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {statusError}
        </p>
      )}

      <div className="bg-white rounded-xl shadow p-6 flex gap-6 items-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-[#017FE6] text-white flex items-center justify-center text-2xl font-bold overflow-hidden">
            {profile.avatar ? (
              <img src={profile.avatar} alt={profile.name || "Owner"} className="w-full h-full object-cover" />
            ) : (
              `${profile.firstName?.[0] || ""}${profile.lastName?.[0] || ""}`.toUpperCase() || "O"
            )}
          </div>
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
        </div>

        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
<<<<<<< HEAD
            {`${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.name || "Owner"}
=======
<<<<<<< HEAD
            {profile.firstName} {profile.lastName}
>>>>>>> 8422a2f (fixed bugs and updates)
            <BadgeCheck className="text-[#017FE6]" size={18} />
          </h2>
          <p className="text-gray-500">{profile.email || "No email found"}</p>
          <span className="text-sm text-[#017FE6] font-medium">Verified Owner</span>
        </div>
      </div>

<<<<<<< HEAD
=======
      {/* PERSONAL */}
=======
            {`${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.name || "Owner"}
            <BadgeCheck className="text-[#017FE6]" size={18} />
          </h2>
          <p className="text-gray-500">{profile.email || "No email found"}</p>
          <span className="text-sm text-[#017FE6] font-medium">Verified Owner</span>
        </div>
      </div>

>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      <Section title="Personal Information" icon={User}>
        <InputField
          label="First Name"
          value={profile.firstName}
          disabled={!editing}
<<<<<<< HEAD
          onChange={(event) => setProfile((prev) => ({ ...prev, firstName: event.target.value }))}
=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({ ...profile, firstName: e.target.value })
          }
=======
          onChange={(event) => setProfile((prev) => ({ ...prev, firstName: event.target.value }))}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
        />
        <InputField
          label="Last Name"
          value={profile.lastName}
          disabled={!editing}
<<<<<<< HEAD
          onChange={(event) => setProfile((prev) => ({ ...prev, lastName: event.target.value }))}
=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({ ...profile, lastName: e.target.value })
          }
=======
          onChange={(event) => setProfile((prev) => ({ ...prev, lastName: event.target.value }))}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
        />
        <InputField label="Email" value={profile.email} disabled />
        <InputField
          label="Phone"
          value={profile.phone}
          disabled={!editing}
<<<<<<< HEAD
          onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
        />
      </Section>

=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({ ...profile, phone: e.target.value })
          }
        />
      </Section>

      {/* ADDRESS */}
=======
          onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
        />
      </Section>

>>>>>>> 8422a2f (fixed bugs and updates)
      <Section title="Blockchain Wallet" icon={Wallet}>
        <InputField label="Wallet Address" value={profile.walletAddress || ""} disabled />
        <div className="col-span-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={connectWalletAddress}
            disabled={walletLoading || !getEthereumProvider()}
            className={`px-3 py-2 rounded-lg text-sm ${
              walletLoading || !getEthereumProvider()
                ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                : "bg-[#017FE6] text-white"
            }`}
          >
            {walletLoading
              ? "Connecting..."
              : profile.walletAddress
                ? `Reconnect (${shortAddress(profile.walletAddress)})`
                : "Connect MetaMask"}
          </button>
          {!getEthereumProvider() && (
            <p className="text-xs text-gray-500">MetaMask extension is required for Sepolia wallet linking.</p>
          )}
        </div>
      </Section>

      {walletError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{walletError}</p>
      )}

<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      <Section title="Address Information" icon={Building2}>
        <InputField
          label="Full Address"
          value={profile.address}
          disabled={!editing}
<<<<<<< HEAD
          onChange={(event) => setProfile((prev) => ({ ...prev, address: event.target.value }))}
=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({ ...profile, address: e.target.value })
          }
=======
          onChange={(event) => setProfile((prev) => ({ ...prev, address: event.target.value }))}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
        />
        <SelectField
          label="Region"
          value={profile.region}
          disabled={!editing}
          options={regions}
<<<<<<< HEAD
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              region: event.target.value,
              province: "",
              city: "",
              barangay: "",
            }))
=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({
              ...profile,
              region: e.target.value,
              province: "",
              city: "",
              barangay: "",
            })
=======
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              region: event.target.value,
              province: "",
              city: "",
              barangay: "",
            }))
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          }
        />
        <SelectField
          label="Province"
          value={profile.province}
          disabled={!editing || !profile.region}
          options={provinces}
<<<<<<< HEAD
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              province: event.target.value,
              city: "",
              barangay: "",
            }))
=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({
              ...profile,
              province: e.target.value,
              city: "",
              barangay: "",
            })
=======
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              province: event.target.value,
              city: "",
              barangay: "",
            }))
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          }
        />
        <SelectField
          label="City"
          value={profile.city}
          disabled={!editing || !profile.province}
          options={cities}
<<<<<<< HEAD
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              city: event.target.value,
              barangay: "",
            }))
=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({
              ...profile,
              city: e.target.value,
              barangay: "",
            })
=======
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              city: event.target.value,
              barangay: "",
            }))
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          }
        />
        <SelectField
          label="Barangay"
          value={profile.barangay}
          disabled={!editing || !profile.city}
          options={barangays}
<<<<<<< HEAD
=======
<<<<<<< HEAD
          onChange={(e) =>
            setProfile({
              ...profile,
              barangay: e.target.value,
            })
=======
>>>>>>> 8422a2f (fixed bugs and updates)
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              barangay: event.target.value,
            }))
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
          }
        />
      </Section>

<<<<<<< HEAD
=======
<<<<<<< HEAD
      {/* BUSINESS */}
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
      {profile.ownerType === "business" && (
        <Section title="Business Information" icon={Building2}>
          <InputField
            label="Business Name"
            value={profile.businessName}
            disabled={!editing}
<<<<<<< HEAD
=======
<<<<<<< HEAD
            onChange={(e) =>
              setProfile({
                ...profile,
                businessName: e.target.value,
              })
=======
>>>>>>> 8422a2f (fixed bugs and updates)
            onChange={(event) =>
              setProfile((prev) => ({
                ...prev,
                businessName: event.target.value,
              }))
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            }
          />
          <InputField
            label="Permit Number"
            value={profile.permitNumber}
            disabled={!editing}
<<<<<<< HEAD
=======
<<<<<<< HEAD
            onChange={(e) =>
              setProfile({
                ...profile,
                permitNumber: e.target.value,
              })
=======
>>>>>>> 8422a2f (fixed bugs and updates)
            onChange={(event) =>
              setProfile((prev) => ({
                ...prev,
                permitNumber: event.target.value,
              }))
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            }
          />
        </Section>
      )}

<<<<<<< HEAD
      <Section title="Verification Status" icon={ShieldCheck}>
=======
<<<<<<< HEAD
      {/* LICENSE */}
      <Section title="License Information" icon={CreditCard}>
        <InputField
          label="Driver’s License Number"
          value={profile.licenseNumber}
          disabled={!editing}
          onChange={(e) =>
            setProfile({
              ...profile,
              licenseNumber: e.target.value,
            })
          }
        />
      </Section>

      {/* VERIFICATION */}
      <Section title="Verification Status" icon={ShieldCheck}>
    <Status label="Government ID" status="Submitted" />
    <Status label="Driver’s License" status="Submitted" />
    {profile.ownerType === "business" && (
        <Status label="Business Permit" status="Submitted" />
    )}
    <Status label="Selfie Verification" status="Submitted" />
    </Section>
=======
      <Section title="Verification Status" icon={ShieldCheck}>
>>>>>>> 8422a2f (fixed bugs and updates)
        <Status label="Government ID" status="Submitted" />
        {profile.ownerType === "business" && <Status label="Business Permit" status="Submitted" />}
        <Status label="Selfie Verification" status="Verified" />
      </Section>
<<<<<<< HEAD
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    </div>
  );
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
/* ===========================
   HELPERS
=========================== */
=======
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
const Section = ({ title, icon: Icon, children }) => (
  <div className="bg-white rounded-xl shadow p-6">
    <h3 className="font-semibold mb-4 flex items-center gap-2">
      <Icon size={18} /> {title}
    </h3>
    <div className="grid grid-cols-2 gap-4">{children}</div>
  </div>
);

const Status = ({ label, status = "Submitted" }) => {
  const color =
    status === "Approved"
      ? "text-green-600"
      : status === "Rejected"
      ? "text-red-600"
      : "text-yellow-600";

  return (
    <div className={`flex items-center gap-2 text-sm ${color}`}>
      <ShieldCheck size={16} />
      <span>{label}</span>
<<<<<<< HEAD
      <span className="text-gray-400">- {status}</span>
=======
<<<<<<< HEAD
      <span className="text-gray-400">— {status}</span>
=======
      <span className="text-gray-400">- {status}</span>
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
    </div>
  );
};
