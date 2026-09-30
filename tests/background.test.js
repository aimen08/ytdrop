import test from 'node:test';
import assert from 'node:assert/strict';
let sequence=0;
const A='https://youtu.be/BaW_jenozKc', B='https://youtu.be/jNQXAC9IVRw', C='https://youtu.be/ZGyA20qqHtg';
const video={mode:'video',quality:'720',speed:'fast'};

async function worker(saved={}) {
  let receiver,stored=structuredClone(saved),failClaim=false;
  const ports=[],posted=[];
  globalThis.chrome={
    storage:{session:{get:async()=>structuredClone(stored),set:async value=>{
      if(failClaim && value.state.job?.status==='starting'){failClaim=false;throw new Error('Storage unavailable');}
      stored=structuredClone(value);
    }}},
    runtime:{id:'test-extension',lastError:null,onMessage:{addListener:fn=>receiver=fn},sendMessage:async()=>{},connectNative:()=>{
      const p={postMessage:m=>posted.push(structuredClone(m)),onMessage:{addListener:fn=>p.emit=fn},onDisconnect:{addListener:fn=>p.disconnect=fn}};
      ports.push(p);return p;
    }},action:{setBadgeText(){},setBadgeBackgroundColor(){}}
  };
  await import(`../extension/background.js?test=${sequence++}`);
  const request=message=>new Promise(resolve=>receiver(message,{id:'test-extension'},resolve));
  const read=async()=> (await request({type:'getState'})).state;
  await read();
  const hello=async()=>{ports.at(-1).emit({type:'hello',ready:true,folder:'Downloads',version:'test'});return read();};
  await hello();
  return {request,read,hello,ports,posted,downloads:()=>posted.filter(m=>m.type==='download'),saved:()=>structuredClone(stored),failClaim:()=>{failClaim=true;},emit:async message=>{ports.at(-1).emit(message);return read();}};
}
const enqueue=(w,urls,options=video)=>w.request({type:'enqueue',urls,...options});

