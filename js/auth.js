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
  let client = null;
  let currentUser = null;
  let currentAccess = { authorized: false, isAdmin: false };
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
  async function invokeServer(action, payload) {
    if (!client) throw new Error("Supabase Auth is not configured.");
    const body = Object.assign({ action: action }, payload || {});
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
    pendingRequestsList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "Loading requests…" }));
    activeUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "Loading accounts…" }));
    try {
      const data = await invokeServer("admin-manage-access", { admin_action: "list" });
      const requests = Array.isArray(data.requests) ? data.requests : [];
      const users = Array.isArray(data.users) ? data.users : [];
      pendingRequestsList.replaceChildren();
      activeUsersList.replaceChildren();
      pendingCount.textContent = String(requests.length);
      authorizedCount.textContent = String(users.filter(user => user.status === "active").length);
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
      if (!users.length) {
        activeUsersList.appendChild(Object.assign(document.createElement("p"), { className: "list-empty", textContent: "No authorized accounts yet." }));
      }
      users.forEach(function (user) {
        const username = user.username ? "@" + String(user.username).replace(/^@/, "") : (user.display_name || "Telegram user");
        const active = user.status === "active";
        const isSelf = currentUser && String(user.user_id) === String(currentUser.user_id);
        const canChange = !user.is_admin && !isSelf;
        const meta = (user.telegram_id ? "Telegram ID " + user.telegram_id + " · " : "") +
          "Supabase user " + user.user_id + " · " + (user.is_admin ? "Administrator" : (active ? "Authorized" : "Access revoked"));
        activeUsersList.appendChild(createListItem(username, meta, canChange ? (active ? "Revoke" : "Restore") : "", async function () {
          const action = active ? "revoke" : "restore";
          if (!window.confirm((active ? "Revoke" : "Restore") + " converter access for " + username + "?")) return;
          try {
            await adminAction(action, user.user_id);
            setAdminFeedback((active ? "Revoked access for " : "Restored access for ") + username + ".", "success");
            await refreshAdminLists();
          } catch (error) { setAdminFeedback(error.message, "error"); }
        }, active));
      });
    } catch (error) {
      setAdminFeedback("Could not load access lists: " + error.message, "error");
    } finally {
      adminRefreshButton.disabled = false;
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
    currentUser = user ? { user_id: user.id } : null;
    if (!user) {
      currentAccess = { authorized: false, isAdmin: false };
      setIdentity(null);
      adminPanel.hidden = true;
      setGate("Sign in with Telegram to request access. The administrator will approve your verified Telegram account.", "");
      signOutButton.hidden = true;
      finishReady(currentAccess);
      return;
    }
    setGate("Verifying your signed-in Telegram account…", "");
    signOutButton.hidden = false;
    try {
      const data = await invokeServer("access-state", {});
      if (sequence !== refreshSequence) return;
      currentUser = data.user || { user_id: user.id };
      currentUser.user_id = user.id;
      setIdentity(currentUser);
      currentAccess = {
        authorized: data.state === "active" || data.state === "admin",
        isAdmin: data.state === "admin" || !!(data.user && data.user.is_admin),
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
      currentAccess = { authorized: false, isAdmin: false };
      setIdentity(currentUser);
      setGate("Could not verify access with the server: " + error.message, "error");
      finishReady(currentAccess);
    }
  }
  async function initialize() {
    const config = getConfig();
    if (!window.supabase || !config.supabaseUrl || !config.publishableKey ||
        config.supabaseUrl.includes("YOUR_PROJECT_REF") || config.publishableKey.includes("YOUR_SUPABASE")) {
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
        currentAccess = { authorized: false, isAdmin: false };
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
