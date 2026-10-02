import { useLayoutEffect, useRef } from "react";
import {
  REALTIME_CHAT_INPUT_MAX_LENGTH,
  sanitizeRealtimeChatInput,
} from "../utils/realtimeChatInput";

const MAX_TEXTAREA_HEIGHT = 112;

export default function ChatMessageInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Write a message...",
  containerClassName = "",
  textareaClassName = "",
}) {
  const textareaRef = useRef(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
      textarea.style.overflowY = textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    };
    resize();
    let width = textarea.clientWidth;
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (textarea.clientWidth === width) return;
      width = textarea.clientWidth;
      resize();
    });
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className={`rp-chat-textarea-shell ${containerClassName}`}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => onChange(sanitizeRealtimeChatInput(event.target.value))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onSend();
        }}
        placeholder={placeholder}
        aria-label="Message"
        maxLength={REALTIME_CHAT_INPUT_MAX_LENGTH}
        disabled={disabled}
        className={`rp-chat-textarea ${textareaClassName}`}
      />
    </div>
  );
}
