import { sourceInfo, downloadOptions, optionLabel, etaLabel, describeJob, isActive } from './presentation.js';

const $ = id => document.getElementById(id);
let state = {helper:{ready:false,message:'Connecting to local helper…'},job:null,history:[]};
let currentTab = {}, dismissedJobId = '', helperExpanded = null, submitting = false, cancelling = false, initialized = false;
let historyKey = '', lastJobId = '', draftOrigin = 'tab';
const settings = () => ({mode:document.querySelector('input[name="mode"]:checked').value,quality:$('quality').value,speed:$('speed').value});

function showError(error) {$('error').textContent=error.message || String(error);$('error').hidden=false;}
function clearError() {$('error').hidden=true;}
async function send(message) {
  const result=await chrome.runtime.sendMessage(message);
  if(!result?.ok)throw new Error(result?.error || 'Couldn’t reach the extension. Close and reopen this panel.');
  if(result.state)render(result.state);
  return result;
}
function persistDraft() {
  return chrome.storage.session.set({draftUrl:$('url').value,draftOrigin}).catch(showError);
}
function updateSource(showInvalid=false) {
  const source=sourceInfo($('url').value,currentTab);
  $('clearUrl').hidden=!$('url').value;$('sourcePreview').hidden=!source.valid;$('urlHint').hidden=source.valid;
  if(source.valid){$('sourceTitle').textContent=source.title;$('sourceTitle').title=source.title;$('sourceMeta').textContent=source.meta;}
  $('urlError').hidden=!(showInvalid && !source.valid);
  $('urlError').textContent=source.empty ? 'Paste a video link, or choose Use this tab.' : source.error;
  $('url').setAttribute('aria-invalid',String(showInvalid && !source.valid));updateDownloadButton();return source;
}
function updateDownloadButton() {
  $('download').disabled=!initialized || !state.helper.ready || isActive(state.job) || submitting;
  $('downloadLabel').textContent=submitting ? 'Starting download…' : !state.helper.ready && initialized ? 'Connect helper to download' : `Download ${settings().mode === 'audio' ? 'MP3 audio' : 'video'}`;
  $('downloadHint').textContent=!state.helper.ready && initialized ? 'Use the connection badge above for setup and help.' : 'Saved locally. No account needed.';
  $('downloadHint').hidden=state.helper.ready;
}
function updateSettings(persist=false) {
  const o=settings(), audio=o.mode==='audio';
  $('quality').hidden=audio;$('quality').disabled=audio;$('audioQuality').hidden=!audio;
  $('qualityLabel').textContent=audio ? 'Audio quality' : 'Video quality';
  $('qualityHint').textContent=audio ? 'Extracts the best audio, then converts it to MP3.' : 'Uses the best quality within your limit.';
  $('speedSummary').textContent=o.speed==='fast' ? 'Fast mode' : 'Standard mode';
  $('speedHint').textContent=o.speed==='fast' ? 'Fetches up to 8 supported fragments at once. Try Standard if transfers stall.' : 'Fetches one fragment at a time. Useful on connections where Fast mode stalls.';
  updateDownloadButton();if(persist)chrome.storage.local.set(o).catch(showError);
}
function applySettings(value,persist=false) {
  const o=downloadOptions(value);document.querySelector(`input[name="mode"][value="${o.mode}"]`).checked=true;
  $('quality').value=o.quality;$('speed').value=o.speed;updateSettings(persist);
}
function renderHelper() {
  const h=state.helper,connecting=!h.ready && /connecting/i.test(h.message || '');
  const status=h.ready ? 'ready' : connecting ? 'connecting' : 'offline';
  $('connectionBadge').dataset.state=status;$('connection').textContent=h.ready ? 'Ready' : connecting ? 'Connecting' : 'Setup needed';
  $('connectionBadge').title=h.ready ? `Local helper connected · yt-dlp ${h.version || ''}` : h.message || 'Set up the local helper';
  $('helperPanel').hidden=!(helperExpanded ?? status==='offline');
  $('connectionBadge').setAttribute('aria-expanded',String(!$('helperPanel').hidden));$('helperPanel').dataset.ready=String(Boolean(h.ready));
  $('helperTitle').textContent=h.ready ? 'Connected to your computer' : connecting ? 'Connecting to your helper' : 'Let’s connect the local helper';
  $('helperMessage').textContent=h.ready ? `yt-dlp ${h.version || ''} is ready. Downloads go directly to your computer.` : h.message || 'Install the Windows helper, then retry the connection.';
  $('retry').hidden=Boolean(h.ready);$('retry').disabled=connecting;$('openFolder').disabled=!h.ready;
  $('folder').textContent=h.folder || 'Downloads / YT Drop';$('folder').title=h.folder || 'Downloads / YT Drop';
}
function renderHistory(jobVisible) {
  const history=(state.history || []).filter(j=>!jobVisible || j.id!==state.job?.id).slice(0,5);
  const key=JSON.stringify([history,isActive(state.job)]);
  $('historySection').hidden=!history.length;$('historyCount').textContent=String(history.length);
  if(key===historyKey)return;historyKey=key;
  $('history').replaceChildren(...history.map(item=>{
    const row=$('historyRow').content.firstElementChild.cloneNode(true),button=row.querySelector('button');
    const title=item.title && item.title!=='Getting video details…' ? item.title : sourceInfo(item.url || '',currentTab).title || 'YouTube video';button.dataset.status=item.status;
    button.title=`Use this link again: ${title}`;button.setAttribute('aria-label',button.title);
    row.querySelector('.history-icon use').setAttribute('href',item.mode==='audio' ? '#i-audio' : '#i-video');
    row.querySelector('strong').textContent=title;row.querySelector('small').textContent=optionLabel(item);
    row.querySelector('.history-state').textContent=({complete:'Saved',error:'Failed',cancelled:'Cancelled'})[item.status] || item.status;
    button.addEventListener('click',()=>{if(!isActive(state.job))showComposer(item);});button.disabled=isActive(state.job);return row;
  }));
}
function render(next) {
  state=next;renderHelper();updateDownloadButton();
  const job=state.job,visible=Boolean(job && (isActive(job) || job.id!==dismissedJobId));
  $('job').hidden=!visible;$('form').hidden=visible;
  if(visible){
    const view=describeJob(job);
    if(job.id!==lastJobId){$('jobErrorDetails').open=false;cancelling=false;lastJobId=job.id;}
    if(!view.active)cancelling=false;
    $('job').dataset.status=job.status;$('jobEyebrow').textContent=view.eyebrow;$('jobStatus').textContent=cancelling ? 'Stopping download…' : view.title;
    $('jobIcon').setAttribute('href',`#i-${view.icon}`);
    const selected=sourceInfo(job.url || '',currentTab);
    $('jobTitle').textContent=job.title && job.title!=='Getting video details…' ? job.title : selected.title || 'YouTube video';
    $('jobTitle').title=$('jobTitle').textContent;$('jobOptions').textContent=optionLabel(job);
    $('percent').textContent=job.status==='downloading' && view.percent!==null ? `${view.percent}%` : '';
    $('progressSection').hidden=!view.active;
    if(view.percent===null)$('progress').removeAttribute('value');else $('progress').value=view.percent;
    $('progress').setAttribute('aria-valuetext',view.percent===null ? view.title : `${view.percent}% of current stream`);
    ['stagePrepare','stageDownload','stageSave'].forEach((id,i)=>{const node=$(id);node.classList.toggle('done',view.stage>i);if(view.stage===i)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});
    $('transferStats').hidden=job.status!=='downloading';
    $('transferSpeed').textContent=job.speed && !['fast','standard'].includes(job.speed) ? job.speed : '—';$('eta').textContent=etaLabel(job.eta);
    $('jobDetail').textContent=cancelling ? 'Stopping the transfer and any conversion in progress…' : view.detail;
    $('filename').hidden=job.status!=='complete' || !view.filename;$('filename').textContent=view.filename;$('filename').title=job.filename || '';
    $('jobErrorDetails').hidden=!job.error;$('jobError').textContent=job.error || '';
    $('activeActions').hidden=!view.active;$('finishedActions').hidden=view.active;
    $('cancel').disabled=cancelling;$('cancel').textContent=cancelling ? 'Stopping…' : 'Cancel download';
    $('jobPrimaryLabel').textContent=job.status==='complete' ? 'Open download folder' : 'Try download again';
    $('jobPrimaryIcon').setAttribute('href',job.status==='complete' ? '#i-folder' : '#i-retry');$('jobPrimary').disabled=!state.helper.ready || submitting;
    $('another').textContent=job.status==='complete' ? 'Download another video →' : 'Edit link or options →';
  }
  renderHistory(visible);
}
function showComposer(item) {
  if(isActive(state.job))return;
  dismissedJobId=state.job?.id || '';chrome.storage.session.set({dismissedJobId}).catch(showError);
  $('url').value=item?.url || '';draftOrigin='manual';if(item)applySettings(item,true);
  clearError();$('historySection').open=false;updateSource();persistDraft();render(state);$('url').focus();
}
async function useCurrentTab(silent=false) {
  try {
    [currentTab={}]=await chrome.tabs.query({active:true,currentWindow:true});
    const source=sourceInfo(currentTab.url || '',currentTab);
    if(!source.valid)throw new Error('Open a YouTube video in this tab, or paste a video link.');
    $('url').value=source.url;draftOrigin='tab';clearError();updateSource();await persistDraft();
  } catch(error){if(!silent){showError(error);$('url').focus();}}
}
async function startDownload(url,options) {
  if(submitting || isActive(state.job))return;
  submitting=true;clearError();render(state);
  try {await chrome.storage.local.set(options);await send({type:'download',url,...options});$('jobStatus').focus();}
  catch(error){showError(error);}finally{submitting=false;render(state);}
}
$('form').addEventListener('submit',event=>{event.preventDefault();const source=updateSource(true);if(!source.valid){$('url').focus();return;}startDownload(source.url,settings());});
$('url').addEventListener('input',()=>{draftOrigin='manual';clearError();updateSource();persistDraft();});
$('url').addEventListener('blur',()=>{if($('url').value)updateSource(true);});
$('clearUrl').addEventListener('click',()=>{$('url').value='';draftOrigin='manual';updateSource();persistDraft();$('url').focus();});
$('current').addEventListener('click',()=>useCurrentTab());
document.querySelectorAll('input[name="mode"]').forEach(input=>input.addEventListener('change',()=>updateSettings(true)));
for(const id of ['quality','speed'])$(id).addEventListener('change',()=>updateSettings(true));
$('connectionBadge').addEventListener('click',()=>{helperExpanded=$('helperPanel').hidden;renderHelper();});
$('retry').addEventListener('click',async()=>{clearError();try{await send({type:'retry'});}catch(error){showError(error);}});
$('openFolder').addEventListener('click',()=>send({type:'openFolder'}).catch(showError));
$('cancel').addEventListener('click',async()=>{if(cancelling)return;cancelling=true;render(state);try{await send({type:'cancel'});}catch(error){cancelling=false;render(state);showError(error);}});
$('jobPrimary').addEventListener('click',()=>{const job=state.job;if(!job)return;if(job.status==='complete')send({type:'openFolder'}).catch(showError);else startDownload(job.url,downloadOptions(job));});
$('another').addEventListener('click',()=>showComposer(state.job?.status==='complete' ? undefined : state.job));
chrome.runtime.onMessage.addListener(message=>{if(message.type==='state')render(message.state);});
async function init() {
  const [saved,session,tabs]=await Promise.all([chrome.storage.local.get(['mode','quality','speed']),chrome.storage.session.get(['draftUrl','draftOrigin','dismissedJobId']),chrome.tabs.query({active:true,currentWindow:true})]);
  currentTab=tabs[0] || {};dismissedJobId=session.dismissedJobId || '';applySettings(saved);
  if(session.draftOrigin==='manual' && typeof session.draftUrl==='string'){$('url').value=session.draftUrl;draftOrigin='manual';}
  else {const source=sourceInfo(currentTab.url || '',currentTab);$('url').value=source.valid ? source.url : session.draftUrl || '';draftOrigin='tab';}
  document.querySelector('.help-link').title=`Setup and help · YT Drop ${chrome.runtime.getManifest().version}`;initialized=true;updateSource();await send({type:'getState'});
}
init().catch(error=>{initialized=true;state.helper={ready:false,message:'Extension setup could not be loaded. Close this panel and try again.'};render(state);showError(error);});
