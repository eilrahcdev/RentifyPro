import React, { useEffect, useRef, useState } from "react";
import { LoaderCircle, Send, X } from "lucide-react";
import API from "../utils/api";

const CHAT_WIDGET_STORAGE_KEY = "rentifypro.chatWidget.v1";
const MAX_STORED_MESSAGES = 40;
const WELCOME_MESSAGE_ID_PREFIX = "welcome-";

const LANGUAGE_OPTIONS = [
  { value: "english", label: "English" },
  { value: "filipino", label: "Filipino" },
];

const TIME_BASED_GREETINGS = {
  english: {
    morning: "Good morning",
    afternoon: "Good afternoon",
    evening: "Good evening",
  },
  filipino: {
    morning: "Magandang umaga",
    afternoon: "Magandang hapon",
    evening: "Magandang gabi",
  },
};

const getGreetingPeriod = (date = new Date()) => {
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  if (totalMinutes === 0) return "evening";
  if (totalMinutes < 12 * 60) return "morning";
  if (totalMinutes < 18 * 60) return "afternoon";
  return "evening";
};

const getWelcomeText = (language, date = new Date()) => {
  const selectedLanguage = language === "filipino" ? "filipino" : "english";
  const greetingPeriod = getGreetingPeriod(date);
  const greeting =
    TIME_BASED_GREETINGS[selectedLanguage][greetingPeriod] ||
    TIME_BASED_GREETINGS.english[greetingPeriod];

  if (selectedLanguage === "filipino") {
    return `${greeting}, ako si RentifyPro AI. Ano ang maitutulong ko sa iyo?`;
  }

  return `${greeting}, I am RentifyPro AI. What can I help you with?`;
};

const createWelcomeMessage = (language, date = new Date()) => ({
  id: `${WELCOME_MESSAGE_ID_PREFIX}${language}-${getGreetingPeriod(date)}`,
  sender: "bot",
  text: getWelcomeText(language, date),
  recommendations: [],
});

const formatDailyRate = (value) => {
  const amount = Number(value || 0);
  return `P${amount.toLocaleString()} / day`;
};

const normalizeRecommendations = (recommendations) =>
  Array.isArray(recommendations) ? recommendations.filter((item) => item && typeof item === "object") : [];

const normalizeMessage = (message, language) => {
  if (!message || typeof message !== "object") {
    return null;
  }

  const sender = message.sender === "user" ? "user" : "bot";
  const text = String(message.text || "").trim();
  if (!text) {
    return null;
  }

  return {
    id: String(message.id || `${sender}-${Date.now()}`),
    sender,
    text,
    recommendations: sender === "bot" ? normalizeRecommendations(message.recommendations) : [],
  };
};

const isWelcomeMessage = (message) =>
  String(message?.id || "").startsWith(WELCOME_MESSAGE_ID_PREFIX);

const ensureConversation = (messages, language, date = new Date()) => {
  const normalized = Array.isArray(messages)
    ? messages
        .map((message) => normalizeMessage(message, language))
        .filter(Boolean)
        .filter((message) => !isWelcomeMessage(message))
        .slice(-Math.max(0, MAX_STORED_MESSAGES - 1))
    : [];

  return [createWelcomeMessage(language, date), ...normalized];
};

const getDefaultChatState = () => ({
  language: "english",
  conversations: {
    english: [createWelcomeMessage("english")],
    filipino: [createWelcomeMessage("filipino")],
  },
  drafts: {
    english: "",
    filipino: "",
  },
});

const readStoredChatState = () => {
  if (typeof window === "undefined") {
    return getDefaultChatState();
  }

  try {
    const raw = window.localStorage.getItem(CHAT_WIDGET_STORAGE_KEY);
    if (!raw) {
      return getDefaultChatState();
    }

    const parsed = JSON.parse(raw);
    return {
      language: parsed?.language === "filipino" ? "filipino" : "english",
      conversations: {
        english: ensureConversation(parsed?.conversations?.english, "english"),
        filipino: ensureConversation(parsed?.conversations?.filipino, "filipino"),
      },
      drafts: {
        english: String(parsed?.drafts?.english || ""),
        filipino: String(parsed?.drafts?.filipino || ""),
      },
    };
  } catch {
    return getDefaultChatState();
  }
};

