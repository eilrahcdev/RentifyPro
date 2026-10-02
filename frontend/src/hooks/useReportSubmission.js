import { useEffect, useRef, useState } from "react";

export default function useReportSubmission() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [existingReport, setExistingReport] = useState(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const submit = async (request, onSuccess) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    setExistingReport(null);
    let response;
    try {
      response = await request();
    } catch (requestError) {
      inFlight.current = false;
      if (mounted.current) {
        setSubmitting(false);
        if (requestError.details?.code === "DUPLICATE_REPORT") setExistingReport(requestError.details.reportId || "");
        setError(requestError.message || "The report could not be submitted. Please try again.");
      }
      return;
    }
    // A response from a closed or replaced form must not close the current draft.
    if (mounted.current) onSuccess(response.report);
  };

  return { submitting, error, existingReport, submit };
}
