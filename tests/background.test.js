import test from 'node:test';
import assert from 'node:assert/strict';
let receiver;
let onMessage;
let onDisconnect;
let stored = {};
const posted = [];
const port = { postMessage: m => posted.push(m), onMessage: { addListener: fn => onMessage = fn }, onDisconnect: { addListener: fn => onDisconnect = fn } };
globalThis.chrome = {
  storage: { session: { get: async () => ({}), set: async value => { stored = structuredClone(value); } } },
  runtime: { id: 'extension-id', onMessage: { addListener: fn => receiver = fn }, connectNative: () => port, sendMessage: async () => {}, lastError: null },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} }
};
await import('../extension/background.js');
const request = msg => new Promise(resolve => receiver(msg, { id: 'extension-id' }, resolve));
test('native download lifecycle survives popup requests, rejects concurrent jobs, and records completion', async () => {
  let result = await request({ type: 'getState' });
  assert.equal(posted[0].type, 'hello');
  assert.equal(result.state.helper.ready, false);
  onMessage({ type: 'hello', ready: true, version: 'test', folder: 'Downloads' });
  result = await request({ type: 'download', url: 'https://youtu.be/BaW_jenozKc', mode: 'video', quality: '720' });
  assert.equal(result.ok, true);
  const id = result.state.job.id;
  assert.equal(posted.at(-1).url, 'https://www.youtube.com/watch?v=BaW_jenozKc');
  const duplicate = await request({ type: 'download' });
  assert.equal(duplicate.ok, false);
  onMessage({ type: 'job', id: 'unknown-job', status: 'complete' });
  assert.equal(stored.state.job.status, 'starting');
  onMessage({ type: 'job', id, status: 'downloading', percent: 42 });
  result = await request({ type: 'getState' });
  assert.equal(result.state.job.percent, 42);
  await request({ type: 'cancel' });
  assert.deepEqual(posted.at(-1), { type: 'cancel', id });
  onMessage({ type: 'job', id, status: 'complete', filename: 'test.mkv' });
  assert.equal(stored.state.history.length, 1);
  result = await request({ type: 'download', url: 'https://youtu.be/BaW_jenozKc', mode: 'audio', quality: 'best' });
  assert.equal(result.ok, true);
  chrome.runtime.lastError = { message: 'Host closed' };
  onDisconnect();
  assert.equal(stored.state.job.status, 'error');
  assert.equal(stored.state.helper.ready, false);
});
