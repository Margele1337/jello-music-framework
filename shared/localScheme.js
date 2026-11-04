// jello-local 自定义协议：本地音乐库的音频与封面由主进程按曲目 ID 提供。
// 渲染进程从不接触真实文件路径，协议 handler 只解析已入库的曲目，
// 因此不存在「把任意路径拼进 URL 就能读本机文件」的通道。
export const LOCAL_SCHEME = 'jello-local';

export const AUDIO_EXTENSIONS = Object.freeze([
  'mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm'
]);

export const AUDIO_MIME = Object.freeze({
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm'
});

export const isAudioExtension = (ext) => AUDIO_EXTENSIONS.includes(String(ext || '').toLowerCase());

export const mimeForExtension = (ext) => AUDIO_MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';

export const buildLocalAudioUrl = (hash) => (
  hash ? `${LOCAL_SCHEME}://audio/${encodeURIComponent(String(hash))}` : ''
);

export const buildLocalCoverUrl = (hash) => (
  hash ? `${LOCAL_SCHEME}://cover/${encodeURIComponent(String(hash))}` : ''
);

// 协议 handler 的解码入口：只接受 audio/cover 两个主机名与单段 ID。
export const parseLocalUrl = (raw) => {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return null;
  }
  if (url.protocol !== `${LOCAL_SCHEME}:`) return null;
  const kind = url.hostname;
  if (kind !== 'audio' && kind !== 'cover') return null;
  const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!id || id.includes('/') || id.includes('\\')) return null;
  return { kind, id };
};
