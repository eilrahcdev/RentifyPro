// Guard routes that need a valid login.
// Also checks the role when one is required.

import { Navigate } from "react-router-dom";
import { getSessionUser } from "./sessionStore";

export default function ProtectedRoute({ children, role }) {
  const user = getSessionUser();

  // Redirect if no user profile is available in local state.
  if (!user) {
    localStorage.removeItem("token");
    sessionStorage.removeItem("token");
    return <Navigate to="/signin" replace />;
  }

  // Redirect if the role does not match
  if (role && user.role !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}
