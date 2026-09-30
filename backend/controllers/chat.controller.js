import mongoose from "mongoose";
import ChatMessage from "../models/ChatMessage.js";
import ChatThread from "../models/ChatThread.js";
import Booking from "../models/Booking.js";
import Vehicle from "../models/Vehicle.js";
import eventBus from "../events/eventBus.js";
import { NOTIFICATION_EVENTS } from "../events/notification.events.js";
import { emitToUser } from "../socket/index.js";
import { censorProfanityInText } from "../utils/chatModeration.js";
import { validateRealtimeChatText } from "../utils/chatMessageValidation.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const toIdString = (value) => String(value?._id || value || "");
const DELETED_MESSAGE_PLACEHOLDER = "This message was deleted.";
const OWNER_RENTER_BOOKING_STATUSES = ["confirmed", "extended", "completed"];
const ACTIVE_RENTER_BOOKING_STATUSES = new Set(["confirmed", "extended"]);

const buildOwnerRenterQuery = (userA, userB) => ({
  $or: [
    { owner: userA, renter: userB },
    { owner: userB, renter: userA },
  ],
});
const buildParticipantQuery = (userA, userB) => ({
  $or: [
    { sender: userA, receiver: userB },
    { sender: userB, receiver: userA },
  ],
});

const parseChatContext = (value = {}) => ({
  bookingId: String(value?.bookingId || "").trim(),
  vehicleId: String(value?.vehicleId || "").trim(),
});

const validateChatContext = ({ bookingId, vehicleId }) => {
  if (bookingId && vehicleId) {
    return "Provide only one chat context: bookingId or vehicleId.";
  }
  if (bookingId && !isObjectId(bookingId)) return "Invalid booking ID.";
  if (vehicleId && !isObjectId(vehicleId)) return "Invalid vehicle ID.";
  return "";
};

const sanitizeChatMessage = (message = {}) => {
  if (!message || typeof message !== "object") return message;
  const { hiddenFor, ...safeMessage } = message;
  const isDeleted = Boolean(safeMessage.isDeleted);
  return {
    ...safeMessage,
    text: isDeleted
      ? DELETED_MESSAGE_PLACEHOLDER
      : censorProfanityInText(String(safeMessage.text || "")),
    isEdited: Boolean(safeMessage.editedAt),
    isDeleted,
  };
};

const isHiddenForUser = (message, userId) =>
  Array.isArray(message?.hiddenFor) &&
  message.hiddenFor.some((entry) => String(entry) === String(userId));

const toTimeValue = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
};

const getRentalActivityAt = (booking = {}) =>
  booking.actualReturnAt || booking.returnAt || booking.updatedAt || booking.createdAt || null;

const isActiveRenterBooking = (booking = {}) =>
  ACTIVE_RENTER_BOOKING_STATUSES.has(String(booking.status || ""));

const serializeRenterBooking = (booking = {}) => ({
  _id: booking._id,
  status: booking.status,
  pickupAt: booking.pickupAt || null,
  returnAt: booking.returnAt || null,
  actualReturnAt: booking.actualReturnAt || null,
  updatedAt: booking.updatedAt || null,
  createdAt: booking.createdAt || null,
  activityAt: getRentalActivityAt(booking),
  vehicle: booking.vehicle
    ? {
        _id: booking.vehicle?._id || booking.vehicle,
        name: booking.vehicle?.name || "Vehicle",
      }
    : null,
});

const getPreferredRenterBooking = (bookings = []) => {
  const activeBookings = bookings.filter(isActiveRenterBooking);
  const pool = activeBookings.length ? activeBookings : bookings;

  return [...pool].sort((a, b) => {
    const returnDiff = toTimeValue(b.returnAt) - toTimeValue(a.returnAt);
    if (returnDiff) return returnDiff;
    return toTimeValue(getRentalActivityAt(b)) - toTimeValue(getRentalActivityAt(a));
  })[0];
};

