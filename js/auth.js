(function () {
  "use strict";

  const setupNotice = document.getElementById("setupNotice");
  const authGate = document.getElementById("authGate");
  const appShell = document.getElementById("appShell");
  const signInButton = document.getElementById("googleSignInButton");
  const signOutButton = document.getElementById("signOutButton");
  const inviteDetails = document.getElementById("inviteDetails");
  const inviteEmailText = document.getElementById("inviteEmail");
  const inviteExpiryText = document.getElementById("inviteExpiry");
  const authFeedback = document.getElementById("authFeedback");
  const adminPanel = document.getElementById("adminPanel");
  const adminInviteForm = document.getElementById("adminInviteForm");
  const inviteEmailInput = document.getElementById("inviteEmailInput");
  const inviteExpiryInput = document.getElementById("inviteExpiryInput");
  const createInviteButton = document.getElementById("createInviteButton");
  const adminFeedback = document.getElementById("adminFeedback");
  const inviteResult = document.getElementById("inviteResult");
  const inviteUrlOutput = document.getElementById("inviteUrlOutput");
  const copyInviteButton = document.getElementById("copyInviteButton");
  const adminRefreshButton = document.getElementById("adminRefreshButton");
  const authorizedUsersList = document.getElementById("authorizedUsersList");
  const invitationsList = document.getElementById("invitationsList");
  const authorizedCount = document.getElementById("authorizedCount");
  const invitationCount = document.getElementById("invitationCount");

  let client = null;
  let currentInviteToken = new URL(window.location.href).searchParams.get("invite");
  let currentInvite = null;
  let currentUser = null;
  let currentAccess = { authorized: false, isAdmin: false };
  let resolving = false;
  let lastStateKey = "";
  let readyResolved = false;
  let resolveReady;
  window.GTrimAuthReady = new Promise(function (resolve) { resolveReady = resolve; });

  function finishReady(state) {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady(state);
  }

  function setAuthFeedback(message, type) {
    authFeedback.textContent = message || "";
    authFeedback.className = "auth-feedback" + (type ? " is-" + type : "");
  }

  function setAdminFeedback(message, type) {
    adminFeedback.textContent = message || "";
    adminFeedback.className = "admin-feedback" + (type ? " is-" + type : "");
  }

  function setGateVisible(message, type) {
    setupNotice.hidden = true;
    appShell.hidden = true;
    authGate.hidden = false;
    signOutButton.hidden = !currentUser;
    setAuthFeedback(message || "", type || "");
  }

  function setAppVisible(access) {
    setupNotice.hidden = true;
    authGate.hidden = true;
    appShell.hidden = false;
    signOutButton.hidden = false;
    adminPanel.hidden = !access.isAdmin;
    currentAccess = access;
  }

  async function readFunctionError(error) {
    if (error && error.context && typeof error.context.json === "function") {
      try {
        const payload = await error.context.json();
        if (payload && typeof payload.message === "string") return payload.message;
        if (payload && payload.error && typeof payload.error.message === "string") return payload.error.message;
      } catch (_error) {}
    }
    return error && error.message ? error.message : "The secure service could not complete the request.";
  }

  async function invoke(name, body) {
    if (!client) throw new Error("Authentication is not configured yet.");
    const { data, error } = await client.functions.invoke(name, { body: body || {} });
    if (error) throw new Error(await readFunctionError(error));
    if (data && data.success === false) throw new Error(data.message || "The request was denied.");
    return data;
  }

  function inviteRedirectUrl() {
    const target = new URL(window.location.href);
    target.hash = "";
    target.search = "";
    if (currentInviteToken) target.searchParams.set("invite", currentInviteToken);
    return target.toString();
  }

  async function signInWithGoogle() {
    if (!client) return;
    signInButton.disabled = true;
    setAuthFeedback(currentInvite ? "Opening Google sign-in for " + currentInvite.email + "…" : "Opening Google sign-in…", "");
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: inviteRedirectUrl(),
          queryParams: { prompt: "select_account" }
        }
      });
      if (error) throw error;
    } catch (error) {
      setAuthFeedback(error.message || "Unable to start Google sign-in.", "error");
      signInButton.disabled = false;
    }
  }

  function clearInviteFromAddress() {
    const target = new URL(window.location.href);
    target.searchParams.delete("invite");
    window.history.replaceState({}, document.title, target.pathname + target.search + target.hash);
  }

  async function checkInvite() {
    if (!currentInviteToken) return;
    if (!/^[a-f0-9]{64}$/i.test(currentInviteToken)) {
      throw new Error("This invitation link is malformed. Ask an administrator for a fresh link.");
    }
    currentInvite = await invoke("get-invite", { token: currentInviteToken });
    if (!currentInvite || !currentInvite.email) throw new Error("This invitation is invalid or expired.");
    inviteDetails.hidden = false;
    inviteEmailText.textContent = currentInvite.email;
    inviteExpiryText.textContent = "Expires " + new Date(currentInvite.expires_at).toLocaleString();
  }

  function safeText(value) {
    return String(value == null ? "" : value);
  }

  function createListItem(email, meta, actionLabel, action, dangerous) {
    const row = document.createElement("div");
    row.className = "access-list-item";
    const copy = document.createElement("div");
    copy.className = "access-item-copy";
    const emailEl = document.createElement("div");
    emailEl.className = "access-item-email";
    emailEl.textContent = safeText(email);
    const metaEl = document.createElement("div");
    metaEl.className = "access-item-meta";
    metaEl.textContent = safeText(meta);
    copy.append(emailEl, metaEl);
    row.appendChild(copy);
    if (actionLabel) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = dangerous ? "danger-small-button" : "secondary-button";
      button.textContent = actionLabel;
      button.addEventListener("click", action);
      row.appendChild(button);
    }
    return row;
  }

  async function refreshAdminLists() {
    if (!currentAccess.isAdmin) return;
    authorizedUsersList.replaceChildren();
    invitationsList.replaceChildren();
    authorizedUsersList.innerHTML = '<p class="list-empty">Loading accounts…</p>';
    invitationsList.innerHTML = '<p class="list-empty">Loading invitations…</p>';
    adminRefreshButton.disabled = true;
    try {
      const data = await invoke("admin-manage-access", { action: "list" });
      authorizedUsersList.replaceChildren();
      invitationsList.replaceChildren();
      const users = Array.isArray(data.users) ? data.users : [];
      const invites = Array.isArray(data.invites) ? data.invites : [];
      authorizedCount.textContent = String(users.filter(function (user) { return user.status === "active"; }).length);
      invitationCount.textContent = String(invites.filter(function (invite) { return invite.status === "pending" && new Date(invite.expires_at).getTime() > Date.now(); }).length);

      if (!users.length) {
        const empty = document.createElement("p");
        empty.className = "list-empty";
        empty.textContent = "No accounts yet.";
        authorizedUsersList.appendChild(empty);
      }
      users.forEach(function (user) {
        const isActive = user.status === "active";
        const meta = (isActive ? "Authorized" : "Access revoked") + " · " + (user.is_admin ? "Admin" : "User");
        const canRevoke = isActive && !user.is_admin && user.user_id !== (currentUser && currentUser.id);
        authorizedUsersList.appendChild(createListItem(
          user.email,
          meta,
          canRevoke ? "Revoke" : "",
          async function () {
            if (!window.confirm("Revoke converter access for " + user.email + "?")) return;
            try {
              await invoke("admin-manage-access", { action: "revoke-user", user_id: user.user_id });
              setAdminFeedback("Access revoked for " + user.email + ".", "success");
              await refreshAdminLists();
            } catch (error) {
              setAdminFeedback(error.message, "error");
            }
          },
          true
        ));
      });

      if (!invites.length) {
        const empty = document.createElement("p");
        empty.className = "list-empty";
        empty.textContent = "No invitations yet.";
        invitationsList.appendChild(empty);
      }
      invites.forEach(function (invite) {
        const expired = new Date(invite.expires_at).getTime() <= Date.now();
        const status = invite.status === "pending" && expired ? "Expired" : invite.status;
        const canCancel = invite.status === "pending" && !expired;
        invitationsList.appendChild(createListItem(
          invite.invited_email,
          status + " · Expires " + new Date(invite.expires_at).toLocaleString(),
          canCancel ? "Cancel" : "",
          async function () {
            try {
              await invoke("admin-manage-access", { action: "cancel-invite", invite_id: invite.id });
              setAdminFeedback("Invitation cancelled.", "success");
              await refreshAdminLists();
            } catch (error) {
              setAdminFeedback(error.message, "error");
            }
          },
          true
        ));
      });
    } catch (error) {
      setAdminFeedback("Could not load access lists: " + error.message, "error");
    } finally {
      adminRefreshButton.disabled = false;
    }
  }

  async function handleSession(session, force) {
    if (resolving) return;
    const user = session && session.user ? session.user : null;
    const key = (user ? user.id : "signed-out") + ":" + (currentInviteToken || "");
    if (!force && lastStateKey === key) return;
    resolving = true;
    currentUser = user;

    try {
      if (!user) {
        currentAccess = { authorized: false, isAdmin: false };
        if (currentInviteToken && !currentInvite) {
          setGateVisible("Checking invitation…", "");
        } else if (currentInvite) {
          setGateVisible("This invitation is for " + currentInvite.email + ". Continue with the same Google account.", "");
        } else {
          setGateVisible("An administrator-generated invitation is required for new accounts. The initial administrator must be configured in Supabase.", "");
        }
        signInButton.disabled = false;
        lastStateKey = key;
        finishReady(currentAccess);
        return;
      }

      let inviteRedeemError = "";
      if (currentInviteToken) {
        if (!currentInvite) {
          inviteRedeemError = "The invitation link is invalid or expired. Ask an administrator for a new invitation.";
        } else {
          try {
            const redeemed = await invoke("redeem-invite", { token: currentInviteToken });
            if (redeemed && redeemed.success) {
              currentInviteToken = null;
              currentInvite = null;
              clearInviteFromAddress();
              setAuthFeedback("Invitation accepted. Checking your account permissions…", "success");
            } else {
              throw new Error("Invitation could not be redeemed.");
            }
          } catch (error) {
            inviteRedeemError = error.message;
          }
        }
      }

      let access;
      try {
        access = await invoke("check-access", {});
      } catch (error) {
        currentAccess = { authorized: false, isAdmin: false };
        setGateVisible("Could not verify access with the server: " + error.message, "error");
        lastStateKey = key;
        finishReady(currentAccess);
        return;
      }

      currentAccess = { authorized: !!access.authorized, isAdmin: !!access.is_admin, email: user.email || "" };
      if (currentAccess.authorized) {
        setAppVisible(currentAccess);
        lastStateKey = (user ? user.id : "signed-out") + ":" + (currentInviteToken || "");
        if (currentAccess.isAdmin) await refreshAdminLists();
      } else {
        const msg = inviteRedeemError || ("Signed in as " + (user.email || "your Google account") + ", but this account is not authorized. Use the Google email that received an invitation.");
        setGateVisible(msg, "error");
        lastStateKey = key;
      }
      finishReady(currentAccess);
    } finally {
      resolving = false;
    }
  }

  async function initialize() {
    const config = window.GTRIMMER_SUPABASE_CONFIG || {};
    if (!window.supabase || !config.url || !config.publishableKey) {
      setupNotice.hidden = false;
      authGate.hidden = true;
      appShell.hidden = true;
      signOutButton.hidden = true;
      finishReady({ authorized: false, isAdmin: false });
      return;
    }

    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce"
      }
    });

    signInButton.addEventListener("click", signInWithGoogle);
    signOutButton.addEventListener("click", async function () {
      signOutButton.disabled = true;
      try {
        await client.auth.signOut();
        currentUser = null;
        lastStateKey = "";
        await handleSession(null, true);
      } catch (error) {
        setAuthFeedback("Sign-out failed: " + error.message, "error");
      } finally {
        signOutButton.disabled = false;
      }
    });

    adminInviteForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      setAdminFeedback("", "");
      createInviteButton.disabled = true;
      createInviteButton.textContent = "Creating…";
      inviteResult.hidden = true;
      try {
        const data = await invoke("create-invite", {
          email: inviteEmailInput.value.trim(),
          expires_in_hours: Number(inviteExpiryInput.value)
        });
        inviteUrlOutput.value = data.invite_url;
        inviteResult.hidden = false;
        inviteEmailInput.value = "";
        setAdminFeedback("Invitation created. Send the link only to the intended Google account.", "success");
        await refreshAdminLists();
      } catch (error) {
        setAdminFeedback(error.message, "error");
      } finally {
        createInviteButton.disabled = false;
        createInviteButton.innerHTML = 'Create invitation <span aria-hidden="true">↗</span>';
      }
    });

    copyInviteButton.addEventListener("click", async function () {
      const text = inviteUrlOutput.value;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          inviteUrlOutput.select();
          if (!document.execCommand("copy")) throw new Error("Copy blocked");
        }
        copyInviteButton.textContent = "Copied";
      } catch (_error) {
        inviteUrlOutput.focus();
        inviteUrlOutput.select();
        setAdminFeedback("Select the invitation URL and copy it manually.", "error");
      }
      window.setTimeout(function () { copyInviteButton.textContent = "Copy link"; }, 1500);
    });

    adminRefreshButton.addEventListener("click", refreshAdminLists);

    try {
      if (currentInviteToken) await checkInvite();
    } catch (error) {
      currentInvite = null;
      setGateVisible(error.message, "error");
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      setGateVisible("Could not restore your session. Please sign in again.", "error");
      finishReady({ authorized: false, isAdmin: false });
    } else {
      await handleSession(data.session || null, true);
    }

    client.auth.onAuthStateChange(function (_event, session) {
      window.setTimeout(function () { handleSession(session, false); }, 0);
    });
  }

  window.GTrimAuth = {
    convertShareUrl: async function (rawUrl) {
      return await invoke("convert-share-url", { raw_url: rawUrl });
    },
    refreshAccess: async function () {
      if (!client) return;
      const { data } = await client.auth.getSession();
      lastStateKey = "";
      await handleSession(data.session || null, true);
    },
    invokeAdmin: invoke,
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
