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
import { chatbotConcurrencyGuard, chatbotLimiter } from "../middleware/security.middleware.js";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import {
  getRenterBookingStatusReply,
  renterBookingRenterOnlyReply,
  renterBookingSignInReply,
} from "../services/chatbotBookingStatus.service.js";
import { ensureChatbotServiceReady } from "../utils/chatbotServiceManager.js";
import { censorProfanityInText } from "../utils/chatModeration.js";
import {
  applyChatbotGuardrails,
  buildRejectedChatbotResponse,
  buildChatbotPayload,
  buildChatbotConversationContext,
  fulfillVehicleAvailabilityStatus,
  normalizeChatbotResponse,
  normalizePendingVehicleSearch,
  normalizeChatbotConversationContext,
  validateChatbotInput,
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

router.post("/", chatbotLimiter, chatbotConcurrencyGuard, async (req, res, next) => {
  try {
    const rawMessage = String(req.body?.message || "");
    const language = String(req.body?.language || "auto").trim().toLowerCase();
    const previousLanguage = ["en", "fil", "taglish"].includes(req.body?.previousLanguage)
      ? req.body.previousLanguage : null;
    const previousContext = normalizeChatbotConversationContext(req.body?.conversationContext)
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
    await ensureChatbotServiceReady();

    const payload = buildChatbotPayload(message, language);

    const { data: classifierResponse } = await axios.post(
      `${chatbotBaseUrl}/chat`,
      {
        message: payload.originalMessage,
        language: ["auto", "english", "filipino", "taglish", "en", "fil", "tag"].includes(language) ? language : "auto",
        previous_language: previousLanguage,
        previous_context: previousContext,
      },
      { timeout: 15000 }
    );

    const chatbotResponse = normalizeChatbotResponse(classifierResponse, payload.selectedLanguage);
    if (!chatbotResponse.valid) return res.json(applyChatbotGuardrails(chatbotResponse, payload));
    const answers = [chatbotResponse, ...chatbotResponse.additional_answers];
    const isVehicleSearch = (answer) => !answer.requires_clarification && (
      LIVE_VEHICLE_INTENTS.has(answer.intent) || (answer.intent === "rental_rate" && answer.entities.brand)
    );
    const isVehicleStatus = (answer) => !answer.requires_clarification
      && answer.intent === "vehicle_availability_status"
      && (answer.entities.brand || answer.conditions.vehicle_status_overview);
    const needsLiveVehicleData = answers.some(isVehicleSearch);
    const needsVehicleStatus = answers.some(isVehicleStatus);
    const needsPrivateStatus = answers.some((answer) => !answer.requires_clarification && PRIVATE_BOOKING_STATUS_INTENTS.has(answer.intent));
    let vehicleRecords = [];
    if (needsLiveVehicleData || needsVehicleStatus) {
      const vehicles = await Vehicle.find(needsVehicleStatus ? {} : { availabilityStatus: "available" })
        .select(
          needsVehicleStatus && !needsLiveVehicleData
            ? "name location availabilityStatus dailyRentalRate pricingUnit specs.type specs.subType specs.transmission specs.seats"
            : "name brand model description location availabilityStatus imageUrl images dailyRentalRate pricingUnit specs driverOptionEnabled driverDailyRate"
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
        vehicleRecords = vehicles.map((vehicle) => lockedVehicleIdSet.has(String(vehicle._id))
          ? { ...vehicle, availabilityStatus: "unavailable" } : vehicle);
      }
    }
    if (needsVehicleStatus || needsLiveVehicleData || needsPrivateStatus) res.set("Cache-Control", "no-store");
    const fulfillAnswers = async () => {
      const fulfilled = [];
      for (const answer of answers) {
        const answerPayload = buildChatbotPayload(answer.question || message, language,
          isVehicleSearch(answer) ? vehicleRecords : [], answer.entities);
        let final = applyChatbotGuardrails({ ...answer, additional_answers: [] }, answerPayload);
        if (isVehicleStatus(answer)) final = fulfillVehicleAvailabilityStatus(final, vehicleRecords);
        if (!answer.requires_clarification && PRIVATE_BOOKING_STATUS_INTENTS.has(answer.intent)) {
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
      const contextAnswer = fulfilled.find((answer) => answer.recommendations.length)
        || fulfilled.find((answer) => answer.requires_clarification) || fulfilled.at(-1);
      return { ...fulfilled[0], additional_answers: fulfilled.slice(1), recommendations,
        reply: fulfilled.length === 1 ? fulfilled[0].reply : fulfilled.map((answer, index) => `${index + 1}. ${answer.reply}`).join("\n\n"),
        conversation_context: buildChatbotConversationContext(contextAnswer) };
    };
    if (needsPrivateStatus && req.cookies?.token) {
      return protect(req, res, async (authError) => {
        if (authError) return next(authError);
        try { return res.json(await fulfillAnswers()); } catch (error) { return next(error); }
      });
    }
    const finalResponse = await fulfillAnswers();

    if (!isProduction) {
      auditLog.info("CHATBOT", "RentifyAI routing", {
        inputLength: message.length,
        classifierIntent: chatbotResponse.intent,
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
  }
});

router.get("/conversations", protect, authorize("user", "owner", "admin"), getConversations);
router.get("/owner/renters", protect, authorize("owner", "admin"), getOwnerRenterThreads);
router.post("/owner/renters/:renterId/open", protect, authorize("owner", "admin"), openOwnerRenterThread);
router.patch("/owner/renters/:renterId/pin", protect, authorize("owner", "admin"), updateOwnerRenterThreadPin);
router.delete("/conversations/:userId", protect, authorize("user", "owner", "admin"), deleteConversation);
router.patch("/conversations/:userId/archive", protect, authorize("user", "owner", "admin"), updateConversationArchive);
router.get("/messages/:userId", protect, authorize("user", "owner", "admin"), getMessagesWithUser);
router.post("/messages/:userId", protect, authorize("user", "owner", "admin"), requireModerationCapability("chat"), sendMessageToUser);
router.patch("/messages/:userId/read", protect, authorize("user", "owner", "admin"), markMessagesAsRead);
router.patch("/messages/:messageId", protect, authorize("user", "owner", "admin"), editMessage);
router.delete("/messages/:messageId", protect, authorize("user", "owner", "admin"), deleteMessage);

export default router;
