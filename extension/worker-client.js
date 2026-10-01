// Identify the running worker, not just the manifest on disk. An unpacked
// extension can load new popup files while an old worker is still alive.
export const WORKER_PROTOCOL = 1;
export const RELOAD_MESSAGE = 'YT Drop’s popup and background worker are out of sync. After active downloads finish, open chrome://extensions, find YT Drop, and click Reload. Then reopen this panel.';

function mismatch() {
  return Object.assign(new Error(RELOAD_MESSAGE), {code:'WORKER_UPDATE_REQUIRED'});
}

export function validateReply(result, message) {
  if (result?.ok !== true) throw new Error(result?.error || 'Couldn’t reach the extension. Close and reopen this panel.');
  if (result.protocol !== WORKER_PROTOCOL || !result.state?.helper || !Array.isArray(result.state.queue)) throw mismatch();
  if (message.type === 'enqueue') {
    const {added,skipped} = result;
    if (!Number.isSafeInteger(added) || added < 0 || !Number.isSafeInteger(skipped) || skipped < 0 || added + skipped !== message.urls.length) throw mismatch();
  }
  return result;
}

export async function requestWorker(message, transport) {
  // Check before mutation. Never retry with a different download command: a
  // missing acknowledgement does not prove that the first request did nothing.
  if (message.type === 'enqueue') {
    const check = {type:'getState',protocol:WORKER_PROTOCOL};
    validateReply(await transport(check), check);
  }
  const request = {...message,protocol:WORKER_PROTOCOL};
  return validateReply(await transport(request), request);
}
