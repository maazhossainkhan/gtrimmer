/* Telegram Mini App bootstrap. Auth decisions remain in the server-verified auth flow. */
(function () {
  "use strict";
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;

  try {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor("#090b14");
    if (tg.setBackgroundColor) tg.setBackgroundColor("#090b14");
  } catch (_error) {}

  // Provide an immediate visible state before the deferred auth bundle starts.
  const gate = document.getElementById("authGate");
  const appShell = document.getElementById("appShell");
  const setupNotice = document.getElementById("setupNotice");
  const signInButton = document.getElementById("telegramSignInButton");
  const feedback = document.getElementById("authFeedback");
  if (gate) gate.hidden = false;
  if (appShell) appShell.hidden = true;
  if (setupNotice) setupNotice.hidden = true;
  if (signInButton) signInButton.hidden = true;
  if (feedback) {
    feedback.textContent = "Opening your secure Telegram session…";
    feedback.className = "auth-feedback";
  }
})();
