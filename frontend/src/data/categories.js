import { Car, Bike, Truck, Van } from "lucide-react";

export const VEHICLE_CATEGORIES = [
  {
    id: "premium-cars",
    title: "Premium Cars",
    icon: Car,
    image: "/cars-optimized.jpg",
    tags: ["Sedan", "Hatchback", "SUV", "Luxury"],
    description: "Perfect for family trips, business meetings, or special occasions.",
    price: "₱500/hr",
  },
  {
    id: "motorcycles",
    title: "Motorcycles",
    icon: Bike,
    image: "/motor-optimized.jpg",
    tags: ["Scooter", "Sports Bike", "Cruiser"],
    description: "Ideal for quick commutes, exploring the city, or weekend adventures.",
    price: "₱300/hr",
  },
  {
    id: "vans",
    title: "Vans",
    icon: Van,
    image: "/van-optimized.jpg",
    tags: ["Passenger", "Mini Van", "Cargo", "Luxury"],
    description: "Spacious rides designed for all your plans and occasions.",
    price: "₱1,500/hr",
  },
  {
    id: "trucks",
    title: "Trucks",
    icon: Truck,
    image: "/trucks-optimized.jpg",
    tags: ["Pick-up", "Cargo", "Refrigerated", "Flat bed"],
    description: "Built for work, designed to carry cargo safely and comfortably.",
    price: "₱2,000/hr",
  },
];
