(function () {
  "use strict";

  const form = document.getElementById("conversionForm");
  const input = document.getElementById("shareUrl");
  const resultBox = document.getElementById("resultBox");
  const resultOutput = document.getElementById("resultOutput");
  const errorMessage = document.getElementById("errorMessage");
  const copyButton = document.getElementById("copyButton");
  const copyButtonText = document.getElementById("copyButtonText");
  const copyFeedback = document.getElementById("copyFeedback");
  const resetButton = document.getElementById("resetButton");

  if (!form || !input || !resultBox || !resultOutput || !errorMessage || !copyButton || !copyButtonText || !copyFeedback || !resetButton || !window.GUrlConverter) {
    return;
  }

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

  function handleConvert(event) {
    if (event) event.preventDefault();
    errorMessage.textContent = "";
    clearFeedback();

    try {
      const converted = window.GUrlConverter.convertShareUrl(input.value);
      lastConvertedUrl = converted.url;
      resultOutput.textContent = converted.url;
      resultBox.hidden = false;
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to convert this URL. Please try again.");
      input.focus();
    }
  }

  async function copyWithFallback(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_error) {
        // Clipboard access can be blocked by browser permissions; use the legacy fallback.
      }
    }

    const temporaryInput = document.createElement("textarea");
    temporaryInput.value = value;
    temporaryInput.setAttribute("readonly", "");
    temporaryInput.setAttribute("aria-hidden", "true");
    temporaryInput.style.position = "fixed";
    temporaryInput.style.opacity = "0";
    temporaryInput.style.pointerEvents = "none";
    temporaryInput.style.left = "-9999px";
    document.body.appendChild(temporaryInput);
    temporaryInput.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    } finally {
      temporaryInput.remove();
    }
    return copied;
  }

  async function handleCopy() {
    if (!lastConvertedUrl) return;
    clearFeedback();
    copyButton.disabled = true;
    copyButtonText.textContent = "Copying…";

    try {
      const copied = await copyWithFallback(lastConvertedUrl);
      if (!copied) throw new Error("Clipboard permission was denied.");
      copyButtonText.textContent = "✓ Copied";
      copyFeedback.textContent = "URL copied to your clipboard.";
    } catch (_error) {
      copyButtonText.textContent = "Copy URL";
      copyFeedback.textContent = "Copy was blocked by the browser. Select the URL above and copy it manually.";
      copyFeedback.style.color = "#ff8799";
    } finally {
      copyButton.disabled = false;
      if (!copyFeedback.textContent.includes("blocked")) {
        copyFeedback.style.color = "";
      }
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

  form.addEventListener("submit", handleConvert);
  input.addEventListener("input", function () {
    if (errorMessage.textContent) errorMessage.textContent = "";
  });
  copyButton.addEventListener("click", handleCopy);
  resetButton.addEventListener("click", handleReset);
})();
