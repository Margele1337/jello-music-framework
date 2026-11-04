export const PLAYBACK_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);
export const SPECTRUM_PRESET_VALUES = Object.freeze(['original', 'legacy']);

export const SETTING_DEFAULTS = Object.freeze({
  language: '',
  volume: 1,
  // 音量合成器式应用级音量：与主界面音量相乘后输出（应用音量 50% × 主界面
  // 80% = 实际 40%），主界面滑杆语义不变
  masterVolume: 0.6,
  playbackRate: 1,
  loudnessNormalization: false,
  audioOutputDevice: 'default',
  minimizeToTray: true,
  desktopLyrics: false,
  desktopLyricsFont: '',
  spectrum: false,
  spectrumScale: 0.7,
  // 只作用于频谱条形层（幽灵条/实心条/条内封面叠加）的不透明度，默认 10%
  spectrumBarOpacity: 0.1,
  // 频谱信息卡（封面、歌名与四周柔边）的不透明度，1 = 原版
  spectrumInfoOpacity: 1,
  // 鼠标靠近透明：光标附近的条形/信息卡以圆形区域渐隐（半径随进入逐渐扩大），
  // 用来看清被频谱挡住的桌面内容
  spectrumMouseFade: true,
  // 渐隐圈最大半径（CSS 像素）
  spectrumMouseFadeRadius: 260,
  // 1.0 = 原版固定像素信息卡（封面 100×100、字号 18/20），纯倍率不叠加分辨率缩放
  spectrumInfoScale: 1,
  spectrumInfoVisible: true,
  spectrumSigmaSmoothing: 0.335,
  spectrumAvDelayMs: 590,
  // HUD 目标电平的刷新间隔：50ms ≈ 跟手；约 500ms ≈ 「一秒变一两次」的慢节奏
  spectrumUpdateMs: 500,
  // 频谱预设：legacy（预设 1，默认）= legacy 复刻——实时 tap（自解码分析不接管）、
  // 250ms 攒批推进 4 帧队首、FFT 输入不做响度归一、预读领先取设置原值、
  // HUD 用 legacy 平滑式（信息卡低音脉冲两个预设都有）；
  // original（预设 2）= 原版 sigmarebase——自解码精确时序 + 帧首 1024 个采样时刻
  // 打包窗 1024 点 FFT。
  // 切到 legacy 立即生效（停用自解码回到 tap）；切到 original 下一首生效。
  spectrumPreset: 'legacy',
  spectrumLocked: true,
  autoStart: false,
  preventAppSuspension: false,
  hotkeyIntroSeen: false,
  // false = 关闭硬件加速并走软件合成（改后需重启生效，UI 自己提示）
  gpuAcceleration: true
});

export const SETTING_KEYS = Object.freeze(Object.keys(SETTING_DEFAULTS));

export const sanitizeSettings = (patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};

  const next = {};
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];

    if (key === 'volume') {
      const number = Number(value);
      if (Number.isFinite(number)) next.volume = Math.max(0, Math.min(1, number));
      continue;
    }

    if (key === 'masterVolume') {
      const number = Number(value);
      if (Number.isFinite(number)) next.masterVolume = Math.max(0, Math.min(1, number));
      continue;
    }

    if (key === 'playbackRate') {
      const number = Number(value);
      if (Number.isFinite(number) && PLAYBACK_RATES.includes(number)) next.playbackRate = number;
      continue;
    }

    if (key === 'minimizeToTray' || key === 'desktopLyrics' || key === 'spectrum'
      || key === 'spectrumInfoVisible' || key === 'spectrumLocked' || key === 'spectrumMouseFade'
      || key === 'hotkeyIntroSeen'
      || key === 'loudnessNormalization' || key === 'autoStart' || key === 'preventAppSuspension'
      || key === 'gpuAcceleration') {
      if (typeof value === 'boolean') next[key] = value;
      continue;
    }

    if (key === 'spectrumScale') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.5, Math.min(3, n));
      continue;
    }

    if (key === 'spectrumInfoScale') {
      // 与 shared/spectrumHud.js 的 clampInfoScale 同区间：信息卡倍率，1.0 = 原版
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.5, Math.min(2, n));
      continue;
    }

    if (key === 'spectrumInfoOpacity') {
      // 歌曲信息卡不透明度；下限 0.1 防止调到几乎不可见
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.1, Math.min(1, n));
      continue;
    }

    if (key === 'spectrumMouseFadeRadius') {
      // 渐隐圈半径：过小失去避让意义，过大接近整窗透明
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(80, Math.min(600, Math.round(n)));
      continue;
    }

    if (key === 'spectrumBarOpacity') {
      // 条形层不透明度，与整窗透明度相乘；下限同上
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.1, Math.min(1, n));
      continue;
    }

    if (key === 'spectrumSigmaSmoothing') {
      // 直接替换原版 MusicManager.java:149 的常量 0.335 作为每帧逼近乘数
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.05, Math.min(1, n));
      continue;
    }

    if (key === 'spectrumAvDelayMs') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0, Math.min(2000, Math.round(n)));
      continue;
    }

    if (key === 'spectrumUpdateMs') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(50, Math.min(2000, Math.round(n)));
      continue;
    }

    if (key === 'spectrumPreset') {
      // 历史存档里的 wide（旧预设 2）迁移到 legacy；'wide' 不再是可取值
      const presetValue = value === 'wide' ? 'legacy' : value;
      if (SPECTRUM_PRESET_VALUES.includes(presetValue)) next.spectrumPreset = presetValue;
      continue;
    }
    if (key === 'audioOutputDevice') {
      // 设备 ID 为浏览器枚举值，仅做长度与字符白名单限制
      if (typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9._\-:=+/]*$/.test(value)) {
        next.audioOutputDevice = value || 'default';
      }
      continue;
    }

    if (typeof value === 'string') next[key] = value;
  }
  // 旧「整窗透明度」键迁移为信息卡透明度（透明度概念已拆分为条形/信息两级）。
  // 已从 defaults 移除的键进不了上面的循环，只能在此后处理；新键优先
  if (next.spectrumInfoOpacity === undefined
    && Object.prototype.hasOwnProperty.call(patch, 'spectrumOpacity')) {
    const n = Number(patch.spectrumOpacity);
    if (Number.isFinite(n)) next.spectrumInfoOpacity = Math.max(0.1, Math.min(1, n));
  }

  return next;
};
