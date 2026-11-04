<template>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"></span>
        <div>Jello<span>framework</span></div>
      </div>

      <nav class="nav">
        <button :class="{ active: view === 'player' }" @click="view = 'player'">正在播放</button>
        <button :class="{ active: view === 'library' }" @click="view = 'library'">媒体库</button>
        <button :class="{ active: view === 'about' }" @click="view = 'about'">关于框架</button>
      </nav>

      <div class="side-foot">MIT License · v{{ version }}</div>
    </aside>

    <main class="main">
      <section v-if="view === 'player'" class="view player-view">
        <div class="cover">
          <div class="disc"></div>
        </div>

        <div class="track-meta">
          <p class="eyebrow">Now playing</p>
          <h1>{{ current?.title ?? '选择一首曲目' }}</h1>
          <p class="artist">{{ current?.artist ?? 'Demo source' }}</p>
        </div>

        <div class="progress" @click="onSeek">
          <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
        </div>
        <div class="time">
          <span>{{ format(position) }}</span>
          <span>{{ format(current?.duration ?? 0) }}</span>
        </div>

        <div class="controls">
          <button @click="prev">上一首</button>
          <button class="primary" @click="toggle">{{ playing ? '暂停' : '播放' }}</button>
          <button @click="next">下一首</button>
        </div>

        <Spectrum :analyser="analyser" />

        <div class="lyrics">
          <p class="eyebrow">Lyrics</p>
          <p v-for="(line, index) in current?.lyrics ?? []" :key="index">{{ line }}</p>
        </div>
      </section>

      <section v-else-if="view === 'library'" class="view library-view">
        <p class="eyebrow">Demo source</p>
        <h1>媒体库</h1>
        <p class="hint">
          这些曲目由 DemoSource 在本地合成，不访问任何外部接口。
          实现 MusicSource 即可替换成自己的数据源。
        </p>

        <ul class="track-list">
          <li v-for="(track, index) in tracks" :key="track.id" :class="{ active: index === currentIndex }">
            <button @click="select(index)">
              <strong>{{ track.title }}</strong>
              <span>{{ track.artist }} · {{ format(track.duration) }}</span>
            </button>
          </li>
        </ul>
      </section>

      <section v-else class="view about-view">
        <p class="eyebrow">Framework</p>
        <h1>Jello Music Framework</h1>
        <p class="hint">
          一个干净、MIT 开源的桌面音乐播放框架。播放层、歌词、频谱和窗口安全边界已经准备好，
          数据源通过适配器接入。
        </p>

        <ul class="bullets">
          <li>Electron + Vue 3 + Vite，主进程与渲染进程严格隔离</li>
          <li>MusicSource 适配器接口；内置 DemoSource 使用本地合成音频</li>
          <li>不内置、不代理、不分发任何音乐内容或第三方接口</li>
          <li>MIT License，可自由用于自己的播放器项目</li>
        </ul>

        <p class="hint">
          架构说明见 docs/ARCHITECTURE.md；适配器契约见 src/sources/MusicSource.js。
        </p>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import Spectrum from './components/Spectrum.vue';
import { usePlayer } from './composables/usePlayer.js';

const {
  tracks,
  current,
  currentIndex,
  playing,
  position,
  progress,
  analyser,
  select,
  toggle,
  next,
  prev,
  seek
} = usePlayer();

const view = ref('player');
const version = '0.1.0';

function format(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function onSeek(event) {
  if (!current.value) {
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  seek(ratio * current.value.duration);
}
</script>