const ensureOwnerRenterBookingAccess = (ownerId, renterId) =>
  Booking.findOne({
    owner: ownerId,
    renter: renterId,
    status: { $in: OWNER_RENTER_BOOKING_STATUSES },
  })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();

const upsertChatThread = ({ ownerId, renterId, update = {} }) =>
  ChatThread.findOneAndUpdate(
    { owner: ownerId, renter: renterId },
    {
      $set: {
        ...update,
        lastOpenedAt: update.lastOpenedAt || new Date(),
      },
      $setOnInsert: {
        owner: ownerId,
        renter: renterId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

const applyScopeQuery = (query, relation, context = {}) => {
  if (context.bookingId && relation?.bookingId) {
    query.booking = relation.bookingId;
    return query;
  }
  if (context.vehicleId && relation?.vehicleId) {
    query.vehicle = relation.vehicleId;
  }
  return query;
};

const resolveOwnerRenterPair = async ({ senderId, partnerId, bookingId, vehicleId }) => {
  const senderKey = toIdString(senderId);
  const partnerKey = toIdString(partnerId);
  if (!senderKey || !partnerKey) return null;

  if (bookingId) {
    const booking = await Booking.findById(bookingId).select("_id owner renter vehicle");
    if (!booking) return null;

    const participants = [String(booking.owner), String(booking.renter)];
    if (!participants.includes(senderKey) || !participants.includes(partnerKey)) {
      return null;
    }

    return {
      bookingId: booking._id,
      vehicleId: booking.vehicle || null,
      ownerId: booking.owner,
      renterId: booking.renter,
    };
  }

  if (vehicleId) {
    const vehicle = await Vehicle.findById(vehicleId).select("_id owner");
    if (!vehicle) return null;

    const ownerKey = String(vehicle.owner);
    if (![senderKey, partnerKey].includes(ownerKey)) return null;

    const renterId = senderKey === ownerKey ? partnerId : senderId;
    if (!renterId || String(renterId) === ownerKey) return null;

    return {
      bookingId: null,
      vehicleId: vehicle._id,
      ownerId: vehicle.owner,
      renterId,
    };
  }

  const latestBooking = await Booking.findOne(buildOwnerRenterQuery(senderId, partnerId))
    .sort({ createdAt: -1 })
    .select("_id owner renter vehicle");

  if (latestBooking) {
    return {
      bookingId: latestBooking._id,
      vehicleId: latestBooking.vehicle || null,
      ownerId: latestBooking.owner,
      renterId: latestBooking.renter,
    };
  }

  // Fallback to existing chat relation so persisted messages remain visible
  // even when booking lookups are unavailable (for example after archival/migration).
  const latestChatRelation = await ChatMessage.findOne(buildOwnerRenterQuery(senderId, partnerId))
    .sort({ createdAt: -1 })
    .select("booking vehicle owner renter");
  if (!latestChatRelation) return null;

  return {
    bookingId: latestChatRelation.booking || null,
    vehicleId: latestChatRelation.vehicle || null,
    ownerId: latestChatRelation.owner,
    renterId: latestChatRelation.renter,
  };
};

const populateChatMessage = (messageId) =>
  ChatMessage.findById(messageId)
    .populate("sender", "name email avatar")
    .populate("receiver", "name email avatar")
    .populate("booking", "pickupAt returnAt status")
    .populate("vehicle", "name")
    .lean();

export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const [messages, unreadCounts, threads] = await Promise.all([
      ChatMessage.find({
        $or: [{ sender: userId }, { receiver: userId }],
        hiddenFor: { $ne: userId },
      })
        .sort({ createdAt: -1 })
        .limit(500)
        .populate("sender", "name email avatar")
        .populate("receiver", "name email avatar")
        .populate("booking", "pickupAt returnAt status")
        .populate("vehicle", "name")
        .lean(),
      ChatMessage.aggregate([
        {
          $match: {
            receiver: userId,
            readAt: null,
            hiddenFor: { $ne: userId },
          },
        },
        {
          $group: {
            _id: "$sender",
            count: { $sum: 1 },
          },
        },
      ]),
      ChatThread.find({ $or: [{ owner: userId }, { renter: userId }] })
        .select("owner renter archivedFor")
        .lean(),
    ]);

    const seenPartners = new Set(messages.map((message) => {
      const partner = String(message.sender?._id || message.sender) === String(userId)
        ? message.receiver : message.sender;
      return toIdString(partner);
    }));
    const missingArchivedThreads = threads.filter((thread) => {
      if (!(thread.archivedFor || []).some((id) => String(id) === String(userId))) return false;
      const partnerId = String(thread.owner) === String(userId) ? String(thread.renter) : String(thread.owner);
      return !seenPartners.has(partnerId);
    });
    if (missingArchivedThreads.length) {
      const archivedMessages = await Promise.all(missingArchivedThreads.map((thread) => {
        const partnerId = String(thread.owner) === String(userId) ? thread.renter : thread.owner;
        return ChatMessage.findOne({
          ...buildParticipantQuery(userId, partnerId),
          hiddenFor: { $ne: userId },
        })
          .sort({ createdAt: -1 })
          .populate("sender", "name email avatar")
          .populate("receiver", "name email avatar")
          .populate("booking", "pickupAt returnAt status")
          .populate("vehicle", "name")
          .lean();
      }));
      messages.push(...archivedMessages.filter(Boolean));
      messages.sort((a, b) => toTimeValue(b.createdAt) - toTimeValue(a.createdAt));
    }

    const unreadBySender = new Map(
      unreadCounts.map((entry) => [String(entry._id), entry.count])
    );

    const byPartner = new Map();
    for (const message of messages) {
      const partner =
        String(message.sender?._id || message.sender) === String(userId)
          ? message.receiver
          : message.sender;

      const partnerId = toIdString(partner);
      if (!isObjectId(partnerId) || byPartner.has(partnerId)) continue;

      byPartner.set(partnerId, {
        partner: {
          _id: partner?._id || partnerId,
          name: partner?.name || partner?.email || "User",
          email: partner?.email || "",
          avatar: partner?.avatar || "",
        },
        lastMessage: sanitizeChatMessage({
          _id: message._id,
          text: message.text,
          sender: message.sender,
          receiver: message.receiver,
          booking: message.booking || null,
          vehicle: message.vehicle || null,
          editedAt: message.editedAt || null,
          isDeleted: Boolean(message.isDeleted),
          deletedAt: message.deletedAt || null,
          createdAt: message.createdAt,
        }),
        unreadCount: unreadBySender.get(partnerId) || 0,
      });
    }

    const partnerIds = Array.from(byPartner.keys());
    if (partnerIds.length) {
      const bookings = await Booking.find({
        $or: [
          { owner: userId, renter: { $in: partnerIds } },
          { renter: userId, owner: { $in: partnerIds } },
        ],
        status: { $in: OWNER_RENTER_BOOKING_STATUSES },
      })
        .sort({ createdAt: -1 })
        .select("_id owner renter vehicle status pickupAt returnAt actualReturnAt updatedAt createdAt")
        .populate("vehicle", "name")
        .lean();
      for (const thread of threads) {
        const partnerId = String(thread.owner) === String(userId)
          ? String(thread.renter)
          : String(thread.owner);
        const conversation = byPartner.get(partnerId);
        if (conversation) {
          conversation.isArchived = (thread.archivedFor || []).some(
            (id) => String(id) === String(userId)
          );
        }
      }
      for (const booking of bookings) {
        const partnerId = String(booking.owner) === String(userId)
          ? String(booking.renter)
          : String(booking.owner);
        const conversation = byPartner.get(partnerId);
        if (conversation && !conversation.recentBooking) {
          conversation.recentBooking = serializeRenterBooking(booking);
        }
      }
    }

    res.json({ success: true, conversations: Array.from(byPartner.values()) });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch conversations." });
  }
};

export const getOwnerRenterThreads = async (req, res) => {
  try {
    const ownerId = req.user._id;

    const bookings = await Booking.find({
      owner: ownerId,
      status: { $in: OWNER_RENTER_BOOKING_STATUSES },
    })
      .sort({ createdAt: -1 })
      .select("_id owner renter vehicle status pickupAt returnAt actualReturnAt updatedAt createdAt")
      .populate("renter", "name email avatar")
      .populate("vehicle", "name")
      .lean();

    const byRenter = new Map();
    for (const booking of bookings) {
      const renterId = toIdString(booking.renter);
      if (!renterId) continue;

      if (!byRenter.has(renterId)) {
        byRenter.set(renterId, {
          renter: {
            _id: booking.renter?._id || renterId,
            name: booking.renter?.name || booking.renter?.email || "User",
            email: booking.renter?.email || "",
            avatar: booking.renter?.avatar || "",
          },
          bookings: [],
        });
      }

      byRenter.get(renterId).bookings.push(booking);
    }

    const renterIds = Array.from(byRenter.keys());
    if (!renterIds.length) {
      return res.json({ success: true, renters: [] });
    }

    const ownerObjectId = new mongoose.Types.ObjectId(String(ownerId));
    const renterObjectIds = renterIds.map((id) => new mongoose.Types.ObjectId(id));

    const [threads, unreadCounts, latestMessages] = await Promise.all([
      ChatThread.find({ owner: ownerId, renter: { $in: renterObjectIds } }).lean(),
      ChatMessage.aggregate([
        {
          $match: {
            owner: ownerObjectId,
            renter: { $in: renterObjectIds },
            receiver: ownerObjectId,
            readAt: null,
            hiddenFor: { $ne: ownerObjectId },
          },
        },
        {
          $group: {
            _id: "$renter",
            count: { $sum: 1 },
          },
        },
      ]),
      ChatMessage.aggregate([
        {
          $match: {
            owner: ownerObjectId,
            renter: { $in: renterObjectIds },
            hiddenFor: { $ne: ownerObjectId },
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$renter",
            message: { $first: "$$ROOT" },
          },
        },
      ]),
    ]);

    const threadByRenter = new Map(threads.map((thread) => [String(thread.renter), thread]));
    const unreadByRenter = new Map(
      unreadCounts.map((entry) => [String(entry._id), Number(entry.count || 0)])
    );
    const latestMessageByRenter = new Map(
      latestMessages.map((entry) => [String(entry._id), entry.message])
    );

    const renters = renterIds.map((renterId) => {
      const entry = byRenter.get(renterId);
      const booking = getPreferredRenterBooking(entry.bookings);
      const serializedBooking = serializeRenterBooking(booking);
      const thread = threadByRenter.get(renterId);
      const latestMessage = latestMessageByRenter.get(renterId);
      const isActive = entry.bookings.some(isActiveRenterBooking);

      return {
        conversationId: thread?._id || null,
        hasConversation: Boolean(thread?._id || latestMessage?._id),
        renter: entry.renter,
        partner: entry.renter,
        isActive,
        status: isActive ? "active" : "previous",
        statusLabel: isActive ? "Active Rental" : "Previous Renter",
        vehicle: serializedBooking.vehicle,
        latestBooking: serializedBooking,
        latestActivityAt: serializedBooking.activityAt,
        unreadCount: unreadByRenter.get(renterId) || 0,
        isPinned: Boolean(thread?.pinned),
        pinnedAt: thread?.pinnedAt || null,
        isArchived: (thread?.archivedFor || []).some((id) => String(id) === String(ownerId)),
        recentBooking: serializeRenterBooking(entry.bookings[0]),
        lastMessage: latestMessage ? sanitizeChatMessage(latestMessage) : null,
      };
    });

    renters.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isPinned && b.isPinned) {
        const pinnedDiff = toTimeValue(b.pinnedAt) - toTimeValue(a.pinnedAt);
        if (pinnedDiff) return pinnedDiff;
      }
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return toTimeValue(b.latestActivityAt) - toTimeValue(a.latestActivityAt);
    });

    return res.json({ success: true, renters });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to fetch renters." });
  }
};

