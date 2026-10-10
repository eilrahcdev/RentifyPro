export const getChatbotServiceHeaders = () => {
  const key = String(process.env.CHATBOT_INTERNAL_API_KEY || "").trim()
    || String(process.env.INTERNAL_API_KEY || "").trim();
  if (key.length < 32) {
    const error = new Error("Chatbot access requires a matching internal service key of at least 32 characters.");
    error.code = "CHATBOT_SERVICE_KEY_MISSING";
    throw error;
  }
  return { "x-internal-key": key };
};
