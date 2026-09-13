import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { isRemoteUrl, publicUrlToPath, toAbsoluteUrl } from '../src/core/media.js';

describe('publicUrlToPath', () => {
  const publicDir = path.resolve('/srv/app/public');

  it('maps /public URLs into the public directory', () => {
    expect(publicUrlToPath('/public/videos/a.mp4', publicDir)).toBe(path.join(publicDir, 'videos', 'a.mp4'));
  });

  it('rejects path traversal', () => {
    expect(publicUrlToPath('/public/../.env', publicDir)).toBeNull();
    expect(publicUrlToPath('/public/%2e%2e/.env', publicDir)).toBeNull();
  });

  it('ignores non-public URLs', () => {
    expect(publicUrlToPath('/etc/passwd', publicDir)).toBeNull();
  });
});

describe('toAbsoluteUrl', () => {
  it('keeps remote URLs', () => {
    expect(toAbsoluteUrl('https://cdn.example.com/a.jpg', undefined)).toBe('https://cdn.example.com/a.jpg');
  });

  it('prefixes local media with the public base URL', () => {
    expect(toAbsoluteUrl('/public/videos/a.mp4', 'https://bot.example.com/')).toBe('https://bot.example.com/public/videos/a.mp4');
  });

  it('returns null when local media cannot be reached publicly', () => {
    expect(toAbsoluteUrl('/public/videos/a.mp4', undefined)).toBeNull();
  });
});

describe('isRemoteUrl', () => {
  it('detects http(s) URLs', () => {
    expect(isRemoteUrl('HTTPS://x.y')).toBe(true);
    expect(isRemoteUrl('/public/x')).toBe(false);
  });
});
