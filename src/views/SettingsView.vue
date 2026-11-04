<script setup>
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { SETTING_DEFAULTS } from '../../shared/settings.js';
import { buildSettingSections } from '../config/settingSections.js';
import {
  clearLibrary,
  importFolder,
  loadTracks,
  onScanProgress,
  rescanLibrary
} from '../services/source/localLibrary.js';
import { useSettingsStore } from '../stores/settings.js';
import { useSigmaWindowDrag } from '../composables/useSigmaWindowDrag.js';

const router = useRouter();
const settings = useSettingsStore();

// 无边框窗口：设置页非控件区域拖动窗口（四边夹屏、右缘橡皮筋由主进程处理）
// 新增交互控件（地址输入行 / 更新进度条 / 更新说明）必须一并登记，否则点击会被窗口拖动吞掉
const SETTINGS_NO_DRAG_SELECTOR = [
  'button', 'input', 'select', 'textarea', 'a',
  '.settings-chip', '.row-pill', '.row-switch', '.row-seg', '.row-slider',
  '.modal', '.modal-content', '.font-search', '.modal-close',
  '.reset-section-btn', '.factory-reset-button', '.confirm-btn',
  '.row-field', '.field-input', '.field-btn', '.update-extra', '.update-progress', '.update-notes'
].join(', ');
const { onPointerDown: onSettingsDragPointerDown } = useSigmaWindowDrag({
  noDragSelector: SETTINGS_NO_DRAG_SELECTOR
});

const version = ref('');
const platform = ref('');
const footerVersionText = computed(() => {
  const parts = [];
  if (version.value) parts.push(`V${version.value}`);
  if (platform.value) parts.push(platform.value);
  return parts.join(' - ');
});
const notice = ref('');
const updateState = ref({ status: 'idle', version: '', percent: 0, error: '' });
const hasUpdateBridge = ref(false);
const activeTab = ref(0);
const libraryCount = ref(0);
const libraryBusy = ref(false);
let noticeTimer = null;
let unsubscribeUpdates = null;

const setNotice = (text, duration = 3000) => {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, duration);
};

const updateSetting = (key, value) => {
  void settings.update({ [key]: value })
    .catch((error) => setNotice(error?.message || '保存失败'));
};

// ===== 内联 SVG 图标（替代参考版的 Font Awesome，无新增依赖） =====
const shapePath = (d) => ({ tag: 'path', attrs: { d } });
const shapeCircle = (cx, cy, r) => ({ tag: 'circle', attrs: { cx, cy, r } });
const shapeEllipse = (cx, cy, rx, ry) => ({ tag: 'ellipse', attrs: { cx, cy, rx, ry } });
const shapeLine = (x1, y1, x2, y2) => ({ tag: 'line', attrs: { x1, y1, x2, y2 } });
const shapeRect = (x, y, width, height, rx) => ({ tag: 'rect', attrs: { x, y, width, height, rx } });
const shapePolyline = (points) => ({ tag: 'polyline', attrs: { points } });

