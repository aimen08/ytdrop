import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceInfo, downloadOptions, optionLabel, etaLabel, describeJob, isActive} from '../extension/presentation.js';

test('current tab titles are only attributed to the same canonical video', () => {
  const tab={url:'https://www.youtube.com/shorts/BaW_jenozKc',title:'A title with — punctuation - YouTube'};
  assert.equal(sourceInfo('https://youtu.be/BaW_jenozKc?t=5',tab).title,'A title with — punctuation');
  assert.equal(sourceInfo('https://youtu.be/jNQXAC9IVRw',tab).title,'YouTube video');
  assert.equal(sourceInfo('https://youtu.be/BaW_jenozKc',{url:'chrome://newtab',title:'New tab'}).title,'YouTube video');
});
test('empty and invalid input produce distinct actionable validation', () => {
  assert.equal(sourceInfo('  ').empty,true);
  for (const url of ['hello','https://youtube.com/playlist?list=test','http://youtu.be/BaW_jenozKc','https://evil.test/watch?v=BaW_jenozKc']) {
    assert.equal(sourceInfo(url).valid,false);
    assert.match(sourceInfo(url).error,/HTTPS YouTube/);
  }
});
test('retries preserve transfer mode after measured speed overwrites the progress field', () => {
  assert.deepEqual(downloadOptions({mode:'audio',quality:'best',downloadSpeed:'standard',speed:'4.8 MB/s'}),{mode:'audio',quality:'best',speed:'standard'});
  assert.equal(downloadOptions({speed:'standard'}).speed,'standard');
  assert.deepEqual(downloadOptions({mode:'invalid',quality:'unknown',speed:'6 MB/s'}),{mode:'video',quality:'1080',speed:'fast'});
  assert.equal(optionLabel({mode:'audio',quality:'480'}),'MP3 audio · best available');
  assert.equal(optionLabel({quality:'2160'}),'Video + audio · up to 4K');
});
test('progress is bounded and processing never implies the file has been saved', () => {
  for (const [percent,expected] of [[0,0],[-5,0],[42.6,43],[101,100],[NaN,null],[Infinity,null],['42',null],[undefined,null]]) {
    assert.equal(describeJob({status:'downloading',percent}).percent,expected);
  }
  for(const status of ['starting','processing'])assert.equal(describeJob({status,percent:100}).percent,null);
  assert.equal(describeJob({status:'complete'}).percent,100);
  assert.equal(describeJob({status:'processing',mode:'audio'}).detail.includes('MP3'),true);
});
test('completion, cancellation, and failures all allow another download', () => {
  assert.equal(isActive(null),false);
  for(const status of ['starting','downloading','processing'])assert.equal(isActive({status}),true);
  for(const status of ['complete','error','cancelled'])assert.equal(isActive({status}),false);
  assert.equal(describeJob({status:'complete',filename:'C:\\Users\\Me\\Downloads\\Example.mkv'}).filename,'Example.mkv');
  assert.match(describeJob({status:'error',error:'Helper connection ended'}).detail,/Reconnect/);
});
test('ETA handles zero, seconds, minutes, hours, and missing estimates', () => {
  for(const [input,expected] of [['0s left','Almost done'],['9s left','9s'],['72s left','1m 12s'],['3605s left','1h 0m'],[undefined,'Calculating…'],['NA','Calculating…']])assert.equal(etaLabel(input),expected);
});
