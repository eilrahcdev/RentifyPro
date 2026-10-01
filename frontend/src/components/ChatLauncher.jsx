import { useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import "./ChatLauncher.css";

const INVITATION_STORAGE_KEY = "rentifypro:ai-launcher-seen:v1";
let invitationSeenInMemory = false;

const hasSeenInvitation = () => {
  try {
    return window.sessionStorage.getItem(INVITATION_STORAGE_KEY) === "1";
  } catch {
    return invitationSeenInMemory;
  }
};

const rememberInvitation = () => {
  invitationSeenInMemory = true;
  try {
    window.sessionStorage.setItem(INVITATION_STORAGE_KEY, "1");
  } catch {
    // Keep the invitation dismissed across page changes when storage is blocked.
  }
};

function ClosedChatLauncher({ onOpen }) {
  const [showInvitation, setShowInvitation] = useState(() => !hasSeenInvitation());
  const [invitationEngaged, setInvitationEngaged] = useState(false);
  const invitationRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!showInvitation) return;
    rememberInvitation();
    if (invitationEngaged) return;
    const timer = window.setTimeout(() => setShowInvitation(false), 10000);
    return () => window.clearTimeout(timer);
  }, [showInvitation, invitationEngaged]);

  const dismissInvitation = () => {
    if (invitationRef.current?.contains(document.activeElement)) {
      buttonRef.current?.focus();
    }
    setShowInvitation(false);
  };

  return (
    <div className="rp-ai-launcher">
      {showInvitation && (
        <div
          ref={invitationRef}
          className="rp-ai-launcher-invitation"
          onPointerEnter={() => setInvitationEngaged(true)}
          onPointerLeave={() => setInvitationEngaged(invitationRef.current?.contains(document.activeElement))}
          onFocusCapture={() => setInvitationEngaged(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setInvitationEngaged(event.currentTarget.matches(":hover"));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              dismissInvitation();
            }
          }}
        >
          <p>Need help with vehicles, bookings, or payments?</p>
          <button
            type="button"
            className="rp-ai-launcher-dismiss"
            aria-label="Dismiss Rentify AI invitation"
            onClick={dismissInvitation}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className={`rp-ai-launcher-button${showInvitation ? " rp-ai-launcher-button--invite" : ""}`}
        aria-haspopup="dialog"
        onClick={() => {
          rememberInvitation();
          onOpen();
        }}
      >
        <img src="/rentify-ai-logo-bubble-optimized.png" alt="" aria-hidden="true" />
        <span className="rp-ai-launcher-label-desktop">Ask Rentify AI</span>
        <span className="rp-ai-launcher-label-mobile">Ask AI</span>
      </button>
    </div>
  );
}

export default function ChatLauncher({ isOpen, onOpen }) {
  useEffect(() => {
    if (isOpen) rememberInvitation();
  }, [isOpen]);

  return (
    <div className="rp-ai-launcher-host">
      {!isOpen && <ClosedChatLauncher onOpen={onOpen} />}
    </div>
  );
}

export function ChatHelpLink({ onOpen, children = "Have a question? Ask Rentify AI." }) {
  return (
    <button type="button" className="rp-ai-help-link" aria-haspopup="dialog" onClick={onOpen}>
      <MessageCircle size={16} aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}
