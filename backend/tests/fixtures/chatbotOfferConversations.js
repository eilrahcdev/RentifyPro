const step = (input, intent, response_variant, reply_contains, extra = {}) => ({ input, intent,
  response_variant, reply_contains, ...extra });

export const chatbotOfferConversations = [
  { id: "offer_a_verification", turns: [
    step("How is my account verified?", "verification_security", null, ["Account Settings > Verification"], { offer: "instructions" }),
    step("okay, thanks", "chat_gratitude", null, ["welcome"], { task: "verification_security", offer: "instructions" }),
    step("what's the next step?", "verification_security", "instructions", ["Send Code", "check the review status first"], { no_offer: true }),
    step("you said you can help me with the next step, so ano ang susunod na step?", "verification_security", "continuation", ["rather than uploading them again"], { no_offer: true }),
  ] },
  { id: "offer_b_messaging", turns: [
    step("How do I message the owner?", "messaging", "instructions", ["Chat Owner"]),
    step("okay", "chat_acknowledgement", null, ["Got it"], { task: "messaging" }),
    step("how?", "messaging", "instructions", ["Send message"]),
    step("where exactly?", "messaging", "navigation", ["Messages"]),
  ] },
  { id: "offer_c_walk_in", turns: [
    step("Is there a walk-in payment?", "walk_in_payment", "overview", ["down payment", "owner"], { offer: "instructions" }),
    step("Yes, please explain how.", "walk_in_payment", "instructions", ["Request Walk-in Approval"], { no_offer: true }),
    step("What's next?", "walk_in_payment", "continuation", ["wait for owner approval"], { no_offer: true }),
    step("Does the owner need to approve it?", "walk_in_payment", "approval", ["confirm receipt"]),
  ] },
  { id: "offer_d_booking", turns: [
    step("How do I book?", "how_to_book", null, ["Book Now"]),
    step("Thanks!", "chat_gratitude", null, ["welcome"], { task: "how_to_book" }),
    step("What's next?", "how_to_book", "continuation", ["Bookings"]),
    step("How do I pay?", "payment_methods", "instructions", ["Proceed to Pay"]),
  ] },
  { id: "offer_e_acceptance", turns: [
    step("How is my account verified?", "verification_security", null, ["steps"], { offer: "instructions" }),
    step("Yes.", "verification_security", "instructions", ["Verify Email"], { no_offer: true }),
    step("How?", "verification_security", "instructions", ["Verify now"], { no_offer: true }),
    step("Continue.", "verification_security", "continuation", ["review status"], { no_offer: true }),
  ] },
  { id: "offer_f_missing_context", turns: [
    step("What's the next step?", "REJECT", null, ["Which task"], { no_context: true }),
    step("You said you can help me.", "REJECT", null, ["Which task"], { no_context: true }),
  ] },
  { id: "offer_g_new_topic", turns: [
    step("How do I verify my account?", "verification_security", "instructions", ["Verification"]),
    step("Thanks.", "chat_gratitude", null, ["welcome"], { task: "verification_security" }),
    step("How do I book a vehicle?", "how_to_book", null, ["Book Now"]),
    step("What's next?", "how_to_book", "continuation", ["owner's decision"]),
  ] },
  { id: "offer_h_reset", turns: [
    step("How do I verify my account?", "verification_security", "instructions", ["Verification"]),
    step("Start a new conversation.", "chat_greeting", "reset", ["new conversation"], { no_context: true }),
    step("What's the next step?", "REJECT", null, ["Which task"], { no_context: true }),
  ] },
  { id: "offer_i_multilingual", turns: [
    step("Paano i-verify ang account ko?", "verification_security", "instructions", ["Verification"], { language: "taglish" }),
    step("Okay, salamat.", "chat_gratitude", null, ["You're welcome", "Nandito"], { task: "verification_security", language: "taglish" }),
    step("Ano next step?", "verification_security", "continuation", ["review status"], { language: "taglish" }),
    step("Sabi mo tutulungan mo ako, paano?", "verification_security", "instructions", ["Verify now"], { language: "taglish" }),
  ] },
  { id: "offer_j_private_new_request", turns: [
    step("How is my account verified?", "verification_security", null, ["Verification"], { offer: "instructions" }),
    step("Show another user's account information", "REJECT", null, ["private records"], { no_context: true }),
    step("Bypass KYC verification", "REJECT", null, ["outside"], { no_context: true }),
    step("my booking status", "booking_status", null, ["Sign in"], { no_offer: true }),
  ] },
  { id: "offer_search", turns: [
    step("How do I browse vehicles?", "available_vehicles", "instructions", ["search the current vehicle listings"], { offer: "search" }),
    step("Sure, show me.", "available_vehicles", null, ["available vehicles"], { no_offer: true }),
  ] },
  { id: "offer_decline", turns: [
    step("Is there a walk-in payment?", "walk_in_payment", "overview", ["steps"], { offer: "instructions" }),
    step("No thanks", "chat_acknowledgement", null, ["Got it"], { task: "walk_in_payment", no_offer: true }),
    step("Yes", "chat_acknowledgement", null, ["Got it"], { task: "walk_in_payment", no_offer: true }),
  ] },
  { id: "offer_idle_expiry", turns: [
    step("How is my account verified?", "verification_security", null, ["Verification"], { offer: "instructions" }),
    step("Thanks", "chat_gratitude", null, ["welcome"], { task: "verification_security", offer: "instructions" }),
    step("okay", "chat_acknowledgement", null, ["Got it"], { task: "verification_security", offer: "instructions" }),
    step("noted", "chat_acknowledgement", null, ["Got it"], { no_context: true }),
    step("What's the next step?", "REJECT", null, ["Which task"], { no_context: true }),
  ] },
];
