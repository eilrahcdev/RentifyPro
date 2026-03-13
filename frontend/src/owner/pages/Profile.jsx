import React, { useState, useEffect, useRef } from "react";
import {
  BadgeCheck,
  ShieldCheck,
  User,
  Building2,
  Wallet,
  Pencil,
} from "lucide-react";
import API from "../../utils/api";
import {
  getOwnerProfileFromStorage,
  getStoredUser,
  normalizeOwnerProfile,
  persistOwnerProfile,
} from "../utils/ownerProfile";
import { connectMetaMaskWallet, getEthereumProvider } from "../../blockchain/metamask";
import { shortAddress } from "../../blockchain/config";

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
  walletAddress: "",
};

export default function Profile() {
  const [editing, setEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusError, setStatusError] = useState("");
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [walletEditing, setWalletEditing] = useState(false);
  const [walletSaving, setWalletSaving] = useState(false);
  const [walletSnapshot, setWalletSnapshot] = useState("");
  const walletInputRef = useRef(null);

  const [profile, setProfile] = useState(() => {
    const stored = getOwnerProfileFromStorage();
    const user = getStoredUser();
    return {
      ...DEFAULT_PROFILE,
      ...stored,
      email: stored.email || user.email || "",
    };
  });

  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);

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
      setWalletEditing(false);
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      setWalletError(error?.message || "Failed to connect wallet.");
    } finally {
      setWalletLoading(false);
    }
  };

  const saveWalletAddress = async () => {
    setWalletError("");
    setStatusError("");
    setStatusMessage("");
    setWalletSaving(true);

    try {
      const response = await API.updateProfile({ walletAddress: profile.walletAddress || "" });
      const normalized = normalizeOwnerProfile(response?.user || {}, {
        ...profile,
        walletAddress: profile.walletAddress || "",
      });
      const persisted = persistOwnerProfile({
        ...profile,
        ...normalized,
        walletAddress: normalized.walletAddress || profile.walletAddress || "",
      });

      setProfile((prev) => ({
        ...prev,
        ...persisted,
        walletAddress: persisted.walletAddress || profile.walletAddress || "",
      }));
      setWalletEditing(false);
      setStatusMessage("Wallet address updated.");
      window.dispatchEvent(new Event("owner-profile-updated"));
    } catch (error) {
      setStatusError(error?.message || "Could not update wallet address.");
    } finally {
      setWalletSaving(false);
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
    if (!profile.city) {
      setBarangays([]);
      return;
    }
    fetch(`https://psgc.gitlab.io/api/cities-municipalities/${profile.city}/barangays/`)
      .then((response) => response.json())
      .then(setBarangays)
      .catch(() => {});
  }, [profile.city]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Owner Profile</h1>
        <button
          onClick={() => (editing ? saveProfile() : setEditing(true))}
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
        </div>

        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            {`${profile.firstName || ""} ${profile.lastName || ""}`.trim() || profile.name || "Owner"}
            <BadgeCheck className="text-[#017FE6]" size={18} />
          </h2>
          <p className="text-gray-500">{profile.email || "No email found"}</p>
          <span className="text-sm text-[#017FE6] font-medium">Verified Owner</span>
        </div>
      </div>

      <Section title="Personal Information" icon={User}>
        <InputField
          label="First Name"
          value={profile.firstName}
          disabled={!editing}
          onChange={(event) => setProfile((prev) => ({ ...prev, firstName: event.target.value }))}
        />
        <InputField
          label="Last Name"
          value={profile.lastName}
          disabled={!editing}
          onChange={(event) => setProfile((prev) => ({ ...prev, lastName: event.target.value }))}
        />
        <InputField label="Email" value={profile.email} disabled />
        <InputField
          label="Phone"
          value={profile.phone}
          disabled={!editing}
          onChange={(event) => setProfile((prev) => ({ ...prev, phone: event.target.value }))}
        />
      </Section>

      <Section title="Blockchain Wallet" icon={Wallet}>
        <div className="col-span-2">
          <label className="text-xs text-gray-500">Wallet Address</label>
          <div className="relative">
            <input
              ref={walletInputRef}
              value={profile.walletAddress || ""}
              onChange={(event) =>
                setProfile((prev) => ({ ...prev, walletAddress: event.target.value }))
              }
              disabled={!editing && !walletEditing}
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-sm pr-10 ${
                !editing && !walletEditing ? "bg-gray-100" : "bg-white"
              }`}
            />
            <button
              type="button"
              onClick={() => {
                if (!editing) {
                  if (!walletEditing) {
                    setWalletSnapshot(profile.walletAddress || "");
                    setWalletEditing(true);
                  }
                  setTimeout(() => walletInputRef.current?.focus(), 0);
                } else {
                  walletInputRef.current?.focus();
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              aria-label="Edit wallet address"
            >
              <Pencil size={16} />
            </button>
          </div>
        </div>
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
                ? "Reconnect to Wallet"
                : "Connect MetaMask"}
          </button>
          {walletEditing && !editing && (
            <>
              <button
                type="button"
                onClick={saveWalletAddress}
                disabled={walletSaving}
                className="px-3 py-2 rounded-lg text-sm border hover:bg-gray-100 disabled:opacity-60"
              >
                {walletSaving ? "Saving..." : "Save Wallet"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setProfile((prev) => ({ ...prev, walletAddress: walletSnapshot }));
                  setWalletEditing(false);
                }}
                className="px-3 py-2 rounded-lg text-sm border hover:bg-gray-100"
              >
                Cancel
              </button>
            </>
          )}
          {!getEthereumProvider() && (
            <p className="text-xs text-gray-500">MetaMask extension is required for Sepolia wallet linking.</p>
          )}
        </div>
      </Section>

      {walletError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{walletError}</p>
      )}

      <Section title="Address Information" icon={Building2}>
        <InputField
          label="Full Address"
          value={profile.address}
          disabled={!editing}
          onChange={(event) => setProfile((prev) => ({ ...prev, address: event.target.value }))}
        />
        <SelectField
          label="Region"
          value={profile.region}
          disabled={!editing}
          options={regions}
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              region: event.target.value,
              province: "",
              city: "",
              barangay: "",
            }))
          }
        />
        <SelectField
          label="Province"
          value={profile.province}
          disabled={!editing || !profile.region}
          options={provinces}
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              province: event.target.value,
              city: "",
              barangay: "",
            }))
          }
        />
        <SelectField
          label="City"
          value={profile.city}
          disabled={!editing || !profile.province}
          options={cities}
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              city: event.target.value,
              barangay: "",
            }))
          }
        />
        <SelectField
          label="Barangay"
          value={profile.barangay}
          disabled={!editing || !profile.city}
          options={barangays}
          onChange={(event) =>
            setProfile((prev) => ({
              ...prev,
              barangay: event.target.value,
            }))
          }
        />
      </Section>

      {profile.ownerType === "business" && (
        <Section title="Business Information" icon={Building2}>
          <InputField
            label="Business Name"
            value={profile.businessName}
            disabled={!editing}
            onChange={(event) =>
              setProfile((prev) => ({
                ...prev,
                businessName: event.target.value,
              }))
            }
          />
          <InputField
            label="Permit Number"
            value={profile.permitNumber}
            disabled={!editing}
            onChange={(event) =>
              setProfile((prev) => ({
                ...prev,
                permitNumber: event.target.value,
              }))
            }
          />
        </Section>
      )}

      <Section title="Verification Status" icon={ShieldCheck}>
        <Status label="Government ID" status="Submitted" />
        {profile.ownerType === "business" && <Status label="Business Permit" status="Submitted" />}
        <Status label="Selfie Verification" status="Verified" />
      </Section>
    </div>
  );
}

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
      <span className="text-gray-400">- {status}</span>
    </div>
  );
};
