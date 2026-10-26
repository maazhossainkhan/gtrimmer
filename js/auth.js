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
  const revokedUsersList = document.getElementById("revokedUsersList");
  const pendingCount = document.getElementById("pendingCount");
  const authorizedCount = document.getElementById("authorizedCount");
  const revokedCount = document.getElementById("revokedCount");
  const clearRevokedButton = document.getElementById("clearRevokedButton");
  const pendingAccessDropdown = document.getElementById("pendingAccessDropdown");
  const authorizedAccessDropdown = document.getElementById("authorizedAccessDropdown");
  const revokedAccessDropdown = document.getElementById("revokedAccessDropdown");
  let client = null;
  let currentUser = null;
  let currentAccess = { authorized: false, isAdmin: false, isMasterAdmin: false };
  let readyResolved = false;
  let resolveReady;
  let refreshSequence = 0;
  window.GTrimAuthReady = new Promise(function (resolve) { resolveReady = resolve; });

  function finishReady(state) {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady(state);
  }
  function getConfig() { return window.GTRIMMER_SUPABASE_CONFIG || {}; }
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
    signOutButton.hidden = !client || !currentUser;
    setAuthFeedback(message, type || "");
    requestAccessButton.hidden = true;
    signInButton.hidden = false;
    signInButton.disabled = false;
  }
  function usernameLabel(user) {
    if (!user) return "your Telegram account";
    if (user.username) return "@" + String(user.username).replace(/^@/, "");
    return user.display_name || "your Telegram account";
  }
  function setIdentity(user) {
    identityChip.hidden = !user;
    identityText.textContent = user ? usernameLabel(user) : "";
  }
  let miniAppMode = false;
  let miniInitData = "";

  async function invokeServer(action, payload) {
    const body = Object.assign({ action: action }, payload || {});
    if (miniAppMode) {
      const config = getConfig();
      const response = await fetch(config.supabaseUrl.replace(/\/$/, "") + "/functions/v1/telegram-mini-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.publishableKey,
          "Authorization": "Bearer " + config.publishableKey,
          "x-telegram-init-data": miniInitData
        },
        cache: "no-store",
        body: JSON.stringify(body)
      });
      let data = null;
      try { data = await response.json(); } catch (_error) {}
      if (!response.ok || !data || data.success === false) {
        throw new Error((data && data.message) || "The secure Mini App service could not complete the request.");
      }
      return data;
    }
    if (!client) throw new Error("Supabase Auth is not configured.");
    const { data, error } = await client.functions.invoke("telegram-auth", { body });
    if (error) {
      let message = error.message || "The secure service could not complete the request.";
      if (error.context && typeof error.context.json === "function") {
        try {
          const detail = await error.context.json();
          if (detail && typeof detail.message === "string") message = detail.message;
        } catch (_error) {}
      }
      throw new Error(message);
    }
    if (!data || data.success === false) throw new Error((data && data.message) || "The secure service denied the request.");
    return data;
  }
  async function signInWithTelegram() {
    if (!client) return;
    signInButton.disabled = true;
    setAuthFeedback("Redirecting to Telegram securely…", "");
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "custom:telegram",
        options: { redirectTo: window.location.origin + "/" }
      });
      if (error) throw error;
    } catch (error) {
      setAuthFeedback(error.message || "Unable to start Telegram sign-in.", "error");
      signInButton.disabled = false;
    }
  }
  function createListItem(title, meta, buttonText, action, dangerous) {
    const row = document.createElement("div");
    row.className = "access-list-item";
    const copy = document.createElement("div");
    copy.className = "access-item-copy";
    const titleEl = document.createElement("div");
    titleEl.className = "access-item-email";
    titleEl.textContent = String(title == null ? "" : title);
    const metaEl = document.createElement("div");
    metaEl.className = "access-item-meta";
    metaEl.textContent = String(meta == null ? "" : meta);
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
  async function adminAction(action, userId) {
    return await invokeServer("admin-manage-access", { admin_action: action, user_id: userId });
  }
  async function refreshAdminLists() {
    if (!currentAccess.isAdmin) return;
    adminRefreshButton.disabled = true;
    pendingRequestsList.replaceChildren();
    activeUsersList.replaceChildren();
    revokedUsersList.replaceChildren();
    pendingCount.textContent = "…";
    authorizedCount.textContent = "…";
    revokedCount.textContent = "…";
    pendingRequestsList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "Loading requests…" }));
    activeUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "Loading authorized accounts…" }));
    revokedUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "Loading revoked accounts…" }));
    try {
      const data = await invokeServer("admin-manage-access", { admin_action: "list" });
      const requests = Array.isArray(data.requests) ? data.requests : [];
      const users = Array.isArray(data.users) ? data.users : [];
      const isMasterAdmin = currentAccess.isMasterAdmin && data.role === "master";
      if (authorizedAccessDropdown) authorizedAccessDropdown.hidden = !isMasterAdmin;
      if (revokedAccessDropdown) revokedAccessDropdown.hidden = !isMasterAdmin;
      const revokedActions = clearRevokedButton ? clearRevokedButton.closest(".revoked-list-actions") : null;
      if (revokedActions) revokedActions.hidden = !isMasterAdmin;
      const panelEyebrow = adminPanel.querySelector(".eyebrow");
      const panelTitle = document.getElementById("adminTitle");
      if (panelEyebrow) panelEyebrow.textContent = isMasterAdmin ? "Master Admin" : "Admin";
      if (panelTitle) panelTitle.textContent = isMasterAdmin ? "Access management" : "Request review";
      const authorizedUsers = users.filter(user => user.status === "active");
      const revokedUsers = users.filter(user => user.status !== "active");

      pendingRequestsList.replaceChildren();
      activeUsersList.replaceChildren();
      revokedUsersList.replaceChildren();
      pendingCount.textContent = String(requests.length);
      authorizedCount.textContent = String(authorizedUsers.length);
      revokedCount.textContent = String(revokedUsers.length);
      if (clearRevokedButton) clearRevokedButton.disabled = revokedUsers.length === 0;

      // Keep pending work visible; keep long account lists collapsed unless the admin opens them.
      if (pendingAccessDropdown) pendingAccessDropdown.open = requests.length > 0;
      if (authorizedAccessDropdown && !authorizedAccessDropdown.dataset.userToggled) {
        authorizedAccessDropdown.open = false;
      }
      if (revokedAccessDropdown && !revokedAccessDropdown.dataset.userToggled) {
        revokedAccessDropdown.open = false;
      }

      if (!requests.length) {
        pendingRequestsList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "No pending requests." }));
      }
      requests.forEach(function (request) {
        const username = request.username ? "@" + String(request.username).replace(/^@/, "") : (request.display_name || "Telegram user");
        const meta = (request.telegram_id ? "Telegram ID " + request.telegram_id + " · " : "") +
          "Supabase user " + request.user_id + " · Requested " + new Date(request.requested_at).toLocaleString();
        const row = createListItem(username, meta, "Approve", async function () {
          if (!window.confirm("Approve converter access for " + username + "?")) return;
          try {
            await adminAction("approve", request.user_id);
            setAdminFeedback("Approved " + username + ".", "success");
            await refreshAdminLists();
          } catch (error) { setAdminFeedback(error.message, "error"); }
        }, false);
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "danger-small-button";
        reject.textContent = "Reject";
        reject.addEventListener("click", async function () {
          if (!window.confirm("Reject the access request from " + username + "?")) return;
          try {
            await adminAction("reject", request.user_id);
            setAdminFeedback("Rejected " + username + ".", "success");
            await refreshAdminLists();
          } catch (error) { setAdminFeedback(error.message, "error"); }
        });
        row.appendChild(reject);
        pendingRequestsList.appendChild(row);
      });

      if (!authorizedUsers.length) {
        activeUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "No authorized accounts." }));
      }
      authorizedUsers.forEach(function (user) {
        const username = user.username ? "@" + String(user.username).replace(/^@/, "") : (user.display_name || "Telegram user");
        const isSelf = currentUser && (String(user.user_id) === String(currentUser.user_id) ||
          (user.telegram_id && currentUser.telegram_id && String(user.telegram_id) === String(currentUser.telegram_id)));
        const canChange = !user.is_admin && !isSelf;
        const meta = (user.telegram_id ? "Telegram ID " + user.telegram_id + " · " : "") +
          "Supabase user " + user.user_id + " · " +
          (user.is_admin || user.is_moderator ? "Admin" : "Authorized");
        const row = createListItem(username, meta, canChange ? "Revoke" : "", async function () {
          if (!window.confirm("Revoke converter access for " + username + "?")) return;
          try {
            await adminAction("revoke", user.user_id);
            setAdminFeedback("Revoked access for " + username + ". Moved to Revoked accounts.", "success");
            await refreshAdminLists();
          } catch (error) { setAdminFeedback(error.message, "error"); }
        }, true);
        if (isMasterAdmin && canChange && user.telegram_id) {
          const roleButton = document.createElement("button");
          roleButton.type = "button";
          roleButton.className = user.is_moderator ? "danger-small-button" : "moderator-small-button";
          roleButton.textContent = user.is_moderator ? "Remove Admin access" : "Grant Admin access";
          roleButton.addEventListener("click", async function () {
            const action = user.is_moderator ? "revoke-moderator" : "grant-moderator";
            const prompt = user.is_moderator
              ? "Remove Admin access from " + username + "?"
              : "Grant review-only Admin access to " + username + "?";
            if (!window.confirm(prompt)) return;
            roleButton.disabled = true;
            try {
              await invokeServer("admin-manage-access", { admin_action: action, telegram_id: String(user.telegram_id) });
              setAdminFeedback(
                (user.is_moderator ? "Removed Admin access from " : "Granted Admin access to ") + username + ".",
                "success"
              );
              await refreshAdminLists();
            } catch (error) {
              setAdminFeedback(error.message, "error");
              roleButton.disabled = false;
            }
          });
          row.appendChild(roleButton);
        }
        activeUsersList.appendChild(row);
      });

      if (!revokedUsers.length) {
        revokedUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "No revoked accounts." }));
      }
      revokedUsers.forEach(function (user) {
        const username = user.username ? "@" + String(user.username).replace(/^@/, "") : (user.display_name || "Telegram user");
        const isSelf = currentUser && (String(user.user_id) === String(currentUser.user_id) ||
          (user.telegram_id && currentUser.telegram_id && String(user.telegram_id) === String(currentUser.telegram_id)));
        const canChange = !user.is_admin && !isSelf;
        const meta = (user.telegram_id ? "Telegram ID " + user.telegram_id + " · " : "") +
          "Supabase user " + user.user_id + " · Access revoked";
        revokedUsersList.appendChild(createListItem(username, meta, canChange ? "Restore" : "", async function () {
          if (!window.confirm("Restore converter access for " + username + "?")) return;
          try {
            await adminAction("restore", user.user_id);
            setAdminFeedback("Restored access for " + username + ". Moved to Authorized accounts.", "success");
            await refreshAdminLists();
          } catch (error) { setAdminFeedback(error.message, "error"); }
        }, false));
      });
    } catch (error) {
      pendingCount.textContent = "—";
      authorizedCount.textContent = currentAccess.isMasterAdmin ? "—" : "0";
      revokedCount.textContent = currentAccess.isMasterAdmin ? "—" : "0";
      setAdminFeedback("Could not load access lists: " + error.message, "error");
    } finally {
      adminRefreshButton.disabled = false;
      if (clearRevokedButton) clearRevokedButton.disabled = Number(revokedCount.textContent) === 0;
    }
  }

  async function clearRevokedAccounts() {
    if (!currentAccess.isAdmin || !clearRevokedButton) return;
    const count = Number(revokedCount.textContent) || 0;
    if (!count) return;
    const confirmed = window.confirm(
      "Permanently clear " + count + " revoked account entr" + (count === 1 ? "y" : "ies") +
      " from the access lists? Active accounts and pending requests will not be changed. Cleared accounts may need to request access again."
    );
    if (!confirmed) return;
    clearRevokedButton.disabled = true;
    try {
      const result = await invokeServer("admin-manage-access", { admin_action: "clear-revoked" });
      const skipped = Number(result.skipped_count) || 0;
      const message = (result.message || "Revoked account entries cleared.") +
        (skipped ? " " + skipped + " conflicting account(s) were kept for safety." : "");
      setAdminFeedback(message, skipped ? "error" : "success");
      if (revokedAccessDropdown) revokedAccessDropdown.open = true;
      await refreshAdminLists();
    } catch (error) {
      setAdminFeedback("Could not clear revoked accounts: " + error.message, "error");
      clearRevokedButton.disabled = Number(revokedCount.textContent) === 0;
    }
  }
  async function setUserState(session) {
    const sequence = ++refreshSequence;
    let currentSession = session;
    if (currentSession === undefined) {
      const result = await client.auth.getSession();
      currentSession = result.data.session;
      if (result.error) throw result.error;
    }
    const user = currentSession && currentSession.user ? currentSession.user : null;
    // Keep the existing authorized view stable during normal Supabase token/session refreshes.
    const wasAuthorizedView = !!(
      user &&
      !appShell.hidden &&
      currentAccess.authorized &&
      currentAccess.userId === user.id
    );
    if (!user) {
      currentUser = null;
    } else if (!currentUser || currentUser.user_id !== user.id) {
      currentUser = { user_id: user.id };
    }
    if (!user) {
      currentAccess = { authorized: false, isAdmin: false, isMasterAdmin: false };
      setIdentity(null);
      adminPanel.hidden = true;
      setGate("Sign in with Telegram to request access. The administrator will approve your verified Telegram account.", "");
      signOutButton.hidden = true;
      finishReady(currentAccess);
      return;
    }
    // Show the verification gate only on initial sign-in or when switching users.
    // A routine TOKEN_REFRESHED / auth-state event must not hide the live dashboard.
    if (!wasAuthorizedView) {
      setGate("Verifying your signed-in Telegram account…", "");
    }
    signOutButton.hidden = false;
    try {
      const data = await invokeServer("access-state", {});
      if (sequence !== refreshSequence) return;
      currentUser = data.user || { user_id: user.id };
      currentUser.user_id = user.id;
      setIdentity(currentUser);
      currentAccess = {
        authorized: data.state === "active" || data.state === "admin",
        // Only trust the server's explicit role for privileged UI; state flags alone must not reveal Admin tools.
        isAdmin: data.role === "master" || data.role === "moderator",
        isMasterAdmin: data.role === "master",
        userId: user.id
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
          setAuthFeedback("Access for " + usernameLabel(currentUser) + " has been revoked. Contact the administrator if this is a mistake.", "error");
        } else if (data.state === "rejected") {
          setAuthFeedback("Your previous request was declined. You may submit another request.", "error");
        } else {
          setAuthFeedback("Signed in as " + usernameLabel(currentUser) + ". Request approval to enable the converter.", "");
        }
      }
      finishReady(currentAccess);
    } catch (error) {
      if (sequence !== refreshSequence) return;
      // Preserve a previously authorized dashboard through temporary network/server errors.
      // The protected Edge Function still checks current authorization for every conversion.
      if (wasAuthorizedView) {
        if (currentAccess.isAdmin) {
          setAdminFeedback("Could not refresh access status: " + error.message, "error");
        }
        finishReady(currentAccess);
        return;
      }
      currentAccess = { authorized: false, isAdmin: false, isMasterAdmin: false };
      setIdentity(currentUser);
      setGate("Could not verify access with the server: " + error.message, "error");
      finishReady(currentAccess);
    }
  }
  if (authorizedAccessDropdown) {
    authorizedAccessDropdown.addEventListener("toggle", function () {
      authorizedAccessDropdown.dataset.userToggled = "true";
    });
  }
  if (pendingAccessDropdown) {
    pendingAccessDropdown.addEventListener("toggle", function () {
      pendingAccessDropdown.dataset.userToggled = "true";
    });
  }
  if (revokedAccessDropdown) {
    revokedAccessDropdown.addEventListener("toggle", function () {
      revokedAccessDropdown.dataset.userToggled = "true";
    });
  }
  if (clearRevokedButton) {
    clearRevokedButton.addEventListener("click", clearRevokedAccounts);
  }

  async function initializeMiniApp() {
    miniAppMode = true;
    const telegram = window.Telegram && window.Telegram.WebApp;
    miniInitData = telegram && typeof telegram.initData === "string" ? telegram.initData : "";
    signInButton.hidden = true;
    signOutButton.hidden = true;
    const authDescription = document.getElementById("authDescription");
    if (authDescription) authDescription.textContent = "Your Telegram identity is verified securely inside this Mini App. Request permission and wait for administrator approval before converting links.";
    setGate("Verifying your Telegram Mini App identity…", "");
    signInButton.hidden = true;
    requestAccessButton.hidden = true;
    if (!miniInitData) {
      setGate("Telegram did not provide signed login data. Close this window and reopen Google Trim using the button in @gtrimmerbot.", "error");
      signInButton.hidden = true;
      finishReady({ authorized: false, isAdmin: false });
      return;
    }

    requestAccessButton.addEventListener("click", async function () {
      requestAccessButton.disabled = true;
      requestAccessButton.textContent = "Submitting…";
      try {
        const result = await invokeServer("request-access", {});
        setAuthFeedback(result.message || "Access request submitted.", "success");
        await loadMiniAppState();
      } catch (error) {
        setAuthFeedback(error.message, "error");
      } finally {
        requestAccessButton.disabled = false;
        requestAccessButton.textContent = "Request converter access";
      }
    });
    adminRefreshButton.addEventListener("click", refreshAdminLists);
    await loadMiniAppState();
  }

  async function loadMiniAppState() {
    setGate("Verifying your Telegram Mini App identity…", "");
    signInButton.hidden = true;
    signOutButton.hidden = true;
    requestAccessButton.hidden = true;
    try {
      const data = await invokeServer("access-state", {});
      currentUser = data.user || null;
      setIdentity(currentUser);
      currentAccess = {
        authorized: data.state === "active" || data.state === "admin",
        // Only trust the server's explicit role for privileged UI; state flags alone must not reveal Admin tools.
        isAdmin: data.role === "master" || data.role === "moderator",
        isMasterAdmin: data.role === "master",
        userId: data.user && data.user.user_id
      };
      if (data.state === "active" || data.state === "admin") {
        setupNotice.hidden = true;
        authGate.hidden = true;
        appShell.hidden = false;
        adminPanel.hidden = !currentAccess.isAdmin;
        if (currentAccess.isAdmin) await refreshAdminLists();
      } else {
        setupNotice.hidden = true;
        appShell.hidden = true;
        authGate.hidden = false;
        signInButton.hidden = true;
        requestAccessButton.hidden = !(data.state === "needs_request" || data.state === "rejected");
        if (data.state === "pending") {
          setAuthFeedback("Your request is pending. The administrator will review " + usernameLabel(currentUser) + ".", "");
        } else if (data.state === "revoked") {
          setAuthFeedback("Access for " + usernameLabel(currentUser) + " has been revoked. Contact the administrator if this is a mistake.", "error");
        } else if (data.state === "rejected") {
          setAuthFeedback("Your previous request was declined. You may submit another request.", "error");
        } else {
          setAuthFeedback("Verified as " + usernameLabel(currentUser) + ". Request admin approval to enable the converter.", "");
        }
      }
      finishReady(currentAccess);
    } catch (error) {
      currentAccess = { authorized: false, isAdmin: false, isMasterAdmin: false };
      setGate(error.message || "Could not verify your Telegram identity.", "error");
      signInButton.hidden = true;
      requestAccessButton.hidden = true;
      finishReady(currentAccess);
    }
  }

  async function initialize() {
    const config = getConfig();
    if (!config.supabaseUrl || !config.publishableKey ||
        config.supabaseUrl.includes("YOUR_PROJECT_REF") || config.publishableKey.includes("YOUR_SUPABASE")) {
      setupNotice.hidden = false;
      authGate.hidden = true;
      appShell.hidden = true;
      signOutButton.hidden = true;
      finishReady({ authorized: false, isAdmin: false });
      return;
    }
    const telegramWebApp = window.Telegram && window.Telegram.WebApp;
    const telegramLaunch = !!(telegramWebApp && (
      (typeof telegramWebApp.initData === "string" && telegramWebApp.initData.length > 0) ||
      /Telegram/i.test(navigator.userAgent) ||
      /tgWebAppData|tgWebAppVersion|tgWebAppPlatform/.test(window.location.hash + "&" + window.location.search)
    ));
    if (telegramLaunch) {
      await initializeMiniApp();
      return;
    }
    if (!window.supabase) {
      setupNotice.hidden = false;
      authGate.hidden = true;
      appShell.hidden = true;
      signOutButton.hidden = true;
      finishReady({ authorized: false, isAdmin: false });
      return;
    }
    client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
    });
    signInButton.addEventListener("click", signInWithTelegram);

    requestAccessButton.addEventListener("click", async function () {
      requestAccessButton.disabled = true;
      requestAccessButton.textContent = "Submitting…";
      try {
        const result = await invokeServer("request-access", {});
        setAuthFeedback(result.message || "Access request submitted.", "success");
        await setUserState();
      } catch (error) {
        setAuthFeedback(error.message, "error");
      } finally {
        requestAccessButton.disabled = false;
        requestAccessButton.textContent = "Request converter access";
      }
    });
    signOutButton.addEventListener("click", async function () {
      signOutButton.disabled = true;
      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
        currentUser = null;
        currentAccess = { authorized: false, isAdmin: false, isMasterAdmin: false };
        adminPanel.hidden = true;
        await setUserState(null);
      } catch (error) {
        setAuthFeedback("Sign-out failed: " + error.message, "error");
      } finally {
        signOutButton.disabled = false;
      }
    });
    adminRefreshButton.addEventListener("click", refreshAdminLists);
    const { data, error } = await client.auth.getSession();
    if (error) {
      setGate("Could not restore your session. Please sign in with Telegram again.", "error");
      finishReady({ authorized: false, isAdmin: false });
    } else {
      await setUserState(data.session || null);
    }
    client.auth.onAuthStateChange(function (_event, session) {
      window.setTimeout(function () { setUserState(session); }, 0);
    });
  }

  window.GTrimAuth = {
    convertShareUrl: async function (rawUrl) {
      if (!currentAccess.authorized) throw new Error("Your Telegram account is not authorized to convert links.");
      return await invokeServer("convert-share-url", { raw_url: rawUrl });
    },
    refreshAccess: async function () { await setUserState(); },
    invokeServer: invokeServer,
    get client() { return client; }
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
