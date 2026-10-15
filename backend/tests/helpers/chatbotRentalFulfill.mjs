import { readFileSync } from "node:fs";
import { applyChatbotGuardrails, buildChatbotPayload, buildChatbotConversationContext, fulfillVehicleAvailabilityStatus } from "../../utils/chatbotPayload.js";
import { rentalVehicles } from "../fixtures/chatbotRentalVehicles.js";

const requests = JSON.parse(readFileSync(0, "utf8"));
const responses = requests.map(({ message, classifier, vehicles = rentalVehicles, previous_context = null }) => {
  const answers = [classifier, ...(classifier.additional_answers || [])].map((answer) => {
    const result = applyChatbotGuardrails({ ...answer, additional_answers: [] }, buildChatbotPayload(answer.question || message, "auto", vehicles, answer.entities));
    return result.intent === "vehicle_availability_status" && !result.requires_clarification
      ? fulfillVehicleAvailabilityStatus(result, vehicles) : result;
  });
  const contextAnswer = answers.find((answer) => answer.requires_clarification)
    || answers.find((answer) => answer.recommendations.length)
    || [...answers].reverse().find((answer) => answer.topic !== "conversation") || answers.at(-1);
  return { ...answers[0], additional_answers: answers.slice(1),
    reply: answers.length === 1 ? answers[0].reply : answers.map((answer, index) => `${index + 1}. ${answer.reply}`).join("\n\n"),
    conversation_context: buildChatbotConversationContext(contextAnswer, previous_context) };
});
process.stdout.write(JSON.stringify(responses));
