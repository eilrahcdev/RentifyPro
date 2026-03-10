import React from "react";

export default function Footer({ onScrollToTop, onNavigateToVehicles, onNavigateToBookingHistory, onNavigateToAbout }) {
  return (
    <footer className="bg-[#017FE6] text-white py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-2xl font-bold mb-4">RentifyPro</h3>
            <p className="text-blue-100">Your trusted partner for vehicle rentals in the Philippines</p>
          </div>

          <div>
            <h4 className="font-bold mb-4">Quick Links</h4>
            <ul className="space-y-3">
              <li><button onClick={onScrollToTop} className="text-blue-100 hover:text-white transition-colors duration-300">Home</button></li>
              <li><button onClick={onNavigateToVehicles} className="text-blue-100 hover:text-white transition-colors duration-300">Vehicles</button></li>
              <li><button onClick={onNavigateToBookingHistory} className="text-blue-100 hover:text-white transition-colors duration-300">Bookings</button></li>
              <li><button onClick={onNavigateToAbout} className="text-blue-100 hover:text-white transition-colors duration-300">About Us</button></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-4">Vehicle Categories</h4>
            <ul className="space-y-2">
              <li><a href="#" className="text-blue-100 hover:text-white transition-colors duration-300">Cars</a></li>
              <li><a href="#" className="text-blue-100 hover:text-white transition-colors duration-300">Motorcycles</a></li>
              <li><a href="#" className="text-blue-100 hover:text-white transition-colors duration-300">Vans</a></li>
              <li><a href="#" className="text-blue-100 hover:text-white transition-colors duration-300">Trucks</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold mb-4">Contacts</h4>
            <ul className="space-y-2 text-blue-100">
              <li>+63 912 324 5678</li>
              <li>message@rentifypro.com</li>
              <li>Dagupan, Pangasinan, Philippines</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-blue-500 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-blue-100">© 2026 RentifyPro. All rights reserved</p>
          <div className="flex space-x-6 mt-4 md:mt-0">
            <a href="#" className="text-blue-100 hover:text-white transition-colors duration-300">Privacy Policy</a>
            <a href="#" className="text-blue-100 hover:text-white transition-colors duration-300">Terms and Condition</a>
          </div>
        </div>
      </div>
    </footer>
  );
}