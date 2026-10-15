// Register page wrapper
import React from "react";
import RegisterPage from "../components/RegisterPage";

export default function Register({
  onNavigateToHome,
  onNavigateToSignIn,
  onNavigateToOwnerRegister,
}) {
  return (
    <RegisterPage
      onNavigateToHome={onNavigateToHome}
      onNavigateToSignIn={onNavigateToSignIn}
      onNavigateToOwnerRegister={onNavigateToOwnerRegister}
    />
  );
}
