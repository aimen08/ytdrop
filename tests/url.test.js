import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeUrl } from '../extension/url.js';
const id = 'BaW_jenozKc';
for (const link of [`https://www.youtube.com/watch?v=${id}&list=PL123`, `https://youtu.be/${id}?t=5`, `https://m.youtube.com/shorts/${id}`, `https://www.youtube.com/live/${id}`, `https://music.youtube.com/watch?v=${id}`]) {
  test(`normalizes ${link}`, () => assert.equal(youtubeUrl(link), `https://www.youtube.com/watch?v=${id}`));
}
for (const link of ['file:///etc/passwd', 'http://youtube.com/watch?v=BaW_jenozKc', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://youtube.com@evil.test/watch?v=BaW_jenozKc', 'https://user@youtube.com/watch?v=BaW_jenozKc', 'https://youtube.com/playlist?list=x', 'https://youtube.com/watch?v=short', 'https://youtu.be/BaW_jenozKc/extra', 'https://youtube.com:1234/watch?v=BaW_jenozKc']) {
  test(`rejects ${link}`, () => assert.throws(() => youtubeUrl(link)));
}
