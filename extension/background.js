import { normalizeLinks, validateOptions, queueKey, QUEUE_LIMIT } from './queue.js';

const HOST = 'com.ytdrop.downloader';
const TERMINAL = new Set(['complete', 'error', 'cancelled']);
let port;
let state = {helper:{ready:false,message:'Connecting to local helper…'},job:null,history:[],queue:[],queuePaused:false};
const active = () => state.job && !TERMINAL.has(state.job.status);
const loaded = chrome.storage.session.get('state').then(saved => {
  if (saved.state) state = {...state,...saved.state};
  state.queue = Array.isArray(state.queue) ? state.queue : [];
  state.helper = {ready:false,message:'Connecting to local helper…'};
  if (active()) {
    state.job = {...state.job,status:'error',error:'Browser connection ended. Start again to resume partial files.'};
    recordJob();
    state.queuePaused = true;
  }
});

// Serialize popup requests and native events, including storage writes. A popup
// can close at any point without owning the queue or starting another transfer.
let operations = Promise.resolve();
function schedule(action) {
  const result = operations.then(() => loaded).then(action);
  operations = result.catch(() => {});
  return result;
}
function recordJob() {
  state.history = [state.job,...state.history.filter(j => j.id !== state.job.id)].slice(0,10);
}
function pauseAfterStorageError(error) {
  state.queuePaused = true;
  state.queueError = `Queue paused: ${error.message}. Try Resume queue.`;
  chrome.runtime.sendMessage({type:'state',state}).catch(() => {});
}
async function publish() {
  await chrome.storage.session.set({state:structuredClone(state)});
  chrome.runtime.sendMessage({type:'state',state}).catch(() => {});
  chrome.action.setBadgeText({text:state.queue.length ? String(state.queue.length) : active() ? '↓' : ''});
  chrome.action.setBadgeBackgroundColor({color:state.queuePaused ? '#d8bd7c' : '#c5f277'});
}
async function disconnected(reason) {
  port = undefined;
  state.helper = {ready:false,message:`${reason} Run install.ps1 if needed, then retry.`};
  state.queuePaused = true;
  if (active()) {
    state.job = {...state.job,status:'error',error:'Helper connection lost. Start again to resume partial files.'};
    recordJob();
  }
  await publish();
}
async function startNext() {
  if (active() || !state.queue.length || state.queuePaused || !port || !state.helper.ready) return;
  const previous = state.job;
  const next = state.queue.shift();
  state.job = {...next,status:'starting',percent:0,speed:next.downloadSpeed};
  try {
    // Commit the claim before sending it to the host. A worker restart turns a
    // claimed job into an interrupted job; it never launches a second copy.
    await publish();
  } catch (error) {
    state.job = previous;
    state.queue.unshift(next);
    pauseAfterStorageError(error);
    throw error;
  }
  try {port.postMessage({...state.job,type:'download'});}
  catch (error) {await disconnected(error.message);}
}
function connect() {
  if (port) return;
  state.helper = {ready:false,message:'Connecting to local helper…'};
  try {
    const connection = chrome.runtime.connectNative(HOST);
    port = connection;
    connection.onMessage.addListener(message => {
      schedule(async () => {
        if (port !== connection) return;
        if (message.type === 'hello') {
          state.helper = message;
          if (!message.ready && state.queue.length) state.queuePaused = true;
        } else if (message.type === 'job' && message.id === state.job?.id && active()) {
          state.job = {...state.job,...message};
          if (TERMINAL.has(message.status)) recordJob();
        } else return;
        await publish();
        await startNext();
      }).catch(pauseAfterStorageError);
    });
    connection.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message || 'Local helper disconnected.';
      schedule(async () => {if (port === connection) await disconnected(reason);}).catch(pauseAfterStorageError);
    });
    connection.postMessage({type:'hello'});
  } catch (error) {
    port = undefined;
    state.helper = {ready:false,message:error.message};
  }
}

chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (sender.id !== chrome.runtime.id || message.type === 'state') return false;
  schedule(async () => {
    let result = {};
    if (message.type === 'getState' || message.type === 'retry') {
      if (message.type === 'retry' && port) port.postMessage({type:'hello'});
      else connect();
      await publish();
    } else if (message.type === 'enqueue' || message.type === 'download') {
      if (!port || !state.helper.ready) throw new Error('Set up the local helper first.');
      const urls = normalizeLinks(message.type === 'download' ? [message.url] : message.urls);
      const options = validateOptions(message);
      const keys = new Set([...state.queue,...(active() ? [state.job] : [])].map(queueKey));
      const items = [];
      for (const url of urls) {
        const item = {id:crypto.randomUUID(),url,...options,downloadSpeed:options.speed,status:'queued',title:urls.length === 1 && typeof message.title === 'string' ? message.title.slice(0,500) : 'YouTube video'};
        const key = queueKey(item);
        if (!keys.has(key)) {items.push(item);keys.add(key);}
      }
      if (state.queue.length + items.length > QUEUE_LIMIT) throw new Error(`The queue holds ${QUEUE_LIMIT} waiting downloads. Remove some items or let them finish.`);
      state.queue.push(...items);
      result = {added:items.length,skipped:urls.length-items.length};
      await publish();
      await startNext();
    } else if (message.type === 'removeQueued') {
      state.queue = state.queue.filter(item => item.id !== message.id);
      await publish();
    } else if (message.type === 'clearQueue') {
      state.queue = [];
      await publish();
    } else if (message.type === 'pauseQueue') {
      if (typeof message.paused !== 'boolean') throw new Error('Invalid queue action.');
      state.queuePaused = message.paused;
      state.queueError = '';
      await publish();
      await startNext();
    } else if (message.type === 'cancel') {
      // A stale popup click must never cancel the next item that just started.
      if (active() && message.id === state.job.id) port?.postMessage({type:'cancel',id:state.job.id});
    } else if (message.type === 'openFolder') {
      port?.postMessage({type:'openFolder'});
    } else throw new Error('Unknown extension action.');
    return {ok:true,state:structuredClone(state),...result};
  }).then(respond,error => respond({ok:false,error:error.message,state:structuredClone(state)}));
  return true;
});
