import React from "react";
import { ArrowRight } from "lucide-react";

export default function HeroSection({ onNavigateToVehicles }) {
  return (
    <div className="relative h-[520px] pt-16 text-white overflow-hidden">
      <img src="/hero-car1.png" alt="Hero" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/60"></div>

      <div className="relative z-10 h-full flex flex-col items-center justify-start text-center px-4 pt-20 animate-fadeIn">
        <h1 className="text-5xl md:text-6xl font-bold mb-6 animate-slideDown">
          Rent Smarter, Ride Easier
        </h1>

        <p className="text-xl text-gray-200 mb-8 max-w-2xl animate-slideUp">
          Find the perfect car or motorcycle and enjoy hassle-free rides with RentifyPro.
        </p>

        <div className="flex gap-4 animate-slideUp">
          <button onClick={onNavigateToVehicles} className="bg-white text-black px-8 py-3 rounded-full font-semibold hover:bg-gray-100 transition-all duration-300 hover:shadow-xl hover:scale-105 flex items-center gap-2">
            Browse Vehicles <ArrowRight size={20} />
          </button>

          <button className="bg-transparent border-2 border-white text-white px-8 py-3 rounded-full font-semibold hover:bg-white hover:text-gray-900 transition-all duration-300 hover:shadow-xl">
            Learn More
          </button>
        </div>
      </div>
    </div>
  );
}