const ICONS = {
  keyboard: [
    shapeRect(2, 4, 20, 16, 2),
    shapePath('M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8')
  ],
  headphones: [
    shapePath('M3 18v-6a9 9 0 0 1 18 0v6'),
    shapePath('M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z')
  ],
  sliders: [
    shapeLine(4, 21, 4, 14), shapeLine(4, 10, 4, 3),
    shapeLine(12, 21, 12, 12), shapeLine(12, 8, 12, 3),
    shapeLine(20, 21, 20, 16), shapeLine(20, 12, 20, 3),
    shapeLine(1, 14, 7, 14), shapeLine(9, 8, 15, 8), shapeLine(17, 16, 23, 16)
  ],
  volume: [
    shapePath('M11 5 6 9 2 9 2 15 6 15 11 19 11 5'),
    shapePath('M15.54 8.46a5 5 0 0 1 0 7.07'),
    shapePath('M19.07 4.93a10 10 0 0 1 0 14.14')
  ],
  desktop: [shapeRect(2, 3, 20, 14, 2), shapeLine(8, 21, 16, 21), shapeLine(12, 17, 12, 21)],
  font: [shapePath('M4 7V4h16v3'), shapeLine(12, 4, 12, 20), shapeLine(9, 20, 15, 20)],
  waveform: [shapePolyline('22 12 18 12 15 21 9 3 6 12 2 12')],
  chart: [shapeLine(18, 20, 18, 10), shapeLine(12, 20, 12, 4), shapeLine(6, 20, 6, 14)],
  image: [shapeRect(3, 3, 18, 18, 2), shapeCircle(8.5, 8.5, 1.5), shapePath('m21 15-5-5L5 21')],
  info: [shapeCircle(12, 12, 10), shapeLine(12, 16, 12, 12), shapeLine(12, 8, 12.01, 8)],
  clock: [shapeCircle(12, 12, 10), shapePolyline('12 6 12 12 16 14')],
  lock: [shapeRect(3, 11, 18, 11, 2), shapePath('M7 11V7a5 5 0 0 1 10 0v4')],
  power: [shapePath('M18.36 6.64a9 9 0 1 1-12.73 0'), shapeLine(12, 2, 12, 12)],
  download: [
    shapePath('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
    shapePolyline('7 10 12 15 17 10'),
    shapeLine(12, 15, 12, 3)
  ],
  folder: [shapePath('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z')],
  // 代理（ globe ）/ 地址链路（link）/ GPU（cpu）/ 导出（upload 形状，download 的反向）
  globe: [
    shapeCircle(12, 12, 9), shapeLine(3, 12, 21, 12), shapeEllipse(12, 12, 4, 9)
  ],
  link: [
    shapeRect(2, 9, 9, 6, 3), shapeRect(13, 9, 9, 6, 3), shapeLine(8, 12, 16, 12)
  ],
  cpu: [
    shapeRect(5, 5, 14, 14, 2), shapeRect(9, 9, 6, 6, 1),
    shapeLine(9, 2, 9, 5), shapeLine(15, 2, 15, 5),
    shapeLine(9, 19, 9, 22), shapeLine(15, 19, 15, 22),
    shapeLine(2, 9, 5, 9), shapeLine(2, 15, 5, 15),
    shapeLine(19, 9, 22, 9), shapeLine(19, 15, 22, 15)
  ],
  export: [
    shapePath('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),
    shapePolyline('7 8 12 3 17 8'),
    shapeLine(12, 3, 12, 15)
  ],
  shield: [shapePath('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z')],
  database: [
    shapeEllipse(12, 5, 9, 3),
    shapePath('M21 12c0 1.66-4 3-9 3s-9-1.34-9-3'),
    shapePath('M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5')
  ],
  user: [shapePath('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'), shapeCircle(12, 7, 4)],
  key: [
    shapePath('M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4')
  ],
  refresh: [shapePolyline('23 4 23 10 17 10'), shapePath('M20.49 15a9 9 0 1 1-2.12-9.36L23 10')],
  trash: [
    shapePolyline('3 6 5 6 21 6'),
    shapePath('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'),
    shapeLine(10, 11, 10, 17), shapeLine(14, 11, 14, 17)
  ],
  chevron: [shapePolyline('9 18 15 12 9 6')],
  chevronLeft: [shapePolyline('15 18 9 12 15 6')]
};

const SvgIcon = (props) => h(
  'svg',
  {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  },
  (ICONS[props.name] || ICONS.sliders).map((shape) => h(shape.tag, shape.attrs))
);
SvgIcon.props = { name: { type: String, default: 'sliders' } };

// ===== 系统 =====
const openLogs = async () => {
  try {
    await window.jello?.app?.openLogs?.();
  } catch {
    setNotice('打开日志目录失败');
  }
};

// 导出的是脱敏副本（主进程弹保存框）：用户取消不算失败，保持静默
const exportLogs = async () => {
  const bridge = window.jello?.app?.exportLogs;
  if (!bridge) {
    setNotice('当前版本不支持导出日志');
    return;
  }
  try {
    const result = await bridge();
    if (result?.ok && result.path) {
      setNotice(`日志已导出：${result.path}`, 5000);
      return;
    }
    if (!result?.canceled) setNotice(`导出日志失败：${result?.error || '未知错误'}`);
  } catch (error) {
    setNotice(`导出日志失败：${error?.message || '未知错误'}`);
  }
};

// ===== 本地音乐库 =====
const refreshLibraryCount = async () => {
  try {
    libraryCount.value = (await loadTracks({ force: true })).length;
  } catch {
    libraryCount.value = 0;
  }
};

const importLibrary = async () => {
  if (libraryBusy.value) return;
  libraryBusy.value = true;
  const off = onScanProgress(({ done, total }) => {
    if (total) setNotice(`正在扫描音乐库 ${done}/${total}`, 1500);
  });
  try {
    const result = await importFolder();
    if (!result?.canceled) {
      libraryCount.value = Array.isArray(result?.tracks) ? result.tracks.length : 0;
      setNotice(result?.tracks?.length ? `已导入 ${result.tracks.length} 首歌曲` : '所选文件夹里没有可播放的音频');
    }
  } catch (error) {
    setNotice(error?.message || '导入音乐失败');
  } finally {
    off?.();
    libraryBusy.value = false;
  }
};

const rescanLibraryNow = async () => {
  if (libraryBusy.value) return;
  libraryBusy.value = true;
  const off = onScanProgress(({ done, total }) => {
    if (total) setNotice(`正在扫描音乐库 ${done}/${total}`, 1500);
  });
  try {
    libraryCount.value = (await rescanLibrary()).length;
    setNotice(`扫描完成，共 ${libraryCount.value} 首歌曲`);
  } catch (error) {
    setNotice(error?.message || '扫描失败');
  } finally {
    off?.();
    libraryBusy.value = false;
  }
};

const clearLibraryNow = () => {
  openConfirm({
    title: '清空音乐库',
    message: '只清除应用内的曲目索引与「我喜欢」，不会删除磁盘上的音乐文件。确定继续吗？',
    confirmText: '清空',
    onConfirm: async () => {
      await clearLibrary();
      libraryCount.value = 0;
      setNotice('音乐库已清空');
    }
  });
};

// ===== GPU 加速（需重启） =====
// 记下进入本页时的值：改回来就不该再催重启
const gpuAtBoot = ref(null);
watch([() => settings.ready, () => settings.gpuAcceleration], () => {
  if (gpuAtBoot.value === null && settings.ready) gpuAtBoot.value = settings.gpuAcceleration;
}, { immediate: true });

const gpuRestartPending = computed(() => (
  gpuAtBoot.value !== null && !!settings.gpuAcceleration !== !!gpuAtBoot.value
));

const restartForGpu = () => {
  openConfirm({
    title: '重启应用',
    message: 'GPU 硬件加速的改动要重启应用才会生效，现在重启吗？',
    confirmText: '立即重启',
    onConfirm: async () => {
      const restart = window.jello?.app?.restart;
      if (!restart) {
        setNotice('当前版本不支持应用内重启，请手动退出后重新打开', 5000);
        return;
      }
      await restart();
    }
  });
};

const showTutorial = () => {
  updateSetting('hotkeyIntroSeen', false);
  setNotice('已重置教程，返回播放页即可查看');
};

// ===== 更新 =====
const updateText = computed(() => {
  const state = updateState.value;
  switch (state.status) {
    case 'dev':
      return '开发模式不检查更新';
    case 'checking':
      return '正在检查更新…';
    case 'current':
      return '已是最新版本';
    case 'available':
      return state.version ? `发现新版本 v${state.version}` : '发现新版本';
    case 'downloading':
      return `正在下载更新 ${state.percent || 0}%`;
    case 'downloaded':
      return state.version ? `v${state.version} 已下载，重启后生效` : '更新已下载，重启后生效';
    case 'error':
      return state.error || '检查更新失败';
    default:
      return '尚未检查更新';
  }
});

const updateAction = computed(() => {
  if (updateState.value.status === 'available') return 'download';
  if (updateState.value.status === 'downloaded') return 'install';
  return 'check';
});

const updateLabel = computed(() => {
  if (updateAction.value === 'download') return '下载更新';
  if (updateAction.value === 'install') return '重启安装';
  return '检查更新';
});

const updateBusy = computed(() => ['checking', 'downloading'].includes(updateState.value.status));
const updateDisabled = computed(() => !hasUpdateBridge.value || updateBusy.value || updateState.value.status === 'dev');

// 下载进度与版本说明：releaseNotes 由主进程拍平成纯文本，可能为空串
const isDownloadingUpdate = computed(() => updateState.value.status === 'downloading');
const updatePercent = computed(() => {
  const raw = Number(updateState.value.percent);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
});
const updateNotes = computed(() => {
  const state = updateState.value;
  if (!['available', 'downloading', 'downloaded'].includes(state.status)) return '';
  return String(state.releaseNotes || '');
});

const onUpdateAction = async () => {
  const bridge = window.jello?.updates;
  if (!bridge) return;
  try {
    if (updateAction.value === 'download') {
      updateState.value = await bridge.download();
    } else if (updateAction.value === 'install') {
      await bridge.install();
    } else {
      updateState.value = await bridge.check();
    }
  } catch (error) {
    setNotice(error?.message || '更新操作失败');
  }
};

// ===== 选择弹窗（输出设备 / 歌词字体） =====
const isSelectionOpen = ref(false);
const selectionTitle = ref('');
const selectionOptions = ref([]);
const selectionValue = ref('');
const selectionKind = ref('device'); // device | font
const deviceOptions = ref([]);
const devicesLoading = ref(false);
const fontOptions = ref([]);
const fontsLoading = ref(false);
const fontSearch = ref('');

const loadAudioOutputDevices = async () => {
  devicesLoading.value = true;
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.() || [];
    const outputs = devices.filter((device) => device.kind === 'audiooutput');
    const options = [{ displayText: '默认', value: 'default' }];
    let unnamed = 1;
    for (const output of outputs) {
      if (!output.deviceId) continue;
      options.push({
        displayText: output.label || `输出设备 ${unnamed++}`,
        value: output.deviceId
      });
    }
    deviceOptions.value = options;
  } catch {
    deviceOptions.value = [{ displayText: '默认', value: 'default' }];
  } finally {
    devicesLoading.value = false;
  }
};

const deviceText = computed(() => {
  if (!settings.audioOutputDevice || settings.audioOutputDevice === 'default') return '默认';
  return deviceOptions.value.find((option) => option.value === settings.audioOutputDevice)?.displayText
    || `已选择设备 (${settings.audioOutputDevice.slice(0, 8)}...)`;
});

const onDevicePicked = (option) => {
  isSelectionOpen.value = false;
  if (option.value !== settings.audioOutputDevice) {
    updateSetting('audioOutputDevice', option.value);
    setNotice('输出设备已更新');
  }
};

const loadLocalFonts = async () => {
  fontsLoading.value = true;
  try {
    if (!window.queryLocalFonts) {
      fontOptions.value = [];
      return;
    }
    const fonts = await window.queryLocalFonts();
    const familyMap = new Map();
    for (const font of fonts) {
      if (!font.family || !font.fullName) continue;
      if (!familyMap.has(font.family) || font.fullName.length < familyMap.get(font.family).length) {
        familyMap.set(font.family, font.fullName.length > font.family.length ? font.family : font.fullName);
      }
    }
    fontOptions.value = [
      { displayText: '默认字体', value: '' },
      ...[...familyMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([family, name]) => ({
          displayText: name === family ? family : `${name} (${family})`,
          value: family
        }))
    ];
  } catch {
    fontOptions.value = [];
  } finally {
    fontsLoading.value = false;
  }
};

const fontList = computed(() => (
  fontOptions.value.filter((option) => (
    !fontSearch.value || option.displayText.toLowerCase().includes(fontSearch.value.toLowerCase())
  ))
));

const onFontPicked = (option) => {
  isSelectionOpen.value = false;
  if (option.value !== (settings.desktopLyricsFont || '')) {
    updateSetting('desktopLyricsFont', option.value);
    setNotice('歌词字体已更新');
  }
};

const onSelectionPicked = (option) => {
  if (selectionKind.value === 'device') onDevicePicked(option);
  else if (selectionKind.value === 'font') onFontPicked(option);
};

// ===== 设置分区 schema：数据与行内闭包在 src/config/settingSections.js，
// 响应式状态与动作由视图注入（参数名与本地变量同名，行内闭包语义不变） =====
const settingSections = buildSettingSections({
  settings,
  deviceText,
  showTutorial,
  gpuRestartPending,
  restartForGpu,
  openLogs,
  exportLogs,
  version,
  updateText,
  updateLabel,
  updateDisabled,
  onUpdateAction,
  libraryCount,
  libraryBusy,
  importLibrary,
  rescanLibraryNow,
  clearLibraryNow
});

// ===== 通用行渲染 =====
// label/description 允许传函数：更新行的文案要随 updateState 实时变化
const labelText = (item) => (typeof item.label === 'function' ? item.label() : item.label);
const descText = (item) => (
  typeof item.description === 'function' ? item.description() : (item.description || '')
);
const pillText = (item) => {
  if (item.getText) return item.getText();
  return typeof item.customText === 'function' ? item.customText() : (item.customText || '');
};
const sectionDesc = (section) => (
  typeof section.description === 'function' ? section.description() : (section.description || '')
);
const pillDisabled = (item) => (item.isDisabled ? !!item.isDisabled() : false);

const visibleItems = (section) => (section.items || []).filter((item) => (
  !item.visible || !!item.visible()
));

// hint 是「本次操作的结果」（保存成功 / 被 sanitize 拒绝 / 探测结果），与固定说明分开
const hintText = (item) => (item.hint ? String(item.hint()?.text || '') : '');
const hintTone = (item) => (item.hint ? String(item.hint()?.tone || '') : '');

// 回车等价于失焦：直接 blur，让 blur 事件走同一条保存路径（避免重复发一次 IPC）
const onFieldEnter = (event) => {
  event.target?.blur?.();
};

const clickPill = (item) => {
  if (item.control === 'action') {
    void item.action?.();
    return;
  }
  openSelection(item);
};

const openSelection = (item) => {
  selectionKind.value = item.selectionKind || 'device';
  selectionTitle.value = item.selectionTitle || item.label;
  if (selectionKind.value === 'device') {
    selectionOptions.value = [];
    selectionValue.value = settings.audioOutputDevice || 'default';
    isSelectionOpen.value = true;
    void loadAudioOutputDevices();
    return;
  }
  if (selectionKind.value === 'font') {
    selectionOptions.value = [];
    selectionValue.value = settings.desktopLyricsFont || '';
    fontSearch.value = '';
    isSelectionOpen.value = true;
    void loadLocalFonts();
    return;
  }
};

const segIsOn = (item, option) => String(settings[item.key]) === String(option.value);
const segDisabled = (item) => (item.segDisabled ? !!item.segDisabled() : false);
const onSegClick = (item, option) => {
  updateSetting(item.key, option.value);
};

const sliderDisplay = (item) => item.format(Number(settings[item.key]));

// ===== 滑条数值点击编辑：点数字 → 文本框，回车/失焦提交（Esc 取消） =====
const editingSliderKey = ref('');
const editingSliderValue = ref('');
const editingSliderCancel = ref(false);
let editingSliderInput = null;

const sliderIsPercent = (item) => item.format(Number(settings[item.key])).endsWith('%');

const startSliderEdit = (item, event) => {
  editingSliderKey.value = item.key;
  editingSliderCancel.value = false;
  // 百分比刻度按屏幕上的百分数编辑（45% 就输 45），其余按原始值
  editingSliderValue.value = sliderIsPercent(item)
    ? String(Math.round(Number(settings[item.key]) * 10000) / 100)
    : String(settings[item.key]);
  nextTick(() => {
    editingSliderInput = event.target.parentElement?.querySelector('.row-value-input');
    editingSliderInput?.focus();
    editingSliderInput?.select();
  });
};

const cancelSliderEdit = () => {
  editingSliderCancel.value = true;
  editingSliderInput?.blur();
};

const commitSliderEdit = (item) => {
  if (editingSliderKey.value !== item.key) return;
  editingSliderKey.value = '';
  if (editingSliderCancel.value) {
    editingSliderCancel.value = false;
    return;
  }
  const raw = Number(editingSliderValue.value);
  if (!Number.isFinite(raw)) return;
  const { min, max, step } = item.slider;
  let value = sliderIsPercent(item) ? raw / 100 : raw;
  value = Math.min(max, Math.max(min, value));
  if (Number.isFinite(step) && step > 0) {
    // 吸附到步长并收敛浮点噪声（0.30000000000004 → 0.3）
    value = min + Math.round((value - min) / step) * step;
    value = Number(value.toFixed((String(step).split('.')[1] || '').length));
  }
  value = Math.min(max, Math.max(min, value));
  if (value !== Number(settings[item.key])) updateSetting(item.key, value);
};

// ===== 按分类重置：仅把该分类中存在于 SETTING_DEFAULTS 的键恢复默认 =====
const sectionResetPatch = (section) => {
  const patch = {};
  for (const item of section.items || []) {
    if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, item.key)) {
      patch[item.key] = SETTING_DEFAULTS[item.key];
    }
  }
  return patch;
};

