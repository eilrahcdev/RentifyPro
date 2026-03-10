import React from "react";

export default function CategoryCard({ category, onClick }) {
  const IconComponent = category.icon;

  return (
    <div onClick={onClick} className="bg-gray-50 rounded-2xl p-8 hover:shadow-2xl transition-all duration-500 cursor-pointer hover:-translate-y-2 group">
      <div className="overflow-hidden rounded-xl mb-6">
        <img src={category.image} alt={category.title} className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500" />
      </div>

      <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
        <IconComponent className="w-6 h-6 text-[#017FE6]" />
        {category.title}
      </h3>

      <div className="flex flex-wrap gap-2 mb-4">
        {category.tags.map((tag) => (
          <span key={tag} className="bg-[#017FE6] text-white px-3 py-1 rounded-full text-sm">
            {tag}
          </span>
        ))}
      </div>

      <p className="text-gray-600 text-left mb-4">{category.description}</p>
      <p className="text-[#017FE6] font-bold text-xl">Starting from {category.price}</p>
    </div>
  );
}