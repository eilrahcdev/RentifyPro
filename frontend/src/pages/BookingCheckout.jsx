import React, { useState, useEffect } from "react";
import { Bot, Bell, MessageCircle, Settings, Car, Camera, ShieldCheck } from "lucide-react";
import API from "../utils/api";
import { getStoredUser, persistUserProfile } from "../utils/userProfile";
import {
  getMinPickupDate,
  getMinPickupTime,
  getMinReturnDate,
  getMinReturnTime,
  getTomorrowDate,
} from "../utils/dateUtils";
 
   const BookingCheckout = ({
    vehicle,
  bookingData,
  setBookingData,
  days,
   onNavigateToHome,
     onNavigateToSignIn,
     onNavigateToVehicles,
     onNavigateToRegister,
     onNavigateToAbout,
     onNavigateToBookingHistory,
     onNavigateToAccountSettings,
     isLoggedIn,
     user,
     onLogout,
   }) => {
 
   const [showAI, setShowAI] = useState(false);
   const [userMessage, setUserMessage] = useState("");
   const [messages, setMessages] = useState([]);
   const [isTyping, setIsTyping] = useState(false);
   const [showProfileMenu, setShowProfileMenu] = useState(false);
   const [agreedToTerms, setAgreedToTerms] = useState(false);
   const [showFormError, setShowFormError] = useState(false);

   const {
  pickupDate,
  pickupTime,
  returnDate,
  returnTime,
  insuranceType,
  refundableDeposit,
} = bookingData;

useEffect(() => {
  if (!pickupDate || !pickupTime) return;

  const minPickupDate = getMinPickupDate();
  const minPickupTime = getMinPickupTime();

  // Only check the time if pickup is at the minimum allowed date
  if (pickupDate !== minPickupDate) return;

  const selectedPickup = new Date(`${pickupDate}T${pickupTime}`);

  // Reset pickup times earlier than the minimum allowed time
  if (selectedPickup < new Date(`${minPickupDate}T${minPickupTime}`)) {
    setBookingData((prev) => ({
      ...prev,
      pickupTime: minPickupTime,
    }));
  }
}, [pickupDate, pickupTime, setBookingData]);

useEffect(() => {
  if (
    pickupDate &&
    pickupTime &&
    returnDate &&
    returnTime
  ) return;

  const initialPickupDate = getMinPickupDate();
  const initialPickupTime = getMinPickupTime();
  const initialReturnDate =
    getMinReturnDate(initialPickupDate, initialPickupTime) || getTomorrowDate();
  const initialReturnTime =
    getMinReturnTime(initialPickupDate, initialPickupTime) || initialPickupTime;

  setBookingData((prev) => ({
    ...prev,
    pickupDate: initialPickupDate,
    pickupTime: initialPickupTime,
    returnDate: initialReturnDate,
    returnTime: initialReturnTime,
  }));
}, []);



const driveType = vehicle.driverOption; 
// "self" or "with-driver"

// Self-drive uploads
const [licenseFile, setLicenseFile] = useState(null);
const [facePhoto, setFacePhoto] = useState(null);

// With-driver contact info
const [emergencyContact, setEmergencyContact] = useState({
  name: "",
  phone: "",
  relationship: "",
});

// Form checks
const isSelfDrive = driveType === "self";

const isLicenseValid = !isSelfDrive || licenseFile;
const isFaceValid = !isSelfDrive || facePhoto;
const isTermsValid = agreedToTerms;

const isFormValid =
  isLicenseValid &&
  isFaceValid &&
  isTermsValid;

const dailyRate = vehicle.price;

useEffect(() => {
  if (!isLoggedIn) return;
  if (driveType !== "with-driver") return;
  if (!user) return;

  setEmergencyContact({
    name: user.emergencyContactName || "",
    phone: user.emergencyContactPhone || "",
    relationship: user.emergencyContactRelationship || "",
  });
}, [driveType, isLoggedIn, user]);

// Insurance price per day
const INSURANCE_PRICES = {
  basic: 0,
  standard: 500,
  premium: 1000,
};

// Selected insurance price per day
const insurancePerDay = INSURANCE_PRICES[insuranceType] || 0;

// Totals
const insuranceTotal = insurancePerDay * days;
const vehicleTotal = dailyRate * days;
const grandTotal = vehicleTotal + insuranceTotal;

const DOWNPAYMENT_RATE = 0.3;

const downpaymentAmount = vehicleTotal * DOWNPAYMENT_RATE;

const [paymentOption, setPaymentOption] = useState("downpayment");
// "downpayment" or "full"

// Amount to pay now
const payableNow =
  paymentOption === "downpayment"
    ? downpaymentAmount
    : vehicleTotal + insuranceTotal;

// Amount to pay on pickup
const payableOnPickup =
  paymentOption === "downpayment"
    ? insuranceTotal + refundableDeposit
    : refundableDeposit;

    const handleContinue = () => {
  if (!isFormValid) {
    setShowFormError(true);
    return;
  }

  setShowFormError(false);

  // Continue with the next step here
  console.log("FORM VALID — PROCEED");
};

const handleBack = () => {
  setShowFormError(false);
  onNavigateToVehicles();
};


   const getInitials = (firstName, lastName) => {
     if (!firstName || !lastName) return "";
     return `${firstName[0]}${lastName[0]}`.toUpperCase();
   };
 
   useEffect(() => {
     if (!showAI) return;
 
     setMessages([
       {
         sender: "ai",
         text: "Hi! 👋 This is RentifyPro AI. How can I assist you today?"
       }
      ]);
    }, [showAI]);

    const [profilePhoto, setProfilePhoto] = useState(
      String(user?.avatar || getStoredUser()?.avatar || "").trim() || null
    );

    useEffect(() => {
      const nextAvatar = String(user?.avatar || "").trim() || null;
      setProfilePhoto(nextAvatar);
    }, [user?.avatar, user?._id]);

    const syncAvatarToProfile = async (avatarValue = "") => {
      const currentUser = getStoredUser();
      if (!currentUser || typeof currentUser !== "object") return;

      const normalizedAvatar = String(avatarValue || "").trim();
      persistUserProfile({
        ...currentUser,
        avatar: normalizedAvatar,
      });
      window.dispatchEvent(new Event("user-profile-updated"));

      try {
        const response = await API.updateProfile({ avatar: normalizedAvatar });
        if (response?.user && typeof response.user === "object") {
          persistUserProfile(response.user);
          window.dispatchEvent(new Event("user-profile-updated"));
        }
      } catch {
        // Keep local avatar preview if backend sync fails.
      }
    };
    
    const handlePhotoUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
    
      const reader = new FileReader();
      reader.onloadend = async () => {
        const nextAvatar = String(reader.result || "");
        setProfilePhoto(nextAvatar || null);
        await syncAvatarToProfile(nextAvatar);
      };
      reader.readAsDataURL(file);
    };
    
    const handleRemovePhoto = async () => {
      setProfilePhoto(null);
      await syncAvatarToProfile("");
    };
 
   return (
     <div className="min-h-screen bg-white">
 
        {/* navbar */}
       <nav className="bg-white shadow-sm fixed w-full top-0 z-50">
         <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
 
           <button onClick={onNavigateToHome} 
           className="text-2xl font-bold hover:opacity-90 transition"> 
           Rentify<span className="text-[#017FE6]">Pro</span></button>
 
           <div className="hidden md:flex gap-8 relative left-12">
 
             <button onClick={onNavigateToHome} className="hover:text-[#017FE6]">Home</button>
             <button onClick={onNavigateToVehicles} className="hover:text-[#017FE6]">Vehicles</button>
             <button onClick={onNavigateToBookingHistory} className="hover:text-[#017FE6]">Booking History</button>
             <button onClick={onNavigateToAbout} className="hover:text-[#017FE6]">About</button>
             <a href="#contacts" className="hover:text-[#017FE6]">Contacts</a>
           </div>
 
           <div className="flex items-center gap-4">
 
              {/* logged-in actions */}
              {isLoggedIn && (
                <>
                  {/* chat */}
                  <button
                    aria-label="Chatroom"
                    className="
                      relative w-11 h-11
                      flex items-center justify-center
                      rounded-full
                      bg-gray-100
                      hover:bg-[#D6EBFF]
                      transition
                    "
                  >
                    <MessageCircle size={20} className="text-[#017FE6]" />
                    <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-[#017FE6] rounded-full" />
                  </button>
            
                  {/* notifications */}
                  <button
                    aria-label="Notifications"
                    className="
                      relative w-11 h-11
                      flex items-center justify-center
                      rounded-full
                      bg-gray-100
                      hover:bg-[#D6EBFF]
                      transition
                    "
                  >
                    <Bell size={20} className="text-[#017FE6]" />
                    <span
                      className="
                        absolute -top-1 -right-1
                        bg-red-500 text-white
                        text-[10px]
                        min-w-[18px] h-[18px]
                        flex items-center justify-center
                        rounded-full font-semibold
                      "
                    >
                      3
                    </span>
                  </button>
                </>
              )}
            
            
              {/* AI chat */}
              <button
                onClick={() => setShowAI(true)}
                aria-label="AI Assistant"
                className="
                  relative w-11 h-11
                  flex items-center justify-center
                  rounded-full
                  bg-gray-100
                  hover:bg-[#D6EBFF]
                  transition
                  shadow-sm
                "
              >
                <Bot size={22} className="text-[#017FE6]" />
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
              </button>
            
              
            
              {/* account menu */}
              {!isLoggedIn ? (
                <>
                  <button
                    onClick={onNavigateToSignIn}
                    className="hover:text-[#017FE6]"
                  >
                    Sign In
                  </button>
            
                  <button
                    onClick={onNavigateToRegister}
                    className="bg-[#017FE6] text-white px-5 py-2 rounded-full hover:bg-[#0165B8]"
                  >
                    Register
                  </button>
                </>
              ) : (
                <div className="relative">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full hover:bg-gray-200 transition"
              >
               <div className="w-8 h-8 rounded-full overflow-hidden bg-[#017FE6] flex items-center justify-center">
             {profilePhoto ? (
                 <img
                 src={profilePhoto}
                 alt="Profile"
                 className="w-full h-full object-cover"
                 />
             ) : (
                 <span className="text-white text-sm font-bold">
                 {user?.initials}
                 </span>
             )}
             </div>
 
                <span className="text-sm font-medium">
                  {user?.name}
                </span>
              </button>
            
               {/* profile menu */}
                  {showProfileMenu && (
                    <div className="absolute right-0 mt-3 w-72 bg-white rounded-xl shadow-2xl z-50">
                      <div className="px-4 py-4 border-b">
                        <p className="font-semibold">{user?.name}</p>
                        <p className="text-sm text-gray-400">{user?.email}</p>
                      </div>
              
                      <button onClick={() => {
                         setShowProfileMenu(false);
                         onNavigateToAccountSettings();}}
                         className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#017FE6]/10 transition">
                         <Settings size={18} />  Account Settings
                       </button>
              
                      <button onClick={onNavigateToBookingHistory}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#017FE6]/10 transition"
                      >
                        <Car size={18} /> My Bookings
                      </button>
              
                      <button onClick={onLogout} 
                      className="w-full px-4 py-3 text-red-500 hover:bg-red-50"> ⎋ Sign Out 
                      </button>
            
                </div>
              )}
            </div>
              )}
            
            </div>
            
                    </div>
       </nav>

       {/* checkout content */}
       <div className="pt-24 pb-16 bg-gray-50 min-h-screen">
          <div className="max-w-7xl mx-auto px-6">
            <h1 className="text-2xl font-semibold mb-6">Complete your Booking</h1>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* booking form */}
          <div className="lg:col-span-2 space-y-6">

          {/* booking details */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-semibold mb-4">Booking Details</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-600">Pickup Date & Time</label>
                <input
                      type="date"
                      value={pickupDate}
                      min={getMinPickupDate()}
                      onChange={(e) =>
                          setBookingData({ ...bookingData, pickupDate: e.target.value })
                      }
                      className="w-full border rounded-lg px-3 py-2 mt-1"
                      />

                      <input
                      type="time"
                      value={pickupTime}
                      min={pickupDate === getMinPickupDate() ? getMinPickupTime() : undefined}
                      onChange={(e) =>
                          setBookingData({ ...bookingData, pickupTime: e.target.value })
                      }
                      className="w-full border rounded-lg px-3 py-2 mt-2"
                  />
              </div>

              <div>
                <label className="text-sm text-gray-600">Return Date & Time</label>
                <input
                  type="date"
                  value={returnDate}
                  min={getMinReturnDate(pickupDate, pickupTime) || getMinPickupDate()}
                  onChange={(e) =>
                    setBookingData({ ...bookingData, returnDate: e.target.value })
                  }
                  className="w-full border rounded-lg px-3 py-2 mt-1"
                />

                <input
                  type="time"
                  value={returnTime}
                  min={
                    returnDate === getMinReturnDate(pickupDate, pickupTime)
                      ? getMinReturnTime(pickupDate, pickupTime)
                      : undefined
                  }
                  onChange={(e) =>
                    setBookingData({ ...bookingData, returnTime: e.target.value })
                  }
                  className="w-full border rounded-lg px-3 py-2 mt-2"
                />
              </div>
          </div>
        </div>

        {/* insurance */}
       <div className="bg-white rounded-xl shadow p-6">
        <h2 className="font-semibold mb-4">Insurance Coverage</h2>

        <div className="space-y-3">

    {/* basic plan */}
     <label className="flex items-center justify-between border p-3 rounded-lg cursor-pointer">
      <div className="flex items-center gap-3">
        <input
          type="radio"
          checked={insuranceType === "basic"}
          onChange={() =>
            setBookingData({ ...bookingData, insuranceType: "basic" })
          }
        />
        <div>
          <p className="font-medium">Basic Coverage</p>
          <p className="text-sm text-gray-500">Third-party liability</p>
        </div>
      </div>

      <span className="font-semibold text-[#017FE6]">
        Free
      </span>
    </label>

    {/* standard plan */}
    <label className="flex items-center justify-between border p-3 rounded-lg cursor-pointer">
      <div className="flex items-center gap-3">
        <input
          type="radio"
          checked={insuranceType === "standard"}
          onChange={() =>
            setBookingData({ ...bookingData, insuranceType: "standard" })
          }
        />
        <div>
          <p className="font-medium">Standard Coverage</p>
          <p className="text-sm text-gray-500">Collision & theft protection</p>
        </div>
      </div>

      <span className="font-semibold text-[#017FE6]">
        ₱{INSURANCE_PRICES.standard} / day
      </span>
    </label>

    {/* premium plan */}
    <label className="flex items-center justify-between border p-3 rounded-lg cursor-pointer">
      <div className="flex items-center gap-3">
        <input
          type="radio"
          checked={insuranceType === "premium"}
          onChange={() =>
            setBookingData({ ...bookingData, insuranceType: "premium" })
          }
        />
        <div>
          <p className="font-medium">Premium Coverage</p>
          <p className="text-sm text-gray-500">Full Coverage + personal accident + roadside assistance</p>
        </div>
      </div>

      <span className="font-semibold text-[#017FE6]">
        ₱{INSURANCE_PRICES.premium} / day
      </span>
    </label>

  </div>
</div>

        {/* driver details */}
        <div className="bg-white rounded-xl shadow p-6 space-y-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-[#E6F2FF]">
              <Car className="w-6 h-6 text-[#017FE6]" />
            </div>

          <div>
            <h2 className="font-semibold text-lg">Driving Option</h2>
            <p className="text-sm text-gray-500">
              This option is based on the selected vehicle and cannot be changed.
            </p>
          </div>
        </div>

        <div className="border rounded-lg p-4 bg-gray-50">
          <p className="text-sm text-gray-600">
           Driver's Option:
            <span className="ml-2 font-semibold text-[#017FE6]">
              {driveType === "self" && "SELF DRIVE"}
              {driveType === "with-driver" && "WITH DRIVER"}
            </span>
          </p>
        </div>

  {/* self drive */}
  {driveType === "self" && (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Please provide a valid driver’s license and face verification.
      </p>

      {/* license upload */}
      <div>
        
        <label className="text-sm font-medium">Driver’s License</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setLicenseFile(e.target.files[0])}
          className="w-full border rounded-lg px-3 py-2 mt-1"
        />

        {showFormError && isSelfDrive && !licenseFile && (
  <p className="text-xs text-red-500 mt-1">
    Driver’s license is required.
  </p>
)}
      </div>

      {/* face check */}
      <div>
        <label className="text-sm font-medium">Face Verification</label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFacePhoto(e.target.files[0])}
          className="w-full border rounded-lg px-3 py-2 mt-1"
        />

        {showFormError && isSelfDrive && !facePhoto && (
  <p className="text-xs text-red-500 mt-1">
    Face verification is required.
  </p>
)}
      </div>
    </div>
  )}

  {/* with driver */}
  {driveType === "with-driver" && (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        An assigned driver will handle the vehicle. Please provide an emergency contact.
      </p>

      <div>
        <label className="text-sm font-medium">Emergency Contact Name</label>
        <input
          type="text"
          value={emergencyContact.name}
          readOnly
           className="w-full border rounded-lg px-3 py-2 mt-1 bg-gray-100"
        />
        
      </div>

      <div>
        <label className="text-sm font-medium">Emergency Contact Number</label>
        <input
          type="tel"
          value={emergencyContact.phone}
          readOnly
         className="w-full border rounded-lg px-3 py-2 mt-1 bg-gray-100"
        />
      </div>

      <div>
        <label className="text-sm font-medium">Relationship</label>
        <input
          type="text"
          value={emergencyContact.relationship}
          readOnly
          className="w-full border rounded-lg px-3 py-2 mt-1 bg-gray-100"
        />
      </div>

      {/* assigned driver */}
      <div className="bg-gray-100 rounded-lg p-4">
        <p className="font-medium">Assigned Driver</p>
        <p className="text-sm text-gray-600">Juan Dela Cruz</p>
        <p className="text-sm text-gray-600">License No: D123-456-789</p>
        <p className="text-sm text-gray-600">5★ Rated Professional Driver</p>
      </div>
    </div>
  )}
  </div>

  {/* payment options */}
  <div className="bg-white rounded-xl shadow p-6 space-y-5">
  <div className="flex items-start gap-4">
    <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-[#E6F2FF]">
      <ShieldCheck className="w-6 h-6 text-[#017FE6]" />
    </div>

    <div>
      <h2 className="font-semibold text-lg">Payment Option</h2>
      <p className="text-sm text-gray-500">
        Choose how you would like to pay for your booking.
      </p>
    </div>
  </div>

  <label className="flex items-start gap-3 border p-4 rounded-lg cursor-pointer hover:bg-gray-50">
    <input
      type="radio"
      checked={paymentOption === "downpayment"}
      onChange={() => setPaymentOption("downpayment")}
    />
    <div>
      <p className="font-medium">Downpayment Only</p>
      <p className="text-sm text-gray-500">
        Pay <b>30%</b> of vehicle rental now. Insurance & deposit on pickup.
      </p>
    </div>
  </label>

  <label className="flex items-start gap-3 border p-4 rounded-lg cursor-pointer hover:bg-gray-50">
    <input
      type="radio"
      checked={paymentOption === "full"}
      onChange={() => setPaymentOption("full")}
    />
    <div>
      <p className="font-medium">Full Payment</p>
      <p className="text-sm text-gray-500">
        Pay vehicle rental + insurance now. Deposit on pickup.
      </p>
    </div>
  </label>
</div>

{/* vehicle condition notes */}
<div className="bg-white rounded-xl shadow p-6 space-y-5">
  <div className="flex items-start gap-4">
    <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-[#E6F2FF]">
      <Camera className="w-6 h-6 text-[#017FE6]" />
    </div>

    <div>
      <h2 className="font-semibold text-lg">
        Vehicle Condition Documentation
      </h2>
      <p className="text-sm text-gray-500">
        Photos will be taken at pickup and return to document the vehicle’s condition.
      </p>
    </div>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
    {[
      "Front & Rear Photos",
      "Both Sides Photos",
      "Interior Condition",
      "Existing Damage",
      "Odometer Reading",
      "Fuel Level",
    ].map((item) => (
      <div key={item} className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-[#017FE6]" />
        <span>{item}</span>
      </div>
    ))}
  </div>

  <p className="text-xs text-gray-400">
    This documentation protects both renter and vehicle owner.
  </p>
</div>
<div>

  {/* terms */}
  <label className="flex items-center gap-2 text-sm mb-3">
   <input
  type="checkbox"
  checked={agreedToTerms}
  onChange={(e) => setAgreedToTerms(e.target.checked)}
/>
    I agree to the <span className="text-[#017FE6]">Terms & Conditions</span>
  </label>

  {showFormError && !agreedToTerms && (
  <p className="text-xs text-red-500 mb-4">
    You must agree to the Terms & Conditions.
  </p>
)}

  <div className="flex gap-3">
  {/* back button */}
  <button
  onClick={handleBack}
  className="w-full border border-gray-300 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-100"
>
  Back
</button>

  {/* continue button */}
  <button
    onClick={handleContinue}
    className="w-full bg-[#017FE6] text-white py-3 rounded-lg font-semibold hover:bg-[#0165B8]"
  >
    Continue
  </button>
</div>
  </div>
</div>

      {/* booking summary */}
      <div className="bg-white rounded-xl shadow p-6 h-fit">
        <h2 className="font-semibold mb-4">Booking Summary</h2>

        <div className="flex items-center gap-4 mb-4">
          <img
            src={vehicle.image}
            alt={vehicle.name}
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
<<<<<<< ours
            className="w-25 h-25 object-cover object-center rounded-xl bg-gray-50 p-2"
=======
            className="object-contain object-center rounded-xl bg-gray-50 p-2"
            style={{ width: "6.25rem", height: "6.25rem" }}
>>>>>>> theirs
=======
            className="w-25 h-25 object-contain object-center rounded-xl bg-gray-50 p-2"
>>>>>>> theirs
=======
            className="object-contain object-center rounded-xl bg-gray-50 p-2"
            style={{ width: "6.25rem", height: "6.25rem" }}
>>>>>>> theirs
=======
            className="w-25 h-25 object-contain object-center rounded-xl bg-gray-50 p-2"
>>>>>>> theirs
=======
            className="object-contain object-center rounded-xl bg-gray-50 p-2"
            style={{ width: "6.25rem", height: "6.25rem" }}
>>>>>>> theirs
          />
        </div>

        <div className="text-center">
        <p className="font-semibold text-lg">
          {vehicle.name}
        </p>
        <p className="text-sm text-gray-500 mb-5">
          {vehicle.category}
        </p>
      </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Daily Rate</span>
            <span>₱{dailyRate.toLocaleString()}</span>
          </div>

          <div className="flex justify-between">
            <span>Duration</span>
            <span>{days} day{days > 1 ? "s" : ""}</span>
          </div>

          <div className="flex justify-between">
            <span>Insurance</span>
            <span>₱{insuranceTotal.toLocaleString()}</span>
          </div>

          <div className="flex justify-between">
            <span>Refundable Deposit</span>
            <span>₱{refundableDeposit.toLocaleString()}</span>
          </div>

     <hr />

      <div className="space-y-2 text-sm">
            <div className="flex justify-between font-semibold text-[#017FE6] text-lg">
              <span>Pay Now</span>
              <span className="text-[#017FE6]">
                ₱{payableNow.toLocaleString()}
              </span>
            </div>

          <div className="flex justify-between">
            <span>Pay on Pickup</span>
            <span>
              ₱{payableOnPickup.toLocaleString()}
            </span>
          </div>
       </div>
    </div>

        <p className="text-center text-xs text-gray-500 mt-8">
          Deposit refunded within 3–5 business days after return, subject to vehicle inspection. 
          Late return fees and additional charges will be deducted if applicable.
        </p>
    </div>
    </div>
  </div>
</div>

<footer className="mt-12 text-center text-xs text-gray-400">
  <p>
    © {new Date().getFullYear()} RentifyPro ·
    <a href="/terms" className="mx-1 text-[#017FE6] hover:underline">
      Terms
    </a>
    ·
    <a href="/privacy" className="mx-1 text-[#017FE6] hover:underline">
      Privacy
    </a>
    ·
    <a href="/support" className="mx-1 text-[#017FE6] hover:underline">
      Support
    </a>
  </p>
</footer>
 
 {showAI && (
    <div className="
      fixed bottom-4 right-4
      w-[95vw] sm:w-[400px]
      h-[70vh] sm:h-[450px]
      bg-white rounded-2xl shadow-2xl
      z-50 overflow-hidden
      flex flex-col
    ">

    {/* header */}
    <div className="bg-[#017FE6] text-white px-4 py-3 flex justify-between items-center">
      <div>
        <h3 className="font-semibold text-sm">RentifyPro AI</h3>
        <p className="text-xs opacity-80">Online • Ready to help</p>
      </div>
      <button onClick={() => setShowAI(false)}>✕</button>
    </div>

    {/* chat body */}
    <div className="p-4 flex-1 overflow-y-auto bg-gray-50 space-y-4">


      {messages.map((msg, index) => (
        <div
          key={index}
          className={`flex items-end gap-2 ${
            msg.sender === "user" ? "justify-end" : "justify-start"
          }`}
        >
          {msg.sender === "ai" && (
            <img src="/robot-ai.png" className="w-8 h-8 rounded-full" />
          )}

          <div
            className={`px-4 py-2 rounded-2xl text-sm max-w-[75%] shadow ${
              msg.sender === "user"
                ? "bg-[#017FE6] text-white rounded-br-sm"
                : "bg-white text-gray-800 rounded-bl-sm"
            }`}
          >
            {msg.text}
          </div>

          {msg.sender === "user" && (
            <div className="w-8 h-8 rounded-full bg-[#017FE6] text-white flex items-center justify-center text-xs">
              U
            </div>
          )}
        </div>
      ))}

      {isTyping && (
        <div className="flex items-center gap-2">
          <img src="/isuzu-truck.png" className="w-8 h-8 rounded-full" />
          <div className="bg-white px-4 py-2 rounded-2xl shadow text-sm text-gray-500 flex gap-1">
            <span className="animate-bounce">.</span>
            <span className="animate-bounce delay-150">.</span>
            <span className="animate-bounce delay-300">.</span>
          </div>
        </div>
      )}
    </div>

    {/* chat input */}
    <div className="border-t bg-white px-3 py-2 flex items-center gap-2">
      <input
        value={userMessage}
        onChange={(e) => setUserMessage(e.target.value)}
        placeholder="Ask me about vehicles, bookings..."
        className="flex-1 border rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-[#017FE6]"
      />

      <button
        onClick={() => {
          if (!userMessage.trim()) return;

          setMessages((prev) => [...prev, { sender: "user", text: userMessage }]);
          setUserMessage("");
          setIsTyping(true);

          setTimeout(() => {
            setMessages((prev) => [
              ...prev,
              { sender: "ai", text: "Got it! 😊 Let me help you with that." }
            ]);
            setIsTyping(false);
          }, 1200);
        }}
        className="bg-[#017FE6] text-white w-9 h-9 rounded-full"
      >
        ➤
      </button>
    </div>
  </div>
      )}
    </div>
  );
};

export default BookingCheckout;
