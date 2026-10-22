import { useEffect, useRef, useState } from "react";
import { prepareRegistrationDocument, cancelRegistrationDocument } from "../utils/kycApi";

export default function useRegistrationDocumentUpload(email, role, onCancelled, onUnconfirmed) {
  const current = useRef(null);
  const failed = useRef(null);
  const mounted = useRef(true);
  const [active, setActive] = useState(null);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current?.controller.abort(); };
  }, []);

  const begin = docType => {
    if (current.current) throw new Error("Finish the current document request before starting another.");
    const attempt = { docType, controller: new AbortController(), cancelRequested: false };
    attempt.settled = new Promise(resolve => { attempt.resolveSettled = resolve; });
    current.current = attempt;
    failed.current = null;
    setActive({ docType, phase: "uploading" });
    setNotice(null);
    return attempt;
  };
  const prepare = async attempt => {
    attempt.controller.signal.throwIfAborted();
    attempt.preparing = prepareRegistrationDocument(email, role, attempt.docType).then(result => {
      if (!result.success || !result.uploadAttemptId) throw new Error("The upload could not be prepared. Please retry.");
      attempt.id = result.uploadAttemptId;
      return result;
    });
    await attempt.preparing;
    attempt.controller.signal.throwIfAborted();
    return { uploadAttemptId: attempt.id, signal: attempt.controller.signal };
  };
  const cancel = async (docType, documentRevision) => {
    const attempt = current.current || { docType,
      id: failed.current?.docType === docType ? failed.current.id : documentRevision, controller: new AbortController() };
    if (attempt.docType !== docType) return;
    if (attempt.cancelling) return attempt.cancelling;
    current.current = attempt;
    attempt.cancelRequested = true;
    attempt.controller.abort();
    setActive({ docType, phase: "cancelling" });
    setNotice(null);
    attempt.cancelling = (async () => {
      try {
        let documentRevision = "";
        if (attempt.preparing) await attempt.preparing;
        if (attempt.id) {
          const result = await cancelRegistrationDocument(email, role, docType, attempt.id);
          if (!result.success || result.cancelled !== true) throw new Error("Cancellation was not confirmed. Please retry.");
          documentRevision = result.documentRevision || "";
        }
        if (attempt.settled) await attempt.settled;
        if (!mounted.current) return;
        await onCancelled(docType, documentRevision);
        failed.current = null;
        if (mounted.current) setNotice({ docType, message: "Document check cancelled. Your details and selected file are kept." });
      } catch (error) {
        if (attempt.settled) await attempt.settled;
        if (!mounted.current) return;
        failed.current = { docType, id: attempt.id };
        setNotice({ docType, attemptId: attempt.id, error: true, message: error.message || "Cancellation was not confirmed. Please retry." });
        await onUnconfirmed();
      } finally {
        if (current.current === attempt) {
          current.current = null;
          if (mounted.current) setActive(null);
        }
      }
    })();
    return attempt.cancelling;
  };
  const finish = async attempt => {
    attempt.resolveSettled();
    if (attempt.cancelling) await attempt.cancelling;
    if (current.current === attempt) {
      current.current = null;
      if (mounted.current) setActive(null);
    }
  };
  return { active, notice, begin, prepare, cancel, finish,
    wasCancelled: attempt => attempt.cancelRequested || attempt.controller.signal.aborted };
}
