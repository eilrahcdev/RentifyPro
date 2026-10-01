import React, { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCirclePlus, Send, X } from "lucide-react";
import API from "../utils/api";
import { getSessionUser, SESSION_USER_UPDATED_EVENT } from "../utils/sessionStore";
import { formatVehicleType } from "../utils/vehicleText";
import { HELP_ASK_AI_EVENT } from "../utils/helpNavigation";
import AutoResizeTextarea from "./AutoResizeTextarea";

const CHAT_WIDGET_STORAGE_KEY_PREFIX = "rentifypro.chatWidget.v2";
const LEGACY_CHAT_WIDGET_STORAGE_KEY = "rentifypro.chatWidget.v1";
const CHAT_INPUT_MAX_LENGTH = 500;
const MAX_STORED_MESSAGES = 40;
const CONVERSATION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_THINKING_DISPLAY_MS = 800;
const WELCOME_MESSAGE_ID_PREFIX = "welcome-";

const BLOCKED_WORDS = [
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "puta",
  "putangina",
  "gago",
  "tanga",
  "ulol",
  "tarantado",
  "pakyu",
  "bwisit",
  "nigger",
  "nigga",
];

const TIME_BASED_GREETINGS = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

const getGreetingPeriod = (date = new Date()) => {
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  if (totalMinutes === 0) return "evening";
  if (totalMinutes < 12 * 60) return "morning";
  if (totalMinutes < 18 * 60) return "afternoon";
  return "evening";
};

const getWelcomeText = (date = new Date()) => {
  const greetingPeriod = getGreetingPeriod(date);
  const greeting = TIME_BASED_GREETINGS[greetingPeriod] || TIME_BASED_GREETINGS.evening;

  return `${greeting}, I am Rentify AI. I automatically reply in English, Filipino, or Taglish based on how you ask your question. What can I help you with today?`;
};

const SUGGESTED_QUESTION_COUNT = 3;
const SUGGESTED_QUESTION_POOL = [
  "What vehicles are available?",
  "How do I book a vehicle?",
  "What are the rental requirements?",
  "What payment methods are accepted?",
  "Is insurance included?",
  "Is there a security deposit?",
  "Can I extend my rental?",
  "Can I cancel my booking?",
  "Can I rent with a driver?",
  "How do I message the owner?",
  "How is my account verified?",
  "Do you have automatic cars?",
  "Can I choose a specific vehicle model?",
  "What is the minimum age to rent?",
];

const createSuggestedQuestions = () => {
  const shuffled = [...SUGGESTED_QUESTION_POOL];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled.slice(0, SUGGESTED_QUESTION_COUNT);
};

const normalizeSuggestedQuestions = (questions) => {
  if (!Array.isArray(questions)) return createSuggestedQuestions();

  const normalized = Array.from(
    new Set(
      questions
        .map((question) => String(question || "").trim())
        .filter((question) => SUGGESTED_QUESTION_POOL.includes(question))
    )
  );

  return normalized.length === SUGGESTED_QUESTION_COUNT
    ? normalized
    : createSuggestedQuestions();
};

const createWelcomeMessage = (language, date = new Date()) => ({
  id: `${WELCOME_MESSAGE_ID_PREFIX}${language}-${getGreetingPeriod(date)}`,
  sender: "bot",
  text: getWelcomeText(date),
  recommendations: [],
  showViewAvailableVehicles: false,
});

const formatRecommendationRate = (vehicle) => {
  const amount = Number(vehicle.displayRate ?? vehicle.hourlyRate ?? vehicle.dailyRate ?? 0);
  const unit = vehicle.displayRateUnit === "day" ? "day" : "hour";
  return `P${amount.toLocaleString()} / ${unit}`;
};

const normalizeRecommendations = (recommendations) =>
  Array.isArray(recommendations) ? recommendations.filter((item) => item && typeof item === "object") : [];

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const BLOCKED_WORD_GLOBAL_PATTERN = new RegExp(
  `\\b(${BLOCKED_WORDS.map((word) => escapeRegex(word)).join("|")})\\b`,
  "gi"
);

const maskBadWord = (word = "") => {
  const characters = Array.from(String(word || ""));
  if (characters.length <= 2) return "*".repeat(characters.length);
  return `${characters[0]}${"*".repeat(characters.length - 2)}${characters.at(-1)}`;
};