const hasSectionReset = (section) => Object.keys(sectionResetPatch(section)).length > 0;

const resetSection = async (section) => {
  const patch = sectionResetPatch(section);
  if (!Object.keys(patch).length) return;
  try {
    await settings.update(patch);
    setNotice(`「${section.title}」已恢复默认设置`);
  } catch (error) {
    setNotice(error?.message || '重置失败');
  }
};

// ===== 恢复出厂设置：用页面自己的弹窗做二次确认（不用 window.confirm） =====
const confirmDialog = ref(null);

const openConfirm = (config) => {
  confirmDialog.value = config;
};

const closeConfirm = () => {
  confirmDialog.value = null;
};

const runConfirm = async () => {
  const dialog = confirmDialog.value;
  confirmDialog.value = null;
  try {
    await dialog?.onConfirm?.();
  } catch (error) {
    setNotice(error?.message || '恢复出厂设置失败');
  }
};

const factoryReset = () => {
  openConfirm({
    title: '重置应用',
    message: '确定恢复出厂设置？此操作不可逆！',
    confirmText: '恢复出厂设置',
    onConfirm: async () => {
      // 全部偏好恢复默认（settings:set 走主进程持久化）
      await settings.update({ ...SETTING_DEFAULTS });
      // 清渲染层 localStorage：桌面歌词窗口把颜色/锁定/字号存在这里
      try {
        localStorage.clear();
      } catch {
        // 忽略
      }
      // 打开用户数据目录，方便残留文件交接（对齐参考版意图）
      try {
        await window.jello?.app?.openLogs?.();
      } catch {
        // 忽略
      }
      setNotice('恢复出厂设置成功，请重启应用', 5000);
    }
  });
};