export const openOwnerRenterThread = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const renterId = req.params.renterId;

    if (!isObjectId(renterId)) {
      return res.status(400).json({ success: false, message: "Invalid renter ID." });
    }

    const booking = await ensureOwnerRenterBookingAccess(ownerId, renterId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Renter not found for this owner.",
      });
    }

    const thread = await upsertChatThread({
      ownerId,
      renterId,
      update: { lastOpenedAt: new Date() },
    });

    return res.json({
      success: true,
      conversationId: thread._id,
      pinned: Boolean(thread.pinned),
      pinnedAt: thread.pinnedAt || null,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to open conversation." });
  }
};

export const updateOwnerRenterThreadPin = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const renterId = req.params.renterId;
    const pinned = Boolean(req.body?.pinned);

    if (!isObjectId(renterId)) {
      return res.status(400).json({ success: false, message: "Invalid renter ID." });
    }

    const booking = await ensureOwnerRenterBookingAccess(ownerId, renterId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Renter not found for this owner.",
      });
    }

    const thread = await upsertChatThread({
      ownerId,
      renterId,
      update: {
        pinned,
        pinnedAt: pinned ? new Date() : null,
      },
    });

    return res.json({
      success: true,
      conversationId: thread._id,
      pinned: Boolean(thread.pinned),
      pinnedAt: thread.pinnedAt || null,
    });
  } catch {
    return res.status(500).json({ success: false, message: "Failed to update pinned chat." });
  }
};

