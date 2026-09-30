import { youtubeUrl } from './url.js';
export const terminal = new Set(['complete', 'error', 'cancelled']);
export const isActive = job => Boolean(job && !terminal.has(job.status));
const qualities = {480:'480p',720:'720p',1080:'1080p',2160:'4K',best:'Best available'};
export function sourceInfo(value, tab = {}) {
  if (!value.trim()) return {empty:true,valid:false,error:''};
  try {
    const url = youtubeUrl(value);
    let sameTab = false;
    try {sameTab = youtubeUrl(tab.url || '') === url;} catch {}
    const title = sameTab && tab.title ? tab.title.replace(/\s*[-–]\s*YouTube\s*$/i,'').trim() : 'YouTube video';
    return {valid:true,url,title:title || 'YouTube video',meta:sameTab ? 'From your current tab' : `youtube.com · ${new URL(url).searchParams.get('v')}`};
  } catch {return {valid:false,empty:false,error:'Use a full HTTPS YouTube video or Shorts link.'};}
}
export function downloadOptions(value = {}) {
  return {mode:value.mode === 'audio' ? 'audio' : 'video',quality:Object.hasOwn(qualities,value.quality) ? String(value.quality) : '1080',speed:['fast','standard'].includes(value.downloadSpeed) ? value.downloadSpeed : ['fast','standard'].includes(value.speed) ? value.speed : 'fast'};
}
export function optionLabel(value) {
  const o = downloadOptions(value);
  return o.mode === 'audio' ? 'MP3 audio · best available' : `Video + audio · ${o.quality === 'best' ? 'best available' : `up to ${qualities[o.quality]}`}`;
}
export function etaLabel(value) {
  const match = /^(\d+)s left$/.exec(value || '');
  if (!match) return 'Calculating…';
  const seconds = Number(match[1]);
  if (seconds === 0) return 'Almost done';
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}
export function describeJob(job) {
  const status = job.status;
  const numeric = typeof job.percent === 'number' && Number.isFinite(job.percent);
  const percent = status === 'complete' ? 100 : status === 'downloading' && numeric ? Math.round(Math.min(100,Math.max(0,job.percent))) : null;
  const labels = {
    starting:['ON ITS WAY','Preparing download','Getting the video details and finding the right format.',0,'download'],
    downloading:['ON ITS WAY','Downloading',job.mode === 'audio' ? 'Downloading the best available audio track.' : 'Video and audio can download separately. Progress is for the current stream.',1,'download'],
    processing:['THE FINAL STEP','Finishing your file',job.mode === 'audio' ? 'Converting the audio to MP3. Larger files can take a moment.' : 'Merging the tracks and saving your video. Almost there.',2,'download'],
    complete:['ALL YOURS','Saved to your device','Your file is ready in the download folder.',3,'check'],
    cancelled:['YOU’RE IN CONTROL','Download cancelled','Partial files are kept. Try again to resume where possible.',-1,'close'],
    error:['LET’S GET IT MOVING','Download interrupted',/connection|helper/i.test(job.error || '') ? 'The local helper connection ended. Reconnect it, then try again to resume.' : 'This video couldn’t be saved. Check the link, or open the details below.',-1,'alert']
  };
  const [eyebrow,title,detail,stage,icon] = labels[status] || labels.starting;
  return {eyebrow,title,detail,stage,icon,percent,active:isActive(job),filename:typeof job.filename === 'string' ? job.filename.split(/[\\/]/).pop() : ''};
}
