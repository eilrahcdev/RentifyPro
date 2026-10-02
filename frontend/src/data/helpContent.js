export const HELP_GUIDES = [
  {
    slug: "verify-identity",
    audience: "renter",
    title: "Verify your identity",
    summary: "Find the ID and selfie steps, then check your review status.",
    steps: [
      { title: "Start verification", detail: "Follow the identity step while registering. If you already have an account, open Account Settings, choose Verification, then select Verify now." },
      { title: "Choose your ID type", detail: "Select one of the accepted IDs shown on the form. Upload a clear photo of the ID you selected." },
      { title: "Take your selfie", detail: "Follow the camera instructions and review the photo before choosing Use selfie and continue." },
      { title: "Check the result", detail: "Open Account Settings to refresh your status. A successful selfie check can still be followed by document review." },
    ],
    next: "If your verification is rejected, read the reason shown in your account and use Resubmit verification when it is available.",
    action: { label: "Open Account Settings", href: "/account-settings", requires: "renter" },
  },
  {
    slug: "request-booking",
    audience: "renter",
    title: "Request a booking",
    summary: "Choose a vehicle and schedule, then follow your request in Bookings.",
    steps: [
      { title: "Find a vehicle", detail: "Open Vehicles and choose one that fits your location and schedule." },
      { title: "Review the rental", detail: "On the vehicle page, check the pickup and return times, rate, fees, and estimated total." },
      { title: "Send your request", detail: "Choose Book Now. If the page asks you to verify your identity first, complete that step before booking." },
      { title: "Watch for the owner's decision", detail: "Open Bookings to see whether the request is pending, confirmed, or declined." },
    ],
    next: "A request is not a confirmed rental until the owner approves it. Payment controls become available for eligible approved bookings.",
    action: { label: "Browse vehicles", href: "/vehicles" },
  },
  {
    slug: "booking-payments",
    audience: "renter",
    title: "Understand booking payments",
    summary: "See when payment opens, what remains, and where to check the result.",
    steps: [
      { title: "Find your booking", detail: "Go to Bookings and find the booking you want to pay for." },
      { title: "Check whether payment is available", detail: "Online payment is available after the booking is approved or extended. The booking shows the amount you can pay now and any remaining balance." },
      { title: "Choose how to pay", detail: "Select Pay Now to review the available amount and payment methods. A walk-in payment request needs owner approval before it can be confirmed." },
      { title: "Check the payment result", detail: "Return to Bookings after online checkout. If it is still processing, use Check payment status before starting another payment." },
    ],
    next: "A partial payment does not complete the balance. Check the amount and due information shown on your booking; the rental status and payment status can differ.",
    action: { label: "Open Bookings", href: "/bookings", requires: "renter" },
  },
  {
    slug: "owner-verification",
    audience: "owner",
    title: "Complete owner verification",
    summary: "Prepare your business document and complete the checks shown for your account.",
    steps: [
      { title: "Choose your path", detail: "If you are new, start owner registration. If you already rent with RentifyPro, open Account Settings and choose Become a Vehicle Owner." },
      { title: "Add your business document", detail: "Select the document type shown on the form and enter the matching details requested for that type." },
      { title: "Complete the required checks", detail: "New owners upload an accepted ID and follow the selfie instructions. Existing renters follow the verification steps shown in Account Settings." },
      { title: "Follow your status", detail: "Check Account Settings while upgrading, or your owner profile after registration. A passed selfie does not mean document review is finished." },
    ],
    next: "Vehicle listing requires the owner verification checks shown by the site. If a document needs correction, follow the status message before resubmitting.",
    action: { label: "Start owner registration", href: "/register-owner" },
  },
  {
    slug: "list-vehicle",
    audience: "owner",
    title: "List a vehicle",
    summary: "Add a vehicle, its photos, and the details renters need.",
    steps: [
      { title: "Open vehicle management", detail: "In the owner workspace, choose My Vehicles and then Add Vehicle." },
      { title: "Enter the vehicle details", detail: "Fill in the required vehicle, location, rate, and availability fields shown in the form." },
      { title: "Add clear photos", detail: "Upload photos that show the vehicle accurately, then review the listing details." },
      { title: "Save and check the listing", detail: "Submit the form and read its confirmation. Return to My Vehicles to check the vehicle's current status." },
    ],
    next: "If the site asks for owner verification, finish that review before trying to publish the vehicle.",
    action: { label: "Open My Vehicles", href: "/owner-dashboard?tab=Vehicles", requires: "owner" },
  },
  {
    slug: "manage-owner-bookings",
    audience: "owner",
    title: "Manage booking requests",
    summary: "Review requests, respond, and keep payment records accurate.",
    steps: [
      { title: "Open Bookings", detail: "In the owner workspace, choose Bookings to see requests and active rentals." },
      { title: "Review the request", detail: "Check the vehicle, pickup and return schedule, and booking details before approving or declining." },
      { title: "Handle later requests", detail: "Review extension, cancellation, return, and walk-in payment requests when they appear." },
      { title: "Record money received", detail: "Use the payment controls only to record the amount you have actually received. Check the updated paid and remaining amounts." },
    ],
    next: "Booking status and payment status are separate. A completed rental may still have a remaining balance to settle.",
    action: { label: "Open owner Bookings", href: "/owner-dashboard?tab=Bookings", requires: "owner" },
  },
];

export const getHelpGuide = (slug) => HELP_GUIDES.find((guide) => guide.slug === slug) || null;

export const getHelpGuidesForAudience = (audience) =>
  HELP_GUIDES.filter((guide) => guide.audience === audience);
