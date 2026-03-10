import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import API from "../../utils/api";
import { getSocket } from "../../utils/socket";
import { formatDisplayName, getInitialsFromName } from "../../utils/dateUtils";
import { resolveAssetUrl } from "../../utils/media";

const formatTime = (value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

export default function Messages() {
  const currentUserId = JSON.parse(localStorage.getItem("user") || "{}")._id || "";
  const [conversations, setConversations] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadConversations = async () => {
    try {
      const response = await API.getConversations();
      const next = (response.conversations || []).map((conversation) => ({
        ...conversation,
        partner: normalizePartner(conversation.partner),
      }));
      setConversations(next);
      if (!activeUser && next.length > 0) setActiveUser(next[0].partner);
    } catch (err) {
      setError(err.message || "Failed to load conversations.");
    }
  };

  const loadMessages = async (partnerId) => {
    if (!partnerId) return;
    setLoading(true);
    setError("");
    try {
      const response = await API.getMessagesWithUser(partnerId);
      setMessages(response.messages || []);
      await API.markMessagesAsRead(partnerId);
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.partner._id === partnerId
            ? { ...conversation, unreadCount: 0 }
            : conversation
        )
      );
    } catch (err) {
      setError(err.message || "Failed to load messages.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!activeUser?._id) return;
    loadMessages(activeUser._id);
  }, [activeUser?._id]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleIncomingMessage = (message) => {
      setConversations((prev) => {
        const senderId = String(message.sender?._id || message.sender);
        const receiverId = String(message.receiver?._id || message.receiver);
        const isOutgoing = senderId === String(currentUserId);
        const partner = isOutgoing ? message.receiver : message.sender;
        const partnerId = String(partner?._id || partner);
        if (!partnerId) return prev;

        const existing = prev.find((conversation) => conversation.partner._id === partnerId);
        const nextConversation = {
          partner: normalizePartner({
            _id: partner?._id || partnerId,
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
            !isOutgoing && activeUser?._id !== partnerId
              ? (existing?.unreadCount || 0) + 1
              : existing?.unreadCount || 0,
        };

        const rest = prev.filter((conversation) => conversation.partner._id !== partnerId);
        return [nextConversation, ...rest];
      });

      if (
        String(message.sender?._id || message.sender) === String(activeUser?._id) ||
        String(message.receiver?._id || message.receiver) === String(activeUser?._id)
      ) {
        setMessages((prev) => appendUniqueMessage(prev, message));
      }
    };

    socket.on("chat:message", handleIncomingMessage);
    return () => socket.off("chat:message", handleIncomingMessage);
  }, [activeUser?._id, currentUserId]);

  const send = async () => {
    if (!activeUser?._id || !text.trim()) return;

    try {
      const response = await API.sendMessageToUser(activeUser._id, {
        text: text.trim(),
      });
      setMessages((prev) => appendUniqueMessage(prev, response.message));
      setText("");
      loadConversations();
    } catch (err) {
      setError(err.message || "Failed to send message.");
    }
  };

  return (
    <div className="flex h-full bg-white border rounded-xl overflow-hidden">
      <aside className="w-80 border-r bg-gray-50">
        <div className="px-4 py-3 border-b font-semibold">Renter Conversations</div>
        <div className="overflow-y-auto h-[calc(100%-48px)]">
          {conversations.map((conversation) => (
            <button
              key={conversation.partner._id}
              onClick={() => setActiveUser(conversation.partner)}
              className={`w-full text-left px-4 py-3 border-b hover:bg-gray-100 ${
                activeUser?._id === conversation.partner._id ? "bg-gray-100" : ""
              }`}
            >
              <div className="flex justify-between items-center gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AvatarCircle
                    name={conversation.partner.name}
                    avatar={conversation.partner.avatar}
                    sizeClass="w-8 h-8"
                  />
                  <p className="font-medium text-sm truncate">{conversation.partner.name}</p>
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
            </button>
          ))}
        </div>
      </aside>

      <section className="flex-1 flex flex-col">
        <div className="px-5 py-4 border-b">
          <div className="flex items-center gap-3">
            <AvatarCircle name={activeUser?.name || "User"} avatar={activeUser?.avatar} sizeClass="w-9 h-9" />
            <div>
              <h2 className="font-semibold">{activeUser?.name || "Select conversation"}</h2>
              {activeUser?.email && <p className="text-xs text-gray-500">{activeUser.email}</p>}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50">
          {loading && <p className="text-sm text-gray-500">Loading messages...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {!loading && !messages.length && (
            <p className="text-sm text-gray-500">No messages yet.</p>
          )}

          {messages.map((message) => {
            const isOwner = String(message.sender?._id || message.sender) !== String(activeUser?._id);
            return (
              <div key={message._id} className={`flex ${isOwner ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[70%] rounded-xl px-3 py-2 text-sm ${
                    isOwner ? "bg-[#017FE6] text-white" : "bg-white border"
                  }`}
                >
                  <p>{message.text}</p>
                  <p className={`text-[10px] mt-1 ${isOwner ? "text-white/80" : "text-gray-500"}`}>
                    {formatTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t p-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            disabled={!activeUser}
          />
          <button onClick={send} disabled={!activeUser} className="px-4 rounded-lg bg-[#017FE6] text-white">
            <Send size={16} />
          </button>
        </div>
      </section>
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
