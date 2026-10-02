export default function PasswordStrengthIndicator({ value }) {
  if (!value) return null;

  let strength = 0;
  if (value.length >= 8) strength++;
  if (value.length >= 12) strength++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) strength++;
  if (/\d/.test(value)) strength++;
  if (/[^a-zA-Z\d]/.test(value)) strength++;

  const colors = ["bg-red-500", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-lime-500", "bg-green-500"];
  const textColors = ["text-red-500", "text-red-500", "text-orange-500", "text-yellow-600", "text-lime-600", "text-green-600"];
  const labels = ["Weak", "Weak", "Fair", "Good", "Strong", "Very Strong"];

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-200 ${index < strength ? colors[strength] : "bg-slate-200"}`}
          />
        ))}
      </div>
      <p className={`text-xs font-semibold ${textColors[strength]}`} aria-live="polite">
        Password Strength: {labels[strength]}
      </p>
    </div>
  );
}
