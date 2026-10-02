import React from "react";
import Navbar from "../components/Navbar";

const LAST_UPDATED = "March 16, 2026";

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg sm:text-xl font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3 text-sm sm:text-base text-slate-700 leading-7">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage({
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
  onNavigateToReports,
  onNavigateToTermsAndConditions,
  isLoggedIn,
  user,
  onLogout,
}) {
  return (
    <div className="min-h-screen bg-slate-50">
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
        onNavigateToReports={onNavigateToReports}
        onLogout={onLogout}
      />

      <main className="pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <article className="max-w-4xl mx-auto rp-surface p-6 sm:p-8 space-y-8">
          <header className="space-y-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Privacy Policy</h1>
            <p className="text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
            <p className="text-sm sm:text-base text-slate-700 leading-7">
              This Privacy Policy explains how RentifyPro collects, uses, stores, and shares
              personal data when you use our website, mobile-friendly interface, and related
              services.
            </p>
          </header>

          <Section title="1. Information We Collect">
            <p>
              We may collect information you provide directly, including your name, email address,
              phone number, account credentials, booking details, and support messages.
            </p>
            <p>
              For identity verification and trust and safety workflows, we may collect verification
              documents, profile images, and related metadata you submit through the platform.
            </p>
            <p>
              We also collect technical data such as device, browser, IP address, approximate
              location, and usage logs for security, analytics, and performance.
            </p>
          </Section>

          <Section title="2. How We Use Your Information">
            <p>We use personal data to:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Create and manage accounts.</li>
              <li>Process bookings, payments, and related support requests.</li>
              <li>Enable communication between renters and owners.</li>
              <li>Prevent fraud, abuse, and unauthorized access.</li>
              <li>Improve platform features, quality, and reliability.</li>
              <li>Send service-related notices and important updates.</li>
            </ul>
          </Section>

          <Section title="3. Legal and Operational Bases">
            <p>
              We process data to provide requested services, perform contractual obligations, comply
              with legal duties, protect legitimate business interests, and, where required, based
              on your consent.
            </p>
          </Section>

          <Section title="4. Sharing of Information">
            <p>We may share information with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Service providers supporting hosting, messaging, analytics, and payments.</li>
              <li>Other users where necessary to complete bookings and platform communication.</li>
              <li>Authorities or legal entities when required by law or legal process.</li>
            </ul>
            <p>
              We do not sell personal information to third parties for unrelated marketing purposes.
            </p>
          </Section>

          <Section title="5. Data Retention">
            <p>
              We retain data only as long as needed for business operations, dispute handling,
              security, legal compliance, and tax or accounting records. Retention periods vary by
              data type and applicable legal requirements.
            </p>
          </Section>

          <Section title="6. Data Security">
            <p>
              We use administrative, technical, and organizational safeguards designed to protect
              personal data. No online service is completely risk free, so users should also protect
              account credentials and devices.
            </p>
          </Section>

          <Section title="7. Your Choices and Rights">
            <p>
              Depending on applicable law, you may request access, correction, or deletion of your
              personal data, and may object to or restrict certain processing activities.
            </p>
            <p>
              To make a privacy request, contact us using the details in the Contact section below.
            </p>
          </Section>

          <Section title="8. Cookies and Similar Technologies">
            <p>
              We may use cookies or similar technologies for session management, authentication,
              analytics, and service quality improvements. Browser controls may allow you to adjust
              cookie settings.
            </p>
          </Section>

          <Section title="9. Children">
            <p>
              RentifyPro is not intended for children under 18. If we learn that personal data from
              a child was collected without proper authorization, we will take steps to remove it.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. Continued use of the platform
              after updates are posted indicates acceptance of the revised policy.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>
              For privacy questions or requests, contact us at{" "}
              <a href="mailto:rentifypro.official@gmail.com" className="text-[#0B75E7] hover:underline">
                rentifypro.official@gmail.com
              </a>
              .
            </p>
          </Section>

          <div className="border-t border-slate-200 pt-6 text-sm text-slate-600">
            Review your platform rights and obligations in our{" "}
            <button
              type="button"
              onClick={onNavigateToTermsAndConditions}
              className="text-[#0B75E7] font-semibold hover:underline"
            >
              Terms and Conditions
            </button>
            .
          </div>
        </article>
      </main>
    </div>
  );
}
