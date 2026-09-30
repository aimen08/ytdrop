import { youtubeUrl } from './url.js';

export const QUEUE_LIMIT = 50;

export function parseLinks(text) {
  return normalizeLinks(typeof text === 'string' ? text.trim().split(/\s+/).filter(Boolean) : []);
}

export function normalizeLinks(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('Paste a video link, or choose Use this tab.');
  if (values.length > QUEUE_LIMIT) throw new Error(`Add up to ${QUEUE_LIMIT} links at a time.`);
  return values.map((value, index) => {
    try {
      if (typeof value !== 'string' || value.length > 2048) throw new Error();
      return youtubeUrl(value);
    } catch {
      throw new Error(`Link ${index + 1}: use a full HTTPS YouTube video or Shorts link.`);
    }
  });
}

export function validateOptions(value) {
  const {mode, quality, speed = 'fast'} = value;
  if (!['video', 'audio'].includes(mode) || !['best', '2160', '1080', '720', '480'].includes(quality)) throw new Error('Invalid download options.');
  if (!['fast', 'standard'].includes(speed)) throw new Error('Invalid download speed.');
  return {mode, quality, speed};
}

export function queueKey(job) {
  return [job.url, job.mode, job.mode === 'audio' ? 'best' : job.quality, job.downloadSpeed || job.speed].join('|');
}
