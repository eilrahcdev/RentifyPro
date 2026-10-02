import React from "react";
import VehicleCard from "./VehicleCard";

export default function FeaturedVehicles({ vehicles, isLoggedIn, onViewDetails, onSignIn }) {
  return (
    <div className="bg-gray-50 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-4xl font-bold mb-12 animate-slideDown">
          <span className="text-[#017FE6]">Featured</span> Vehicles
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {vehicles.map((vehicle, index) => (
            <VehicleCard
              key={vehicle.id || vehicle._id}
              vehicle={vehicle}
              onBookNow={(selected) => isLoggedIn ? onViewDetails(selected) : onSignIn()}
              className="animate-fadeIn"
              style={{ animationDelay: `${index * 100}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