export default function ChatWidget({ isOpen, onClose }) {
  const initialState = readStoredChatState();
  const [language, setLanguage] = useState(initialState.language);
  const [messagesByLanguage, setMessagesByLanguage] = useState(initialState.conversations);
  const [draftByLanguage, setDraftByLanguage] = useState(initialState.drafts);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef(null);

  const messages = ensureConversation(messagesByLanguage[language], language);
  const draft = String(draftByLanguage[language] || "");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      CHAT_WIDGET_STORAGE_KEY,
      JSON.stringify({
        language,
        conversations: {
          english: ensureConversation(messagesByLanguage.english, "english"),
          filipino: ensureConversation(messagesByLanguage.filipino, "filipino"),
        },
        drafts: {
          english: String(draftByLanguage.english || ""),
          filipino: String(draftByLanguage.filipino || ""),
        },
      })
    );
  }, [draftByLanguage, language, messagesByLanguage]);

  useEffect(() => {
    if (!isOpen) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [isOpen, messages, isSending]);

  const updateMessagesForLanguage = (targetLanguage, updater) => {
    setMessagesByLanguage((current) => {
      const currentMessages = ensureConversation(current[targetLanguage], targetLanguage);
      const nextMessages =
        typeof updater === "function" ? updater(currentMessages) : updater;

      return {
        ...current,
        [targetLanguage]: ensureConversation(nextMessages, targetLanguage),
      };
    });
  };

  const updateDraftForLanguage = (targetLanguage, value) => {
    setDraftByLanguage((current) => ({
      ...current,
      [targetLanguage]: value,
    }));
  };

  const sendMessage = async () => {
    const activeLanguage = language;
    const message = String(draftByLanguage[activeLanguage] || "").trim();
    if (!message || isSending) return;

    updateMessagesForLanguage(activeLanguage, (current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        sender: "user",
        text: message,
        recommendations: [],
      },
    ]);
    updateDraftForLanguage(activeLanguage, "");
    setIsSending(true);

    try {
      const response = await API.chatWithBot({ message, language: activeLanguage });
      updateMessagesForLanguage(activeLanguage, (current) => [
        ...current,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text:
            response.reply ||
            (activeLanguage === "filipino"
              ? "May problema sa tugon ng chatbot. Pakisubukan muli."
              : "There was a problem with the chatbot response. Please try again."),
          recommendations: Array.isArray(response.recommendations)
            ? response.recommendations
            : [],
        },
      ]);
    } catch (error) {
      updateMessagesForLanguage(activeLanguage, (current) => [
        ...current,
        {
          id: `bot-error-${Date.now()}`,
          sender: "bot",
          text:
            error.message ||
            (activeLanguage === "filipino"
              ? "Hindi maabot ang chatbot service sa ngayon. Pakisubukan muli mamaya."
              : "The chatbot service is unavailable right now. Please try again later."),
          recommendations: [],
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-[95vw] max-w-[420px] h-[72vh] max-h-[560px] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)] flex flex-col">
      <div className="bg-gradient-to-r from-[#0B75E7] to-[#045FC3] text-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">RentifyPro AI</h3>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 transition flex items-center justify-center"
            aria-label="Close chatbot"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 inline-flex rounded-2xl bg-white/10 p-1">
          {LANGUAGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setLanguage(option.value)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
                language === option.value
                  ? "bg-white text-[#0B75E7]"
                  : "text-white hover:bg-white/10"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                message.sender === "user"
                  ? "bg-[#0B75E7] text-white rounded-br-md"
                  : "bg-white text-slate-700 border border-slate-200 rounded-bl-md"
              }`}
            >
              <p className="whitespace-pre-line">{message.text}</p>

              {message.sender === "bot" && message.recommendations?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.recommendations.map((vehicle, index) => (
                    <article
                      key={`${message.id}-${vehicle._id || vehicle.name || index}`}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-3"
                    >
                      <h4 className="font-semibold text-slate-900">
                        {vehicle.name || "Vehicle"}
                      </h4>
                      <p className="mt-1 text-xs text-slate-600">
                        {vehicle.type || "N/A"} | {vehicle.transmission || "N/A"} |{" "}
                        {vehicle.seats || 0} seats
                      </p>
                      <p className="mt-2 text-sm font-semibold text-[#0B75E7]">
                        {formatDailyRate(vehicle.dailyRate)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isSending && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
              <LoaderCircle size={16} className="animate-spin" />
              {language === "filipino" ? "Nag-iisip..." : "Thinking..."}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 bg-white p-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => updateDraftForLanguage(language, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder={
            language === "filipino"
              ? "Magtanong tungkol sa sasakyan o booking..."
              : "Ask about vehicles or booking..."
          }
          className="rp-input text-sm"
          disabled={isSending}
        />
        <button
          onClick={sendMessage}
          disabled={isSending}
          className="h-11 min-w-11 rounded-2xl bg-[#0B75E7] text-white flex items-center justify-center disabled:opacity-60"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