// ===== 导航 / ESC =====
const goBack = () => router.push('/');

const onKeyDown = (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (confirmDialog.value) {
    closeConfirm();
    return;
  }
  // 层级由上到下：选择弹窗 → 返回播放页
  if (isSelectionOpen.value) {
    isSelectionOpen.value = false;
    return;
  }
  goBack();
};

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  platform.value = window.jello?.app?.platform || '';
  try {
    version.value = await window.jello?.app?.getVersion?.() || '';
  } catch {
    version.value = '';
  }

  if (window.jello?.updates) {
    hasUpdateBridge.value = true;
    try {
      updateState.value = await window.jello.updates.get();
    } catch {
      /* keep default state */
    }
    unsubscribeUpdates = window.jello.updates.onState((next) => {
      updateState.value = next || updateState.value;
    });
  }
  void refreshLibraryCount();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  clearTimeout(noticeTimer);
  unsubscribeUpdates?.();
  unsubscribeUpdates = null;
});
</script>

<template>
  <main class="settings-page" @pointerdown="onSettingsDragPointerDown">
    <!-- 顶栏：返回 + 导入音乐 -->
    <div class="settings-view-bar">
      <button type="button" class="back-btn" title="返回" aria-label="返回" @click="goBack">
        <SvgIcon name="chevronLeft" />
      </button>
      <button type="button" class="switch-account" :disabled="libraryBusy" @click="importLibrary">
        {{ libraryBusy ? '扫描中…' : '导入音乐' }}
      </button>
    </div>

    <!-- 分类胶囊（替代左侧栏） -->
    <div class="settings-chips">
      <button v-for="(section, sectionIndex) in settingSections" :key="section.title" type="button"
        class="settings-chip" :class="{ 'is-active': activeTab === sectionIndex }" @click="activeTab = sectionIndex">
        {{ section.title }}
      </button>
    </div>

    <div class="settings-scroll">
      <div v-for="(section, sectionIndex) in settingSections" :key="section.title" v-show="activeTab === sectionIndex"
        class="setting-section">
        <div class="group-label">{{ section.title }}</div>
        <div class="settings-rows">
          <template v-for="item in visibleItems(section)" :key="item.key">
            <div class="setting-row">
              <div class="row-main">
                <SvgIcon :name="item.icon" class="row-icon" />
                <span class="row-label">{{ labelText(item) }}</span>
                <span v-if="item.experimental" class="row-tag">实验性</span>
                <span v-else-if="item.tag" class="row-tag">{{ item.tag }}</span>
              </div>

              <!-- 开关型：行内开关 -->
              <button v-if="item.control === 'toggle'" type="button" class="row-switch"
                :class="{ 'is-on': !!settings[item.key] }" role="switch" :aria-checked="!!settings[item.key]"
                :aria-label="labelText(item)" @click.stop="updateSetting(item.key, !settings[item.key])">
                <i></i>
              </button>

              <!-- 少量选项：行内分段按钮 -->
              <div v-else-if="item.control === 'seg'" class="row-seg" :class="{ 'is-compact': item.segCompact }">
                <button v-for="option in item.options" :key="String(option.value)" type="button"
                  :class="{ 'is-on': segIsOn(item, option) }" :disabled="segDisabled(item)"
                  @click.stop="onSegClick(item, option)">
                  {{ option.displayText }}
                </button>
              </div>

              <!-- 地址输入：草稿在输入框、生效值在主进程，失焦即保存 + 「输入被拒」判定 -->
              <div v-else-if="item.control === 'field'" class="row-field">
                <input type="text" class="field-input" spellcheck="false" autocomplete="off"
                  :value="item.getValue()" :placeholder="item.placeholder || ''"
                  :aria-label="labelText(item)" @input="item.setValue($event.target.value)"
                  @focus="item.onFocus?.()" @blur="item.onBlur?.()" @keydown.enter.prevent="onFieldEnter($event)" />
                <button type="button" class="field-btn" :disabled="item.buttonDisabled ? item.buttonDisabled() : false"
                  @click.stop="item.onButton?.()">
                  {{ item.buttonText() }}
                </button>
              </div>

              <!-- 滑条型：行内滑条 + 数值（点数值可直接输入，回车/失焦提交，Esc 取消） -->
              <div v-else-if="item.control === 'slider'" class="row-slider-wrap">
                <input v-if="editingSliderKey === item.key" type="text" class="row-value-input"
                  v-model="editingSliderValue" spellcheck="false"
                  @keydown.enter.prevent="$event.target.blur()"
                  @keydown.esc.prevent="cancelSliderEdit"
                  @blur="commitSliderEdit(item)" />
                <span v-else class="row-value row-value-editable" title="点击输入数值"
                  @click="startSliderEdit(item, $event)">{{ sliderDisplay(item) }}</span>
                <input type="range" class="row-slider" :min="item.slider.min" :max="item.slider.max"
                  :step="item.slider.step" :value="settings[item.key]"
                  @change="updateSetting(item.key, Number($event.target.value))" />
              </div>

              <!-- 长列表 / 字体 / 设备 / 动作：值胶囊 -->
              <button v-else type="button" class="row-pill" :disabled="pillDisabled(item)" @click.stop="clickPill(item)">
                <span>{{ pillText(item) }}</span>
                <SvgIcon name="chevron" />
              </button>
            </div>

            <p v-if="descText(item)" class="row-desc">{{ descText(item) }}</p>
            <p v-if="hintText(item)" class="row-desc" :class="{ 'is-error': hintTone(item) === 'error', 'is-ok': hintTone(item) === 'ok' }">
              {{ hintText(item) }}
            </p>

            <!-- 更新行专属：下载进度条 + 版本说明（纯文本、限高可滚） -->
            <div v-if="item.key === 'update' && (isDownloadingUpdate || updateNotes)" class="update-extra">
              <div v-if="isDownloadingUpdate" class="update-progress" role="progressbar"
                :aria-valuenow="updatePercent" aria-valuemin="0" aria-valuemax="100">
                <i :style="{ width: `${updatePercent}%` }"></i>
              </div>
              <pre v-if="updateNotes" class="update-notes">{{ updateNotes }}</pre>
            </div>
          </template>
        </div>
        <p v-if="section.description" class="group-desc">{{ sectionDesc(section) }}</p>
        <div v-if="hasSectionReset(section)" class="group-footer">
          <button type="button" class="reset-section-btn" @click="resetSection(section)">
            <SvgIcon name="refresh" />
            重置{{ section.title }}
          </button>
        </div>
      </div>

      <div class="settings-footer">
        <div class="version-info">
          <p>© Jello Music</p>
          <span>{{ footerVersionText }}</span>
        </div>
        <button type="button" class="factory-reset-button" @click="factoryReset">
          <SvgIcon name="trash" />
          重置应用
        </button>
      </div>
    </div>

    <!-- 选择弹窗：只服务长列表（音质 / 字体 / 输出设备） -->
    <teleport to="body">
      <div v-if="isSelectionOpen" class="modal" @click.self="isSelectionOpen = false">
        <div class="modal-content">
          <h3>{{ selectionTitle }}</h3>
          <input v-if="selectionKind === 'font'" v-model="fontSearch" class="font-search" placeholder="搜索字体..." />
          <ul v-if="selectionKind === 'device'">
            <li v-if="devicesLoading">正在获取设备列表...</li>
            <li v-else-if="deviceOptions.length === 0">未检测到音频输出设备</li>
            <li v-else v-for="option in deviceOptions" :key="option.value"
              :class="{ 'is-current': option.value === selectionValue }" @click="onSelectionPicked(option)">
              {{ option.displayText }}
            </li>
          </ul>
          <ul v-else-if="selectionKind === 'font'" class="font-list">
            <li v-if="fontsLoading">加载中...</li>
            <li v-else-if="fontList.length === 0">默认字体</li>
            <li v-else v-for="option in fontList" :key="option.value" :style="{ fontFamily: option.value }"
              :class="{ 'is-current': option.value === selectionValue }" @click="onSelectionPicked(option)">
              {{ option.displayText }}
            </li>
          </ul>
          <ul v-else>
            <li v-for="option in selectionOptions" :key="option.value"
              :class="{ 'is-current': option.value === selectionValue }" @click="onSelectionPicked(option)">
              {{ option.displayText }}
            </li>
          </ul>
          <button type="button" class="modal-close" @click="isSelectionOpen = false">关闭</button>
        </div>
      </div>
    </teleport>

    <!-- 二次确认弹窗（恢复出厂设置）：复用页面自己的弹窗外观 -->
    <teleport to="body">
      <div v-if="confirmDialog" class="modal" @click.self="closeConfirm">
        <div class="modal-content">
          <h3>{{ confirmDialog.title }}</h3>
          <p class="confirm-message">{{ confirmDialog.message }}</p>
          <div class="modal-actions">
            <button type="button" class="modal-close" @click="closeConfirm">取消</button>
            <button type="button" class="confirm-btn" @click="runConfirm">{{ confirmDialog.confirmText }}</button>
          </div>
        </div>
      </div>
    </teleport>

    <p v-if="notice" class="notice">{{ notice }}</p>
  </main>
