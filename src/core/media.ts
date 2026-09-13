import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export const PUBLIC_DIR = path.resolve('public');
export const TEMP_DIR = path.resolve('temp');

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Maps a `/public/...` URL served by the dashboard to its file on disk.
 * Returns null for anything outside the public directory (including traversal attempts).
 */
export function publicUrlToPath(url: string, publicDir = PUBLIC_DIR): string | null {
  if (!url.startsWith('/public/')) return null;
  const resolved = path.resolve(publicDir, decodeURIComponent(url.slice('/public/'.length)));
  const root = path.resolve(publicDir) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

/**
 * Returns an absolute URL that third-party platforms can fetch, or null when the
 * media only exists locally and no PUBLIC_BASE_URL is configured.
 */
export function toAbsoluteUrl(url: string, publicBaseUrl: string | undefined): string | null {
  if (isRemoteUrl(url)) return url;
  if (url.startsWith('/public/') && publicBaseUrl) {
    return publicBaseUrl.replace(/\/+$/, '') + url;
  }
  return null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
};

/**
 * Resolves a media reference (remote URL, `/public/...` URL or local path) to a local file,
 * downloading remote files into the temp directory. `cleanup` removes downloaded files only.
 */
export async function resolveMediaFile(url: string): Promise<{ filePath: string; cleanup: () => void }> {
  if (isRemoteUrl(url)) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download media (${res.status}): ${url}`);
    }
    ensureDir(TEMP_DIR);
    const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const ext = EXTENSION_BY_MIME[mime] ?? (path.extname(new URL(url).pathname) || '.bin');
    const filePath = path.join(TEMP_DIR, `download_${randomUUID()}${ext}`);
    fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    return {
      filePath,
      cleanup: () => {
        try { fs.unlinkSync(filePath); } catch { /* already gone */ }
      },
    };
  }

  const filePath = url.startsWith('/public/') ? publicUrlToPath(url) : path.resolve(url);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Media file not found: ${url}`);
  }
  return { filePath, cleanup: () => {} };
}
