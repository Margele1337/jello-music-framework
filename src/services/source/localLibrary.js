import { parseLrc } from '../lyrics/lrc.js';

// 渲染层只依赖 window.jello.library（preload 暴露的窄桥）。
// 本地库的所有状态都在主进程落盘，这里只做缓存与排序/筛选。
let tracksCache = null;
let tracksPromise = null;
let likedSet = new Set();
let likedLoaded = false;

const bridge = () => window.jello?.library || null;

const shuffle = (items) => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const mulberry32 = (seed) => () => {
  let value = seed += 0x6D2B79F5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const dailyShuffle = (items) => {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = mulberry32(Number(day));
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

export const loadTracks = async ({ force = false } = {}) => {
  const api = bridge();
  if (!api) return [];
  if (!force && tracksCache) return tracksCache;
  if (!force && tracksPromise) return tracksPromise;
  tracksPromise = api.getTracks()
    .then((tracks) => {
      tracksCache = Array.isArray(tracks) ? tracks : [];
      return tracksCache;
    })
    .finally(() => {
      tracksPromise = null;
    });
  return tracksPromise;
};

export const importFolder = async () => {
  const api = bridge();
  if (!api) throw new Error('本地音乐库不可用');
  const result = await api.importFolder();
  if (!result?.canceled) {
    tracksCache = Array.isArray(result?.tracks) ? result.tracks : await loadTracks({ force: true });
  }
  return result;
};

export const rescanLibrary = async () => {
  const api = bridge();
  if (!api) throw new Error('本地音乐库不可用');
  tracksCache = await api.rescan();
  return tracksCache;
};

export const clearLibrary = async () => {
  const api = bridge();
  if (!api) return;
  tracksCache = await api.clear();
  likedSet = new Set();
  likedLoaded = true;
};

export const onScanProgress = (callback) => bridge()?.onProgress?.(callback) || null;

// ===== 曲库查询 =====

const normalize = (value) => String(value || '').trim().toLowerCase();

const matches = (song, keyword) => {
  const text = normalize(keyword);
  if (!text) return true;
  return normalize(song.name).includes(text)
    || normalize(song.author).includes(text)
    || normalize(song.album).includes(text);
};

export const searchSongs = async (keywords, { page = 1, pagesize = 30 } = {}) => {
  const tracks = await loadTracks();
  const start = Math.max(0, (Number(page) - 1) * Number(pagesize));
  return tracks.filter((song) => matches(song, keywords)).slice(start, start + Number(pagesize));
};

// 本地库没有远端歌单搜索，保留空实现让搜索框无需分叉
export const searchPlaylists = async () => [];

const recentTracks = async (limit = 100) => (await loadTracks())
  .slice()
  .sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0))
  .slice(0, limit);

const likedTracks = async () => {
  await ensureLikedHashSet();
  const tracks = await loadTracks();
  return tracks.filter((song) => likedSet.has(song.hash));
};

export const getPlaylistTracks = async (playlist, { page = 1, pagesize = 300 } = {}) => {
  let list;
  const id = String(playlist?.id || '');
  if (id === 'local-liked') list = await likedTracks();
  else if (id === 'local-recent') list = await recentTracks(pagesize);
  else list = await loadTracks();
  const start = Math.max(0, (Number(page) - 1) * Number(pagesize));
  return list.slice(start, start + Number(pagesize));
};

export const getUserPlaylists = async () => {
  const tracks = await loadTracks();
  return [
    { id: 'local-all', name: '本地音乐', idType: 'local', count: tracks.length },
    { id: 'local-liked', name: '我喜欢', idType: 'local' },
    { id: 'local-recent', name: '最近添加', idType: 'local' }
  ];
};

export const getDailyRecommend = async () => dailyShuffle(await loadTracks()).slice(0, 60);

export const getGuessYouLike = async () => shuffle(await loadTracks()).slice(0, 30);

// ===== 播放地址 / 歌词 =====

export const getSongUrl = async (song) => {
  const api = bridge();
  if (!api) throw new Error('本地音乐库不可用');
  if (!song?.hash) throw new Error('缺少歌曲信息');
  const result = await api.resolve(song.hash);
  if (!result?.exists || !result.url) throw new Error('文件已移动或删除，请重新扫描音乐库');
  return {
    url: result.url,
    extName: result.ext || ''
  };
};

export const getLyrics = async (song) => {
  const api = bridge();
  if (!api) throw new Error('本地音乐库不可用');
  if (!song?.hash) throw new Error('缺少歌曲信息');
  const text = await api.lyric(song.hash);
  const lines = parseLrc(text || '');
  if (!lines.length) throw new Error('歌词内容为空');
  return { lines, candidate: null };
};


// ===== 我喜欢 =====

export const ensureLikedHashSet = async ({ force = false } = {}) => {
  const api = bridge();
  if (!api) return likedSet;
  if (!force && likedLoaded) return likedSet;
  try {
    const hashes = await api.getLiked();
    likedSet = new Set(Array.isArray(hashes) ? hashes : []);
    likedLoaded = true;
  } catch {
    /* 读取失败保持当前缓存 */
  }
  return likedSet;
};

export const isSongLiked = (song) => !!(song?.hash && likedSet.has(song.hash));

export const markSongLiked = (song) => {
  if (!song?.hash) return;
  likedSet.add(song.hash);
  likedLoaded = true;
};

export const collectSongToLiked = async (song) => {
  if (!song?.hash) throw new Error('没有正在播放的歌曲');
  await ensureLikedHashSet();
  if (likedSet.has(song.hash)) return false;
  const liked = await bridge()?.toggleLiked?.(song.hash);
  if (liked) markSongLiked(song);
  return !!liked;
};

export const toggleSongLiked = async (song) => {
  if (!song?.hash) throw new Error('没有正在播放的歌曲');
  await ensureLikedHashSet();
  const liked = await bridge()?.toggleLiked?.(song.hash);
  if (liked) likedSet.add(song.hash);
  else likedSet.delete(song.hash);
  likedLoaded = true;
  return !!liked;
};

export const resetLibraryCache = () => {
  tracksCache = null;
  tracksPromise = null;
  likedSet = new Set();
  likedLoaded = false;
};
