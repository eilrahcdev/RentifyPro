// Sign-in page wrapper
import React from "react";
import SignInPage from "../components/SignInPage";

export default function SignIn({
  onNavigateToHome,
  onNavigateToRegister,
  onNavigateToForgotPassword,
  onLoginSuccess,
}) {
  return (
    <SignInPage
      onNavigateToHome={onNavigateToHome}
      onNavigateToRegister={onNavigateToRegister}
      onNavigateToForgotPassword={onNavigateToForgotPassword}
      onLoginSuccess={onLoginSuccess}
    />
  );
}
