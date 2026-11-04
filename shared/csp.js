// CSP 策略的唯一来源：vite.config.js 在 dev/build 两个阶段把 buildCsp 的结果
// 写进 index.html 的 meta 标签（dev 需要 Vite HMR 的 5173，build 产物不带）。
//
// 媒体与封面全部经 jello-local 自定义协议（shared/localScheme.js）由主进程
// 按曲目 ID 提供：渲染器不持有本机文件路径，也不访问任何外部曲库。
// connect-src 保留该协议，自解码频谱需要 fetch 本地音频。

import { LOCAL_SCHEME } from './localScheme.js';

export const buildCsp = ({ dev = false } = {}) => {
  const connectSrc = ["'self'", `${LOCAL_SCHEME}:`];
  if (dev) connectSrc.push('ws://127.0.0.1:5173', 'http://127.0.0.1:5173');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${LOCAL_SCHEME}:`,
    `media-src blob: ${LOCAL_SCHEME}:`,
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:"
  ].join('; ');
};
