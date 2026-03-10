import React from "react";
import { Search } from "lucide-react";

export default function SearchCard({
  vehicleType,
  pickupDate,
  pickupTime,
  returnDate,
  returnTime,
  onVehicleTypeChange,
  onPickupDateChange,
  onPickupTimeChange,
  onReturnDateChange,
  onReturnTimeChange,
  onSearch,
}) {
  return (
    <div className="max-w-6xl mx-auto px-4 -mt-20 relative z-10">
      <div className="bg-white rounded-2xl shadow-2xl p-8 animate-slideUp">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <InputField label="Vehicle Types" type="select" value={vehicleType} onChange={onVehicleTypeChange}
            options={[
              { label: "Select type", value: "" },
              { label: "Car", value: "car" },
              { label: "Motorcycle", value: "motorcycle" },
              { label: "Van", value: "van" },
              { label: "Truck", value: "truck" },
            ]}
          />
          <InputField label="Pick-up Date" type="date" value={pickupDate} onChange={onPickupDateChange} />
          <InputField label="Pick-up Time" type="time" value={pickupTime} onChange={onPickupTimeChange} />
          <InputField label="Return Date" type="date" value={returnDate} onChange={onReturnDateChange} />
          <InputField label="Return Time" type="time" value={returnTime} onChange={onReturnTimeChange} />
        </div>

        <div className="flex justify-center">
          <button onClick={onSearch} className="flex items-center gap-3 bg-[#017FE6] text-white px-10 py-3 rounded-xl font-semibold text-lg hover:bg-[#0165B8] transition-all duration-300 hover:shadow-xl hover:scale-105">
            <Search size={22} className="stroke-[2.5]" />
            Search Available Vehicles
          </button>
        </div>
      </div>
    </div>
  );
}

function InputField({ label, type, value, onChange, options }) {
  return (
    <div>
      <label className="block text-[#017FE6] font-semibold mb-2">{label}</label>
      {type === "select" ? (
        <select className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#017FE6] transition-all duration-300" value={value} onChange={(e) => onChange(e.target.value)}>
          {options?.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input type={type} className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#017FE6] transition-all duration-300" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}