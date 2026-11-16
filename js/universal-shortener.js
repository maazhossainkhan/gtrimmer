(function () {
  "use strict";

  const config = window.GTRIMMER_SUPABASE_CONFIG || {};
  const baseUrl = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = config.publishableKey || "";
  const endpoint = baseUrl + "/functions/v1/universal-shortener";
  const redirectMatch = /^\/r\/([A-Za-z0-9_-]{5,12})\/?$/.exec(window.location.pathname);

  function showRedirectScreen(title, message, showHome) {
    let screen = document.getElementById("ushRedirectScreen");
    if (!screen) {
      screen = document.createElement("main");
      screen.id = "ushRedirectScreen";
      screen.className = "ush-redirect-screen";
      screen.innerHTML =
        '<section class="ush-redirect-panel">' +
          '<div class="ush-redirect-symbol" aria-hidden="true">↗</div>' +
          '<h1 class="ush-redirect-title"></h1>' +
          '<p class="ush-redirect-message" role="status" aria-live="polite"></p>' +
          '<a class="ush-redirect-home" href="/">Back to Turlx</a>' +
        '</section>';
      document.body.appendChild(screen);
    }
    screen.querySelector(".ush-redirect-title").textContent = title;
    screen.querySelector(".ush-redirect-message").textContent = message;
    screen.querySelector(".ush-redirect-home").hidden = !showHome;
  }

  async function handleRedirect(code) {
    showRedirectScreen("Opening your link…", "Checking the short link securely.", false);
    if (!baseUrl || !publishableKey) {
      showRedirectScreen("Link service unavailable", "The short-link service is not configured. Please contact the site administrator.", true);
      return;
    }
    try {
      const response = await fetch(endpoint + "?code=" + encodeURIComponent(code), {
        method: "GET",
        headers: { apikey: publishableKey },
        cache: "no-store"
      });
      const data = await response.json().catch(function () { return null; });
      if (!response.ok || !data || data.success !== true || typeof data.destinationUrl !== "string") {
        const message = data && typeof data.message === "string" ? data.message : "This short link could not be found.";
        showRedirectScreen(response.status === 410 ? "Link expired" : "Link not found", message, true);
        return;
      }
      const destination = new URL(data.destinationUrl);
      if (destination.protocol !== "http:" && destination.protocol !== "https:") {
        showRedirectScreen("Unsafe destination", "This short link does not point to a supported web address.", true);
        return;
      }
      window.location.replace(destination.href);
    } catch (_error) {
      showRedirectScreen("Could not open this link", "Please check your connection and try again.", true);
    }
  }

  async function authenticatedHeaders() {
    if (!publishableKey) throw new Error("The Supabase publishable key is not configured.");
    const headers = new Headers({
      "apikey": publishableKey,
      "Content-Type": "application/json"
    });

    const telegram = window.Telegram && window.Telegram.WebApp;
    const initData = telegram && typeof telegram.initData === "string" ? telegram.initData : "";
    if (initData) {
      headers.set("x-telegram-init-data", initData);
      return headers;
    }

    const client = window.GTrimAuth && window.GTrimAuth.client;
    if (!client) throw new Error("Open Turlx from its Telegram Mini App or sign in with your approved account.");
    const result = await client.auth.getSession();
    if (result.error) throw new Error("Could not verify your sign-in session.");
    const token = result.data && result.data.session && result.data.session.access_token;
    if (!token) throw new Error("Your sign-in session has expired. Sign in again.");
    headers.set("Authorization", "Bearer " + token);
    return headers;
  }

  function copyText(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(value);
    }
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    let success = false;
    try { success = document.execCommand("copy"); } catch (_error) { success = false; }
    field.remove();
    return success ? Promise.resolve() : Promise.reject(new Error("Copy was blocked by the browser."));
  }

  function mountShortener() {
    const shell = document.getElementById("appShell");
    const anchor = shell && shell.querySelector(".hero-grid");
    if (!anchor || shell.querySelector(".universal-shortener-card")) return;

    const card = document.createElement("section");
    card.className = "universal-shortener-card";
    card.setAttribute("aria-labelledby", "ushTitle");
    card.innerHTML =
      '<div class="ush-header">' +
        '<div class="ush-icon" aria-hidden="true">↗</div>' +
        '<div class="ush-heading">' +
          '<div class="ush-eyebrow">UNIVERSAL LINK SHORTENER</div>' +
          '<h2 class="ush-title" id="ushTitle">Shorten any link</h2>' +
          '<p class="ush-description">Turn any valid website URL into a compact turlx.com link.</p>' +
        '</div>' +
        '<span class="ush-pill">7-character code</span>' +
      '</div>' +
      '<form class="ush-form" novalidate>' +
        '<label class="ush-label" for="ushDestination">Destination URL</label>' +
        '<div class="ush-form-row">' +
          '<input class="ush-input" id="ushDestination" name="destinationUrl" type="text" inputmode="url" autocomplete="url" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="2048" placeholder="https://example.com/your-long-link" required>' +
          '<button class="ush-submit" type="submit"><span class="ush-submit-text">Shorten link</span><span aria-hidden="true">→</span></button>' +
        '</div>' +
        '<p class="ush-error" role="alert" hidden></p>' +
      '</form>' +
      '<section class="ush-result" hidden aria-live="polite">' +
        '<p class="ush-result-label">Your short link is ready</p>' +
        '<div class="ush-result-row">' +
          '<a class="ush-result-link" target="_blank" rel="noopener noreferrer"></a>' +
          '<button class="ush-copy" type="button">Copy link</button>' +
        '</div>' +
        '<p class="ush-feedback" role="status" aria-live="polite"></p>' +
      '</section>' +
      '<p class="ush-note">Only HTTP and HTTPS links are supported. Your link is saved to your approved Telegram account.</p>';

    anchor.insertAdjacentElement("afterend", card);

    const form = card.querySelector(".ush-form");
    const input = card.querySelector("#ushDestination");
    const submit = card.querySelector(".ush-submit");
    const submitText = card.querySelector(".ush-submit-text");
    const error = card.querySelector(".ush-error");
    const result = card.querySelector(".ush-result");
    const resultLink = card.querySelector(".ush-result-link");
    const copyButton = card.querySelector(".ush-copy");
    const feedback = card.querySelector(".ush-feedback");
    let currentShortUrl = "";

    input.addEventListener("input", function () {
      error.hidden = true;
      result.hidden = true;
      feedback.textContent = "";
      currentShortUrl = "";
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        error.textContent = "Paste a URL first.";
        error.hidden = false;
        return;
      }

      submit.disabled = true;
      submitText.textContent = "Shortening…";
      error.hidden = true;
      result.hidden = true;
      feedback.textContent = "";

      try {
        const headers = await authenticatedHeaders();
        const response = await fetch(endpoint, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({ action: "create", destinationUrl: value })
        });
        const data = await response.json().catch(function () { return null; });
        if (!response.ok || !data || data.success !== true || !data.link || !data.link.short_code) {
          throw new Error(data && data.message ? data.message : "Could not shorten this link. Please try again.");
        }

        currentShortUrl = data.shortUrl || (window.location.origin + "/r/" + data.link.short_code);
        resultLink.href = currentShortUrl;
        resultLink.textContent = currentShortUrl;
        result.hidden = false;
        input.value = "";
      } catch (caught) {
        error.textContent = caught instanceof Error ? caught.message : "Could not shorten this link. Please try again.";
        error.hidden = false;
      } finally {
        submit.disabled = false;
        submitText.textContent = "Shorten link";
      }
    });

    copyButton.addEventListener("click", async function () {
      if (!currentShortUrl) return;
      copyButton.disabled = true;
      copyButton.textContent = "Copying…";
      try {
        await copyText(currentShortUrl);
        copyButton.textContent = "Copied!";
        feedback.textContent = "Short link copied to clipboard.";
      } catch (_error) {
        copyButton.textContent = "Copy link";
        feedback.textContent = "Copy was blocked. Select the short link and copy it manually.";
      } finally {
        window.setTimeout(function () {
          copyButton.disabled = false;
          copyButton.textContent = "Copy link";
        }, 1500);
      }
    });
  }

  if (redirectMatch) {
    handleRedirect(redirectMatch[1]);
    return;
  }

  if (window.GTrimAuthReady && typeof window.GTrimAuthReady.then === "function") {
    window.GTrimAuthReady.then(function (state) {
      if (state && state.authorized) mountShortener();
    });
  }
})();