</template>

<style scoped>
/* 参考版 SCSS 变量（原样展开为普通 CSS，目标仓库不引入 sass）：
   $accent #FF69B4 / $accent-soft rgba(255,105,180,0.16) / $text #ece9f1 /
   $text-muted rgba(236,233,241,0.55) / $text-faint rgba(236,233,241,0.35) /
   $row-bg rgba(254,254,254,0.045) / $row-border rgba(254,254,254,0.07)。
   字体栈：参考版的 JelloLight 在本仓库不存在，替换为 src/styles.css 的
   'Segoe UI','Microsoft YaHei'，保留其余回退。 */
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* 无边框透明窗口：设置页自铺不透明底。旧版设置是 v-if 换页、播放器不在
     底下，0.96 的底看不出透影；新版播放器常驻、设置叠在上面，半透明会把
     播放器透出来，故用实色还原旧版观感 */
  background: #101114;
  font-family: 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif;
  color: #ece9f1;
  overflow: hidden;
  animation: settings-fade 0.25s ease;
}

@keyframes settings-fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

/* ===== 顶栏（对齐旧版 sigma-view-bar） ===== */
.settings-view-bar {
  height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  padding: 0 10px;
}

.back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(254, 254, 254, 0.1);
  color: #fefefe;
  cursor: pointer;
  transition: background 0.15s ease;
}

