import React from "react";
import { Users, Settings, Fuel, Car } from "lucide-react";

export default function FeaturedVehicles({ vehicles, isLoggedIn, onViewDetails, onSignIn }) {
  return (
    <div className="bg-gray-50 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-4xl font-bold mb-12 animate-slideDown">
          <span className="text-[#017FE6]">Featured</span> Vehicles
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {vehicles.map((vehicle, index) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} index={index} isLoggedIn={isLoggedIn} onViewDetails={onViewDetails} onSignIn={onSignIn} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VehicleCard({ vehicle, index, isLoggedIn, onViewDetails, onSignIn }) {
  return (
    <div className="group bg-white rounded-xl shadow-md overflow-hidden hover:shadow-2xl transition-all duration-500 hover:-translate-y-1 animate-fadeIn" style={{ animationDelay: `${index * 100}ms` }}>
      <div className="relative">
        {vehicle.available && (
          <span className="absolute top-4 left-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-semibold animate-pulse">
            Available
          </span>
        )}
        <span className="absolute top-4 right-4 bg-gray-900 text-white px-3 py-1 rounded-full text-sm font-semibold">
          <span className="text-yellow-400">★ </span>
          {vehicle.rating}
        </span>

        <div className="bg-gray-50 rounded-t-xl p-6 h-60 flex items-center justify-center overflow-hidden">
          <img src={vehicle.image} alt={vehicle.name} className="max-h-full object-contain transition-transform duration-500 group-hover:scale-110" />
        </div>
      </div>

      <div className="p-6">
        <h3 className="text-2xl font-bold mb-2">{vehicle.name}</h3>
        <p className="text-gray-600 mb-4">{vehicle.category}</p>

        <div className="flex items-center gap-5 mb-4 text-sm text-gray-600">
          <span className="flex items-center gap-1">
            <Users size={16} className="text-[#017FE6]" />
            {vehicle.seats} seats
          </span>
          <span className="flex items-center gap-1">
            <Settings size={16} className="text-[#017FE6]" />
            {vehicle.transmission}
          </span>
          <span className="flex items-center gap-1">
            <Fuel size={16} className="text-[#017FE6]" />
            {vehicle.fuel}
          </span>
        </div>

        <div className="text-lg font-bold text-[#017FE6] mb-4">
          ₱{vehicle.price.toLocaleString()} / day
        </div>

<<<<<<< HEAD
        <div>
          <button onClick={() => (isLoggedIn ? onViewDetails(vehicle) : onSignIn())} className="w-full bg-[#017FE6] text-white py-2 rounded-lg hover:bg-[#0165B8] transition-all duration-300 hover:shadow-lg">
=======
<<<<<<< HEAD
        <div className="flex gap-2">
          <button onClick={() => onViewDetails(vehicle)} className="flex-1 border-2 border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition-all duration-300 hover:border-[#017FE6]">
            View Details
          </button>
          <button onClick={() => (isLoggedIn ? onViewDetails(vehicle) : onSignIn())} className="flex-1 bg-[#017FE6] text-white py-2 rounded-lg hover:bg-[#0165B8] transition-all duration-300 hover:shadow-lg">
=======
        <div>
          <button onClick={() => (isLoggedIn ? onViewDetails(vehicle) : onSignIn())} className="w-full bg-[#017FE6] text-white py-2 rounded-lg hover:bg-[#0165B8] transition-all duration-300 hover:shadow-lg">
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
            Book Now
          </button>
        </div>
      </div>
    </div>
  );
<<<<<<< HEAD
}
=======
<<<<<<< HEAD
}
=======
}
>>>>>>> 8745d21 (fixed bugs and updates)
>>>>>>> 8422a2f (fixed bugs and updates)
