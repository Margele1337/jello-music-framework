import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

// player.js 依赖浏览器 Audio 与 toast 事件通道，这里给出最小纯逻辑替身
class FakeAudio {
  constructor() {
    this.listeners = {};
    this.src = '';
    this.preload = '';
    this.crossOrigin = '';
    this.currentTime = 0;
    this.volume = 1;
    this.playbackRate = 1;
    this.paused = true;
    this.error = null;
    this.playImpl = null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  removeEventListener() {}

  dispatch(type) {
    for (const fn of this.listeners[type] || []) fn();
  }

  play() {
    if (this.playImpl) return this.playImpl();
    this.paused = false;
    this.dispatch('play');
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatch('pause');
  }
}

globalThis.Audio = FakeAudio;

let localResolve = async (hash) => ({ exists: true, url: `jello-local://audio/${hash}`, ext: 'mp3' });
const toasts = [];
// 播放状态持久化桥的测试替身：save 全量记录，get 返回注入的状态
const persistedPlayback = [];
let storedPlaybackState = null;
globalThis.window = {
  dispatchEvent: (event) => {
    toasts.push(String(event?.detail || ''));
    return true;
  },
  jello: {
    library: {
      resolve: (hash) => localResolve(hash)
    },
    playbackState: {
      get: async () => storedPlaybackState,
      save: (state) => { persistedPlayback.push(state); }
    }
  }
};

const { usePlayerStore } = await import('../src/stores/player.js');
const { useSettingsStore } = await import('../src/stores/settings.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 自动跳歌由定时器驱动，固定 sleep 在负载下会与多步循环赛跑：改为轮询等条件
const waitFor = async (predicate, timeoutMs = 2000, intervalMs = 10) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await sleep(intervalMs);
  return predicate();
};

// 常用桩：本地音乐库解析出协议 URL；playable 返回 false 模拟文件被移动/删除
const stubApi = ({ playable = () => true, onUrl = null } = {}) => {
  localResolve = async (hash) => {
    if (onUrl) onUrl({ hash, quality: 'local' });
    if (!playable(hash)) return { exists: false, url: '', ext: '' };
    return { exists: true, url: `jello-local://audio/${hash}`, ext: 'mp3' };
  };
};

const setupPlayer = ({ queueSize = 2 } = {}) => {
  setActivePinia(createPinia());
  useSettingsStore();
  const player = usePlayerStore();
  player.queue = Array.from({ length: queueSize }, (_, i) => ({ hash: `h${i}`, name: `歌曲${i}` }));
  player.index = 0;
  player.autoAdvanceDelayMs = 10;
  toasts.length = 0;
  return player;
};

test('exposes playback mode under the Sigma UI getter name and cycles it', () => {
  setActivePinia(createPinia());
  const player = usePlayerStore();

  assert.equal(player.currentPlaybackModeIndex, 1);
  player.togglePlaybackMode();
  assert.equal(player.currentPlaybackModeIndex, 2);
  player.togglePlaybackMode();
  assert.equal(player.currentPlaybackModeIndex, 0);
  player.togglePlaybackMode();
  assert.equal(player.currentPlaybackModeIndex, 1);
});

test('queue removal keeps the current index aligned', () => {
  setActivePinia(createPinia());
  const player = usePlayerStore();
  player.queue = [{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }, { hash: 'd' }];

  // 移除当前之前的歌曲 → 索引前移
  player.index = 2;
  player.removeFromQueue(0);
  assert.equal(player.index, 1);
  assert.equal(player.queue.length, 3);

  // 移除当前之后的歌曲 → 索引不动
  player.removeFromQueue(2);
  assert.equal(player.index, 1);
  assert.equal(player.queue.length, 2);

  // 越界与清空
  player.removeFromQueue(9);
  player.clearQueue();
  assert.equal(player.queue.length, 0);
  assert.equal(player.index, -1);
});

test('loadCurrent resolves local files to the local protocol URL', async () => {
  stubApi();
  const player = setupPlayer();
  await player.loadCurrent();

  assert.equal(player.error, '');
  assert.equal(player.playing, true);
  assert.equal(player.audio.src, 'jello-local://audio/h0');
});

test('source error schedules an auto advance when the local file is gone', async () => {
  stubApi({ playable: () => false });
  const player = setupPlayer();
  player.autoAdvanceDelayMs = 200;

  await player.loadCurrent();

  assert.match(player.error, /文件已移动或删除/);
  assert.equal(player.failStreak, 1);
  assert.match(player.error, /自动切换下一首/);
  assert.ok(toasts.some((text) => text.includes('自动切换下一首')));

  // 两首歌循环下索引每步 1↔0 往复：看到推进到 1 就清空队列停掉后续定时器，
  // 避免断言时机正好落在绕回 0 的瞬间
  await waitFor(() => player.index === 1);
  assert.equal(player.index, 1);
  player.clearQueue();
});

test('successful playback resets failure counters', async () => {
  stubApi();
  const player = setupPlayer();
  player.failStreak = 4;

  await player.loadCurrent();
  assert.equal(player.failStreak, 0);
});

test('auto advance stops after five consecutive failures', async () => {
  // 所有歌曲的文件都不存在
  stubApi({ playable: () => false });
  const player = setupPlayer({ queueSize: 7 });

  await player.loadCurrent(); // 失败 1
  await waitFor(() => player.error.includes('已停止自动切歌'), 3000);

  assert.match(player.error, /已停止自动切歌/);
  assert.equal(player.failStreak, 0);
  // 5 次跳歌上限 + 初始曲目：最多推进到索引 5，不会绕圈刷屏
  assert.ok(player.index <= 5);
});

test('unplayable single track never spins the auto advance loop', async () => {
  stubApi({ playable: () => false });
  const player = setupPlayer({ queueSize: 1 });

  await player.loadCurrent();
  await sleep(30);

  assert.equal(player.failStreak, 0);
  assert.equal(player.index, 0);
  assert.equal(player.queue.length, 1);
  assert.ok(player.error);
});

// ===== 随机模式历史栈 =====

// 候选按升序构建，Math.random=0 恒取第一个候选，选歌完全确定
const withFixedRandom = async (fn) => {
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    await fn();
  } finally {
    Math.random = realRandom;
  }
};

