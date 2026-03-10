import axios from "axios";
import express from "express";
import {
  getConversations,
  getMessagesWithUser,
  sendMessageToUser,
  markMessagesAsRead,
} from "../controllers/chat.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/rbac.middleware.js";
import Vehicle from "../models/Vehicle.js";
import { ensureChatbotServiceReady } from "../utils/chatbotServiceManager.js";
import {
  applyChatbotGuardrails,
  buildRejectedChatbotResponse,
  buildChatbotPayload,
  buildRetryPayload,
  normalizeChatbotResponse,
  shouldRetryChatbotResponse,
} from "../utils/chatbotPayload.js";

const router = express.Router();
const DEFAULT_CHATBOT_URL = "http://localhost:8001";

router.post("/", async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    const language = String(req.body?.language || "english").trim().toLowerCase();
    if (!message) {
      return res.status(400).json({ message: "Message is required." });
    }

    const chatbotBaseUrl = String(process.env.CHATBOT_URL || DEFAULT_CHATBOT_URL)
      .trim()
      .replace(/\/+$/, "");
    await ensureChatbotServiceReady();

    const vehicles = await Vehicle.find({ availabilityStatus: "available" })
      .select(
        "name description location availabilityStatus imageUrl images dailyRentalRate specs driverOptionEnabled driverDailyRate"
      )
      .lean();

    const payload = buildChatbotPayload(message, language, vehicles);
    if (payload.preflightRejectReason) {
      return res.json(buildRejectedChatbotResponse(payload.selectedLanguage, payload.preflightRejectReason));
    }

    const { data: firstResponse } = await axios.post(
      `${chatbotBaseUrl}/chat`,
      {
        message: payload.filteredMessage,
        language: payload.selectedLanguage,
        vehicles: payload.vehicles,
      },
      { timeout: 15000 }
    );

    let chatbotResponse = normalizeChatbotResponse(firstResponse);

    if (shouldRetryChatbotResponse(chatbotResponse, payload)) {
      const retryMessage = buildRetryPayload(payload);
      const { data: retryResponse } = await axios.post(
        `${chatbotBaseUrl}/chat`,
        {
          message: retryMessage,
          language: payload.selectedLanguage,
          vehicles: payload.vehicles,
        },
        { timeout: 15000 }
      );

      const normalizedRetry = normalizeChatbotResponse(retryResponse);
      if (normalizedRetry.score >= chatbotResponse.score) {
        chatbotResponse = normalizedRetry;
      }
    }

    return res.json(applyChatbotGuardrails(chatbotResponse, payload));
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
router.get("/messages/:userId", protect, authorize("user", "owner", "admin"), getMessagesWithUser);
router.post("/messages/:userId", protect, authorize("user", "owner", "admin"), sendMessageToUser);
router.patch("/messages/:userId/read", protect, authorize("user", "owner", "admin"), markMessagesAsRead);

export default router;
