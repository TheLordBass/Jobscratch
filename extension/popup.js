/* global chrome */
"use strict";

const DEFAULT_APP_URL = "http://localhost:3000";
const sendButton = document.getElementById("send");
const statusEl = document.getElementById("status");
const appUrlInput = document.getElementById("appUrl");

function setStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "";
}

function normalizeAppUrl(value) {
  const url = new URL(value || DEFAULT_APP_URL);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an http(s) address");
  return url.origin;
}

chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL }, ({ appUrl }) => {
  appUrlInput.value = appUrl;
});

appUrlInput.addEventListener("change", () => {
  try {
    const appUrl = normalizeAppUrl(appUrlInput.value.trim());
    appUrlInput.value = appUrl;
    chrome.storage.sync.set({ appUrl });
    setStatus("Saved.", false);
  } catch (error) {
    setStatus(error.message, true);
  }
});

sendButton.addEventListener("click", async () => {
  sendButton.disabled = true;
  setStatus("Reading the page…", false);
  try {
    const appUrl = normalizeAppUrl(appUrlInput.value.trim());
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) throw new Error("Open a job page first.");
    // Both calls run in the extension's isolated world, so the second can see the function the first defines.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extractor.js"] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.jobscratchExtract(document, location.href),
    });
    if (!result || (!result.title && !result.description)) {
      throw new Error("Couldn't find a job here. Select the job description text and try again.");
    }
    await chrome.tabs.create({ url: `${appUrl}/import#job=${encodeURIComponent(JSON.stringify(result))}` });
    window.close();
  } catch (error) {
    setStatus(error.message || String(error), true);
    sendButton.disabled = false;
  }
});