.back-btn:hover {
  background: rgba(254, 254, 254, 0.2);
}

.back-btn svg {
  width: 14px;
  height: 14px;
}

.switch-account {
  margin-left: auto;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: rgba(254, 254, 254, 0.1);
  color: #fefefe;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.switch-account:hover {
  background: rgba(254, 254, 254, 0.2);
}

/* ===== 分类胶囊 ===== */
.settings-chips {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  padding: 8px 18px 10px;
}

.settings-chip {
  height: 30px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.06);
  color: rgba(236, 233, 241, 0.55);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, box-shadow 0.12s;
}

.settings-chip:hover {
  background: rgba(254, 254, 254, 0.12);
  color: #ece9f1;
}

.settings-chip.is-active {
  background: #FF69B4;
  color: #fff;
  box-shadow: 0 3px 12px rgba(255, 105, 180, 0.4);
}

/* ===== 滚动区 ===== */
.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 18px 16px;
}

/* 隐藏滚动条（保留滚动）：主滚动区与弹窗统一处理 */
.settings-scroll,
.modal-content,
.modal-content ul {
  scrollbar-width: none;
}

.settings-scroll::-webkit-scrollbar,
.modal-content::-webkit-scrollbar,
.modal-content ul::-webkit-scrollbar {
  display: none;
}

