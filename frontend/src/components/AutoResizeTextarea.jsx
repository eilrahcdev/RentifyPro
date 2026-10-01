import { useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import "./AutoResizeTextarea.css";

export default function AutoResizeTextarea({
  ref,
  value,
  defaultValue,
  minRows = 1,
  maxRows = 4,
  minHeight = 44,
  className = "",
  ...props
}) {
  const textareaRef = useRef(null);
  useImperativeHandle(ref, () => textareaRef.current, []);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea?.clientWidth) return;

    const styles = getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.5;
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const border = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
    const minimum = Math.max(minHeight, minRows * lineHeight + padding + border);
    const visibleRows = Math.min(maxRows, parseFloat(styles.getPropertyValue("--rp-textarea-max-rows")) || maxRows);
    const maximum = Math.max(minimum, visibleRows * lineHeight + padding + border);

    textarea.style.minHeight = `${minimum}px`;
    textarea.style.maxHeight = `${maximum}px`;
    textarea.style.overflowY = "hidden";
    textarea.style.height = "auto";
    const contentHeight = textarea.value ? textarea.scrollHeight + border : minimum;
    textarea.style.height = `${Math.min(maximum, Math.max(minimum, contentHeight))}px`;
    textarea.style.overflowY = textarea.value && textarea.scrollHeight > textarea.clientHeight + 1 ? "auto" : "hidden";
  }, [minRows, maxRows, minHeight]);

  useLayoutEffect(() => {
    resize();
  }, [resize, value, defaultValue, className, props.placeholder]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    let frame = 0;
    let disposed = false;
    const scheduleResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    };
    let width = textarea.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = textarea.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer?.observe(textarea);
    textarea.addEventListener("input", scheduleResize);
    const form = textarea.form;
    form?.addEventListener("reset", scheduleResize);
    window.addEventListener("resize", scheduleResize);
    document.fonts?.ready.then(() => { if (!disposed) resize(); });
    document.fonts?.addEventListener("loadingdone", scheduleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      textarea.removeEventListener("input", scheduleResize);
      form?.removeEventListener("reset", scheduleResize);
      window.removeEventListener("resize", scheduleResize);
      document.fonts?.removeEventListener("loadingdone", scheduleResize);
    };
  }, [resize]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      rows={minRows}
      value={value}
      defaultValue={defaultValue}
      className={`rp-auto-resize-textarea ${className}`}
    />
  );
}