test('shuffle previous walks the played history and next walks forward again', async () => {
  stubApi();
  const player = setupPlayer({ queueSize: 5 });
  player.mode = 0;
  player.index = 0;
  player.resetShuffleTracking(0);

  await withFixedRandom(async () => {
    player.playNext(); // 候选 [1,2,3,4] → 1
    assert.equal(player.index, 1);
    player.playNext(); // 本轮已播 {0,1}，候选 [2,3,4] → 2
    assert.equal(player.index, 2);
    assert.deepEqual(player.shuffleHistory, [0, 1, 2]);

    player.playPrevious(); // 沿栈回退到实际播过的 1
    assert.equal(player.index, 1);
    player.playPrevious();
    assert.equal(player.index, 0);

    player.playNext(); // 回溯后 next 沿栈前进重放
    assert.equal(player.index, 1);
    player.playNext();
    assert.equal(player.index, 2);
    assert.equal(player.shuffleCursor, 2);
  });
  await sleep(10);
});

test('shuffle next-pick avoids repeats until the whole queue has played', async () => {
  stubApi();
  const player = setupPlayer({ queueSize: 4 });
  player.mode = 0;
  player.index = 0;
  player.resetShuffleTracking(0);

  await withFixedRandom(() => {
    const seen = new Set([0]);
    for (let i = 0; i < 3; i += 1) {
      const next = player.pickShuffleIndex();
      assert.ok(!seen.has(next), `第 ${i + 1} 次选歌重复了本轮已播曲目`);
      seen.add(next);
      player.noteShufflePlay(next);
      player.index = next;
    }
    assert.equal(seen.size, 4);

    // 整队播完 → 新一轮允许重复，但仍避开当前曲
    const again = player.pickShuffleIndex();
    assert.notEqual(again, player.index);
  });
});

test('shuffle previous at the history head inserts a pick that next can undo', async () => {
  stubApi();
  const player = setupPlayer({ queueSize: 5 });
  player.mode = 0;
  player.index = 2;
  player.resetShuffleTracking(2);

  await withFixedRandom(() => {
    player.playPrevious(); // 栈头无更早历史：候选 [0,1,3,4] → 0 插入栈首
    assert.equal(player.index, 0);
    assert.deepEqual(player.shuffleHistory, [0, 2]);
    assert.equal(player.shuffleCursor, 0);

    player.playNext(); // 前进即回到按键前的曲目
    assert.equal(player.index, 2);
    assert.equal(player.shuffleCursor, 1);
  });
  await sleep(10);
});

test('queue removal remaps or drops stale shuffle history indices', () => {
  setActivePinia(createPinia());
  const player = usePlayerStore();
  player.queue = Array.from({ length: 5 }, (_, i) => ({ hash: `h${i}` }));
  player.mode = 0;
  player.shuffleHistory = [0, 2, 4];
  player.shuffleCursor = 2;
  player.shuffleCycle = [2, 4];

  player.removeFromQueue(1); // 删掉不在历史里的歌：其后索引整体前移
  assert.deepEqual(player.shuffleHistory, [0, 1, 3]);
  assert.deepEqual(player.shuffleCycle, [1, 3]);
  assert.equal(player.shuffleCursor, 2);

  player.removeFromQueue(3); // 删掉游标指向的歌：失效条目剔除，游标钳回栈尾
  assert.deepEqual(player.shuffleHistory, [0, 1]);
  assert.equal(player.shuffleCursor, 1);

  player.clearQueue();
  assert.deepEqual(player.shuffleHistory, []);
  assert.equal(player.shuffleCursor, -1);
  assert.deepEqual(player.shuffleCycle, []);
});

