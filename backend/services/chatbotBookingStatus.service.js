import { evaluateBookingEligibility, getRenterBookingStatusRecords } from "./bookingEligibility.service.js";
import { getBookingRemainingAmount } from "../utils/bookingPayment.js";
import { roundCurrency } from "../utils/pricing.js";

const ACTIVE_STATUSES = new Set(["confirmed", "extended"]);
const BALANCE_STATUSES = new Set(["confirmed", "extended", "completed"]);
const DUE_REASON_CODES = new Set(["OVERDUE_BOOKING_BALANCE", "UNPAID_LATE_RETURN_PENALTY"]);

const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;
const money = (value) => `PHP ${roundCurrency(value).toLocaleString("en-PH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;
const returned = (booking) => Boolean(
  booking.actualReturnAt || booking.returnStatus === "confirmed" || booking.status === "completed"
);

export const summarizeRenterBookingStatus = (bookings, now = new Date()) => {
  const currentTime = new Date(now).getTime();
  const active = bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status) && !returned(booking));
  const pendingCount = bookings.filter((booking) => booking.status === "pending").length;
  const eligibility = evaluateBookingEligibility(bookings, { now });
  const overdueCount = eligibility.reasons.filter((reason) => reason.code === "OVERDUE_VEHICLE_RETURN").length;
  const dueBalances = eligibility.reasons.filter((reason) => DUE_REASON_CODES.has(reason.code));
  const dueBookingIds = new Set(dueBalances.map((reason) => reason.bookingId));
  const notDueBalances = bookings.filter((booking) =>
    BALANCE_STATUSES.has(booking.status)
    && booking.paymentStatus !== "refunded"
    && !dueBookingIds.has(String(booking._id))
    && getBookingRemainingAmount(booking) > 0
  );

  return {
    activeCount: active.length,
    pendingCount,
    overdueCount,
    withinGraceCount: active.filter((booking) => {
      const returnTime = new Date(booking.returnAt).getTime();
      return Number.isFinite(returnTime) && currentTime > returnTime;
    }).length - overdueCount,
    dueCount: dueBalances.length,
    dueTotal: roundCurrency(dueBalances.reduce((sum, reason) => sum + reason.amountDue, 0)),
    notDueCount: notDueBalances.length,
    notDueTotal: roundCurrency(notDueBalances.reduce(
      (sum, booking) => sum + getBookingRemainingAmount(booking), 0
    )),
    latePenaltyDueCount: dueBalances.filter((reason) => reason.code === "UNPAID_LATE_RETURN_PENALTY").length,
  };
};

const REPLIES = {
  en: {
    signIn: "Please sign in to your renter account so I can check your bookings. I can't view private booking status without that session.",
    renterOnly: "I can check booking status only for the signed-in renter account. Sign in as a renter to see your own bookings.",
    active: (s) => `Your account shows ${plural(s.activeCount, "active booking")} (confirmed or extended). ${plural(s.pendingCount, "pending request")} ${s.pendingCount === 1 ? "is" : "are"} separate. Open Bookings for vehicle and date details.`,
    overdue: (s) => `${s.overdueCount ? `Your account shows ${plural(s.overdueCount, "vehicle return")} overdue after the applicable grace period.` : s.withinGraceCount ? `No return is overdue after its grace period, but ${plural(s.withinGraceCount, "booking")} passed the scheduled return time.` : "Your account shows no current return past its scheduled time."}${s.latePenaltyDueCount ? ` ${plural(s.latePenaltyDueCount, "booking")} also ${s.latePenaltyDueCount === 1 ? "has" : "have"} a finalized unpaid late-return penalty included in its due balance.` : ""} Check Bookings for the return and payment details.`,
    unpaid: (s) => `${s.dueCount ? `Your account has ${plural(s.dueCount, "balance")} due, totaling ${money(s.dueTotal)}.` : "Your account has no balance currently due."}${s.notDueCount ? ` ${plural(s.notDueCount, "ongoing rental")} also ${s.notDueCount === 1 ? "has" : "have"} an outstanding balance totaling ${money(s.notDueTotal)} that is not due yet.` : ""} Check Bookings for each payment's details.`,
    all: (s) => `Your current and unsettled bookings show ${plural(s.activeCount, "active booking")}, ${plural(s.pendingCount, "pending request")}, ${plural(s.overdueCount, "overdue return")}, and ${plural(s.dueCount, "balance")} due${s.dueCount ? ` totaling ${money(s.dueTotal)}` : ""}.${s.withinGraceCount ? ` ${plural(s.withinGraceCount, "return")} passed the scheduled time but is still within grace.` : ""} Open Bookings for details or History for completed and cancelled trips.`,
  },
  fil: {
    signIn: "Mag-sign in sa renter account mo para ma-check ko ang sarili mong bookings. Hindi ko makikita ang private booking status mo nang walang session.",
    renterOnly: "Para lang sa naka-sign in na renter ang booking status na ito. Mag-sign in bilang renter para makita ang sarili mong bookings.",
    active: (s) => `May ${s.activeCount} active booking (confirmed o extended) at ${s.pendingCount} hiwalay na pending request sa account mo. Tingnan ang Bookings para sa sasakyan at mga petsa.`,
    overdue: (s) => `${s.overdueCount ? `May ${s.overdueCount} overdue na pagbabalik ng sasakyan matapos ang itinakdang grace period.` : s.withinGraceCount ? `Wala pang overdue return matapos ang grace period, pero lumampas na sa nakatakdang oras ang ${s.withinGraceCount} booking.` : "Walang kasalukuyang return na lumampas sa nakatakdang oras sa account mo."}${s.latePenaltyDueCount ? ` May ${s.latePenaltyDueCount} booking din na may finalized at hindi pa bayad na late-return penalty sa due balance nito.` : ""} Tingnan ang Bookings para sa detalye ng return at bayad.`,
    unpaid: (s) => `${s.dueCount ? `May ${s.dueCount} due balance sa account mo na may kabuuang ${money(s.dueTotal)}.` : "Wala kang balance na due sa ngayon."}${s.notDueCount ? ` May ${s.notDueCount} ongoing rental din na may natitirang ${money(s.notDueTotal)} na hindi pa due.` : ""} Tingnan ang Bookings para sa detalye ng bawat bayad.`,
    all: (s) => `Sa kasalukuyan at hindi pa settled na bookings mo ay may ${s.activeCount} active booking, ${s.pendingCount} pending request, ${s.overdueCount} overdue return, at ${s.dueCount} due balance${s.dueCount ? ` na may kabuuang ${money(s.dueTotal)}` : ""}.${s.withinGraceCount ? ` May ${s.withinGraceCount} return na lumampas sa oras pero nasa grace period pa.` : ""} Tingnan ang Bookings para sa detalye o ang History para sa natapos at nakanselang trips.`,
  },
  taglish: {
    signIn: "Please sign in sa renter account mo para ma-check ko ang sarili mong bookings. I can't view private booking status without your session.",
    renterOnly: "I can check this booking status only for the signed-in renter account. Mag-sign in as a renter to see your own bookings.",
    active: (s) => `May ${s.activeCount} active booking (confirmed or extended) at ${s.pendingCount} separate pending request sa account mo. Check Bookings for vehicle and date details.`,
    overdue: (s) => `${s.overdueCount ? `May ${s.overdueCount} vehicle return na overdue after the applicable grace period.` : s.withinGraceCount ? `Walang overdue return after grace, pero ${s.withinGraceCount} booking ang past scheduled return time.` : "Walang current return na past scheduled time sa account mo."}${s.latePenaltyDueCount ? ` May ${s.latePenaltyDueCount} booking din with a finalized unpaid late-return penalty in its due balance.` : ""} Check Bookings for return and payment details.`,
    unpaid: (s) => `${s.dueCount ? `May ${s.dueCount} due balance sa account mo, totaling ${money(s.dueTotal)}.` : "Wala kang balance na due ngayon."}${s.notDueCount ? ` May ${s.notDueCount} ongoing rental din with ${money(s.notDueTotal)} outstanding, hindi pa due.` : ""} Check Bookings for each payment's details.`,
    all: (s) => `Sa current at unsettled bookings mo, may ${s.activeCount} active booking, ${s.pendingCount} pending request, ${s.overdueCount} overdue return, at ${s.dueCount} due balance${s.dueCount ? ` totaling ${money(s.dueTotal)}` : ""}.${s.withinGraceCount ? ` May ${s.withinGraceCount} return na past scheduled time pero within grace pa.` : ""} Check Bookings for details or History for completed and cancelled trips.`,
  },
};

export const renterBookingSignInReply = (language) => REPLIES[language]?.signIn || REPLIES.en.signIn;
export const renterBookingRenterOnlyReply = (language) => REPLIES[language]?.renterOnly || REPLIES.en.renterOnly;

export const getRenterBookingStatusReply = async (renterId, intent, language, now = new Date()) => {
  const bookings = await getRenterBookingStatusRecords(renterId);
  const summary = summarizeRenterBookingStatus(bookings, now);
  const replies = REPLIES[language] || REPLIES.en;
  const kind = {
    my_active_bookings: "active",
    my_overdue_return: "overdue",
    my_unpaid_balance: "unpaid",
    booking_status: "all",
  }[intent];
  if (!kind) throw new Error(`Unsupported renter booking status intent: ${intent}`);
  return replies[kind](summary);
};
