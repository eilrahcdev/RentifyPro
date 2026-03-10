import { Car, Bike, Truck, Van } from "lucide-react";

export const VEHICLE_CATEGORIES = [
  {
    id: "premium-cars",
    title: "Premium Cars",
    icon: Car,
    image: "/cars.png",
    tags: ["Sedan", "Hatchback", "SUV", "Luxury"],
    description: "Perfect for family trips, business meetings, or special occasions.",
    price: "₱500/day",
  },
  {
    id: "motorcycles",
    title: "Motorcycles",
    icon: Bike,
    image: "/motor.png",
    tags: ["Scooter", "Sports Bike", "Cruiser"],
    description: "Ideal for quick commutes, exploring the city, or weekend adventures.",
    price: "₱300/day",
  },
  {
    id: "vans",
    title: "Vans",
    icon: Van,
    image: "/van.png",
    tags: ["Passenger", "Mini Van", "Cargo", "Luxury"],
    description: "Spacious rides designed for all your plans and occasions.",
    price: "₱1,500/day",
  },
  {
    id: "trucks",
    title: "Trucks",
    icon: Truck,
    image: "/trucks.png",
    tags: ["Pick-up", "Cargo", "Refrigerated", "Flat bed"],
    description: "Built for work, designed to carry cargo safely and comfortably.",
    price: "₱2,000/day",
  },
];