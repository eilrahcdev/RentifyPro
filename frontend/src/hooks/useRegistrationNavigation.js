import { useEffect, useId, useRef } from "react";

export default function useRegistrationNavigation(step) {
  const formRef = useRef(null);
  const formId = useId();
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const frame = requestAnimationFrame(() => {
      const card = formRef.current?.closest(".rp-registration-card");
      const target = card?.querySelector(".rp-registration-header h2") || formRef.current;
      if (target) target.tabIndex = -1;
      target?.focus({ preventScroll: true });
      const content = card?.closest(".rp-auth-content");
      content?.scrollTo({ top: 0, behavior: "instant" });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);
  const revealError = () => {
    requestAnimationFrame(() => {
      const target = formRef.current?.querySelector('[aria-invalid="true"]:not([type="hidden"])')
        || formRef.current?.querySelector('[role="alert"], p.text-red-500, p.text-red-600')
        || formRef.current;
      if (target && !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "FORM"].includes(target.tagName)) target.tabIndex = -1;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center", behavior: "instant" });
    });
  };
  return { formRef, formId, revealError };
}
