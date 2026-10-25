(function () {
  "use strict";

  const form = document.getElementById("conversionForm");
  const input = document.getElementById("shareUrl");
  const resultBox = document.getElementById("resultBox");
  const resultOutput = document.getElementById("resultOutput");
  const errorMessage = document.getElementById("errorMessage");
  const convertButton = document.getElementById("convertButton");
  const copyButton = document.getElementById("copyButton");
  const copyButtonText = document.getElementById("copyButtonText");
  const copyFeedback = document.getElementById("copyFeedback");
  const resetButton = document.getElementById("resetButton");

  if (!form || !input || !resultBox || !resultOutput || !errorMessage || !convertButton || !copyButton || !copyButtonText || !copyFeedback || !resetButton) return;

  let lastConvertedUrl = "";
  let feedbackTimer = null;

  function clearFeedback() {
    if (feedbackTimer !== null) {
      window.clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
    copyButtonText.textContent = "Copy URL";
    copyFeedback.textContent = "";
    copyFeedback.style.color = "";
  }

  function showError(message) {
    errorMessage.textContent = message;
    resultBox.hidden = true;
    lastConvertedUrl = "";
    clearFeedback();
  }

  async function handleConvert(event) {
    event.preventDefault();
    errorMessage.textContent = "";
    copyFeedback.textContent = "";
    clearFeedback();
    convertButton.disabled = true;
    convertButton.querySelector("span").textContent = "Validating access…";

    try {
      const converted = await window.GTrimAuth.convertShareUrl(input.value);
      lastConvertedUrl = converted.url;
      resultOutput.textContent = converted.url;
      resultBox.hidden = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to convert this URL. Please try again.";
      showError(message);
      if (/access|authorized|sign in|session|jwt|token/i.test(message) && window.GTrimAuth) {
        await window.GTrimAuth.refreshAccess();
      }
    } finally {
      convertButton.disabled = false;
      convertButton.querySelector("span").textContent = "Convert share link";
    }
  }

  async function copyWithFallback(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_error) {
        // Clipboard permission may be blocked; try the legacy fallback below.
      }
    }
    const temporaryInput = document.createElement("textarea");
    temporaryInput.value = value;
    temporaryInput.setAttribute("readonly", "");
    temporaryInput.setAttribute("aria-hidden", "true");
    temporaryInput.style.position = "fixed";
    temporaryInput.style.opacity = "0";
    temporaryInput.style.left = "-9999px";
    document.body.appendChild(temporaryInput);
    temporaryInput.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch (_error) { copied = false; }
    temporaryInput.remove();
    return copied;
  }

  async function handleCopy() {
    if (!lastConvertedUrl) return;
    clearFeedback();
    copyButton.disabled = true;
    copyButtonText.textContent = "Copying…";
    try {
      if (!(await copyWithFallback(lastConvertedUrl))) throw new Error("Copy blocked");
      copyButtonText.textContent = "✓ Copied";
      copyFeedback.textContent = "URL copied to your clipboard.";
    } catch (_error) {
      copyButtonText.textContent = "Copy URL";
      copyFeedback.textContent = "The browser blocked copying. Select the URL above and copy it manually.";
      copyFeedback.style.color = "#ff9aaa";
    } finally {
      copyButton.disabled = false;
      feedbackTimer = window.setTimeout(function () {
        copyButtonText.textContent = "Copy URL";
        feedbackTimer = null;
      }, 1800);
    }
  }

  function handleReset() {
    input.value = "";
    errorMessage.textContent = "";
    resultOutput.textContent = "";
    resultBox.hidden = true;
    lastConvertedUrl = "";
    clearFeedback();
    input.focus();
  }

  window.GTrimAuthReady.then(function (state) {
    if (!state || !state.authorized) return;
    form.addEventListener("submit", handleConvert);
    copyButton.addEventListener("click", handleCopy);
    resetButton.addEventListener("click", handleReset);
    input.addEventListener("input", function () {
      if (errorMessage.textContent) errorMessage.textContent = "";
    });
  });
})();
