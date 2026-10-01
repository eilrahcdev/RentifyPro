import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { applyChatbotGuardrails, buildChatbotPayload, fulfillVehicleAvailabilityStatus, buildChatbotConversationContext } from "../utils/chatbotPayload.js";

// Fixed renter-visible snapshot. The unavailable record exercises visibility filtering.
const vehicles = [
  { _id: "vios", name: "Toyota Vios", dailyRentalRate: 2400, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "sedan", seats: 5, transmission: "Automatic" } },
  { _id: "everest", name: "Ford Everest", dailyRentalRate: 1800, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
  { _id: "fortuner", name: "Toyota Fortuner", dailyRentalRate: 2500, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
  { _id: "raptor", name: "Ford Ranger Raptor", dailyRentalRate: 3200, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "pickup", seats: 5, transmission: "Automatic" } },
  { _id: "city", name: "Honda City", dailyRentalRate: 1400, pricingUnit: "daily", availabilityStatus: "available", specs: { type: "sedan", seats: 5, transmission: "Automatic" } },
  { _id: "van", name: "Toyota Hiace", dailyRentalRate: 400, pricingUnit: "hourly", availabilityStatus: "available", specs: { type: "van", seats: 12, transmission: "Manual" } },
  { _id: "hidden", name: "Honda SUV", dailyRentalRate: 1000, pricingUnit: "daily", availabilityStatus: "unavailable", specs: { type: "suv", seats: 7, transmission: "Automatic" } },
];

const locations = { vios: "Manila", everest: "Cebu City", fortuner: "Davao City", raptor: "Davao City", city: "Cebu City", van: "Manila", hidden: "Cebu City" };
for (const vehicle of vehicles) vehicle.location = locations[vehicle._id];
export function fulfillHoldoutRequests(requests, includeRecommendationDetails = false) {
  return requests.map(({ message, classifier }) => {
  const answers = [classifier, ...(classifier.additional_answers || [])].map((answer) => {
    const payload = buildChatbotPayload(answer.question || message, "auto", vehicles, answer.entities);
    const canonical = applyChatbotGuardrails({ ...answer, additional_answers: [] }, payload);
    return canonical.intent === "vehicle_availability_status" && !canonical.requires_clarification
      ? fulfillVehicleAvailabilityStatus(canonical, vehicles) : canonical;
  });
  const response = answers[0];
  return {
    intent: response.intent,
    language: response.language,
    entities: response.entities,
    conditions: response.conditions,
    clarification: response.clarification,
    reply: answers.map((answer) => answer.reply).join("\n\n"),
    reason_code: response.reason_code,
    additional_intents: answers.slice(1).map((answer) => answer.intent),
    conversation_context: buildChatbotConversationContext(response),
    recommendations: includeRecommendationDetails ? response.recommendations : response.recommendations.map(({ _id, displayRate, displayRateUnit }) => ({
      id: _id, displayRate, displayRateUnit,
    })),
  };
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(fulfillHoldoutRequests(JSON.parse(readFileSync(0, "utf8")))));
}
