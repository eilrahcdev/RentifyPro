import React, { useEffect } from "react";
import { X } from "lucide-react";
import ModalPortal from "./ModalPortal";

const LAST_UPDATED = "March 16, 2026";

const TERMS_SECTIONS = [
  {
    title: "1. Eligibility and Accounts",
    paragraphs: [
      "You must provide accurate and complete information when creating an account. You are responsible for activity under your account and for keeping your login credentials secure.",
      "We may suspend or restrict accounts that use false information, violate platform rules, or create safety risks.",
    ],
  },
  {
    title: "2. Booking and Payments",
    paragraphs: [
      "By confirming a booking, you agree to the rates, deposits, and additional charges shown in checkout.",
      "Late returns, damages, violations, or unpaid balances may result in additional fees based on booking records and applicable rules.",
    ],
  },
  {
    title: "3. User Responsibilities",
    paragraphs: [
      "Renters must use vehicles lawfully and safely, and follow all licensing and traffic requirements.",
      "Owners must provide accurate listings and maintain vehicles in roadworthy condition.",
    ],
  },
  {
    title: "4. Prohibited Conduct",
    paragraphs: [
      "Users must not misuse the platform, submit fraudulent information, impersonate others, or attempt unauthorized access.",
    ],
  },
  {
    title: "5. Service Availability and Liability",
    paragraphs: [
      "We aim to keep the service reliable, but temporary interruptions may happen due to maintenance or third-party issues.",
      "To the extent allowed by law, RentifyPro is not liable for indirect or consequential damages from platform use.",
    ],
  },
  {
    title: "6. Updates and Governing Law",
    paragraphs: [
      "These Terms may be updated from time to time. Continued use after updates means acceptance of revised terms.",
      "These Terms are governed by the laws of the Republic of the Philippines, subject to applicable consumer protections.",
    ],
  },
];

const PRIVACY_SECTIONS = [
  {
    title: "1. Information We Collect",
    paragraphs: [
      "We collect information you provide directly, such as name, email, phone number, account details, and booking data.",
      "For verification and safety, we may process submitted identity documents, profile images, and related metadata.",
      "We also collect technical data such as device, browser, IP address, and usage logs for security and performance.",
    ],
  },
  {
    title: "2. How We Use Information",
    paragraphs: [
      "We use data to create and manage accounts, process bookings, provide support, improve services, and protect against fraud and abuse.",
    ],
    bullets: [
      "Account setup and authentication",
      "Booking and transaction processing",
      "User-to-user communication support",
      "Security monitoring and abuse prevention",
      "Service analytics and performance improvements",
    ],
  },
  {
    title: "3. Sharing and Disclosure",
    paragraphs: [
      "We may share data with service providers that help us deliver platform functions, and with legal authorities when required by law.",
      "We do not sell personal information for unrelated third-party marketing.",
    ],
  },
  {
    title: "4. Retention and Security",
    paragraphs: [
      "We retain data only as long as needed for operations, legal compliance, dispute handling, and security.",
      "We use administrative and technical safeguards, but users should also protect their credentials and devices.",
    ],
  },
  {
    title: "5. Your Rights",
    paragraphs: [
      "Depending on applicable law, you may request access, correction, deletion, or restriction of your personal data.",
      "You may contact us for privacy requests at rentifypro.official@gmail.com.",
    ],
  },
  {
    title: "6. Policy Updates",
    paragraphs: [
      "This Privacy Policy may be updated from time to time. Continued platform use after updates indicates acceptance of the revised policy.",
    ],
  },
];

const getDocumentConfig = (documentType) => {
  if (documentType === "privacy") {
    return {
      heading: "Privacy Policy",
      description:
        "This policy explains how RentifyPro collects, uses, stores, and shares personal data when you use the platform.",
      sections: PRIVACY_SECTIONS,
    };
  }

  return {
    heading: "Terms and Conditions",
    description:
      "These terms govern your use of RentifyPro, including account registration, bookings, and platform responsibilities.",
    sections: TERMS_SECTIONS,
  };
};

function LegalSection({ title, paragraphs = [], bullets = [] }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm sm:text-base font-semibold text-slate-900">{title}</h3>
      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-xs sm:text-sm text-slate-700 leading-6">
          {paragraph}
        </p>
      ))}
      {bullets.length > 0 && (
        <ul className="list-disc pl-5 space-y-1 text-xs sm:text-sm text-slate-700">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function LegalPolicyModal({
  isOpen,
  documentType = "terms",
  onClose,
  onSwitchToTerms,
  onSwitchToPrivacy,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const { heading, description, sections } = getDocumentConfig(documentType);

  return (
    <ModalPortal lockScroll={false}>
    <div className="rp-modal-layer" role="dialog" aria-modal="true" aria-label={heading}>
      <button type="button" className="rp-modal-backdrop" onClick={onClose} aria-label="Close legal policy dialog" />
      <div
        className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-[0_25px_80px_rgba(15,23,42,0.30)] overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">{heading}</h2>
            <p className="text-xs text-slate-500">Last updated: {LAST_UPDATED}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rp-icon-button"
            aria-label="Close legal policy modal"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-3 border-b border-slate-200 flex items-center gap-2">
          <button
            type="button"
            onClick={onSwitchToTerms}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
              documentType === "terms"
                ? "bg-[#017FE6] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Terms
          </button>
          <button
            type="button"
            onClick={onSwitchToPrivacy}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
              documentType === "privacy"
                ? "bg-[#017FE6] text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Privacy
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-5 max-h-[70vh] overflow-y-auto space-y-5">
          <p className="text-xs sm:text-sm text-slate-700 leading-6">{description}</p>
          {sections.map((section) => (
            <LegalSection
              key={section.title}
              title={section.title}
              paragraphs={section.paragraphs}
              bullets={section.bullets || []}
            />
          ))}
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#017FE6] text-white text-sm font-semibold hover:bg-[#0165B8]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
