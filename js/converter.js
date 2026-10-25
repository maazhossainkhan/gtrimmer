/* Pure URL conversion logic shared by the browser app and unit tests. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.GUrlConverter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLOWED_HOSTS = new Set(["share.google", "www.share.google"]);

  function convertShareUrl(rawValue) {
    if (typeof rawValue !== "string" || rawValue.trim() === "") {
      throw new Error("Please paste a share.google URL.");
    }

    const trimmed = rawValue.trim();
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (_error) {
      throw new Error("The URL you entered is invalid.");
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Please enter an HTTP or HTTPS share.google URL.");
    }
    if (parsed.username || parsed.password) {
      throw new Error("Please enter a share.google URL without a username or password.");
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(hostname)) {
      throw new Error("Please enter a valid share.google URL.");
    }

    const token = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (!token) {
      throw new Error("Google share token was not found.");
    }

    return {
      token,
      url: `https://www.google.com/share.google?q=${encodeURIComponent(token)}`
    };
  }

  return { convertShareUrl };
});
