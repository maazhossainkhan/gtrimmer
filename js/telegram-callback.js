(function () {
  "use strict";
  const config = window.GTRIMMER_SUPABASE_CONFIG || {};
  const message = document.getElementById("callbackMessage");
  const error = document.getElementById("callbackError");
  const home = document.getElementById("backHomeLink");
  const qs = new URLSearchParams(window.location.search);

  function fail(text) {
    message.textContent = "Telegram sign-in was not completed.";
    error.textContent = text;
    error.hidden = false;
    home.hidden = false;
    sessionStorage.removeItem("gtrim_telegram_id_token");
  }

  async function run() {
    const oauthError = qs.get("error");
    if (oauthError) {
      fail("Telegram returned: " + (qs.get("error_description") || oauthError));
      return;
    }
    const code = qs.get("code");
    const receivedState = qs.get("state");
    const savedState = sessionStorage.getItem("gtrim_telegram_state");
    const verifier = sessionStorage.getItem("gtrim_telegram_verifier");
    const nonce = sessionStorage.getItem("gtrim_telegram_nonce");
    if (!code || !receivedState || !savedState || receivedState !== savedState || !verifier || !nonce) {
      fail("The sign-in state could not be verified. Start again from the main page.");
      return;
    }
    if (!config.supabaseUrl || !config.publishableKey || !config.telegramClientId || !config.telegramRedirectUri) {
      fail("The site administrator has not completed Supabase and Telegram configuration.");
      return;
    }
    message.textContent = "Verifying the signed Telegram identity on the server…";
    const response = await fetch(config.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/telegram-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": config.publishableKey },
      body: JSON.stringify({
        action: "exchange-code",
        code: code,
        redirect_uri: config.telegramRedirectUri,
        code_verifier: verifier,
        nonce: nonce
      })
    });
    let data = {};
    try { data = await response.json(); } catch (_error) {}
    if (!response.ok || !data.success || !data.id_token) {
      throw new Error(data.message || data.error || ("The secure service returned HTTP " + response.status));
    }
    sessionStorage.setItem("gtrim_telegram_id_token", data.id_token);
    if (data.expires_at) sessionStorage.setItem("gtrim_telegram_exp", String(data.expires_at));
    sessionStorage.removeItem("gtrim_telegram_state");
    sessionStorage.removeItem("gtrim_telegram_verifier");
    sessionStorage.removeItem("gtrim_telegram_nonce");
    message.textContent = "Sign-in verified. Returning to Google Trim…";
    window.location.replace("/");
  }

  run().catch(function (err) {
    fail(err && err.message ? err.message : "Unknown sign-in error.");
  });
})();
