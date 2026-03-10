<<<<<<< HEAD
// Deprecated page.
// Owner verification now runs in RegisterOwnerPage step 3.
// This file is only kept as a reference.
=======
<<<<<<< HEAD
import React, { useState } from "react";
import { Upload, Camera, CheckCircle } from "lucide-react";
>>>>>>> 8422a2f (fixed bugs and updates)

import React from "react";
import { ArrowLeft } from "lucide-react";

export default function VehicleOwnerVerification({ onBack }) {
  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-2xl max-w-md text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Page Moved</h2>
        <p className="text-gray-500 text-sm mb-6">
          Identity verification is now part of the owner registration process (Step 3).
        </p>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-gray-50 transition"
        >
          <ArrowLeft size={18} /> Go Back
        </button>
      </div>
    </div>
  );
<<<<<<< HEAD
}
=======
};

export default VehicleOwnerVerification;
=======
// Deprecated page.
// Owner verification now runs in RegisterOwnerPage step 3.
// This file is only kept as a reference.

import React from "react";
import { ArrowLeft } from "lucide-react";

export default function VehicleOwnerVerification({ onBack }) {
  return (
    <div className="h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="bg-white rounded-3xl border border-gray-200 p-8 shadow-2xl max-w-md text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Page Moved</h2>
        <p className="text-gray-500 text-sm mb-6">
          Identity verification is now part of the owner registration process (Step 3).
        </p>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border border-gray-200 text-gray-900 hover:bg-gray-50 transition"
        >
          <ArrowLeft size={18} /> Go Back
        </button>
      </div>
    </div>
  );
}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
