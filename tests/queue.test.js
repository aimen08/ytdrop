import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLinks,normalizeLinks,queueKey} from '../extension/queue.js';
test('batch input accepts newlines and whitespace and normalizes each video',()=>{
  assert.deepEqual(parseLinks(' https://youtu.be/BaW_jenozKc\n\nhttps://youtube.com/shorts/jNQXAC9IVRw '),['https://www.youtube.com/watch?v=BaW_jenozKc','https://www.youtube.com/watch?v=jNQXAC9IVRw']);
});
test('bad links identify their position and excessive batches are rejected',()=>{
  assert.throws(()=>parseLinks('https://youtu.be/BaW_jenozKc\nnope'),/Link 2/);
  assert.throws(()=>parseLinks('  '),/Paste a video link/);
  assert.throws(()=>normalizeLinks(Array(51).fill('https://youtu.be/BaW_jenozKc')),/50/);
});
test('duplicate audio ignores irrelevant video quality but preserves transfer preference',()=>{
  const job={url:'https://www.youtube.com/watch?v=BaW_jenozKc',mode:'audio',quality:'720',downloadSpeed:'fast'};
  assert.equal(queueKey(job),queueKey({...job,quality:'2160'}));
  assert.notEqual(queueKey(job),queueKey({...job,downloadSpeed:'standard'}));
});