test('switching playback mode clears the shuffle history like the legacy app', () => {
  setActivePinia(createPinia());
  // playNext/playPrevious 会 fire-and-forget 地 loadCurrent：给本测试独立的
  // 解析桩，避免泄漏请求打到后续测试的 onUrl 记录器（时序随实现细节漂移）
  stubApi();
  const player = usePlayerStore();
  player.queue = [{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }];
  player.index = 1;
  player.mode = 0;
  player.shuffleHistory = [0, 1];
  player.shuffleCursor = 1;

  player.togglePlaybackMode(); // 0 → 1
  assert.equal(player.mode, 1);
  assert.deepEqual(player.shuffleHistory, [1]); // 以当前曲目重新起栈
  assert.equal(player.shuffleCursor, 0);

  // 列表循环的上一首/下一首保持原有 ±1 环绕行为
  player.playNext();
  assert.equal(player.index, 2);
  player.playPrevious();
  assert.equal(player.index, 1);
});

// ===== 播放状态持久化 =====

test('restorePersistedState repopulates state without autoplay and seeks on hash match', async () => {
  const requested = [];
  // 只记录本测试队列的 hash：前面测试 fire-and-forget 的 loadCurrent 若因
  // 时序漂移落到本 stub 上，不应污染「恢复不预取」的断言
  stubApi({ onUrl: (params) => { if (String(params.hash).startsWith('r')) requested.push(params.hash); } });
  storedPlaybackState = {
    queue: [
      { hash: 'r0', name: '歌0', timeLength: 60000 },
      { hash: 'r1', name: '歌1', timeLength: 120000 }
    ],
    index: 1,
    mode: 0,
    progress: 42
  };
  setActivePinia(createPinia());
  useSettingsStore();
  const player = usePlayerStore();
  player.failStreak = 3;

  await player.restorePersistedState();

  assert.equal(player.queue.length, 2);
  assert.equal(player.index, 1);
  assert.equal(player.mode, 0);
  // 恢复等同手动换列表：失败计数复位、不触发自动跳歌
  assert.equal(player.failStreak, 0);
  // 不自动播放、不预取流地址（离线启动也不会触发跳歌连锁）
  assert.equal(player.playing, false);
  assert.deepEqual(requested, []);

  // 用户首次播放：元数据就绪后定位到保存进度（hash 匹配）
  await player.loadCurrent();
  assert.ok(requested.includes('r1'));
  const element = player.audio;
  element.dispatch('loadedmetadata');
  assert.equal(element.currentTime, 42);
  await sleep(5);
});

test('restore seek is discarded when a different song loads first', async () => {
  stubApi();
  storedPlaybackState = {
    queue: [
      { hash: 'r0', name: '歌0', timeLength: 60000 },
      { hash: 'r1', name: '歌1', timeLength: 120000 }
    ],
    index: 1,
    mode: 1,
    progress: 30
  };
  setActivePinia(createPinia());
  useSettingsStore();
  const player = usePlayerStore();

  await player.restorePersistedState();
  const element = player.audio;
  // FakeAudio 不实现 once 语义且单例跨测试复用：只清上一用例残留的定位监听，
  // 不能整个 listeners 置空（play/pause 等由 ensureAudio 注册的监听会丢）
  element.listeners.loadedmetadata = [];
  element.currentTime = 0;
  player.playIndex(0); // 用户先点了另一首：hash 不匹配，定位作废
  await sleep(10);
  element.dispatch('loadedmetadata');
  assert.equal(element.currentTime, 0);
});

test('corrupt persisted state restores as empty without throwing', async () => {
  storedPlaybackState = { queue: 'garbage', index: 'x' };
  setActivePinia(createPinia());
  useSettingsStore();
  const player = usePlayerStore();
  await player.restorePersistedState();
  assert.deepEqual(player.queue, []);
  assert.equal(player.index, -1);

  storedPlaybackState = null; // 桥返回空 → 静默
  await player.restorePersistedState();
  assert.deepEqual(player.queue, []);
});

test('song change and pause push sanitized state to the bridge', async () => {
  stubApi();
  const player = setupPlayer();
  persistedPlayback.length = 0;

  await player.loadCurrent(); // 换歌完成 → 立即落盘一次
  assert.ok(persistedPlayback.length >= 1);

  player.audio.currentTime = 12.5;
  player.audio.pause(); // 暂停 → 再落盘，带上真实进度
  const last = persistedPlayback[persistedPlayback.length - 1];
  assert.equal(last.index, 0);
  assert.equal(last.mode, player.mode);
  assert.equal(last.progress, 12.5);
  assert.equal(last.queue.length, 2);
  assert.equal(last.queue[0].hash, 'h0');
  // 渲染层只送最小字段集
  assert.deepEqual(Object.keys(last.queue[0]).sort(), [
    'albumAudioId', 'albumId', 'author', 'hash', 'img', 'name', 'timeLength'
  ]);
});
