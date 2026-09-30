import { Toaster } from "react-hot-toast";

export default function ActionToastHost() {
  return (
    <Toaster
      position="top-center"
      reverseOrder={false}
      gutter={8}
      containerStyle={{
        top: "var(--rp-floating-alert-top)",
        bottom: "auto",
        left: 16,
        right: 16,
        zIndex: 120,
      }}
    />
  );
}