// React renders message text safely. Preserve the user's wording (including
// amounts, percentages, apostrophes, hyphens, and Unicode) and enforce only
// the same bounded length that the server validates.
const limitDraftInput = (value = "") =>
  String(value || "").slice(0, CHAT_INPUT_MAX_LENGTH);

const censorBadWords = (value = "") =>
  String(value || "").replace(BLOCKED_WORD_GLOBAL_PATTERN, (word) => maskBadWord(word));

const normalizeMessage = (message) => {
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
    replyStyle: sender === "bot" && ["en", "fil", "taglish"].includes(message.replyStyle)
      ? message.replyStyle : null,
    pendingSearch: sender === "bot" && message.pendingSearch && typeof message.pendingSearch === "object"
      ? message.pendingSearch : null,
    conversationContext: sender === "bot" && message.conversationContext && typeof message.conversationContext === "object"
      ? message.conversationContext : null,
    showViewAvailableVehicles:
      sender === "bot" ? Boolean(message.showViewAvailableVehicles) : false,
  };
};

const isWelcomeMessage = (message) =>
  String(message?.id || "").startsWith(WELCOME_MESSAGE_ID_PREFIX);

const ensureConversation = (messages, language, date = new Date()) => {
  const normalized = Array.isArray(messages)
    ? messages
        .map((message) => normalizeMessage(message))
        .filter(Boolean)
        .filter((message) => !isWelcomeMessage(message))
        .slice(-Math.max(0, MAX_STORED_MESSAGES - 1))
    : [];

  return [createWelcomeMessage(language, date), ...normalized];
};

