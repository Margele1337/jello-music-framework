import { app, protocol } from 'electron';
import Store from 'electron-store';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parseFile } from 'music-metadata';
import {
  LOCAL_SCHEME,
  buildLocalAudioUrl,
  buildLocalCoverUrl,
  isAudioExtension,
  mimeForExtension,
  parseLocalUrl
} from '../../shared/localScheme.js';

const STORE_NAME = 'library';
const SCAN_CONCURRENCY = 4;
const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);

let store = null;
let scanPromise = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

const ensureStore = () => {
  if (!store) {
    store = new Store({
      name: STORE_NAME,
      defaults: { roots: [], tracks: {}, liked: [] }
    });
  }
  return store;
};

const coversDir = () => path.join(app.getPath('userData'), 'covers');

const trackId = (filePath) => createHash('sha1').update(filePath).digest('hex').slice(0, 24);

const readState = () => {
  const value = ensureStore().store;
  return {
    roots: Array.isArray(value.roots) ? value.roots.filter((root) => typeof root === 'string') : [],
    tracks: value.tracks && typeof value.tracks === 'object' ? value.tracks : {},
    liked: Array.isArray(value.liked) ? value.liked.filter((hash) => typeof hash === 'string') : []
  };
};

const writeState = (patch) => {
  ensureStore().set(patch);
};

const toSong = (track) => ({
  hash: track.hash,
  name: track.name || '未知歌曲',
  author: track.author || '未知艺术家',
  album: track.album || '',
  img: track.hasCover ? buildLocalCoverUrl(track.hash) : '',
  timeLength: Number(track.timeLength) || 0,
  albumId: '',
  albumAudioId: '',
  addedAt: Number(track.addedAt) || 0
});

export const listTracks = () => Object.values(readState().tracks)
  .filter((track) => track?.hash)
  .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0))
  .map(toSong);

export const getTrack = (hash) => {
  const track = readState().tracks[String(hash || '')];
  return track?.hash ? track : null;
};

export const getLikedHashes = () => readState().liked;

export const toggleLiked = (hash) => {
  const id = String(hash || '');
  if (!id || !readState().tracks[id]) return false;
  const liked = new Set(readState().liked);
  const next = !liked.has(id);
  if (next) liked.add(id);
  else liked.delete(id);
  writeState({ liked: [...liked] });
  return next;
};

// ===== 目录扫描 =====

const walkAudioFiles = async (root, output = []) => {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkAudioFiles(fullPath, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    if (isAudioExtension(ext)) output.push({ path: fullPath, ext });
  }
  return output;
};

const filenameInfo = (filePath) => {
  const base = path.basename(filePath, path.extname(filePath)).replace(/^\d+\s*[-._]\s*/, '').trim();
  const separator = base.indexOf(' - ');
  if (separator > 0) {
    return {
      artist: base.slice(0, separator).trim(),
      title: base.slice(separator + 3).trim()
    };
  }
  return { artist: '', title: base };
};

const coverExtension = (format) => {
  const value = String(format || '').toLowerCase();
  if (value.includes('png')) return 'png';
  if (value.includes('webp')) return 'webp';
  if (value.includes('gif')) return 'gif';
  return 'jpg';
};

const saveCover = async (hash, picture) => {
  if (!picture?.data?.length) return false;
  const ext = coverExtension(picture.format);
  const dir = coversDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `${hash}.${ext}`);
  await fs.writeFile(target, picture.data);
  return true;
};

const parseTrack = async ({ path: filePath, ext }, previous) => {
  const stat = await fs.stat(filePath);
  const hash = trackId(filePath);
  // 增量扫描：文件路径与 mtime/size 都没变时沿用上次解析结果
  if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs
    && previous.ext === ext) {
    return { ...previous, hash };
  }

  let metadata = null;
  try {
    metadata = await parseFile(filePath, { duration: true, skipCovers: false });
  } catch {
    /* 标签不可读时退回文件名解析 */
  }

  const fallback = filenameInfo(filePath);
  const common = metadata?.common || {};
  const name = String(common.title || fallback.title || path.basename(filePath)).trim();
  const author = String(common.artist || common.albumartist || fallback.artist || '未知艺术家').trim();
  const album = String(common.album || '').trim();
  const duration = Number(metadata?.format?.duration);
  const timeLength = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0;

  let hasCover = false;
  try {
    hasCover = await saveCover(hash, common.picture?.[0]);
  } catch {
    /* 封面写入失败不影响音频入库 */
  }

  return {
    hash,
    path: filePath,
    ext,
    name: name || '未知歌曲',
    author: author || '未知艺术家',
    album,
    timeLength,
    hasCover,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    addedAt: Number(previous?.addedAt) || Date.now()
  };
};

const runPool = async (items, worker, onProgress) => {
  const results = new Array(items.length);
  let cursor = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(SCAN_CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
      done += 1;
      onProgress?.(done, items.length);
    }
  });
  await Promise.all(runners);
  return results.filter(Boolean);
};

