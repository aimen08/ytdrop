// Exercise the real popup AND service worker, with storage and native-port mocks.
// No network downloads or actual helper commands are performed by this harness.
const prefix='ytdrop-preview-';
const read=(area)=>JSON.parse(area.getItem(prefix+'prefs') || '{}');
const storage=area=>({
  get:async keys=>{const all=read(area);return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,all[k]]));},
  set:async value=>area.setItem(prefix+'prefs',JSON.stringify({...read(area),...value}))
});
const tab={url:'https://www.youtube.com/watch?v=BaW_jenozKc',title:'A slower morning — a little film about everyday life - YouTube'};
const listeners=[];
let port, nativeJob=null, offline=false;
const panel=document.createElement('aside');panel.style.cssText='position:fixed;left:424px;top:24px;width:260px;font:13px/1.5 Segoe UI,sans-serif;color:#dae4d4;padding:20px;background:#252d22;border-radius:12px';
const heading=document.createElement('h2');heading.textContent='Queue preview';panel.append(heading);
const note=document.createElement('p');note.textContent='Sample data · no downloads. Runs the real queue service worker with a simulated native helper.';note.style.margin='10px 0 16px';panel.append(note);
const log=document.createElement('pre');log.id='previewRequest';log.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px;margin-top:18px';
const transition=(status,extra={})=>{
  if(!nativeJob)return;
  const id=nativeJob.id;
  if(['complete','error','cancelled'].includes(status))nativeJob=null;
  port.emit({type:'job',id,status,...extra});
};
const actions={
  'Reset preview':()=>{localStorage.removeItem(prefix+'prefs');sessionStorage.removeItem(prefix+'prefs');location.reload();},
  'No YouTube tab':()=>{tab.url='https://example.com';tab.title='Example';},
  'Simulate progress':()=>transition('downloading',{percent:42,speed:'8.4 MB/s',eta:'72s left'}),
  'Simulate finishing':()=>transition('processing'),
  'Simulate complete':()=>transition('complete',{percent:100,filename:'C:\\Users\\You\\Downloads\\YT Drop\\Sample video.mkv'}),
  'Simulate failure':()=>transition('error',{error:'ERROR: This video is unavailable.'}),
  'Disconnect helper':()=>{offline=true;nativeJob=null;port?.disconnect();},
  'Reconnect helper':()=>{offline=false;port?.postMessage({type:'hello'});}
};
for(const [label,action] of Object.entries(actions)){const b=document.createElement('button');b.textContent=label;b.style.cssText='display:block;padding:8px 10px;margin:6px 0;background:#3d4b34;border-radius:6px;width:100%;text-align:left';b.onclick=action;panel.append(b);}
panel.append(log);document.body.append(panel);
globalThis.chrome={
  storage:{session:storage(sessionStorage),local:storage(localStorage)},tabs:{query:async()=>[{...tab}]},action:{setBadgeText(){},setBadgeBackgroundColor(){}},
  runtime:{id:'preview-extension',getManifest:()=>({version:'1.4.0'}),lastError:null,onMessage:{addListener:fn=>listeners.push(fn)},
    sendMessage:message=>new Promise(resolve=>{
      if(message.type==='state'){listeners.forEach(fn=>fn(structuredClone(message),{id:'preview-extension'},()=>{}));resolve();return;}
      let pending=false;
      for(const fn of listeners)if(fn(message,{id:'preview-extension'},resolve)===true)pending=true;
      if(!pending)resolve();
    }),
    connectNative:()=>{
      const connection={onMessage:{addListener:fn=>connection.emit=fn},onDisconnect:{addListener:fn=>connection.disconnect=fn},postMessage:message=>{
        if(message.type==='hello'){queueMicrotask(()=>connection.emit({type:'hello',ready:!offline,version:'2026.8.19',folder:'C:\\Users\\You\\Downloads\\YT Drop',message:offline?'Helper disconnected. Retry connection.':undefined}));return;}
        log.textContent=JSON.stringify(message,null,2);
        if(message.type==='download'){
          if(nativeJob)throw new Error('Preview detected a concurrent native download');
          nativeJob=structuredClone(message);
        }
        if(message.type==='cancel')setTimeout(()=>{if(nativeJob?.id===message.id)transition('cancelled');},350);
      }};
      port=connection;return connection;
    }
  }
};
await import('/background.js');
await import('/popup.js');