const createConversationId = (date = new Date()) => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `chat-${date.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
};

const createConversationMetadata = (date = new Date()) => ({
  id: createConversationId(date),
  startedAt: date.toISOString(),
  lastActivityAt: date.toISOString(),
});

const normalizeConversationMetadata = (conversation) => {
  const id = String(conversation?.id || "").trim();
  const startedAtMs = Date.parse(conversation?.startedAt);
  const lastActivityAtMs = Date.parse(conversation?.lastActivityAt);

  if (!id || !Number.isFinite(startedAtMs) || !Number.isFinite(lastActivityAtMs)) {
    return null;
  }

  return {
    id,
    startedAt: new Date(startedAtMs).toISOString(),
    lastActivityAt: new Date(lastActivityAtMs).toISOString(),
  };
};

const isSameLocalDay = (left, right) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const isConversationExpired = (conversation, date = new Date()) => {
  const normalized = normalizeConversationMetadata(conversation);
  if (!normalized) return true;

  const lastActivity = new Date(normalized.lastActivityAt);
  const idleTime = date.getTime() - lastActivity.getTime();
  return (
    idleTime < 0 ||
    idleTime >= CONVERSATION_IDLE_TIMEOUT_MS ||
    !isSameLocalDay(lastActivity, date)
  );
};

const getDefaultChatState = (date = new Date()) => ({
  language: "english",
  conversation: createConversationMetadata(date),
  suggestedQuestions: createSuggestedQuestions(),
  conversations: {
    english: [createWelcomeMessage("english", date)],
    filipino: [createWelcomeMessage("filipino", date)],
  },
  drafts: {
    english: "",
    filipino: "",
  },
});

const resolveStorageScope = () => {
  const userId = String(getSessionUser()?._id || "").trim();
  return userId ? `user:${userId}` : "guest";
};

const getStorageKey = (scope) => `${CHAT_WIDGET_STORAGE_KEY_PREFIX}:${scope}`;

const readStoredChatState = (scope, date = new Date()) => {
  if (typeof window === "undefined") {
    return getDefaultChatState(date);
  }

  try {
    const storageKey = getStorageKey(scope);
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      return getDefaultChatState(date);
    }

    const parsed = JSON.parse(raw);
    const conversation = normalizeConversationMetadata(parsed?.conversation);
    if (!conversation || isConversationExpired(conversation, date)) {
      window.sessionStorage.removeItem(storageKey);
      return getDefaultChatState(date);
    }

    return {
      language: "english",
      conversation,
      suggestedQuestions: normalizeSuggestedQuestions(parsed?.suggestedQuestions),
      conversations: {
        english: ensureConversation(parsed?.conversations?.english, "english", date),
        filipino: ensureConversation(parsed?.conversations?.filipino, "filipino", date),
      },
      drafts: {
        english: limitDraftInput(parsed?.drafts?.english || ""),
        filipino: limitDraftInput(parsed?.drafts?.filipino || ""),
      },
    };
  } catch {
    return getDefaultChatState(date);
  }
};

const removeLegacyChatStorage = () => {
  if (typeof window === "undefined") return;

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key === LEGACY_CHAT_WIDGET_STORAGE_KEY || key?.startsWith(`${LEGACY_CHAT_WIDGET_STORAGE_KEY}:`)) {
      window.localStorage.removeItem(key);
    }
  }
};

export default function ChatWidget({ isOpen, onOpen, onClose, onViewAvailableVehicles }) {
  const initialStorageScope = resolveStorageScope();
  const initialState = readStoredChatState(initialStorageScope);
  const [storageScope, setStorageScope] = useState(initialStorageScope);
  const [language, setLanguage] = useState(initialState.language);
  const [conversation, setConversation] = useState(initialState.conversation);
  const [suggestedQuestions, setSuggestedQuestions] = useState(initialState.suggestedQuestions);
  const [messagesByLanguage, setMessagesByLanguage] = useState(initialState.conversations);
  const [draftByLanguage, setDraftByLanguage] = useState(initialState.drafts);
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const conversationIdRef = useRef(initialState.conversation.id);

  useEffect(() => {
    if (!onOpen) return undefined;
    const handleHelpAskAI = () => onOpen();
    window.addEventListener(HELP_ASK_AI_EVENT, handleHelpAskAI);
    return () => window.removeEventListener(HELP_ASK_AI_EVENT, handleHelpAskAI);
  }, [onOpen]);

  const messages = ensureConversation(messagesByLanguage[language], language);
  const draft = String(draftByLanguage[language] || "");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      getStorageKey(storageScope),
      JSON.stringify({
        language,
        conversation,
        suggestedQuestions,
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
  }, [conversation, draftByLanguage, language, messagesByLanguage, storageScope, suggestedQuestions]);

  const replaceChatState = useCallback((nextState) => {
    conversationIdRef.current = nextState.conversation.id;
    setLanguage(nextState.language);
    setConversation(nextState.conversation);
    setSuggestedQuestions(nextState.suggestedQuestions);
    setMessagesByLanguage(nextState.conversations);
    setDraftByLanguage(nextState.drafts);
    setIsSending(false);
  }, []);

  const startNewConversation = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(getStorageKey(storageScope));
    }
    replaceChatState(getDefaultChatState());
    inputRef.current?.focus();
  }, [replaceChatState, storageScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    removeLegacyChatStorage();

    const syncChatStateToCurrentSessionUser = () => {
      const nextScope = resolveStorageScope();
      if (storageScope === nextScope) return;

      window.sessionStorage.removeItem(getStorageKey(storageScope));
      window.sessionStorage.removeItem(getStorageKey(nextScope));
      replaceChatState(getDefaultChatState());
      setStorageScope(nextScope);
    };

    window.addEventListener(SESSION_USER_UPDATED_EVENT, syncChatStateToCurrentSessionUser);
    return () => {
      window.removeEventListener(SESSION_USER_UPDATED_EVENT, syncChatStateToCurrentSessionUser);
    };
  }, [replaceChatState, storageScope]);

  useEffect(() => {
    if (!isOpen || isSending) return undefined;

    if (isConversationExpired(conversation)) {
      startNewConversation();
      return undefined;
    }

    const lastActivityAtMs = Date.parse(conversation.lastActivityAt);
    const now = new Date();
    const idleExpiryAt = lastActivityAtMs + CONVERSATION_IDLE_TIMEOUT_MS;
    const nextDayAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    ).getTime();
    const expiryDelay = Math.max(0, Math.min(idleExpiryAt, nextDayAt) - now.getTime());
    const expiryTimer = window.setTimeout(startNewConversation, expiryDelay + 50);

    return () => window.clearTimeout(expiryTimer);
  }, [conversation, isOpen, isSending, startNewConversation]);

  useEffect(() => {
    if (!isOpen) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [isOpen, messages, isSending]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen, language]);

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

  const markConversationActive = () => {
    const now = new Date().toISOString();
    setConversation((current) => ({
      ...current,
      lastActivityAt: now,
    }));
  };

  const sendMessage = async (messageOverride = "") => {
    const activeLanguage = language;
    const hasMessageOverride = typeof messageOverride === "string" && messageOverride.trim();
    const rawDraft = hasMessageOverride
      ? messageOverride
      : String(draftByLanguage[activeLanguage] || "");
    const limitedDraft = limitDraftInput(rawDraft);
    const message = limitedDraft.trim();

    if (!hasMessageOverride && limitedDraft !== rawDraft) {
      updateDraftForLanguage(activeLanguage, limitedDraft);
    }

    inputRef.current?.focus();
    if (!message || isSending) return;

    const previousLanguage = [...(messagesByLanguage[activeLanguage] || [])]
      .reverse()
      .find((item) => item.sender === "bot" && ["en", "fil", "taglish"].includes(item.replyStyle))?.replyStyle || null;
    const lastBotMessage = [...(messagesByLanguage[activeLanguage] || [])]
      .reverse()
      .find((item) => item.sender === "bot" && !isWelcomeMessage(item));
    const pendingSearch = lastBotMessage?.pendingSearch || null;
    const conversationContext = lastBotMessage?.conversationContext || null;

    const requestConversationId = conversationIdRef.current;
    const userMessageId = `user-${Date.now()}`;
    updateMessagesForLanguage(activeLanguage, (current) => [
      ...current,
      {
        id: userMessageId,
        sender: "user",
        text: censorBadWords(message),
        recommendations: [],
        showViewAvailableVehicles: false,
      },
    ]);
    updateDraftForLanguage(activeLanguage, "");
    markConversationActive();
    setIsSending(true);
    const thinkingStartedAt = Date.now();

    try {
      const response = await API.chatWithBot({ message, language: "auto", previousLanguage, pendingSearch, conversationContext });
      const remainingThinkingTime = Math.max(
        0,
        MIN_THINKING_DISPLAY_MS - (Date.now() - thinkingStartedAt)
      );
      if (remainingThinkingTime > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingThinkingTime));
      }
      if (conversationIdRef.current !== requestConversationId) return;

      updateMessagesForLanguage(activeLanguage, (current) => {
        const updatedMessages = response.censoredMessage
          ? current.map((item) =>
              item.id === userMessageId
                ? { ...item, text: String(response.censoredMessage) }
                : item
            )
          : current;

        return [
          ...updatedMessages,
          {
            id: `bot-${Date.now()}`,
            sender: "bot",
            replyStyle: ["en", "fil", "taglish"].includes(response.language) ? response.language : null,
            pendingSearch: response.intent === "available_vehicles" && response.clarification?.field === "rate_unit"
              ? response.entities : null,
            conversationContext: response.conversation_context || null,
            text:
              response.reply ||
              (activeLanguage === "filipino"
                ? "May problema sa tugon ng chatbot. Pakisubukan muli."
                : "There was a problem with the chatbot response. Please try again."),
            recommendations: Array.isArray(response.recommendations)
              ? response.recommendations
              : [],
            showViewAvailableVehicles:
              ["available_vehicles", "vehicle_brand_search"].includes(response.intent) &&
              Array.isArray(response.recommendations) &&
              response.recommendations.length > 0,
          },
        ];
      });
    } catch (error) {
      if (conversationIdRef.current !== requestConversationId) return;

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
          showViewAvailableVehicles: false,
        },
      ]);
    } finally {
      if (conversationIdRef.current === requestConversationId) {
        setIsSending(false);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="Rentify AI chatbot"
      className="rp-ai-chat-dialog fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-[90] flex h-[min(76dvh,620px)] max-h-[620px] w-[calc(100vw-2rem)] max-w-[440px] flex-col overflow-hidden rounded-3xl border border-blue-100/80 bg-white shadow-[0_20px_48px_rgba(2,32,71,0.2)] sm:bottom-4 sm:right-4 sm:shadow-[0_30px_100px_rgba(2,32,71,0.3)]"
    >
      <div className="rp-ai-chat-header relative overflow-hidden bg-[linear-gradient(135deg,#0B75E7_0%,#056ED9_55%,#045FC3_100%)] px-4 py-4 text-white">
        <div className="pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full border border-white/10 bg-white/5" />
        <div className="pointer-events-none absolute -bottom-16 right-20 h-28 w-28 rounded-full border border-white/10" />
        <div className="relative flex items-center justify-between gap-3">
          <div className="rp-ai-chat-title flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white/15 p-1 shadow-lg shadow-blue-950/15 backdrop-blur-sm">
              <img
                src="/rentify-ai-logo-bubble-optimized.png"
                alt="Rentify AI"
                className="h-full w-full rounded-full object-contain"
              />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight">Rentify AI</h3>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-blue-100">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-white/25" />
                </span>
                <span>Online</span>
              </div>
            </div>
          </div>
          <div className="rp-ai-chat-actions flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={startNewConversation}
              disabled={isSending || messages.length === 1}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-2xl border border-white/15 bg-white/10 px-3 text-xs font-semibold transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Start a new chatbot conversation"
              title="Start a new chat"
            >
              <MessageCirclePlus size={18} strokeWidth={2} aria-hidden="true" />
              <span className="rp-ai-chat-new-label">New chat</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rp-icon-button"
              aria-label="Close Rentify AI"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="rp-ai-chat-body flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex items-end gap-2.5 ${message.sender === "user" ? "justify-end" : "justify-start"}`}
          >
            {message.sender === "bot" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-white p-0.5 shadow-sm">
                <img
                  src="/rentify-ai-logo-bubble-optimized.png"
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full rounded-full object-contain"
                />
              </div>
            )}
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                message.sender === "user"
                  ? "rounded-br-md bg-[linear-gradient(135deg,#0B75E7,#056ED9)] text-white shadow-[0_10px_24px_rgba(11,117,231,0.2)]"
                  : "rounded-bl-md border border-slate-200/90 bg-white text-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.06)]"
              }`}
            >
              <p className="whitespace-pre-line">{message.text}</p>

              {message.sender === "bot" && message.recommendations?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {message.recommendations.map((vehicle, index) => (
                    <article
                      key={`${message.id}-${vehicle._id || vehicle.name || index}`}
                      className="rounded-2xl border border-blue-100 bg-[linear-gradient(145deg,#f8fbff,#eff6ff)] p-3 transition hover:border-blue-200"
                    >
                      <h4 className="font-semibold text-slate-900">
                        {vehicle.name || "Vehicle"}
                      </h4>
                      <p className="mt-1 text-xs text-slate-600">
                        {formatVehicleType(vehicle.type, "N/A")} | {vehicle.transmission || "N/A"} |{" "}
                        {vehicle.seats || 0} seats
                      </p>
                      <p className="mt-2 text-sm font-semibold text-[#0B75E7]">
                        {formatRecommendationRate(vehicle)}
                      </p>
                    </article>
                  ))}
                  {message.showViewAvailableVehicles && typeof onViewAvailableVehicles === "function" && (
                    <button
                      onClick={() => {
                        onClose?.();
                        onViewAvailableVehicles();
                      }}
                      className="mt-1 inline-flex items-center justify-center rounded-xl bg-[#0B75E7] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-[#095fb8]"
                    >
                      View available vehicles
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {messages.length === 1 && !isSending && (
          <div className="pl-10">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Suggested questions
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  disabled={isSending}
                  className="rounded-full border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-[#0B75E7] shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {isSending && (
          <div className="flex items-end gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-white p-0.5 shadow-sm">
              <img src="/rentify-ai-logo-bubble-optimized.png" alt="" aria-hidden="true" className="h-full w-full rounded-full object-contain" />
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
              <LoaderCircle size={16} className="animate-spin" />
              <span>
                {language === "filipino" ? "Nag-iisip ang Rentify AI" : "Rentify AI is thinking"}
              </span>
              <span className="animate-pulse font-bold tracking-widest" aria-hidden="true">
                ...
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200/80 bg-white/95 p-3.5 backdrop-blur">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5 transition focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
          <AutoResizeTextarea
            ref={inputRef}
            maxRows={3}
            aria-label="Message Rentify AI"
            value={draft}
            onChange={(event) =>
              updateDraftForLanguage(language, limitDraftInput(event.target.value))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder={
              language === "filipino"
                ? "Magtanong tungkol sa sasakyan o booking..."
                : "Ask about vehicles or booking..."
            }
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400"
            maxLength={CHAT_INPUT_MAX_LENGTH}
          />
          <button
            onClick={() => sendMessage()}
            disabled={isSending}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#0B75E7,#045FC3)] text-white shadow-[0_8px_18px_rgba(11,117,231,0.24)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-slate-400">
          <span>Press Enter to send</span>
          <span>{draft.length}/{CHAT_INPUT_MAX_LENGTH}</span>
        </div>
      </div>
    </div>
  );
}
