export const HELP_OPEN_EVENT = "rentifypro:open-help";
export const HELP_ASK_AI_EVENT = "rentifypro:help-ask-ai";

export const openHelp = (guideSlug = "") => {
  window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT, { detail: { guideSlug } }));
};
