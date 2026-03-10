import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import Booking from "../models/Booking.js";
import { createNotification } from "../utils/notification.js";
import { emitToUser } from "../socket/index.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const buildOwnerRenterQuery = (userA, userB) => ({
  $or: [
    { owner: userA, renter: userB },
    { owner: userB, renter: userA },
  ],
});

const resolveOwnerRenterPair = async ({ senderId, partnerId, bookingId }) => {
  if (bookingId) {
    if (!isObjectId(bookingId)) return null;

    const booking = await Booking.findById(bookingId).select("owner renter");
    if (!booking) return null;

    const participants = [String(booking.owner), String(booking.renter)];
    if (!participants.includes(String(senderId)) || !participants.includes(String(partnerId))) {
      return null;
    }

    return {
      bookingId: booking._id,
      ownerId: booking.owner,
      renterId: booking.renter,
    };
  }

  const latestBooking = await Booking.findOne(buildOwnerRenterQuery(senderId, partnerId))
    .sort({ createdAt: -1 })
    .select("_id owner renter");

  if (latestBooking) {
    return {
      bookingId: latestBooking._id,
      ownerId: latestBooking.owner,
      renterId: latestBooking.renter,
    };
  }

  // Fallback to existing chat relation so persisted messages remain visible
  // even when booking lookups are unavailable (for example after archival/migration).
  const latestChatRelation = await ChatMessage.findOne(buildOwnerRenterQuery(senderId, partnerId))
    .sort({ createdAt: -1 })
    .select("booking owner renter");
  if (!latestChatRelation) return null;

  return {
    bookingId: latestChatRelation.booking || null,
    ownerId: latestChatRelation.owner,
    renterId: latestChatRelation.renter,
  };
};

export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const [messages, unreadCounts] = await Promise.all([
      ChatMessage.find({
        $or: [{ sender: userId }, { receiver: userId }],
      })
        .sort({ createdAt: -1 })
        .limit(500)
        .populate("sender", "name email avatar")
        .populate("receiver", "name email avatar")
        .populate("booking", "pickupAt returnAt status")
        .lean(),
      ChatMessage.aggregate([
        {
          $match: {
            receiver: userId,
            readAt: null,
          },
        },
        {
          $group: {
            _id: "$sender",
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const unreadBySender = new Map(
      unreadCounts.map((entry) => [String(entry._id), entry.count])
    );

    const byPartner = new Map();
    for (const message of messages) {
      const partner =
        String(message.sender?._id || message.sender) === String(userId)
          ? message.receiver
          : message.sender;

      const partnerId = String(partner?._id || partner);
      if (!partnerId || byPartner.has(partnerId)) continue;

        byPartner.set(partnerId, {
        partner: {
            _id: partner?._id || partnerId,
            name: partner?.name || partner?.email || "User",
            email: partner?.email || "",
            avatar: partner?.avatar || "",
          },
          lastMessage: {
          _id: message._id,
          text: message.text,
          sender: message.sender,
          receiver: message.receiver,
          booking: message.booking || null,
          createdAt: message.createdAt,
        },
        unreadCount: unreadBySender.get(partnerId) || 0,
      });
    }

    res.json({ success: true, conversations: Array.from(byPartner.values()) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch conversations." });
  }
};

export const getMessagesWithUser = async (req, res) => {
  try {
    const partnerId = req.params.userId;
    const currentUserId = req.user._id;

    if (!isObjectId(partnerId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    const bookingId = req.query.bookingId;
    const relation = await resolveOwnerRenterPair({
      senderId: currentUserId,
      partnerId,
      bookingId,
    });

    if (!relation) {
      return res.status(403).json({
        success: false,
        message: "Chat is only available between renters and owners with related bookings.",
      });
    }

    const query = {
      $or: [
        { sender: currentUserId, receiver: partnerId },
        { sender: partnerId, receiver: currentUserId },
      ],
    };
    // Only scope to a specific booking when the client explicitly asks for it.
    // This keeps historical renter-owner messages visible after app restarts.
    if (bookingId && relation.bookingId) query.booking = relation.bookingId;

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: 1 })
      .populate("sender", "name email avatar")
      .populate("receiver", "name email avatar")
      .lean();

    res.json({
      success: true,
      messages,
      conversationMeta: {
        bookingId: relation.bookingId || null,
        ownerId: relation.ownerId,
        renterId: relation.renterId,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch messages." });
  }
};

export const sendMessageToUser = async (req, res) => {
  try {
    const receiverId = req.params.userId;
    const senderId = req.user._id;
    const text = String(req.body.text || "").trim();
    const bookingId = req.body.bookingId;

    if (!isObjectId(receiverId)) {
      return res.status(400).json({ success: false, message: "Invalid receiver ID." });
    }
    if (!text) {
      return res.status(400).json({ success: false, message: "Message text is required." });
    }

    const relation = await resolveOwnerRenterPair({
      senderId,
      partnerId: receiverId,
      bookingId,
    });
    if (!relation) {
      return res.status(403).json({
        success: false,
        message: "Chat is only available between renters and owners with related bookings.",
      });
    }

    const message = await ChatMessage.create({
      owner: relation.ownerId,
      renter: relation.renterId,
      booking: relation.bookingId || null,
      sender: senderId,
      receiver: receiverId,
      text,
      attachments: [],
    });

    const populated = await ChatMessage.findById(message._id)
      .populate("sender", "name email avatar")
      .populate("receiver", "name email avatar")
      .lean();

    await createNotification({
      user: receiverId,
      type: "chat_message",
      title: "New message",
      message: `${req.user.name || "Someone"} sent you a message.`,
      data: { senderId, bookingId: relation.bookingId || null },
    });

    emitToUser(String(receiverId), "chat:message", populated);
    emitToUser(String(senderId), "chat:message", populated);

    res.status(201).json({ success: true, message: populated });
  } catch {
    res.status(500).json({ success: false, message: "Failed to send message." });
  }
};

export const markMessagesAsRead = async (req, res) => {
  try {
    const partnerId = req.params.userId;
    if (!isObjectId(partnerId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    await ChatMessage.updateMany(
      {
        sender: partnerId,
        receiver: req.user._id,
        readAt: null,
      },
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, message: "Messages marked as read." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to mark messages as read." });
  }
};
