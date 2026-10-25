(function () {
  "use strict";

  const setupNotice = document.getElementById("setupNotice");
  const authGate = document.getElementById("authGate");
  const appShell = document.getElementById("appShell");
  const signInButton = document.getElementById("telegramSignInButton");
  const requestAccessButton = document.getElementById("requestAccessButton");
  const signOutButton = document.getElementById("signOutButton");
  const authFeedback = document.getElementById("authFeedback");
  const identityChip = document.getElementById("identityChip");
  const identityText = document.getElementById("identityText");
  const adminPanel = document.getElementById("adminPanel");
  const adminFeedback = document.getElementById("adminFeedback");
  const adminRefreshButton = document.getElementById("adminRefreshButton");
  const pendingRequestsList = document.getElementById("pendingRequestsList");
  const activeUsersList = document.getElementById("activeUsersList");
  const pendingCount = document.getElementById("pendingCount");
  const authorizedCount = document.getElementById("authorizedCount");

  const TOKEN_KEY = "gtrim_telegram_id_token";
  const STATE_KEY = "gtrim_telegram_state";
  const VERIFIER_KEY = "gtrim_telegram_verifier";
  const NONCE_KEY = "gtrim_telegram_nonce";
  let currentUser = null;
  let currentAccess = { authorized: false, isAdmin: false };
  let readyResolved = false;
  let resolveReady;
  window.GTrimAuthReady = new Promise(function (resolve) { resolveReady = resolve; });

  function finishReady(state) {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady(state);
  }

  function getConfig() {
    return window.GTRIMMER_SUPABASE_CONFIG || {};
  }

  function randomBase64Url(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let binary = "";
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function sha256Base64Url(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    let binary = "";
    new Uint8Array(digest).forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function setAuthFeedback(message, type) {
    authFeedback.textContent = message || "";
    authFeedback.className = "auth-feedback" + (type ? " is-" + type : "");
  }

  function setAdminFeedback(message, type) {
    adminFeedback.textContent = message || "";
    adminFeedback.className = "admin-feedback" + (type ? " is-" + type : "");
  }

  function setGate(message, type) {
    setupNotice.hidden = true;
    authGate.hidden = false;
    appShell.hidden = true;
    signOutButton.hidden = !sessionStorage.getItem(TOKEN_KEY);
    setAuthFeedback(message, type || "");
    requestAccessButton.hidden = true;
    signInButton.hidden = false;
  }

  function usernameLabel(user) {
    if (!user) return "your Telegram account";
    return user.username ? "@" + user.username.replace(/^@/, "") : (user.display_name || "your Telegram account");
  }

  function setIdentity(user) {
    if (!user) {
      identityChip.hidden = true;
      identityText.textContent = "";
      return;
    }
    identityChip.hidden = false;
    identityText.textContent = usernameLabel(user);
  }

  async function callFunction(action, payload, tokenOverride) {
    const config = getConfig();
    if (!config.supabaseUrl || !config.publishableKey) throw new Error("Supabase is not configured.");
    const token = tokenOverride || sessionStorage.getItem(TOKEN_KEY);
    const body = Object.assign({}, payload || {});
    body.endpoint_action = action;
    if (action !== "exchange-code" && token) body.id_token = token;
    const response = await fetch(config.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/telegram-auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.publishableKey
      },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch (_error) {}
    if (!response.ok || data.success === false) {
      throw new Error(data.message || data.error || ("Secure service returned HTTP " + response.status));
    }
    return data;
  }

  async function startTelegramLogin() {
    const config = getConfig();
    if (!config.telegramClientId || !config.telegramRedirectUri) {
      setAuthFeedback("Telegram Login is not configured yet. Follow the setup guide in the repository README.", "error");
      return;
    }
    if (!window.crypto || !crypto.subtle) {
      setAuthFeedback("Secure Telegram sign-in requires HTTPS. Open https://turlx.com and try again.", "error");
      return;
    }
    signInButton.disabled = true;
    setAuthFeedback("Preparing secure Telegram sign-in…", "");
    try {
      const state = randomBase64Url(32);
      const nonce = randomBase64Url(32);
      const verifier = randomBase64Url(48);
      const challenge = await sha256Base64Url(verifier);
      sessionStorage.setItem(STATE_KEY, state);
      sessionStorage.setItem(NONCE_KEY, nonce);
      sessionStorage.setItem(VERIFIER_KEY, verifier);

      const url = new URL("https://oauth.telegram.org/auth");
      url.searchParams.set("client_id", config.telegramClientId);
      url.searchParams.set("redirect_uri", config.telegramRedirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid profile");
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      window.location.assign(url.toString());
    } catch (error) {
      setAuthFeedback(error.message || "Unable to start Telegram sign-in.", "error");
      signInButton.disabled = false;
    }
  }

  function safeText(value) {
    return String(value == null ? "" : value);
  }

  function createListItem(title, meta, buttonText, action, dangerous) {
    const row = document.createElement("div");
    row.className = "access-list-item";
    const copy = document.createElement("div");
    copy.className = "access-item-copy";
    const titleEl = document.createElement("div");
    titleEl.className = "access-item-email";
    titleEl.textContent = safeText(title);
    const metaEl = document.createElement("div");
    metaEl.className = "access-item-meta";
    metaEl.textContent = safeText(meta);
    copy.append(titleEl, metaEl);
    row.appendChild(copy);
    if (buttonText) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = dangerous ? "danger-small-button" : "secondary-button";
      button.textContent = buttonText;
      button.addEventListener("click", action);
      row.appendChild(button);
    }
    return row;
  }

  async function adminAction(action, telegramId) {
    return await callFunction("admin-manage-access", { action: action, telegram_id: telegramId });
  }

  async function refreshAdminLists() {
    if (!currentAccess.isAdmin) return;
    adminRefreshButton.disabled = true;
    pendingRequestsList.replaceChildren();
    activeUsersList.replaceChildren();
    pendingRequestsList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "Loading requests…" }));
    activeUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "Loading accounts…" }));

    try {
      const data = await callFunction("admin-manage-access", { action: "list" });
      const requests = Array.isArray(data.requests) ? data.requests : [];
      const users = Array.isArray(data.users) ? data.users : [];
      pendingRequestsList.replaceChildren();
      activeUsersList.replaceChildren();
      pendingCount.textContent = String(requests.length);
      authorizedCount.textContent = String(users.filter(function (user) { return user.status === "active"; }).length);

      if (!requests.length) {
        pendingRequestsList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "No pending requests." }));
      }
      requests.forEach(function (request) {
        const username = request.username ? "@" + request.username.replace(/^@/, "") : (request.display_name || "Telegram user");
        pendingRequestsList.appendChild(createListItem(
          username,
          "Telegram ID " + request.telegram_id + " · Requested " + new Date(request.requested_at).toLocaleString(),
          "Approve",
          async function () {
            if (!window.confirm("Approve converter access for " + username + "?")) return;
            try {
              await adminAction("approve", request.telegram_id);
              setAdminFeedback("Approved " + username + ".", "success");
              await refreshAdminLists();
            } catch (error) { setAdminFeedback(error.message, "error"); }
          },
          false
        ));
        const rejectButton = pendingRequestsList.lastElementChild.querySelector("button");
        if (rejectButton) {
          rejectButton.insertAdjacentText("afterend", " ");
          const reject = document.createElement("button");
          reject.type = "button";
          reject.className = "danger-small-button";
          reject.textContent = "Reject";
          reject.addEventListener("click", async function () {
            if (!window.confirm("Reject the access request from " + username + "?")) return;
            try {
              await adminAction("reject", request.telegram_id);
              setAdminFeedback("Rejected " + username + ".", "success");
              await refreshAdminLists();
            } catch (error) { setAdminFeedback(error.message, "error"); }
          });
          pendingRequestsList.lastElementChild.appendChild(reject);
        }
      });

      if (!users.length) {
        activeUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "No authorized accounts yet." }));
      }
      users.forEach(function (user) {
        const username = user.username ? "@" + user.username.replace(/^@/, "") : (user.display_name || "Telegram user");
        const active = user.status === "active";
        const isSelf = currentUser && String(user.telegram_id) === String(currentUser.telegram_id);
        const canChange = !user.is_admin && !isSelf;
        activeUsersList.appendChild(createListItem(
          username,
          "Telegram ID " + user.telegram_id + " · " + (user.is_admin ? "Administrator" : (active ? "Authorized" : "Access revoked")),
          canChange ? (active ? "Revoke" : "Restore") : "",
          async function () {
            const action = active ? "revoke" : "restore";
            if (!window.confirm((active ? "Revoke" : "Restore") + " converter access for " + username + "?")) return;
            try {
              await adminAction(action, user.telegram_id);
              setAdminFeedback((active ? "Revoked access for " : "Restored access for ") + username + ".", "success");
              await refreshAdminLists();
            } catch (error) { setAdminFeedback(error.message, "error"); }
          },
          active
        ));
      });
    } catch (error) {
      setAdminFeedback("Could not load access lists: " + error.message, "error");
    } finally {
      adminRefreshButton.disabled = false;
    }
  }

  async function setUserState() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      currentUser = null;
      currentAccess = { authorized: false, isAdmin: false };
      setIdentity(null);
      setGate("Sign in with Telegram to request access. The administrator will approve your verified account.", "");
      signOutButton.hidden = true;
      requestAccessButton.hidden = true;
      finishReady(currentAccess);
      return;
    }

    signOutButton.hidden = false;
    setGate("Verifying your Telegram session…", "");
    try {
      const data = await callFunction("access-state", {});
      currentUser = data.user || null;
      setIdentity(currentUser);
      currentAccess = {
        authorized: data.state === "active" || data.state === "admin",
        isAdmin: data.state === "admin" || !!(data.user && data.user.is_admin),
        telegramId: data.user && data.user.telegram_id
      };

      if (data.state === "active" || data.state === "admin") {
        authGate.hidden = true;
        setupNotice.hidden = true;
        appShell.hidden = false;
        signOutButton.hidden = false;
        adminPanel.hidden = !currentAccess.isAdmin;
        if (currentAccess.isAdmin) await refreshAdminLists();
      } else {
        appShell.hidden = true;
        authGate.hidden = false;
        setupNotice.hidden = true;
        signInButton.hidden = false;
        requestAccessButton.hidden = !(data.state === "needs_request" || data.state === "rejected");
        if (data.state === "pending") {
          setAuthFeedback("Your request is pending. The administrator will review " + usernameLabel(currentUser) + ".", "");
        } else if (data.state === "revoked") {
          setAuthFeedback("Access for " + usernameLabel(currentUser) + " has been revoked. Contact the administrator if you think this is a mistake.", "error");
        } else if (data.state === "rejected") {
          setAuthFeedback("Your previous request was declined. You may submit another request if needed.", "error");
        } else {
          setAuthFeedback("Signed in as " + usernameLabel(currentUser) + ". Request approval to enable the converter.", "");
        }
      }
      finishReady(currentAccess);
    } catch (error) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem("gtrim_telegram_exp");
      currentUser = null;
      currentAccess = { authorized: false, isAdmin: false };
      setIdentity(null);
      setGate("Could not verify your Telegram session: " + error.message + " Sign in again after checking the setup.", "error");
      signOutButton.hidden = true;
      finishReady(currentAccess);
    }
  }

  async function initialize() {
    const config = getConfig();
    if (!config.supabaseUrl || !config.publishableKey || !config.telegramClientId || !config.telegramRedirectUri) {
      setupNotice.hidden = false;
      authGate.hidden = true;
      appShell.hidden = true;
      signOutButton.hidden = true;
      finishReady({ authorized: false, isAdmin: false });
      return;
    }

    signInButton.addEventListener("click", startTelegramLogin);
    requestAccessButton.addEventListener("click", async function () {
      requestAccessButton.disabled = true;
      requestAccessButton.textContent = "Submitting…";
      try {
        await callFunction("request-access", {});
        await setUserState();
      } catch (error) {
        setAuthFeedback(error.message, "error");
      } finally {
        requestAccessButton.disabled = false;
        requestAccessButton.textContent = "Request converter access";
      }
    });
    signOutButton.addEventListener("click", function () {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem("gtrim_telegram_exp");
      currentUser = null;
      currentAccess = { authorized: false, isAdmin: false };
      setIdentity(null);
      adminPanel.hidden = true;
      setUserState();
    });
    adminRefreshButton.addEventListener("click", refreshAdminLists);
    await setUserState();
  }

  window.GTrimAuth = {
    convertShareUrl: async function (rawUrl) {
      if (!currentAccess.authorized) throw new Error("Your Telegram account is not authorized to convert links.");
      return await callFunction("convert-share-url", { raw_url: rawUrl });
    },
    refreshAccess: setUserState,
    callFunction: callFunction,
    get currentAccess() { return currentAccess; }
  };

  initialize().catch(function (error) {
    setupNotice.hidden = false;
    authGate.hidden = true;
    appShell.hidden = true;
    const message = document.createElement("p");
    message.textContent = "Authentication initialization failed: " + (error.message || "unknown error");
    setupNotice.appendChild(message);
    finishReady({ authorized: false, isAdmin: false });
  });
})();