.group-label {
  font-size: 12px;
  letter-spacing: 3px;
  color: #FF69B4;
  margin: 10px 2px 10px;
}

.group-desc {
  margin: 10px 2px 0;
  color: rgba(236, 233, 241, 0.55);
  font-size: 12px;
  line-height: 1.7;
}

.row-desc {
  margin: -1px 4px 2px;
  color: rgba(236, 233, 241, 0.55);
  font-size: 11.5px;
  line-height: 1.6;
}

.row-desc.is-error {
  color: #ff8f8f;
}

.row-desc.is-ok {
  color: rgba(255, 154, 213, 0.95);
}

.settings-rows {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* ===== 设置行 ===== */
.setting-row {
  background: rgba(254, 254, 254, 0.045);
  border: 1px solid rgba(254, 254, 254, 0.07);
  border-radius: 10px;
  padding: 10px 14px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  transition: border-color 0.12s, background 0.12s;
}

.setting-row:hover {
  background: rgba(254, 254, 254, 0.07);
  border-color: rgba(255, 105, 180, 0.35);
}

.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* 对齐参考版 .row-main > i：强调色、13px 字号、18px 宽、居中 */
.row-main .row-icon {
  color: #FF69B4;
  width: 18px;
  height: 18px;
  font-size: 13px;
  text-align: center;
  flex: 0 0 auto;
}

.row-label {
  font-size: 14px;
  color: #ece9f1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-tag {
  font-size: 11px;
  color: rgba(236, 233, 241, 0.35);
  border: 1px solid rgba(254, 254, 254, 0.16);
  border-radius: 4px;
  padding: 1px 6px;
  flex: 0 0 auto;
}

/* ===== 行内开关 ===== */
.row-switch {
  width: 40px;
  height: 22px;
  flex: 0 0 auto;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.16);
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
}

.row-switch i {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fefefe;
  transition: transform 0.15s;
}

.row-switch.is-on {
  background: #FF69B4;
}

.row-switch.is-on i {
  transform: translateX(18px);
}

/* ===== 行内分段按钮 ===== */
.row-seg {
  display: flex;
  gap: 4px;
  background: rgba(254, 254, 254, 0.06);
  border-radius: 999px;
  padding: 3px;
  flex: 0 0 auto;
}

.row-seg button {
  height: 24px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(236, 233, 241, 0.55);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.row-seg button:hover:not(:disabled) {
  color: #ece9f1;
}

.row-seg button.is-on {
  background: #FF69B4;
  color: #fff;
}

.row-seg button:disabled {
  opacity: 0.55;
  cursor: default;
}

/* 6 档播放速率（含 0.5x）在 800px 窗口里会顶到右缘：收紧一档内边距与间隙 */
.row-seg.is-compact {
  gap: 2px;
  padding: 2px;
}

.row-seg.is-compact button {
  height: 22px;
  padding: 0 7px;
  font-size: 11.5px;
}

/* ===== 行内滑条 ===== */
.row-slider-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.row-value {
  font-size: 13px;
  color: rgba(255, 154, 213, 0.9);
  min-width: 52px;
  text-align: right;
}

/* 滑条数值可点击输入：虚线下划线提示可编辑 */
.row-value-editable {
  cursor: pointer;
  border-bottom: 1px dashed rgba(255, 154, 213, 0.35);
}

.row-value-input {
  width: 64px;
  min-width: 0;
  padding: 1px 6px;
  background: rgba(254, 254, 254, 0.06);
  border: 1px solid rgba(255, 105, 180, 0.45);
  border-radius: 4px;
  color: #ece9f1;
  font-family: inherit;
  font-size: 13px;
  text-align: right;
  outline: none;
}

.row-slider {
  width: 140px;
  accent-color: #FF69B4;
  cursor: pointer;
}

/* ===== 行内地址输入 ===== */
.row-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 auto;
  min-width: 0;
}

