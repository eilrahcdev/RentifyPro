// Register page wrapper
import React from "react";
import RegisterPage from "../components/RegisterPage";

export default function Register({
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToRegisterOTP,
  onNavigateToOwnerRegister,
}) {
  return (
    <RegisterPage
      onNavigateToHome={onNavigateToHome}
      onNavigateToSignIn={onNavigateToSignIn}
      onNavigateToRegisterOTP={onNavigateToRegisterOTP}
      onNavigateToOwnerRegister={onNavigateToOwnerRegister}
    />
  );
}
