import axios from "axios";
import express from "express";
import {
  getConversations,
  getOwnerRenterThreads,
  openOwnerRenterThread,
  updateOwnerRenterThreadPin,
  getMessagesWithUser,
  sendMessageToUser,
  markMessagesAsRead,
  editMessage,
  deleteMessage,
  deleteConversation,
  updateConversationArchive,
} from "../controllers/chat.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";
import { requireModerationCapability } from "../middleware/moderation.middleware.js";
import { auditLog } from "../middleware/auditLogger.middleware.js";
import { chatbotConcurrencyGuard, chatbotLimiter, messageSendLimiter } from "../middleware/security.middleware.js";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import {
  getRenterBookingStatusReply,
  renterBookingRenterOnlyReply,
  renterBookingSignInReply,
} from "../services/chatbotBookingStatus.service.js";
import { ensureChatbotServiceReady } from "../utils/chatbotServiceManager.js";
import { getChatbotServiceHeaders } from "../utils/chatbotServiceAuth.js";
import { censorProfanityInText } from "../utils/chatModeration.js";
import { getChatbotScheduleRange } from "../utils/chatbotRentalQuote.js";
import { retainChatbotLease, settleChatbotRequest } from "../middleware/chatbotProtection.js";
import {
  applyChatbotGuardrails,
  buildRejectedChatbotResponse,
  buildChatbotPayload,
  buildChatbotInventoryVocabulary,
  buildChatbotConversationContext,
  fulfillVehicleAvailabilityStatus,
  normalizeChatbotResponse,
  normalizePendingVehicleSearch,
  normalizeChatbotConversationContext,
  validateChatbotInput,
  isChatbotVehicleGuidance,
  getChatbotDatasetInfo,
  getChatbotContextOutcome,
} from "../utils/chatbotPayload.js";

const router = express.Router();
const isProduction = process.env.NODE_ENV === "production";
const DEFAULT_CHATBOT_URL = isProduction ? "" : "http://localhost:8001";
const ACTIVE_BOOKING_STATUSES = ["pending", "confirmed", "extended"];
const LIVE_VEHICLE_INTENTS = new Set([
  "available_vehicles",
  "available_transmission",
  "passenger_capacity",
  "vehicle_brand_search",
]);
const PRIVATE_BOOKING_STATUS_INTENTS = new Set([
  "booking_status", "my_active_bookings", "my_overdue_return", "my_unpaid_balance",
]);
const isPrivateBookingStatus = (answer) => !answer.requires_clarification
  && PRIVATE_BOOKING_STATUS_INTENTS.has(answer.intent)
  && !(answer.intent === "booking_status" && ["approval_timing", "rejection"].includes(answer.response_variant));

