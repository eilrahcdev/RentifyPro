import { useEffect } from "react";
import { FLOATING_ALERT_MS, removeFloatingAlert, showFloatingAlert } from "../utils/actionToast";

export default function PaymentSuccessToast({ notice }) {
  const noticeId = notice?.id;
  const message = notice?.message;
  const isProcessing = notice?.kind === "processing";

  useEffect(() => {
    if (noticeId == null || !message) return undefined;
    const id = `payment-${noticeId}`;
    showFloatingAlert(message, { id, duration: isProcessing ? Infinity : FLOATING_ALERT_MS });
    return () => removeFloatingAlert(id);
  }, [noticeId, message, isProcessing]);

  return null;
}
