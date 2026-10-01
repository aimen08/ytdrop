import test from 'node:test';
import assert from 'node:assert/strict';
import {requestWorker,validateReply,WORKER_PROTOCOL} from '../extension/worker-client.js';

const message={type:'enqueue',urls:['https://youtu.be/BaW_jenozKc']};
const reply=extra=>({ok:true,protocol:WORKER_PROTOCOL,state:{helper:{ready:true},queue:[],job:null},...extra});

test('old worker success response is rejected before sending any download',async()=>{
  const sent=[];
  await assert.rejects(requestWorker(message,async request=>{
    sent.push(request);
    // Version 1.2 returned this for both getState and unknown actions.
    return {ok:true,state:{helper:{ready:true},job:null,history:[]}};
  }),error=>error.code==='WORKER_UPDATE_REQUIRED' && /chrome:\/\/extensions/.test(error.message));
  assert.deepEqual(sent.map(m=>m.type),['getState']);
});

test('compatible worker receives one enqueue after a read-only handshake',async()=>{
  const sent=[];
  const result=await requestWorker(message,async request=>{
    sent.push(request);return reply(request.type==='enqueue' ? {added:1,skipped:0} : {});
  });
  assert.equal(result.added,1);
  assert.deepEqual(sent.map(m=>m.type),['getState','enqueue']);
  assert.ok(sent.every(m=>m.protocol===WORKER_PROTOCOL));
});

test('missing or invalid counts never become a successful queue acknowledgement',()=>{
  for(const counts of [{},{added:undefined,skipped:0},{added:'1',skipped:0},{added:-1,skipped:2},{added:0.5,skipped:0.5},{added:NaN,skipped:0},{added:1,skipped:1},{added:0,skipped:0}]) {
    assert.throws(()=>validateReply(reply(counts),message),{code:'WORKER_UPDATE_REQUIRED'});
  }
});

test('duplicate-only batches are valid with zero added and an exact skipped count',()=>{
  const result=reply({added:0,skipped:1});
  assert.equal(validateReply(result,message),result);
});

test('an unacknowledged enqueue is never automatically retried or sent as a legacy download',async()=>{
  const sent=[];
  await assert.rejects(requestWorker(message,async request=>{
    sent.push(request);return reply();
  }),{code:'WORKER_UPDATE_REQUIRED'});
  assert.deepEqual(sent.map(m=>m.type),['getState','enqueue']);
});

test('protocol mismatches and incomplete state request a reload',()=>{
  for(const result of [reply({protocol:999}),reply({state:null}),reply({state:{helper:{}}})]) {
    assert.throws(()=>validateReply(result,{type:'getState'}),{code:'WORKER_UPDATE_REQUIRED'});
  }
});

test('worker errors and disconnected transport keep their useful messages',async()=>{
  assert.throws(()=>validateReply({ok:false,error:'Set up the local helper first.'},message),/Set up the local helper first/);
  assert.throws(()=>validateReply(undefined,message),/Couldn’t reach/);
  await assert.rejects(requestWorker(message,async()=>{throw new Error('Connection closed');}),/Connection closed/);
});
