export function currentMonthKey() {
  return dateMonthKey(new Date());
}

function dateMonthKey(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-PH", { month: "long", year: "numeric" });
}

// Include gaps so administrators can inspect months with no recorded activity.
export function monthOptions(values) {
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), 1);
  let earliest = new Date(current.getFullYear(), current.getMonth() - 5, 1);
  values.forEach((value) => {
    const key = dateMonthKey(value);
    if (!key || key > currentMonthKey()) return;
    const [year, month] = key.split("-").map(Number);
    const date = new Date(year, month - 1, 1);
    if (date < earliest) earliest = date;
  });
  const result = [];
  for (const month = new Date(current); month >= earliest; month.setMonth(month.getMonth() - 1)) {
    const value = dateMonthKey(month);
    result.push({ value, label: monthLabel(value) });
  }
  return result;
}
