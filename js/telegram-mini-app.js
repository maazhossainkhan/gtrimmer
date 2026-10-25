/* Telegram Mini App shell integration. Authentication and access decisions remain server-side. */
(function () {
  "use strict";
  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    document.documentElement.classList.add("telegram-mini-app");
    if (tg.setHeaderColor) tg.setHeaderColor("#090b14");
    if (tg.setBackgroundColor) tg.setBackgroundColor("#090b14");
  } catch (_error) { /* Preserve ordinary browser behavior on older clients. */ }
})();
