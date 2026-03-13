import React from "react";
import { CheckCircle, ArrowLeft } from "lucide-react";

const ProceedVehicleOwner = ({ onBack, onProceed, onDoLater, onNavigateToHome, }) => {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      {/* container */}
      <div className="bg-white rounded-2xl shadow-lg max-w-5xl w-full overflow-hidden">
        
        {/* header */}
        <div className="relative h-16 flex items-center border-b px-6">

          {/* logo */}
          <button
            onClick={onNavigateToHome}
            className="absolute left-1/2 -translate-x-1/2 text-xl font-bold hover:opacity-80 transition"
            >
            Rentify<span className="text-[#017FE6]">Pro</span>
          </button>

        </div>

        {/* content */}
        <div className="p-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            {/* illustration */}
            <div className="flex justify-center">
              <img
                src="/vehicle-owner-verify.png"
                alt="Vehicle Owner Verification"
                className="max-w-xs"
              />
            </div>

            {/* details */}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-4">
                Proceed as Vehicle Owner
              </h1>

              <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                Your account has already been verified as a user, including your
                personal information and government-issued ID.
              </p>

              <p className="text-gray-600 text-sm mb-6 leading-relaxed">
                To proceed as a <strong>Vehicle Owner</strong>, additional
                verification is required to ensure eligibility and platform
                safety.
              </p>

              <h3 className="font-semibold text-gray-900 mb-4">
                What You Need to Complete
              </h3>

              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3">
                  <CheckCircle className="text-green-500 mt-0.5" size={20} />
                  <div>
                    <p className="font-medium text-sm">
                      Upload a Driver’s License
                    </p>
                    <p className="text-xs text-gray-500">
                      Required to confirm legal authorization to operate and rent
                      out a vehicle
                    </p>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <CheckCircle className="text-green-500 mt-0.5" size={20} />
                  <div>
                    <p className="font-medium text-sm">
                      Complete Selfie Verification
                    </p>
                    <p className="text-xs text-gray-500">
                      Used to verify your identity against the submitted driver’s
                      license and prevent fraud
                    </p>
                  </div>
                </li>
              </ul>

              <p className="text-xs text-gray-500 mb-6">
                Once completed, you will be granted access to the{" "}
                <strong>Vehicle Owner Dashboard</strong>, allowing you to list and
                manage your vehicles.
              </p>

              <button
                onClick={onProceed}
                className="w-full bg-[#017FE6] text-white py-3 rounded-lg font-semibold hover:bg-[#0165B8] transition"
              >
                Proceed with Vehicle Owner Verification
              </button>

              <button
                onClick={onDoLater}
                className="w-full text-sm text-gray-500 mt-4 hover:underline"
              >
                Do it later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProceedVehicleOwner;