.field-input {
  flex: 1 1 auto;
  min-width: 0;
  width: 190px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(254, 254, 254, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: #ece9f1;
  font-family: inherit;
  font-size: 12.5px;
  outline: none;
  transition: border-color 0.12s;
}

.field-input::placeholder {
  color: rgba(236, 233, 241, 0.3);
}

.field-input:focus {
  border-color: #FF69B4;
}

.field-btn {
  flex: 0 0 auto;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 105, 180, 0.16);
  color: rgba(255, 154, 213, 0.95);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;
}

.field-btn:hover:not(:disabled) {
  background: rgba(255, 105, 180, 0.28);
}

.field-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

/* ===== 更新进度 / 版本说明 ===== */
.update-extra {
  margin: -1px 4px 2px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.update-progress {
  height: 6px;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.1);
  overflow: hidden;
}

.update-progress i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: #FF69B4;
  transition: width 0.2s ease;
}

.update-notes {
  max-height: 132px;
  overflow-y: auto;
  margin: 0;
  padding: 9px 11px;
  border: 1px solid rgba(254, 254, 254, 0.07);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
  color: rgba(236, 233, 241, 0.65);
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: none;
}

.update-notes::-webkit-scrollbar {
  display: none;
}

/* ===== 值胶囊 ===== */
.row-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 14px;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.08);
  color: rgba(236, 233, 241, 0.55);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  max-width: 240px;
  flex: 0 0 auto;
  transition: background 0.12s;
}

.row-pill span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-pill svg {
  width: 10px;
  height: 10px;
  opacity: 0.5;
  flex: 0 0 auto;
}

.row-pill:hover:not(:disabled) {
  background: rgba(254, 254, 254, 0.16);
  color: #ece9f1;
}

.row-pill:disabled {
  opacity: 0.55;
  cursor: default;
}

/* ===== 分组底部 / 页面底部 ===== */
.group-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.reset-section-btn {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(236, 233, 241, 0.35);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}

.reset-section-btn svg {
  width: 12px;
  height: 12px;
  margin-right: 6px;
}

.reset-section-btn:hover {
  color: #ece9f1;
  background: rgba(254, 254, 254, 0.06);
}

.settings-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding: 12px 4px 4px;
  border-top: 1px solid rgba(254, 254, 254, 0.07);
}

.version-info p {
  margin: 0 0 2px;
  font-size: 12px;
  color: rgba(236, 233, 241, 0.55);
}

.version-info span {
  font-size: 11px;
  color: rgba(236, 233, 241, 0.35);
}

.factory-reset-button {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 16px;
  border: 1px solid rgba(255, 105, 180, 0.35);
  border-radius: 999px;
  background: rgba(255, 105, 180, 0.16);
  color: rgba(255, 154, 213, 0.95);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;
}

.factory-reset-button svg {
  width: 12px;
  height: 12px;
  margin-right: 6px;
}

.factory-reset-button:hover {
  background: rgba(255, 105, 180, 0.28);
}

/* ===== 弹窗（深色玻璃） ===== */
.modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  width: 320px;
  max-width: calc(100% - 48px);
  max-height: 70vh;
  overflow-y: auto;
  background: rgba(22, 20, 28, 0.97);
  border: 1px solid rgba(254, 254, 254, 0.1);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modal-content h3 {
  margin: 0;
  font-family: inherit;
  font-size: 17px;
  font-weight: 500;
  color: #ece9f1;
  text-align: center;
}

.modal-content ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 300px;
  overflow-y: auto;
}

.modal-content li {
  padding: 8px 12px;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  color: rgba(236, 233, 241, 0.55);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.modal-content li:hover {
  background: rgba(255, 105, 180, 0.16);
  color: #ece9f1;
}

.modal-content li.is-current {
  color: #FF69B4;
  font-weight: 600;
}

.font-search {
  height: 32px;
  border: 1px solid rgba(254, 254, 254, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  color: #ece9f1;
  font-family: inherit;
  font-size: 13px;
  padding: 0 10px;
  outline: none;
}

.font-search:focus {
  border-color: #FF69B4;
}

.modal-close {
  height: 32px;
  border: none;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.08);
  color: #ece9f1;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.modal-close:hover {
  background: rgba(254, 254, 254, 0.16);
}

/* ===== 二次确认弹窗 ===== */
.confirm-message {
  margin: 0;
  color: rgba(236, 233, 241, 0.55);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

.modal-actions {
  display: flex;
  gap: 8px;
}

.modal-actions .modal-close {
  flex: 1;
}

.confirm-btn {
  flex: 1;
  height: 32px;
  border: none;
  border-radius: 999px;
  background: #FF69B4;
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}

.confirm-btn:hover {
  background: #ff7fbf;
}

/* ===== 提示条 ===== */
.notice {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 1100;
  max-width: calc(100% - 48px);
  margin: 0;
  padding: 9px 18px;
  border: 1px solid rgba(254, 254, 254, 0.1);
  border-radius: 999px;
  background: rgba(22, 20, 28, 0.97);
  color: rgba(255, 154, 213, 0.95);
  font-size: 12px;
  text-align: center;
}
</style>
