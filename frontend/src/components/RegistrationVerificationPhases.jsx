export default function RegistrationVerificationPhases({ phase, emailVerified, documentsComplete, selfieVerified }) {
  return <ol aria-label="Verification phases" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
    {[["email", "Email Verification", emailVerified], ["documents", "ID Verification", documentsComplete], ["face", "Face Recognition", selfieVerified]].map(([key, label, complete], index) =>
      <li key={key} aria-current={phase === key ? "step" : undefined}
        className={`rounded-xl border px-3 py-2 text-sm ${phase === key ? "border-[#017FE6] bg-blue-50 text-[#0165B8]" : "border-gray-200 text-gray-600"}`}>
        <span className="font-semibold">{index + 1}. {label}</span><span className="block text-xs">{complete ? key === "documents" ? "Documents saved" : key === "face" ? "Selfie matched" : "Email verified" : phase === key ? "Current phase" : "To complete"}</span>
      </li>)}
  </ol>;
}
