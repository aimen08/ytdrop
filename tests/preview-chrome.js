// Browser-only sample data. Never included by the extension itself.
(() => {
  const prefix='ytdrop-preview-', read=(area,key,fallback)=>JSON.parse(area.getItem(prefix+key)||JSON.stringify(fallback));
  const write=(area,key,value)=>area.setItem(prefix+key,JSON.stringify(value));
  const storage=area=>({get:async keys=>{const all=read(area,'prefs',{});return Object.fromEntries(keys.map(k=>[k,all[k]]));},set:async values=>write(area,'prefs',{...read(area,'prefs',{}),...values})});
  const tab={url:'https://www.youtube.com/watch?v=BaW_jenozKc',title:'A slower morning — a little film about everyday life - YouTube'};
  const ready={ready:true,version:'2026.8.19',folder:'C:\\Users\\You\\Downloads\\YT Drop'};
  const sample={id:'sample-1',url:'https://youtu.be/jNQXAC9IVRw',title:'A weekend in the mountains',mode:'video',quality:'2160',downloadSpeed:'standard',status:'complete',filename:'A weekend in the mountains.mkv'};
  let state=read(sessionStorage,'state',{helper:ready,job:null,history:[sample]}),listeners=[];
  const emit=()=>{write(sessionStorage,'state',state);listeners.forEach(fn=>fn({type:'state',state:structuredClone(state)}));};
  const transition=(status,extras={})=>{
    if(!state.job)return;
    state.job={...state.job,status,...extras};
    if(['complete','cancelled','error'].includes(status))state.history=[{...state.job},...state.history.filter(j=>j.id!==state.job.id)].slice(0,10);
    emit();
  };
  const panel=document.createElement('aside');panel.style.cssText='position:fixed;left:424px;top:24px;width:250px;font:13px/1.5 Segoe UI,sans-serif;color:#dae4d4;padding:20px;background:#252d22;border-radius:12px';
  const heading=document.createElement('h2');heading.textContent='UI preview';panel.append(heading);
  const note=document.createElement('p');note.textContent='Sample data · no downloads. These controls are not part of the extension.';note.style.margin='10px 0 16px';panel.append(note);
  const log=document.createElement('pre');log.id='previewRequest';log.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;margin-top:18px';
  const actions={
    'Reset preview':()=>{for(const area of [localStorage,sessionStorage])for(const key of Object.keys(area))if(key.startsWith(prefix))area.removeItem(key);location.reload();},
    'No YouTube tab':()=>{tab.url='https://example.com/';tab.title='Example';},
    'Disconnect helper':()=>{state.helper={ready:false,message:'Specified native messaging host not found. Install the local helper, then retry.'};emit();},
    'Simulate progress':()=>transition('downloading',{title:tab.title.replace(' - YouTube',''),percent:42,speed:'8.4 MB/s',eta:'72s left'}),
    'Simulate finishing':()=>transition('processing',{percent:100}),
    'Simulate complete':()=>transition('complete',{filename:'C:\\Users\\You\\Downloads\\YT Drop\\A slower morning.mkv',percent:100}),
    'Simulate failure':()=>transition('error',{error:'ERROR: This video is unavailable. Try a different video link.'})
  };
  for(const [label,action] of Object.entries(actions)){const b=document.createElement('button');b.textContent=label;b.style.cssText='display:block;padding:8px 10px;margin:6px 0;background:#3d4b34;border-radius:6px;width:100%;text-align:left';b.onclick=action;panel.append(b);}
  panel.append(log);document.body.append(panel);
  globalThis.chrome={
    storage:{local:storage(localStorage),session:storage(sessionStorage)},tabs:{query:async()=>[{...tab}]},
    runtime:{getManifest:()=>({version:'1.2.0'}),onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async message=>{
      if(message.type!=='getState')log.textContent=JSON.stringify(message,null,2);
      if(message.type==='download'){
        if(state.job && !['complete','cancelled','error'].includes(state.job.status))return {ok:false,error:'A download is already running.'};
        if(!state.helper.ready)return {ok:false,error:'Connect the local helper first.'};
        state.job={...message,id:crypto.randomUUID(),downloadSpeed:message.speed,title:'Getting video details…',status:'starting',percent:0};emit();
      }
      if(message.type==='cancel')setTimeout(()=>transition('cancelled'),350);
      if(message.type==='retry'){state.helper=ready;emit();}
      return {ok:true,state:structuredClone(state)};
    }}
  };
})();