test('FIFO queue runs exactly one item, waits through processing, and advances after every terminal outcome',async()=>{
  const w=await worker();
  let r=await enqueue(w,[A,B,C]);
  assert.equal(r.added,3);assert.equal(w.downloads().length,1);assert.equal(r.state.queue.length,2);
  const first=r.state.job.id;
  let s=await w.emit({type:'job',id:first,status:'downloading',percent:42,speed:'8 MB/s'});
  assert.equal(s.job.downloadSpeed,'fast');assert.equal(s.job.percent,42);
  s=await w.emit({type:'job',id:first,status:'processing'});
  assert.equal(w.downloads().length,1);
  s=await w.emit({type:'job',id:first,status:'complete',filename:'test.mkv'});
  const second=s.job.id;assert.equal(w.downloads().length,2);assert.match(s.job.url,/jNQXAC9IVRw/);
  await w.emit({type:'job',id:first,status:'complete'});
  assert.equal(w.downloads().length,2);
  s=await w.emit({type:'job',id:second,status:'error',error:'Unavailable video'});
  assert.equal(w.downloads().length,3);assert.match(s.job.url,/ZGyA20qqHtg/);
  s=await w.emit({type:'job',id:s.job.id,status:'cancelled'});
  assert.equal(w.downloads().length,3);assert.equal(s.queue.length,0);
  assert.deepEqual(s.history.map(j=>j.status),['cancelled','error','complete']);
});
test('adding while active snapshots each item’s quality, format, and transfer mode',async()=>{
  const w=await worker();let r=await enqueue(w,[A]);const id=r.state.job.id;
  r=await enqueue(w,[B],{mode:'audio',quality:'best',speed:'standard'});
  assert.equal(w.downloads().length,1);assert.equal(r.state.queue[0].downloadSpeed,'standard');
  await w.emit({type:'job',id,status:'complete'});
  const next=w.downloads().at(-1);assert.equal(next.mode,'audio');assert.equal(next.quality,'best');assert.equal(next.speed,'standard');
});
test('canonical duplicates are skipped but different output settings remain allowed',async()=>{
  const w=await worker();let r=await enqueue(w,[A,'https://www.youtube.com/watch?v=BaW_jenozKc&t=2',A]);
  assert.equal(r.added,1);assert.equal(r.skipped,2);
  r=await enqueue(w,[A]);assert.equal(r.added,0);assert.equal(r.skipped,1);
  r=await enqueue(w,[A],{...video,mode:'audio'});assert.equal(r.added,1);
});
test('invalid batch or options adds nothing and the waiting queue is bounded',async()=>{
  const w=await worker();
  for(const input of [{urls:[A,'https://evil.test/']},{urls:[]},{urls:'bad'},{urls:[A],speed:'--exec=calc'}]){
    const r=await w.request({type:'enqueue',...video,...input});assert.equal(r.ok,false);assert.equal((await w.read()).queue.length,0);assert.equal(w.downloads().length,0);
  }
  const urls=Array.from({length:50},(_,i)=>`https://youtu.be/${String(i).padStart(11,'0')}`);
  await w.request({type:'pauseQueue',paused:true});
  let r=await enqueue(w,urls);assert.equal(r.added,50);
  r=await enqueue(w,[A]);assert.equal(r.ok,false);assert.equal((await w.read()).queue.length,50);
});
test('pause finishes the current item, resume starts one, and clear only removes waiting items',async()=>{
  const w=await worker();let r=await enqueue(w,[A,B,C]);
  await w.request({type:'pauseQueue',paused:true});
  let s=await w.emit({type:'job',id:r.state.job.id,status:'complete'});
  assert.equal(s.job.status,'complete');assert.equal(s.queue.length,2);assert.equal(w.downloads().length,1);
  r=await w.request({type:'pauseQueue',paused:false});assert.equal(w.downloads().length,2);
  const id=r.state.job.id;
  r=await w.request({type:'clearQueue'});assert.equal(r.state.queue.length,0);assert.equal(r.state.job.id,id);assert.equal(r.state.job.status,'starting');
  assert.equal(w.posted.filter(m=>m.type==='cancel').length,0);
});
test('remove waiting item and stale cancel cannot affect the wrong download',async()=>{
  const w=await worker();let r=await enqueue(w,[A,B,C]);const first=r.state.job.id;
  r=await w.request({type:'removeQueued',id:r.state.queue[0].id});assert.equal(r.state.queue.length,1);assert.match(r.state.queue[0].url,/ZGyA20qqHtg/);
  await w.request({type:'cancel',id:'stale'});assert.equal(w.posted.filter(m=>m.type==='cancel').length,0);
  await w.request({type:'cancel',id:first});assert.deepEqual(w.posted.at(-1),{type:'cancel',id:first});assert.equal(w.downloads().length,1);
  const s=await w.emit({type:'job',id:first,status:'cancelled'});assert.equal(w.downloads().length,2);
  await w.request({type:'cancel',id:first});assert.notEqual(w.posted.at(-1).type,'cancel');assert.notEqual(s.job.id,first);
});
test('disconnect pauses remaining items and reconnect requires explicit resume',async()=>{
  const w=await worker();await enqueue(w,[A,B,C]);
  chrome.runtime.lastError={message:'Host closed'};w.ports.at(-1).disconnect();
  let s=await w.read();assert.equal(s.job.status,'error');assert.equal(s.queuePaused,true);assert.equal(s.queue.length,2);
  assert.equal(s.history[0].status,'error');
  s=await w.hello();assert.equal(s.helper.ready,true);assert.equal(w.downloads().length,1);
  await w.request({type:'pauseQueue',paused:false});assert.equal(w.downloads().length,2);
});
test('worker recovery keeps waiting items and marks the interrupted active job only once',async()=>{
  const old=await worker();await enqueue(old,[A,B,C]);
  const restored=await worker(old.saved());const s=await restored.read();
  assert.equal(s.job.status,'error');assert.equal(s.queue.length,2);assert.equal(s.queuePaused,true);assert.equal(restored.downloads().length,0);
  await restored.request({type:'pauseQueue',paused:false});assert.equal(restored.downloads().length,1);assert.match(restored.downloads()[0].url,/jNQXAC9IVRw/);
});
test('concurrent popup submissions are serialized without parallel native downloads',async()=>{
  const w=await worker();const results=await Promise.all([enqueue(w,[A]),enqueue(w,[B]),enqueue(w,[C])]);
  assert.ok(results.every(r=>r.ok));assert.equal(w.downloads().length,1);assert.equal((await w.read()).queue.length,2);
});
test('failed storage claim pauses safely without launching or losing the waiting item',async()=>{
  const w=await worker();w.failClaim();const r=await enqueue(w,[A]);assert.equal(r.ok,false);
  assert.equal(r.state.queuePaused,true);assert.match(r.state.queueError,/Storage unavailable/);
  const s=await w.read();assert.equal(s.job,null);assert.equal(s.queue.length,1);assert.equal(s.queuePaused,true);assert.equal(w.downloads().length,0);
});
test('1.2 session state migrates and legacy single-link messages still work',async()=>{
  const w=await worker({state:{helper:{ready:true},job:null,history:[]}});
  const r=await w.request({type:'download',url:A,...video});assert.equal(r.ok,true);assert.equal(r.state.queue.length,0);assert.equal(w.downloads().length,1);
});