const scanRoots = async (roots, onProgress) => {
  const state = readState();
  const files = [];
  for (const root of roots) await walkAudioFiles(root, files);
  const unique = [];
  const seen = new Set();
  for (const file of files) {
    let real;
    try {
      real = await fs.realpath(file.path);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    unique.push({ ...file, path: real });
  }

  const tracks = await runPool(unique, async (file) => {
    const hash = trackId(file.path);
    try {
      return await parseTrack(file, state.tracks[hash]);
    } catch {
      return null;
    }
  }, onProgress);

  const nextTracks = {};
  for (const track of tracks) nextTracks[track.hash] = track;

  // 不在本次扫描根目录下的旧条目保留（用户可能只移除了一个根），
  // 位于扫描范围内但已消失的文件则移除
  const insideRoot = (filePath) => roots.some((root) => {
    const relative = path.relative(root, filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
  for (const [hash, track] of Object.entries(state.tracks)) {
    if (nextTracks[hash]) continue;
    if (insideRoot(track.path)) continue;
    nextTracks[hash] = track;
  }

  // 文件确实不存在的条目（无论根目录）一并清理
  for (const [hash, track] of Object.entries(nextTracks)) {
    try {
      await fs.access(track.path);
    } catch {
      delete nextTracks[hash];
      if (track.hasCover) {
        for (const ext of ['jpg', 'png', 'webp', 'gif']) {
          await fs.rm(path.join(coversDir(), `${hash}.${ext}`), { force: true }).catch(() => {});
        }
      }
    }
  }

  writeState({ roots, tracks: nextTracks });
  return listTracks();
};

export const importFolders = async (folders, onProgress) => {
  const current = readState().roots;
  const roots = [...new Set([...current, ...folders.map((folder) => path.resolve(folder))])];
  writeState({ roots });
  return scanRoots(roots, onProgress);
};

export const rescan = async (onProgress) => scanRoots(readState().roots, onProgress);

export const clearLibrary = async () => {
  writeState({ roots: [], tracks: {}, liked: [] });
  await fs.rm(coversDir(), { recursive: true, force: true }).catch(() => {});
};

// 扫描互斥：两个入口（导入/设置页重扫）同时触发时复用同一次扫描
export const scanOnce = (task) => {
  if (!scanPromise) {
    scanPromise = Promise.resolve()
      .then(task)
      .finally(() => {
        scanPromise = null;
      });
  }
  return scanPromise;
};

// ===== 播放/歌词 =====

export const resolveTrack = async (hash) => {
  const track = getTrack(hash);
  if (!track) return { exists: false, url: '', ext: '' };
  try {
    await fs.access(track.path);
    return { exists: true, url: buildLocalAudioUrl(track.hash), ext: track.ext };
  } catch {
    return { exists: false, url: '', ext: track.ext || '' };
  }
};

const decodeText = (buffer) => {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\uFFFD')) return utf8.replace(/^\uFEFF/, '');
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch {
    return utf8.replace(/^\uFEFF/, '');
  }
};

export const readLyric = async (hash) => {
  const track = getTrack(hash);
  if (!track) throw new Error('歌曲不在音乐库中');
  const parsed = path.parse(track.path);
  const candidates = [`${parsed.name}.lrc`, `${parsed.name}.LRC`];
  for (const name of candidates) {
    const candidate = path.join(parsed.dir, name);
    try {
      const buffer = await fs.readFile(candidate);
      return decodeText(buffer);
    } catch {
      /* try next */
    }
  }
  throw new Error('没有找到同名 .lrc 歌词文件');
};

// ===== 自定义协议 =====

const streamFile = async (filePath, request, contentType, cacheControl) => {
  const stat = await fs.stat(filePath);
  const size = stat.size;
  const range = request.headers.get('range');
  const baseHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) return new Response('invalid range', { status: 416, headers: baseHeaders });
    const [, rawStart, rawEnd] = match;
    if (rawStart === '' && rawEnd === '') {
      return new Response('invalid range', { status: 416, headers: baseHeaders });
    }
    if (rawStart === '') {
      start = Math.max(0, size - Number(rawEnd));
    } else {
      start = Number(rawStart);
      if (rawEnd !== '') end = Math.min(Number(rawEnd), size - 1);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response('range not satisfiable', {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` }
      });
    }
    status = 206;
  }

  const headers = {
    ...baseHeaders,
    'Content-Length': String(end - start + 1)
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  if (request.method === 'HEAD') return new Response(null, { status, headers });

  const stream = createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream), { status, headers });
};

const findCoverFile = async (hash) => {
  const dir = coversDir();
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const candidate = path.join(dir, `${hash}.${ext}`);
    try {
      await fs.access(candidate);
      const format = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { path: candidate, format };
    } catch {
      /* next */
    }
  }
  return null;
};

export const initLocalProtocol = () => {
  protocol.handle(LOCAL_SCHEME, async (request) => {
    const target = parseLocalUrl(request.url);
    if (!target) return new Response('not found', { status: 404 });
    const track = getTrack(target.id);
    if (!track) return new Response('not found', { status: 404 });
    try {
      if (target.kind === 'audio') {
        return await streamFile(track.path, request, mimeForExtension(track.ext), 'no-cache');
      }
      const cover = await findCoverFile(track.hash);
      if (!cover) return new Response('not found', { status: 404 });
      return await streamFile(cover.path, request, cover.format, 'public, max-age=31536000, immutable');
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
};
