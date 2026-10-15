import { rentalVehicles } from "./chatbotRentalVehicles.js";

export const specificationVehicles = [
  ...rentalVehicles.map(vehicle => ({ ...vehicle, driverOptionEnabled: vehicle.driverOptionEnabled ?? false,
    specs: { ...vehicle.specs, fuel: "Gasoline" } })),
  { ...rentalVehicles[3], _id: "000000000000000000000201", name: "Ford Transit",
    driverOptionEnabled: true, driverDailyRate: 720,
    specs: { type: "van", subType: "Passenger", seats: 18, transmission: "Automatic", fuel: "Diesel" } },
  { ...rentalVehicles[0], _id: "000000000000000000000202", name: "Isuzu FSR", driverOptionEnabled: false,
    specs: { type: "truck", subType: "Cargo", seats: 3, transmission: "Manual", fuel: "Diesel" } },
  { ...rentalVehicles[0], _id: "000000000000000000000203", name: "Ford Ranger", driverOptionEnabled: true,
    specs: { type: "truck", subType: "Pickup", seats: 5, transmission: "Automatic", fuel: "Diesel" } },
  { ...rentalVehicles[5], _id: "000000000000000000000204", name: "Honda Kuliglig", driverOptionEnabled: false,
    specs: { type: "motorcycle", subType: "Kuliglig", seats: 2, transmission: "Automatic", fuel: "Gasoline", plateNumber: "FIX-123" },
    owner: { email: "private-fixture@example.invalid", phone: "private-fixture" } },
  { ...rentalVehicles[5], _id: "000000000000000000000205", name: "Yamaha Electric", driverOptionEnabled: false,
    specs: { type: "motorcycle", subType: "Scooter", seats: 2, transmission: "Automatic", fuel: "Electric" } },
  { ...rentalVehicles[0], _id: "000000000000000000000206", name: "Toyota Unknown Specs",
    specs: { type: "car", subType: "Sedan" } },
];