router.post("/", chatbotConcurrencyGuard, chatbotLimiter, async (req, res, next) => {
  retainChatbotLease(req);
  let privateFulfillmentStarted = false;
  try {
    const rawMessage = String(req.body?.message || "");
    const language = String(req.body?.language || "auto").trim().toLowerCase();
    const previousLanguage = ["en", "fil", "taglish"].includes(req.body?.previousLanguage)
      ? req.body.previousLanguage : null;
    let previousContext = normalizeChatbotConversationContext(req.body?.conversationContext)
      || normalizePendingVehicleSearch(req.body?.pendingSearch);
    const validation = validateChatbotInput(rawMessage);
    if (!validation.isValid) {
      const rejectedResponse = buildRejectedChatbotResponse(
        language === "auto" ? rawMessage : language,
        validation.reason
      );
      if (validation.reason === "profanity") {
        rejectedResponse.censoredMessage = censorProfanityInText(rawMessage.trim());
      }
      return res.json(rejectedResponse);
    }
    const message = validation.message;

    const chatbotBaseUrl = String(process.env.CHATBOT_URL || DEFAULT_CHATBOT_URL)
      .trim()
      .replace(/\/+$/, "");
    if (!chatbotBaseUrl) {
      return res.status(503).json({ message: "CHATBOT_URL is not configured in production." });
    }
    const serviceHeaders = getChatbotServiceHeaders();
    await ensureChatbotServiceReady();

    const payload = buildChatbotPayload(message, language);

    const classify = async (inventoryVocabulary) => (await axios.post(
      `${chatbotBaseUrl}/chat`,
      {
        message: payload.originalMessage,
        language: ["auto", "english", "filipino", "taglish", "en", "fil", "tag"].includes(language) ? language : "auto",
        previous_language: previousLanguage,
        previous_context: previousContext,
        ...(inventoryVocabulary ? { inventory_vocabulary: inventoryVocabulary } : {}),
      },
      { timeout: 15000, headers: serviceHeaders, maxRedirects: 0 }
    )).data;

    let classifierResponse = await classify();
    let chatbotResponse = normalizeChatbotResponse(classifierResponse, payload.selectedLanguage);
    let inventoryVocabulary = {};
    // Python selects whether inventory recognition is needed; policy and social replies stay independent of inventory.
    if (chatbotResponse.valid && (chatbotResponse.inventory_vocabulary_requested || [chatbotResponse, ...chatbotResponse.additional_answers]
      .some(answer => answer.topic === "vehicles" && !answer.requires_clarification && !isChatbotVehicleGuidance(answer))
      || (chatbotResponse.intent === "REJECT" && chatbotResponse.requires_clarification
        && ["low_confidence", "ambiguous_intent"].includes(chatbotResponse.reason_code))
      || (!previousContext && req.body?.conversationContext?.topic === "vehicles"
        && ["REJECT", "unclear_message"].includes(chatbotResponse.intent)))) {
      const catalog = await Vehicle.find({}).select("name brand model specs.type specs.subType").lean();
      inventoryVocabulary = buildChatbotInventoryVocabulary(catalog);
      previousContext = normalizeChatbotConversationContext(req.body?.conversationContext, inventoryVocabulary)
        || normalizePendingVehicleSearch(req.body?.pendingSearch, inventoryVocabulary);
      classifierResponse = await classify(inventoryVocabulary);
      chatbotResponse = normalizeChatbotResponse(classifierResponse, payload.selectedLanguage, 0, inventoryVocabulary);
    }
    if (!chatbotResponse.valid) return res.json(applyChatbotGuardrails(chatbotResponse, payload));
    const answers = [chatbotResponse, ...chatbotResponse.additional_answers];
    const isVehicleSearch = (answer) => !answer.requires_clarification && !isChatbotVehicleGuidance(answer) && (
      LIVE_VEHICLE_INTENTS.has(answer.intent) || answer.intent === "rental_rate"
    );
    const isVehicleStatus = (answer) => !answer.requires_clarification
      && answer.intent === "vehicle_availability_status"
      && (answer.entities.brand || answer.conditions.vehicle_status_overview);
    const needsLiveVehicleData = answers.some(isVehicleSearch);
    const needsPriceInventory = answers.some((answer) => isVehicleSearch(answer) && answer.intent === "rental_rate");
    const needsVehicleStatus = answers.some(isVehicleStatus);
    const needsPrivateStatus = answers.some(isPrivateBookingStatus);
    let vehicleRecords = [];
    if (needsLiveVehicleData || needsVehicleStatus) {
      const vehicles = await Vehicle.find(needsVehicleStatus || needsPriceInventory ? {} : { availabilityStatus: "available" })
        .select(
          needsVehicleStatus && !needsLiveVehicleData
            ? "name location availabilityStatus dailyRentalRate pricingUnit specs.type specs.subType specs.transmission specs.seats +bookingReservationId"
            : "name brand model description location availabilityStatus imageUrl images dailyRentalRate pricingUnit specs.type specs.subType specs.transmission specs.seats specs.fuel driverOptionEnabled driverDailyRate +bookingReservationId"
        )
        .lean();

      vehicleRecords = vehicles;
      if (vehicles.length > 0) {
        const vehicleIds = vehicles.map((vehicle) => vehicle._id);
        const lockedVehicleIds = await Booking.distinct("vehicle", {
          vehicle: { $in: vehicleIds },
          status: { $in: ACTIVE_BOOKING_STATUSES },
          actualReturnAt: null,
        });
        const lockedVehicleIdSet = new Set(lockedVehicleIds.map((id) => String(id)));
        vehicleRecords = vehicles.map((vehicle) => vehicle.bookingReservationId || lockedVehicleIdSet.has(String(vehicle._id))
          ? { ...vehicle, availabilityStatus: "unavailable" } : vehicle);
      }
    }
    if (needsVehicleStatus || needsLiveVehicleData || needsPrivateStatus) res.set("Cache-Control", "no-store");
    const inventoryByAnswer = new Map();
    for (const answer of answers.filter(isVehicleSearch)) {
      const schedule = getChatbotScheduleRange(answer.entities);
      if (!schedule || !vehicleRecords.length) continue;
      // Keep the current unreturned-booking lock and the booking controller's overlap rule.
      const conflicts = await Booking.distinct("vehicle", {
        vehicle: { $in: vehicleRecords.map((vehicle) => vehicle._id) },
        status: { $in: ACTIVE_BOOKING_STATUSES },
        pickupAt: { $lt: schedule.returnAt }, returnAt: { $gt: schedule.pickupAt },
      });
      const conflictIds = new Set(conflicts.map(String));
      inventoryByAnswer.set(answer, vehicleRecords.map((vehicle) => conflictIds.has(String(vehicle._id))
        ? { ...vehicle, availabilityStatus: "unavailable" } : vehicle));
    }
    const fulfillAnswers = async () => {
      const fulfilled = [];
      for (const answer of answers) {
        const answerPayload = buildChatbotPayload(answer.question || message, language,
          isVehicleSearch(answer) ? inventoryByAnswer.get(answer) || vehicleRecords : [], answer.entities, false, inventoryVocabulary);
        let final = applyChatbotGuardrails({ ...answer, additional_answers: [] }, answerPayload);
        if (isVehicleStatus(answer)) final = fulfillVehicleAvailabilityStatus(final, vehicleRecords);
        if (isPrivateBookingStatus(answer)) {
          const authenticatedRenter = req.cookies?.token && req.user?.role === "user";
          final = { ...final, recommendations: [], requires_live_data: Boolean(authenticatedRenter),
            reason_code: !req.cookies?.token ? "authentication_required" : authenticatedRenter ? "authenticated_renter_booking_status" : "renter_account_required",
            reply: !req.cookies?.token ? renterBookingSignInReply(final.language)
              : !authenticatedRenter ? renterBookingRenterOnlyReply(final.language)
                : await getRenterBookingStatusReply(req.user._id, answer.intent, final.language) };
        }
        fulfilled.push(final);
      }
      const recommendations = [...new Map(fulfilled.flatMap((answer) => answer.recommendations)
        .map((vehicle) => [vehicle._id, vehicle])).values()].slice(0, 3);
      const contextAnswer = fulfilled.find((answer) => answer.requires_clarification)
        || fulfilled.find((answer) => answer.recommendations.length)
        || [...fulfilled].reverse().find((answer) => answer.topic !== "conversation") || fulfilled.at(-1);
      return { ...fulfilled[0], additional_answers: fulfilled.slice(1), recommendations,
        reply: fulfilled.length === 1 ? fulfilled[0].reply : fulfilled.map((answer, index) => `${index + 1}. ${answer.reply}`).join("\n\n"),
        conversation_context: buildChatbotConversationContext(contextAnswer, previousContext, inventoryVocabulary) };
    };
    if (needsPrivateStatus && req.cookies?.token) {
      await protect(req, res, async (authError) => {
        privateFulfillmentStarted = true;
        try {
          if (authError) return next(authError);
          return res.json(await fulfillAnswers());
        } catch (error) { return next(error); }
        finally { settleChatbotRequest(req); }
      });
      return;
    }
    const finalResponse = await fulfillAnswers();

    if (!isProduction) {
      auditLog.info("CHATBOT", "RentifyAI routing", {
        inputLength: message.length,
        classifierIntent: chatbotResponse.intent,
        taskIntent: finalResponse.conversation_context?.intent || null,
        requestedAnswerType: finalResponse.requested_answer_type || null,
        responseVariant: finalResponse.response_variant || null,
        assistantAction: finalResponse.conversation_context?.assistant_action || null,
        offerResolved: finalResponse.reason_code === "assistant_offer_fulfilled",
        contextState: getChatbotContextOutcome(finalResponse, previousContext, Boolean(req.body?.conversationContext && !previousContext)),
        datasetSha256: getChatbotDatasetInfo().datasetSha256,
        configSha256: getChatbotDatasetInfo().configSha256,
        confidence: chatbotResponse.confidence,
        style: finalResponse.language,
        brand: chatbotResponse.entities?.brand || null,
        category: chatbotResponse.entities?.category || null,
        rateUnit: chatbotResponse.entities?.rate_unit || null,
        hasBudget: Boolean(chatbotResponse.entities?.max_budget),
        conditionKeys: Object.keys(chatbotResponse.conditions || {}),
        clarificationType: finalResponse.clarification?.type || null,
        alternative: chatbotResponse.alternatives?.[0] || null,
        requiresLiveData: Boolean(finalResponse.requires_live_data),
        clarification: Boolean(finalResponse.requires_clarification),
      });
    }

    return res.json(finalResponse);
  } catch (error) {
    if (error.code === "CHATBOT_SERVICE_KEY_MISSING" ||
        (axios.isAxiosError(error) && [401, 403, 503].includes(error.response?.status))) {
      auditLog.error("CHATBOT", "Chatbot service access failed; check the matching internal key and service configuration.");
      return res.status(503).json({ message: "Chatbot service is temporarily unavailable. Please try again later." });
    }
    if (axios.isAxiosError(error)) {
      if (error.response) {
        return res.status(error.response.status).json(
          error.response.data && typeof error.response.data === "object"
            ? error.response.data
            : { message: "Chatbot service returned an invalid response." }
        );
      }

      return res.status(502).json({
        message: "Chatbot service is unavailable.",
      });
    }

    return next(error);
  } finally {
    if (!privateFulfillmentStarted) settleChatbotRequest(req);
  }
});

router.get("/conversations", protect, authorize("user", "owner", "admin"), getConversations);
router.get("/owner/renters", protect, authorize("owner", "admin"), getOwnerRenterThreads);
router.post("/owner/renters/:renterId/open", protect, authorize("owner", "admin"), openOwnerRenterThread);
router.patch("/owner/renters/:renterId/pin", protect, authorize("owner", "admin"), updateOwnerRenterThreadPin);
router.delete("/conversations/:userId", protect, authorize("user", "owner", "admin"), deleteConversation);
router.patch("/conversations/:userId/archive", protect, authorize("user", "owner", "admin"), updateConversationArchive);
router.get("/messages/:userId", protect, authorize("user", "owner", "admin"), getMessagesWithUser);
router.post("/messages/:userId", protect, authorize("user", "owner", "admin"), requireModerationCapability("chat"), messageSendLimiter, sendMessageToUser);
router.patch("/messages/:userId/read", protect, authorize("user", "owner", "admin"), markMessagesAsRead);
router.patch("/messages/:messageId", protect, authorize("user", "owner", "admin"), editMessage);
router.delete("/messages/:messageId", protect, authorize("user", "owner", "admin"), deleteMessage);

export default router;
