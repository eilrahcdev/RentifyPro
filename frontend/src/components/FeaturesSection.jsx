import React from "react";

export default function FeaturesSection({ features }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
      <h2 className="text-4xl font-bold text-center mb-16 animate-slideDown">
        Why choose <span className="text-[#017FE6]">RentifyPro</span>?
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {features.map((feature, index) => (
          <div key={index} className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-2xl transition-all duration-500 text-center hover:-translate-y-2 animate-fadeIn hover:scale-105" style={{ animationDelay: `${index * 150}ms` }}>
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full text-[#017FE6] mb-6 hover:scale-110 transition-transform duration-300">
              {feature.icon}
            </div>
            <h3 className="text-xl font-bold mb-4">{feature.title}</h3>
            <p className="text-gray-600">{feature.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}