import { youtubeUrl } from "./url.js";

const HOST = "com.ytdrop.downloader";
const TERMINAL = new Set(["complete", "error", "cancelled"]);
let port;
let state = { helper: { ready: false, message: "Connecting to local helper…" }, job: null, history: [] };
const loaded = chrome.storage.session.get("state").then(saved => {
  if (saved.state) state = saved.state;
  state.helper = { ready: false, message: "Connecting to local helper…" };
  if (state.job && !TERMINAL.has(state.job.status)) {
    state.job = { ...state.job, status: "error", error: "Browser connection ended. Start again to resume partial files." };
  }
});

function publish() {
  chrome.storage.session.set({ state });
  chrome.runtime.sendMessage({ type: "state", state }).catch(() => {});
  const active = state.job && !TERMINAL.has(state.job.status);
  chrome.action.setBadgeText({ text: active ? "↓" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#c5f277" });
}

function connect() {
  if (port) return;
  state.helper = { ready: false, message: "Connecting to local helper…" };
  try {
    const connection = chrome.runtime.connectNative(HOST);
    port = connection;
    connection.onMessage.addListener(message => {
      if (message.type === "hello") state.helper = message;
      else if (message.type === "job" && message.id === state.job?.id) {
        state.job = { ...state.job, ...message };
        if (TERMINAL.has(message.status)) {
          state.history = [state.job, ...state.history.filter(j => j.id !== message.id)].slice(0, 10);
        }
      }
      publish();
    });
    connection.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || "Local helper disconnected.";
      if (port !== connection) return;
      port = undefined;
      state.helper = { ready: false, message: `${reason} Run install.ps1, then retry.` };
      if (state.job && !TERMINAL.has(state.job.status)) {
        state.job = { ...state.job, status: "error", error: "Helper connection lost. Start again to resume partial files." };
      }
      publish();
    });
    connection.postMessage({ type: "hello" });
  } catch (error) {
    port = undefined;
    state.helper = { ready: false, message: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.type === "state") return false;
  (async () => {
    await loaded;
    if (message.type === "getState" || message.type === "retry") {
      if (message.type === "retry" && port) port.postMessage({ type: "hello" });
      else connect();
    }
    else if (message.type === "download") {
      if (!port || !state.helper.ready) throw new Error("Set up the local helper first.");
      if (state.job && !TERMINAL.has(state.job.status)) throw new Error("Wait for the current download or cancel it.");
      const url = youtubeUrl(message.url);
      if (!["video", "audio"].includes(message.mode) || !["best", "2160", "1080", "720", "480"].includes(message.quality)) throw new Error("Invalid download options.");
      const speed = message.speed === undefined ? "fast" : message.speed;
      if (!["fast", "standard"].includes(speed)) throw new Error("Invalid download speed.");
      state.job = { id: crypto.randomUUID(), url, mode: message.mode, quality: message.quality, speed, status: "starting", title: "Getting video details…", percent: 0 };
      port.postMessage({ type: "download", ...state.job });
      publish();
    } else if (message.type === "cancel" && state.job && !TERMINAL.has(state.job.status)) {
      port?.postMessage({ type: "cancel", id: state.job.id });
    } else if (message.type === "openFolder") {
      port?.postMessage({ type: "openFolder" });
    }
    respond({ ok: true, state });
  })().catch(error => respond({ ok: false, error: error.message }));
  return true;
});
