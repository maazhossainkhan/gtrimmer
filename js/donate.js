(function () {
  "use strict";

  const dialog = document.getElementById("donateDialog");
  const openButton = document.getElementById("donateButton");
  const closeButton = document.getElementById("donateCloseButton");
  const doneButton = document.getElementById("donateDoneButton");
  const feedback = document.getElementById("donateCopyFeedback");
  if (!dialog || !openButton || !closeButton || !doneButton || !feedback) return;

  let feedbackTimer = null;
  function setFeedback(message) {
    feedback.textContent = message || "";
    if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
    feedbackTimer = message ? window.setTimeout(function () {
      feedback.textContent = "";
      feedbackTimer = null;
    }, 3500) : null;
  }
  function openDialog() {
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }
  function closeDialog() {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }
  async function copyText(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try { await navigator.clipboard.writeText(value); return true; } catch (_error) {}
    }
    const temporary = document.createElement("textarea");
    temporary.value = value;
    temporary.setAttribute("readonly", "");
    temporary.setAttribute("aria-hidden", "true");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    temporary.style.left = "-9999px";
    document.body.appendChild(temporary);
    temporary.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch (_error) {}
    temporary.remove();
    return copied;
  }

  openButton.addEventListener("click", openDialog);
  closeButton.addEventListener("click", closeDialog);
  doneButton.addEventListener("click", closeDialog);
  dialog.addEventListener("click", function (event) {
    if (event.target === dialog) closeDialog();
  });
  dialog.querySelectorAll("[data-copy-value]").forEach(function (button) {
    button.addEventListener("click", async function () {
      const value = button.getAttribute("data-copy-value") || "";
      const label = button.getAttribute("data-copy-label") || "Value";
      if (!value) return;
      const originalText = button.getAttribute("data-original-text") || button.textContent.trim();
      button.setAttribute("data-original-text", originalText);
      button.disabled = true;
      try {
        const copied = await copyText(value);
        if (!copied) throw new Error("Clipboard is unavailable");
        button.classList.add("is-copied");
        button.textContent = "✓ Copied";
        setFeedback(label + " copied to clipboard.");
      } catch (_error) {
        setFeedback("Unable to copy automatically. Select and copy the value above.");
      } finally {
        button.disabled = false;
        window.setTimeout(function () {
          button.classList.remove("is-copied");
          button.innerHTML = '<span aria-hidden="true">⧉</span> ' + originalText;
        }, 2200);
      }
    });
  });
})();