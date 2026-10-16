import { createPortal } from "react-dom";
import useScrollLock from "./useScrollLock";

export default function ModalPortal({ children, lockScroll = true }) {
  useScrollLock(lockScroll);

  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