export const getMessagesWithUser = async (req, res) => {
  try {
    const partnerId = req.params.userId;
    const currentUserId = req.user._id;
    const context = parseChatContext(req.query);

    if (!isObjectId(partnerId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    const contextError = validateChatContext(context);
    if (contextError) {
      return res.status(400).json({ success: false, message: contextError });
    }

    const relation = await resolveOwnerRenterPair({
      senderId: currentUserId,
      partnerId,
      bookingId: context.bookingId,
      vehicleId: context.vehicleId,
    });

    if (!relation) {
      return res.status(403).json({
        success: false,
        message: "Chat is only available between renters and owners with related bookings.",
      });
    }

    const query = buildParticipantQuery(currentUserId, partnerId);
    query.hiddenFor = { $ne: currentUserId };
    applyScopeQuery(query, relation, context);

    const messages = await ChatMessage.find(query)
      .sort({ createdAt: 1 })
      .populate("sender", "name email avatar")
      .populate("receiver", "name email avatar")
      .populate("booking", "pickupAt returnAt status")
      .populate("vehicle", "name")
      .lean();

    res.json({
      success: true,
      messages: messages.map((message) => sanitizeChatMessage(message)),
      conversationMeta: {
        bookingId: relation.bookingId || null,
        vehicleId: relation.vehicleId || null,
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
    const textValidation = validateRealtimeChatText(req.body?.text);
    const context = parseChatContext(req.body);

    if (!isObjectId(receiverId)) {
      return res.status(400).json({ success: false, message: "Invalid receiver ID." });
    }
    if (!textValidation.isValid) {
      return res.status(400).json({
        success: false,
        reason: textValidation.reason,
        message: textValidation.message,
      });
    }
    const text = textValidation.text;

    const contextError = validateChatContext(context);
    if (contextError) {
      return res.status(400).json({ success: false, message: contextError });
    }

    const relation = await resolveOwnerRenterPair({
      senderId,
      partnerId: receiverId,
      bookingId: context.bookingId,
      vehicleId: context.vehicleId,
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
      vehicle: relation.vehicleId || null,
      sender: senderId,
      receiver: receiverId,
      text: censorProfanityInText(text),
      attachments: [],
      hiddenFor: [],
    });

    const populated = await populateChatMessage(message._id);
    const sanitizedMessage = sanitizeChatMessage(populated);

    try {
      await ChatThread.updateOne(
        { owner: relation.ownerId, renter: relation.renterId },
        { $pull: { archivedFor: { $in: [senderId, receiverId] } } }
      );
    } catch (archiveError) {
      console.error("Failed to restore conversation after sending a message.", archiveError);
    }

    eventBus.emit(NOTIFICATION_EVENTS.CHAT_MESSAGE_RECEIVED, {
      message,
      actor: req.user,
      senderId,
      receiverId,
      bookingId: relation.bookingId || null,
      vehicleId: relation.vehicleId || null,
    });

    emitToUser(String(receiverId), "chat:message", sanitizedMessage);
    emitToUser(String(senderId), "chat:message", sanitizedMessage);

    res.status(201).json({ success: true, message: sanitizedMessage });
  } catch {
    res.status(500).json({ success: false, message: "Failed to send message." });
  }
};

export const editMessage = async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const currentUserId = req.user._id;
    const textValidation = validateRealtimeChatText(req.body?.text);

    if (!isObjectId(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid message ID." });
    }
    if (!textValidation.isValid) {
      return res.status(400).json({
        success: false,
        reason: textValidation.reason,
        message: textValidation.message,
      });
    }
    const text = textValidation.text;

    const existingMessage = await ChatMessage.findById(messageId);
    if (!existingMessage || isHiddenForUser(existingMessage, currentUserId)) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }
    if (String(existingMessage.sender) !== String(currentUserId)) {
      return res.status(403).json({ success: false, message: "You can only edit your own messages." });
    }
    if (existingMessage.isDeleted) {
      return res.status(400).json({ success: false, message: "Deleted messages cannot be edited." });
    }

    existingMessage.text = censorProfanityInText(text);
    existingMessage.editedAt = new Date();
    await existingMessage.save();

    const populated = await populateChatMessage(existingMessage._id);
    const sanitizedMessage = sanitizeChatMessage(populated);

    emitToUser(String(existingMessage.sender), "chat:message:update", sanitizedMessage);
    emitToUser(String(existingMessage.receiver), "chat:message:update", sanitizedMessage);

    res.json({ success: true, message: sanitizedMessage });
  } catch {
    res.status(500).json({ success: false, message: "Failed to edit message." });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const currentUserId = req.user._id;

    if (!isObjectId(messageId)) {
      return res.status(400).json({ success: false, message: "Invalid message ID." });
    }

    const existingMessage = await ChatMessage.findById(messageId);
    if (!existingMessage || isHiddenForUser(existingMessage, currentUserId)) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }
    if (String(existingMessage.sender) !== String(currentUserId)) {
      return res.status(403).json({ success: false, message: "You can only delete your own messages." });
    }

    if (!existingMessage.isDeleted) {
      existingMessage.text = DELETED_MESSAGE_PLACEHOLDER;
      existingMessage.attachments = [];
      existingMessage.isDeleted = true;
      existingMessage.deletedAt = new Date();
      await existingMessage.save();
    }

    const populated = await populateChatMessage(existingMessage._id);
    const sanitizedMessage = sanitizeChatMessage(populated);

    emitToUser(String(existingMessage.sender), "chat:message:update", sanitizedMessage);
    emitToUser(String(existingMessage.receiver), "chat:message:update", sanitizedMessage);

    res.json({ success: true, message: sanitizedMessage });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete message." });
  }
};

export const deleteConversation = async (req, res) => {
  try {
    const partnerId = req.params.userId;
    const currentUserId = req.user._id;
    const context = parseChatContext(req.query);

    if (!isObjectId(partnerId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    const contextError = validateChatContext(context);
    if (contextError) {
      return res.status(400).json({ success: false, message: contextError });
    }

    const relation = await resolveOwnerRenterPair({
      senderId: currentUserId,
      partnerId,
      bookingId: context.bookingId,
      vehicleId: context.vehicleId,
    });

    if (!relation) {
      return res.status(403).json({
        success: false,
        message: "Chat is only available between renters and owners with related bookings.",
      });
    }

    const query = buildParticipantQuery(currentUserId, partnerId);
    query.hiddenFor = { $ne: currentUserId };
    applyScopeQuery(query, relation, context);

    const result = await ChatMessage.updateMany(
      query,
      { $addToSet: { hiddenFor: currentUserId } }
    );

    await ChatThread.updateOne(
      { owner: relation.ownerId, renter: relation.renterId },
      { $pull: { archivedFor: currentUserId } }
    );

    emitToUser(String(currentUserId), "chat:conversation:deleted", {
      partnerId: String(partnerId),
      bookingId: context.bookingId || null,
      vehicleId: context.vehicleId || null,
      deletedCount: result.modifiedCount || 0,
    });

    res.json({
      success: true,
      message: "Conversation deleted.",
      deletedCount: result.modifiedCount || 0,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete conversation." });
  }
};

export const updateConversationArchive = async (req, res) => {
  try {
    const partnerId = req.params.userId;
    const currentUserId = req.user._id;
    const archived = req.body?.archived;
    if (!isObjectId(partnerId) || String(partnerId) === String(currentUserId)) {
      return res.status(400).json({ success: false, message: "Invalid conversation partner." });
    }
    if (typeof archived !== "boolean") {
      return res.status(400).json({ success: false, message: "archived must be a boolean." });
    }

    const relation = await resolveOwnerRenterPair({ senderId: currentUserId, partnerId });
    if (!relation) {
      return res.status(403).json({ success: false, message: "Conversation is unavailable." });
    }

    const thread = await ChatThread.findOneAndUpdate(
      { owner: relation.ownerId, renter: relation.renterId },
      {
        [archived ? "$addToSet" : "$pull"]: { archivedFor: currentUserId },
        $setOnInsert: { owner: relation.ownerId, renter: relation.renterId },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const isArchived = (thread.archivedFor || []).some(
      (id) => String(id) === String(currentUserId)
    );
    emitToUser(String(currentUserId), "chat:conversation:archive", {
      partnerId: String(partnerId),
      archived: isArchived,
    });
    res.json({ success: true, archived: isArchived });
  } catch {
    res.status(500).json({ success: false, message: "Failed to update conversation archive." });
  }
};

export const markMessagesAsRead = async (req, res) => {
  try {
    const partnerId = req.params.userId;
    const currentUserId = req.user._id;
    const context = parseChatContext(req.query);

    if (!isObjectId(partnerId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    const contextError = validateChatContext(context);
    if (contextError) {
      return res.status(400).json({ success: false, message: contextError });
    }

    const relation = await resolveOwnerRenterPair({
      senderId: currentUserId,
      partnerId,
      bookingId: context.bookingId,
      vehicleId: context.vehicleId,
    });

    if (!relation) {
      return res.status(403).json({
        success: false,
        message: "Chat is only available between renters and owners with related bookings.",
      });
    }

    const query = {
      sender: partnerId,
      receiver: currentUserId,
      readAt: null,
      hiddenFor: { $ne: currentUserId },
    };
    applyScopeQuery(query, relation, context);

    await ChatMessage.updateMany(
      query,
      { $set: { readAt: new Date() } }
    );

    res.json({ success: true, message: "Messages marked as read." });
  } catch {
    res.status(500).json({ success: false, message: "Failed to mark messages as read." });
  }
};
