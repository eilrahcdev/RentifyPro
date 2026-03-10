// Guard routes that need a valid login.
// Also checks the role when one is required.

import { Navigate } from "react-router-dom";

function isTokenExpired(token) {
  if (!token) return true;
  try {
    // The JWT payload is the middle section
    const payload = JSON.parse(atob(token.split(".")[1]));
    // exp is in seconds, so convert it to milliseconds
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export default function ProtectedRoute({ children, role }) {
  const token = localStorage.getItem("token");
  const user = JSON.parse(localStorage.getItem("user") || "null");

  // Redirect if the token is missing or expired
  if (!token || !user || isTokenExpired(token)) {
    // Clear stale local data
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    return <Navigate to="/signin" replace />;
  }

  // Redirect if the role does not match
  if (role && user.role !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}
