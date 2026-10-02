export const getChatPreview = (lastMessage, currentUserId) => {
  if (!lastMessage) return "No messages yet";

  const messageText = lastMessage.isDeleted
    ? "This message was deleted."
    : String(lastMessage.text || "").replace(/\s+/g, " ").trim();
  if (!messageText) return "No messages yet";

  const senderId = String(lastMessage.sender?._id || lastMessage.sender || "");
  const sentByYou = Boolean(currentUserId && senderId === String(currentUserId));
  return `${sentByYou ? "You: " : ""}${messageText}`;
};
