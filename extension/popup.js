import { youtubeUrl } from "./url.js";
const $ = id => document.getElementById(id);
let state;
const terminal = new Set(["complete", "error", "cancelled"]);
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || "Extension connection failed. Reopen the popup.");
  if (result.state) render(result.state);
  return result;
}
function showError(error) { $("error").textContent = error.message; $("error").hidden = false; }
function mode() { return document.querySelector('input[name="mode"]:checked').value; }
function updateMode() {
  $("quality").disabled = mode() === "audio";
  $("download").firstElementChild.textContent = `Download ${mode()}`;
}
function render(next) {
  state = next;
  const helper = state.helper;
  $("connection").textContent = helper.ready ? `Helper connected · yt-dlp ${helper.version}` : helper.message;
  $("dot").classList.toggle("ready", Boolean(helper.ready));
  $("retry").hidden = Boolean(helper.ready);
  $("openFolder").disabled = !helper.ready;
  $("folder").textContent = helper.folder || "Downloads / YT Drop";
  const job = state.job;
  const active = job && !terminal.has(job.status);
  $("download").disabled = !helper.ready || active;
  $("job").hidden = !job;
  if (job) {
    $("title").textContent = job.title || job.url;
    $("jobStatus").textContent = ({ starting: "PREPARING", downloading: "DOWNLOADING", processing: "FINISHING FILE", complete: "SAVED TO YOUR DEVICE", cancelled: "CANCELLED", error: "DOWNLOAD FAILED" })[job.status] || job.status;
    $("cancel").hidden = !active;
    $("progress").value = job.status === "complete" ? 100 : (job.percent || 0);
    $("percent").textContent = job.status === "downloading" ? `${Math.round(job.percent || 0)}%` : "";
    $("detail").textContent = job.status === "complete" ? "Download complete" : job.status === "processing" ? "Merging or converting…" : job.status === "starting" ? "Contacting YouTube…" : active ? [job.speed, job.eta].filter(Boolean).join(" · ") : "";
    $("jobError").hidden = !job.error;
    $("jobError").textContent = job.error || "";
    $("filename").hidden = job.status !== "complete" || !job.filename;
    $("filename").textContent = job.filename || "";
  }
  const history = (state.history || []).filter(j => j.id !== job?.id).slice(0, 3);
  $("historySection").hidden = !history.length;
  $("history").replaceChildren(...history.map(item => {
    const li = document.createElement("li");
    const title = document.createElement("span"); title.textContent = item.title || item.url;
    const status = document.createElement("span"); status.textContent = item.status === "complete" ? "SAVED" : item.status.toUpperCase();
    li.append(title, status); return li;
  }));
}
async function useCurrentTab(silent = false) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    $("url").value = youtubeUrl(tab?.url || "");
    $("error").hidden = true;
  } catch { if (!silent) showError(new Error("Open a YouTube video in this tab, or paste its link.")); }
}
$("form").addEventListener("submit", async event => {
  event.preventDefault(); $("error").hidden = true;
  try {
    const url = youtubeUrl($("url").value);
    await chrome.storage.local.set({ mode: mode(), quality: $("quality").value, speed: $("speed").value });
    await send({ type: "download", url, mode: mode(), quality: $("quality").value, speed: $("speed").value });
  } catch (error) { showError(error); }
});
$("current").addEventListener("click", () => useCurrentTab());
for (const [id, type] of [["cancel", "cancel"], ["retry", "retry"], ["openFolder", "openFolder"]]) {
  $(id).addEventListener("click", () => send({ type }).catch(showError));
}
document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener("change", updateMode));
chrome.runtime.onMessage.addListener(message => { if (message.type === "state") render(message.state); });
async function init() {
  const saved = await chrome.storage.local.get(["mode", "quality", "speed"]);
  if (["audio", "video"].includes(saved.mode)) document.querySelector(`input[value="${saved.mode}"]`).checked = true;
  if (["best", "2160", "1080", "720", "480"].includes(saved.quality)) $("quality").value = saved.quality;
  if (["fast", "standard"].includes(saved.speed)) $("speed").value = saved.speed;
  updateMode();
  await useCurrentTab(true);
  await send({ type: "getState" });
}
init().catch(showError);
