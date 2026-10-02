import React, { useState } from "react";
import { Users, Wrench, ShieldCheck, X } from "lucide-react";
import Navbar from "../components/Navbar";

  const AboutPage = ({
  onNavigateToHome,
  onNavigateToSignIn,
    onNavigateToVehicles,
    onNavigateToRegister,
    onNavigateToAbout,
    onNavigateToContacts,
    onNavigateToChat,
    onNavigateToNotifications,
    onNavigateToBookingHistory,
    onNavigateToAccountSettings,
    onNavigateToReports,
    onNavigateToPrivacyPolicy,
    onNavigateToTermsAndConditions,
    isLoggedIn,
    user,
    onLogout,
  }) => {

  const [showAI, setShowAI] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [messages, setMessages] = useState([
    { sender: "ai", text: "Hi! This is Rentify AI. How can I assist you today?" },
  ]);
  const [isTyping, setIsTyping] = useState(false);

  return (
    <div className="rp-renter-page min-h-screen bg-white">
      <Navbar
        activePage="about"
        isLoggedIn={isLoggedIn}
        user={user}
        isAIOpen={showAI}
        onNavigateToHome={onNavigateToHome}
        onNavigateToVehicles={onNavigateToVehicles}
        onNavigateToBookingHistory={onNavigateToBookingHistory}
        onNavigateToAbout={onNavigateToAbout}
        onNavigateToContacts={onNavigateToContacts}
        onNavigateToChat={onNavigateToChat}
        onNavigateToNotifications={onNavigateToNotifications}
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onNavigateToReports={onNavigateToReports}
        onShowAI={() => setShowAI(true)}
        onLogout={onLogout}
      />


                  {/* content */}
            <div className="rp-about-page-content pt-24 pb-16 px-4 bg-white sm:pt-28 sm:pb-20 sm:px-6">
              {/* header */}
              <div className="text-center mb-12">
                <h1 className="text-3xl font-bold text-gray-900">
                  About <span className="text-[#017FE6]">RentifyPro</span>
                </h1>
                <p className="text-gray-500 mt-2">
                  Your trusted partner for vehicle rentals in the Philippines
                </p>
              </div>

              {/* story */}
              <div className="max-w-4xl mx-auto bg-white border rounded-xl shadow-sm p-5 mb-12 sm:p-8 sm:mb-14">
                <h2 className="text-xl font-semibold mb-4">
                  Our <span className="text-[#017FE6]">Story</span>
                </h2>

                <p className="text-gray-600 mb-4">
                  RentifyPro was founded with a simple mission: to make vehicle rental easy,
                  affordable, and reliable. We started with just 5 vehicles and a dream to
                  revolutionize the rental industry.
                </p>

                <p className="text-gray-600 mb-4">
                  Today, we've grown to serve thousands of customers with a diverse fleet of
                  cars and motorcycles. Our commitment to quality service and customer
                  satisfaction remains at the heart of everything we do.
                </p>

                <p className="text-gray-600">
                  We believe that everyone deserves access to reliable transportation,
                  whether it's for a business trip, a family vacation, or an adventure on
                  two wheels.
                </p>
              </div>

              {/* stats */}
              <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
                <div className="border rounded-xl text-center py-6 shadow-sm">
                  <h3 className="text-2xl font-bold text-[#017FE6]">1k</h3>
                  <p className="text-gray-500 mt-1">Vehicles</p>
                </div>

                <div className="border rounded-xl text-center py-6 shadow-sm">
                  <h3 className="text-2xl font-bold text-[#017FE6]">10k</h3>
                  <p className="text-gray-500 mt-1">Users</p>
                </div>

                <div className="border rounded-xl text-center py-6 shadow-sm">
                  <h3 className="text-2xl font-bold text-[#017FE6]">4.7</h3>
                  <p className="text-gray-500 mt-1">Average Ratings</p>
                </div>
              </div>

              {/* values */}
            <div className="max-w-5xl mx-auto">
              <h2 className="text-2xl font-semibold text-center mb-10">
                Our <span className="text-[#017FE6]">Values</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                
                {/* vehicles */}
                <div className="border rounded-xl p-6 text-center shadow-sm hover:shadow-md transition">
                  <div className="flex justify-center mb-4">
                    <div className="bg-blue-100 p-4 rounded-full">
                      <Wrench size={28} className="text-[#017FE6]" />
                    </div>
                  </div>
                  <h3 className="font-semibold mb-2">Quality Vehicles</h3>
                  <p className="text-gray-500 text-sm">
                    All vehicles are thoroughly inspected and well-maintained.
                  </p>
                </div>

                {/* customer experience */}
                <div className="border rounded-xl p-6 text-center shadow-sm hover:shadow-md transition">
                  <div className="flex justify-center mb-4">
                    <div className="bg-blue-100 p-4 rounded-full">
                      <Users size={28} className="text-[#017FE6]" />
                    </div>
                  </div>
                  <h3 className="font-semibold mb-2">Customer Experience</h3>
                  <p className="text-gray-500 text-sm">
                    Customer satisfaction is our top priority.
                  </p>
                </div>

                {/* trust */}
                <div className="border rounded-xl p-6 text-center shadow-sm hover:shadow-md transition">
                  <div className="flex justify-center mb-4">
                    <div className="bg-blue-100 p-4 rounded-full">
                      <ShieldCheck size={28} className="text-[#017FE6]" />
                    </div>
                  </div>
                  <h3 className="font-semibold mb-2">Trust & Transparency</h3>
                  <p className="text-gray-500 text-sm">
                    We believe in honest pricing, clear policies, and open communication.
                  </p>
                </div>

              </div>
            </div>

            </div>


                  {/* footer */}
                  <footer className="bg-[#017FE6] text-white py-12">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                        <div>
                          <h3 className="text-2xl font-bold mb-4">
                            RentifyPro
                          </h3>
                          <p className="text-blue-100">Your trusted partner for vehicle rentals in the Philippines</p>
                        </div>

                        <div>
              <h4 className="font-bold mb-4">Quick Links</h4>

              <ul className="space-y-3">
                <li>
                  <button
                    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                    className="text-blue-100 hover:text-white transition"
                  >
                    <span className="text-white font-semibold cursor-default">
                      Home
                    </span>
                  </button>
                </li>

                <li>
                  <button
                    onClick={onNavigateToVehicles}
                    className="text-blue-100 hover:text-white transition"
                  >
                    Vehicles
                  </button>
                </li>

                <li>
                  <button onClick={onNavigateToBookingHistory} className="text-blue-100 hover:text-white transition">
                    Bookings
                  </button>
                </li>

                <li>
                  <a href="#" className="text-blue-100 hover:text-white transition">
                    About Us
                  </a>
                </li>
              </ul>
            </div>


            <div>
              <h4 className="font-bold mb-4">Vehicle Categories</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-blue-100 hover:text-white">Cars</a></li>
                <li><a href="#" className="text-blue-100 hover:text-white">Motorcycles</a></li>
                <li><a href="#" className="text-blue-100 hover:text-white">Vans</a></li>
                <li><a href="#" className="text-blue-100 hover:text-white">Trucks</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold mb-4">Contacts</h4>
              <ul className="space-y-2 text-blue-100">
                <li>+63 912 324 5678</li>
                <li>rentifypro.official@gmail.com</li>
                <li>Dagupan, Pangasinan,</li>
                <li>Philippines</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-blue-500 mt-8 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-blue-100">Copyright 2026 RentifyPro. All rights reserved.</p>
            <div className="flex space-x-6 mt-4 md:mt-0">
              <button onClick={onNavigateToPrivacyPolicy} className="text-blue-100 hover:text-white">Privacy Policy</button>
              <button onClick={onNavigateToTermsAndConditions} className="text-blue-100 hover:text-white">Terms and Conditions</button>
            </div>
          </div>
        </div>
      </footer>

        {showAI && (
    <div className="rp-legacy-ai-chat
      fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))]
      w-[calc(100vw-2rem)] sm:w-[400px]
      h-[70dvh] sm:h-[450px]
      bg-white rounded-2xl shadow-2xl
      z-50 overflow-hidden
      flex flex-col
    ">

    {/* header */}
    <div className="bg-[#017FE6] text-white px-4 py-3 flex justify-between items-center">
      <div>
        <h3 className="font-semibold text-sm">Rentify AI</h3>
        <p className="flex items-center gap-1.5 text-xs opacity-90">
          <span className="h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-white/25" />
          Online
        </p>
      </div>
      <button
        type="button"
        onClick={() => setShowAI(false)}
        className="rp-icon-button"
        aria-label="Close Rentify AI"
      >
        <X aria-hidden="true" />
      </button>
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
            <img src="/rentify-ai-logo-bubble-optimized.png" alt="Rentify AI" className="h-8 w-8 object-contain" />
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
          <img src="/rentify-ai-logo-bubble-optimized.png" alt="Rentify AI" className="h-8 w-8 object-contain" />
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
              { sender: "ai", text: "Got it! Let me help you with that." }
            ]);
            setIsTyping(false);
          }, 1200);
        }}
        className="bg-[#017FE6] text-white w-9 h-9 rounded-full"
      >
        &gt;
      </button>
    </div>
  </div>
      )}
    </div>
  );
};

export default AboutPage;

