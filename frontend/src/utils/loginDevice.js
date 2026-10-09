export function describeLoginDevice(userAgent = "") {
  const agent = String(userAgent);
  const browser = /Edg(?:e|A|iOS)?\//i.test(agent) ? "Edge"
    : /OPR\/|Opera/i.test(agent) ? "Opera"
    : /Firefox\/|FxiOS\//i.test(agent) ? "Firefox"
    : /Chrome\/|CriOS\//i.test(agent) ? "Chrome"
    : /Safari\//i.test(agent) ? "Safari" : "Unknown browser";
  const device = /iPad|Macintosh.*Mobile/i.test(agent) ? "iPad"
    : /iPhone/i.test(agent) ? "iPhone"
    : /Android/i.test(agent) ? "Android"
    : /Windows/i.test(agent) ? "Windows"
    : /Macintosh|Mac OS X/i.test(agent) ? "Mac"
    : /Linux/i.test(agent) ? "Linux" : "Unknown device";
  return `${browser} on ${device}`;
}
