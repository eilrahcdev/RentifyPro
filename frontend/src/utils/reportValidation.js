export const getReportCategoryLabel = (groups, category) =>
  groups.flatMap((group) => group.options).find(([value]) => value === category)?.[1] || "";

export const validateReportCategory = (groups, category) =>
  getReportCategoryLabel(groups, category) ? "" : "Select the category that best describes what happened.";

export const validateReportDescription = (description) => {
  const length = description.trim().length;
  if (length < 20) return "Please provide at least 20 characters of incident details.";
  if (length > 3000) return "Keep incident details within 3,000 characters.";
  return "";
};
