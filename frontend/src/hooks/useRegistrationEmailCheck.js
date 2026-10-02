import { useCallback, useEffect, useRef, useState } from "react";
import API from "../utils/api";

const CHECK_TIMEOUT_MS = 15000;

export default function useRegistrationEmailCheck() {
  const [isChecking, setIsChecking] = useState(false);
  const active = useRef(null);

  const cancel = useCallback(() => {
    active.current?.controller.abort();
    active.current = null;
    setIsChecking(false);
  }, []);

  useEffect(() => () => {
    active.current?.controller.abort();
    active.current = null;
  }, []);

  const check = useCallback(async (email) => {
    if (active.current) return null;
    const request = { controller: new AbortController(), timedOut: false };
    active.current = request;
    setIsChecking(true);
    const timeout = window.setTimeout(() => {
      request.timedOut = true;
      request.controller.abort();
    }, CHECK_TIMEOUT_MS);
    try {
      const result = await API.checkRegistrationEmail(String(email || "").trim().toLowerCase(), {
        signal: request.controller.signal,
      });
      if (active.current !== request) return null;
      // A malformed or unexpected response must never unlock the next step.
      if (result?.success !== true || result.available !== true) {
        return { available: false, message: "We couldn't confirm your email is available. Please try again." };
      }
      return { available: true };
    } catch (error) {
      if (active.current !== request) return null;
      const message = request.timedOut
        ? "Checking your email took too long. Please try again."
        : error?.message || "We couldn't check your email. Please try again.";
      return {
        available: false,
        message,
        fieldError: (error?.status === 400 || error?.status === 409) && Boolean(error?.details?.errors?.email),
      };
    } finally {
      window.clearTimeout(timeout);
      if (active.current === request) {
        active.current = null;
        setIsChecking(false);
      }
    }
  }, []);

  return { check, cancel, isChecking };
}
