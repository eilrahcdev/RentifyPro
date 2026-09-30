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
  normalizeChatbotResponse,
  normalizePendingVehicleSearch,
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
    const previousContext = normalizePendingVehicleSearch(req.body?.pendingSearch);
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

    let payload = buildChatbotPayload(message, language);

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
    const needsLiveVehicleData = chatbotResponse.valid && !chatbotResponse.requires_clarification && (
      LIVE_VEHICLE_INTENTS.has(chatbotResponse.intent) ||
      (chatbotResponse.intent === "rental_rate" && chatbotResponse.entities?.brand)
    );
    if (needsLiveVehicleData) {
      const vehicles = await Vehicle.find({ availabilityStatus: "available" })
        .select(
          "name brand model description location availabilityStatus imageUrl images dailyRentalRate pricingUnit specs driverOptionEnabled driverDailyRate"
        )
        .lean();

      let realtimeAvailableVehicles = vehicles;
      if (vehicles.length > 0) {
        const vehicleIds = vehicles.map((vehicle) => vehicle._id);
        const lockedVehicleIds = await Booking.distinct("vehicle", {
          vehicle: { $in: vehicleIds },
          status: { $in: ACTIVE_BOOKING_STATUSES },
          actualReturnAt: null,
        });
        const lockedVehicleIdSet = new Set(lockedVehicleIds.map((id) => String(id)));
        realtimeAvailableVehicles = vehicles.filter(
          (vehicle) => !lockedVehicleIdSet.has(String(vehicle?._id || ""))
        );
      }
      payload = buildChatbotPayload(
        message,
        language,
        realtimeAvailableVehicles,
        chatbotResponse.entities
      );
    }

    const finalResponse = applyChatbotGuardrails(chatbotResponse, payload);
    if (chatbotResponse.valid && !chatbotResponse.requires_clarification
      && PRIVATE_BOOKING_STATUS_INTENTS.has(chatbotResponse.intent)) {
      res.set("Cache-Control", "no-store");
      const replyWithStatus = (reply, reasonCode, usedLiveData = false) => res.json({
        ...finalResponse,
        reply,
        reason_code: reasonCode,
        requires_live_data: usedLiveData,
        recommendations: [],
      });
      if (!req.cookies?.token) {
        return replyWithStatus(renterBookingSignInReply(finalResponse.language), "authentication_required");
      }
      return protect(req, res, async (authError) => {
        if (authError) return next(authError);
        if (req.user?.role !== "user") {
          return replyWithStatus(renterBookingRenterOnlyReply(finalResponse.language), "renter_account_required");
        }
        try {
          const reply = await getRenterBookingStatusReply(
            req.user._id, chatbotResponse.intent, finalResponse.language
          );
          return replyWithStatus(reply, "authenticated_renter_booking_status", true);
        } catch (error) {
          return next(error);
        }
      });
    }

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
