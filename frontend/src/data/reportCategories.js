export const BOOKING_REPORT_CATEGORY_GROUPS = {
  owner: [
    {
      label: "Vehicle and booking",
      options: [
        ["vehicle_misrepresented", "Vehicle did not match the listing"],
        ["unsafe_vehicle", "Unsafe or defective vehicle"],
        ["booking_not_honored", "Confirmed booking was not honored"],
        ["no_show", "Owner did not appear for handover"],
      ],
    },
    {
      label: "Charges and payment",
      options: [
        ["undisclosed_charges", "Undisclosed or unexpected charges"],
        ["payment_dispute", "Booking payment dispute"],
        ["off_platform_payment", "Requested payment outside RentifyPro"],
        ["fraud", "Fraud or attempted scam"],
      ],
    },
    {
      label: "Safety and conduct",
      options: [
        ["harassment", "Harassment, threats, or abuse"],
        ["discrimination", "Discriminatory treatment"],
        ["dangerous_conduct", "Dangerous or illegal conduct"],
        ["other", "Other owner-related booking issue"],
      ],
    },
  ],
  renter: [
    {
      label: "Booking compliance",
      options: [
        ["no_show", "Renter did not appear for handover"],
        ["late_or_unreturned_vehicle", "Vehicle returned late or not returned"],
        ["unauthorized_driver", "Vehicle used by an unauthorized driver"],
      ],
    },
    {
      label: "Vehicle condition and use",
      options: [
        ["vehicle_damage", "Vehicle damage"],
        ["reckless_use", "Reckless or unauthorized vehicle use"],
        ["prohibited_activity", "Smoking or prohibited activity"],
        ["excessive_cleaning", "Excessive cleaning required"],
      ],
    },
    {
      label: "Payment and conduct",
      options: [
        ["payment_dispute", "Booking payment dispute"],
        ["false_payment_evidence", "False payment evidence"],
        ["off_platform_payment", "Requested payment outside RentifyPro"],
        ["fraud", "Fraud or attempted scam"],
        ["harassment", "Harassment, threats, or abuse"],
        ["dangerous_conduct", "Dangerous or illegal conduct"],
        ["other", "Other renter-related booking issue"],
      ],
    },
  ],
};

export const MESSAGE_REPORT_CATEGORY_GROUPS = [
  {
    label: "Abusive or unsafe content",
    options: [
      ["harassment", "Harassment, bullying, or abusive language"],
      ["discrimination", "Discriminatory or hateful content"],
      ["dangerous_conduct", "Threats or encouragement of dangerous conduct"],
      ["sexual_content", "Unwanted sexual or explicit content"],
    ],
  },
  {
    label: "Scams, identity, and privacy",
    options: [
      ["fraud", "Fraud, phishing, or attempted scam"],
      ["identity_concern", "Impersonation or identity concern"],
      ["off_platform_payment", "Off-platform payment request"],
      ["privacy_violation", "Shared or requested sensitive personal information"],
    ],
  },
  {
    label: "Unwanted content",
    options: [
      ["spam", "Spam or repeated unwanted messages"],
      ["other", "Other message-content violation"],
    ],
  },
];
