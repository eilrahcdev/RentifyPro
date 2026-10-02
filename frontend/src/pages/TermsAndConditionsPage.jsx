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

export default function TermsAndConditionsPage({
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
  onNavigateToPrivacyPolicy,
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
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Terms and Conditions</h1>
            <p className="text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
            <p className="text-sm sm:text-base text-slate-700 leading-7">
              These Terms and Conditions govern your use of the RentifyPro platform and services,
              including vehicle browsing, booking, account registration, and communication tools.
              By using our platform, you agree to these Terms.
            </p>
          </header>

          <Section title="1. Eligibility and Accounts">
            <p>
              You must provide accurate, current, and complete information when creating an account.
              You are responsible for activity under your account and for keeping your login
              credentials secure.
            </p>
            <p>
              We may suspend or restrict accounts that use false information, violate these Terms,
              or create safety risks.
            </p>
          </Section>

          <Section title="2. Platform Role">
            <p>
              RentifyPro provides a digital platform that connects renters and vehicle owners.
              Actual rental transactions are between users and owners, subject to listing details,
              booking records, and applicable law.
            </p>
            <p>
              We may moderate listings, monitor activity, and enforce platform standards to protect
              users and service quality.
            </p>
          </Section>

          <Section title="3. Booking, Payment, and Fees">
            <p>
              Booking rates, deposits, and additional charges are presented during checkout. By
              confirming a booking, you agree to pay all applicable amounts, including penalties for
              late return, damage, violations, or unpaid balances under your booking record.
            </p>
            <p>
              Refunds, if applicable, are processed according to the cancellation terms shown in
              your booking flow and transaction status.
            </p>
          </Section>

          <Section title="4. User Responsibilities">
            <p>
              Renters must use vehicles lawfully, safely, and only for permitted purposes. Users
              must comply with traffic rules, licensing requirements, and all conditions shown in
              booking and listing details.
            </p>
            <p>
              Owners must keep listing information accurate, disclose material vehicle issues, and
              maintain vehicles in roadworthy condition.
            </p>
          </Section>

          <Section title="5. Cancellations and Disputes">
            <p>
              Cancellation outcomes depend on booking status, timing, and policy rules at the time
              of the request. Disputes should be reported promptly through official RentifyPro
              support channels.
            </p>
            <p>
              We may request supporting evidence such as photos, logs, and messages when resolving
              disputes.
            </p>
          </Section>

          <Section title="6. Prohibited Conduct">
            <p>
              You may not misuse the platform, attempt unauthorized access, upload harmful content,
              submit fraudulent claims, impersonate others, or use RentifyPro for illegal purposes.
            </p>
          </Section>

          <Section title="7. Intellectual Property">
            <p>
              RentifyPro trademarks, logos, interface elements, and platform content are protected
              by intellectual property laws. You may not reproduce or distribute platform materials
              without written permission.
            </p>
          </Section>

          <Section title="8. Service Availability">
            <p>
              We aim to keep the platform available and secure, but we do not guarantee uninterrupted
              operation. Maintenance, outages, and third-party service issues may affect access.
            </p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p>
              To the fullest extent allowed by law, RentifyPro is not liable for indirect,
              incidental, or consequential damages arising from platform use, third-party actions,
              user disputes, or service interruptions.
            </p>
          </Section>

          <Section title="10. Termination">
            <p>
              We may suspend or terminate access for violations of these Terms, fraud risks, safety
              concerns, or legal requirements. Termination does not remove obligations from completed
              transactions.
            </p>
          </Section>

          <Section title="11. Updates to These Terms">
            <p>
              We may update these Terms from time to time. Continued use of the platform after an
              update takes effect means you accept the revised Terms.
            </p>
          </Section>

          <Section title="12. Governing Law">
            <p>
              These Terms are governed by the laws of the Republic of the Philippines, without
              prejudice to mandatory consumer protection rights under applicable law.
            </p>
          </Section>

          <Section title="13. Contact">
            <p>
              For questions about these Terms, contact us at{" "}
              <a href="mailto:rentifypro.official@gmail.com" className="text-[#0B75E7] hover:underline">
                rentifypro.official@gmail.com
              </a>
              .
            </p>
          </Section>

          <div className="border-t border-slate-200 pt-6 text-sm text-slate-600">
            Review how we handle personal data in our{" "}
            <button
              type="button"
              onClick={onNavigateToPrivacyPolicy}
              className="text-[#0B75E7] font-semibold hover:underline"
            >
              Privacy Policy
            </button>
            .
          </div>
        </article>
      </main>
    </div>
  );
}
