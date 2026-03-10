import { useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import Navbar from "../components/Navbar";
import API from "../utils/api";
import { getSocket } from "../utils/socket";
import { requestLiveCountersRefresh } from "../utils/liveCounters";
import { formatDisplayName, getInitialsFromName } from "../utils/dateUtils";
import { resolveAssetUrl } from "../utils/media";

const getId = (value) => String(value?._id || value || "");
const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
const appendUniqueMessage = (list, message) =>
  list.some((item) => item._id === message._id) ? list : [...list, message];
const normalizePartner = (partner = {}) => {
  const name = formatDisplayName(partner?.name || "", "");
  const email = String(partner?.email || "").trim();
  return {
    _id: String(partner?._id || ""),
    name: name || email || "User",
    email,
    avatar: resolveAssetUrl(partner?.avatar),
  };
};

export default function RealtimeChatPage({
  isLoggedIn,
  user,
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegister,
  onNavigateToVehicles,
  onNavigateToBookingHistory,
  onNavigateToAbout,
  onNavigateToContacts,
  onNavigateToChat,
  onNavigateToNotifications,
  onNavigateToAccountSettings,
  onLogout,
}) {
  const currentUserId = user?._id || JSON.parse(localStorage.getItem("user") || "{}")._id || "";

  const [conversations, setConversations] = useState([]);
  const [activePartnerId, setActivePartnerId] = useState("");
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");

  const activeConversation = useMemo(
    () => conversations.find((conversation) => getId(conversation.partner) === activePartnerId),
    [conversations, activePartnerId]
  );

  const loadConversations = async () => {
    setLoadingConversations(true);
    setError("");
    try {
      const response = await API.getConversations();
      const nextConversations = (response.conversations || []).map((conversation) => ({
        ...conversation,
        partner: normalizePartner(conversation.partner),
      }));
      setConversations(nextConversations);
      setActivePartnerId((prevId) => prevId || getId(nextConversations[0]?.partner));
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to load conversations.");
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadMessages = async (partnerId) => {
    if (!partnerId) return;

    setLoadingMessages(true);
    setError("");
    try {
      const response = await API.getMessagesWithUser(partnerId);
      setMessages(response.messages || []);
      await API.markMessagesAsRead(partnerId);
      setConversations((prev) =>
        prev.map((conversation) =>
          getId(conversation.partner) === partnerId ? { ...conversation, unreadCount: 0 } : conversation
        )
      );
      requestLiveCountersRefresh();
    } catch (err) {
      setError(err.message || "Failed to load messages.");
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    loadMessages(activePartnerId);
  }, [activePartnerId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const handleIncomingMessage = (message) => {
      const senderId = getId(message.sender);
      const receiverId = getId(message.receiver);
      const isOutgoing = senderId === String(currentUserId);
      const partner = isOutgoing ? message.receiver : message.sender;
      const partnerId = getId(partner);

      if (!partnerId) return;

      setConversations((prev) => {
        const existingConversation = prev.find(
          (conversation) => getId(conversation.partner) === partnerId
        );

        const nextConversation = {
          partner: normalizePartner({
            _id: getId(partner),
            name: partner?.name,
            email: partner?.email,
            avatar: partner?.avatar,
          }),
          lastMessage: {
            _id: message._id,
            text: message.text,
            sender: message.sender,
            receiver: message.receiver,
            createdAt: message.createdAt,
          },
          unreadCount:
            !isOutgoing && activePartnerId !== partnerId
              ? (existingConversation?.unreadCount || 0) + 1
              : 0,
        };

        const rest = prev.filter((conversation) => getId(conversation.partner) !== partnerId);
        return [nextConversation, ...rest];
      });

      if ([senderId, receiverId].includes(activePartnerId)) {
        setMessages((prev) => appendUniqueMessage(prev, message));
        if (!isOutgoing && activePartnerId === partnerId) {
          API.markMessagesAsRead(partnerId)
            .then(() => requestLiveCountersRefresh())
            .catch(() => {});
        }
      }
    };

    socket.on("chat:message", handleIncomingMessage);
    return () => {
      socket.off("chat:message", handleIncomingMessage);
    };
  }, [activePartnerId, currentUserId]);

  const sendMessage = async () => {
    const text = messageText.trim();
    if (!activePartnerId || !text) return;

    try {
      const response = await API.sendMessageToUser(activePartnerId, { text });
      setMessages((prev) => appendUniqueMessage(prev, response.message));
      setMessageText("");
      loadConversations();
    } catch (err) {
      setError(err.message || "Failed to send message.");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        activePage=""
        isLoggedIn={isLoggedIn}
        user={user}
        onNavigateToHome={onNavigateToHome}
        onNavigateToSignIn={onNavigateToSignIn}
        onNavigateToRegister={onNavigateToRegister}
        onNavigateToVehicles={onNavigateToVehicles}
        onNavigateToBookingHistory={onNavigateToBookingHistory}
        onNavigateToAbout={onNavigateToAbout}
        onNavigateToContacts={onNavigateToContacts}
        onNavigateToChat={onNavigateToChat}
        onNavigateToNotifications={onNavigateToNotifications}
        onNavigateToAccountSettings={onNavigateToAccountSettings}
        onLogout={onLogout}
      />

      <div className="max-w-7xl mx-auto px-6 pt-24 pb-16">
        <div className="mb-5">
          <h1 className="text-3xl font-bold">Real-Time Chat</h1>
          <p className="text-sm text-gray-600">Talk with owners about your bookings in real time.</p>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="bg-white border rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr] min-h-[64vh]">
          <aside className="border-r bg-gray-50">
            <div className="px-4 py-3 border-b font-semibold">Conversations</div>
            {loadingConversations && (
              <p className="px-4 py-3 text-sm text-gray-500">Loading conversations...</p>
            )}
            {!loadingConversations && !conversations.length && (
              <p className="px-4 py-3 text-sm text-gray-500">No conversations yet.</p>
            )}
            <div className="max-h-[64vh] overflow-y-auto">
              {conversations.map((conversation) => {
                const partnerId = getId(conversation.partner);
                return (
                  <button
                    key={partnerId}
                    onClick={() => setActivePartnerId(partnerId)}
                    className={`w-full text-left px-4 py-3 border-b hover:bg-gray-100 ${
                      activePartnerId === partnerId ? "bg-gray-100" : ""
                    }`}
                  >
                    <div className="flex justify-between items-center gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarCircle
                          name={conversation.partner?.name || "User"}
                          avatar={conversation.partner?.avatar}
                          sizeClass="w-8 h-8"
                        />
                        <p className="font-medium text-sm truncate">
                          {conversation.partner?.name || "User"}
                        </p>
                      </div>
                      {conversation.unreadCount > 0 && (
                        <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-1">
                      {conversation.lastMessage?.text || "No messages"}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {formatDateTime(conversation.lastMessage?.createdAt)}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex flex-col">
            <div className="px-5 py-4 border-b">
              <div className="flex items-center gap-3">
                <AvatarCircle
                  name={activeConversation?.partner?.name || "User"}
                  avatar={activeConversation?.partner?.avatar}
                  sizeClass="w-9 h-9"
                />
                <div>
                  <h2 className="font-semibold">
                    {activeConversation?.partner?.name || "Select a conversation"}
                  </h2>
                  {activeConversation?.partner?.email && (
                    <p className="text-xs text-gray-500">{activeConversation.partner.email}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50">
              {loadingMessages && <p className="text-sm text-gray-500">Loading messages...</p>}
              {!loadingMessages && !messages.length && (
                <p className="text-sm text-gray-500">
                  {activePartnerId ? "No messages yet." : "Choose a conversation to start chatting."}
                </p>
              )}

              {messages.map((message) => {
                const isMine = getId(message.sender) === String(currentUserId);
                return (
                  <div key={message._id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                        isMine ? "bg-[#017FE6] text-white" : "bg-white border"
                      }`}
                    >
                      <p>{message.text}</p>
                      <p className={`text-[10px] mt-1 ${isMine ? "text-white/80" : "text-gray-500"}`}>
                        {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t p-3 flex gap-2">
              <input
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") sendMessage();
                }}
                placeholder="Type your message"
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
                disabled={!activePartnerId}
              />
              <button
                onClick={sendMessage}
                disabled={!activePartnerId}
                className="px-4 rounded-lg bg-[#017FE6] text-white disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AvatarCircle({ name, avatar, sizeClass = "w-8 h-8" }) {
  const image = String(avatar || "").trim();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [image]);

  if (image && !failed) {
    return (
      <img
        src={image}
        alt={name}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 flex-shrink-0`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-[#017FE6] text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}
      aria-label={name}
    >
      {getInitialsFromName(name || "User")}
    </div>
  );
}
