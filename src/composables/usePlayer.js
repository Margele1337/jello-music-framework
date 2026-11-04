import { computed, onUnmounted, ref, shallowRef } from 'vue';
import { DemoPlayer } from '../core/DemoPlayer.js';
import { DemoSource } from '../sources/DemoSource.js';

const source = new DemoSource();
const player = new DemoPlayer();

const tracks = ref([]);
const currentIndex = ref(-1);
const playing = ref(false);
const position = ref(0);
const analyser = shallowRef(null);

let timer = null;
let loaded = false;

function stopTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function startTimer() {
  stopTimer();
  timer = setInterval(() => {
    if (!player.track) {
      return;
    }
    const next = player.position();
    position.value = next;
    if (next >= player.track.duration) {
      stopTimer();
      advance(1);
    }
  }, 250);
}

async function select(index, autoplay = true) {
  if (!tracks.value.length) {
    return;
  }
  const normalized = ((index % tracks.value.length) + tracks.value.length) % tracks.value.length;
  currentIndex.value = normalized;
  const track = tracks.value[normalized];
  const stream = await source.resolveStream(track);
  player.load({ ...track, ...stream });
  position.value = 0;
  analyser.value = player.getAnalyser();
  if (autoplay) {
    await play();
  }
}

async function play() {
  await player.play();
  playing.value = true;
  analyser.value = player.getAnalyser();
  startTimer();
}

function pause() {
  player.pause();
  playing.value = false;
  position.value = player.position();
  stopTimer();
}

async function toggle() {
  if (playing.value) {
    pause();
  } else {
    await play();
  }
}

async function advance(delta) {
  await select(currentIndex.value + delta);
}

async function load() {
  tracks.value = await source.listTracks();
  if (currentIndex.value < 0 && tracks.value.length) {
    await select(0, false);
  }
}

export function usePlayer() {
  if (!loaded) {
    loaded = true;
    load();
  }

  const current = computed(() => tracks.value[currentIndex.value] ?? null);
  const progress = computed(() => {
    const track = current.value;
    if (!track || !track.duration) {
      return 0;
    }
    return Math.min(100, (position.value / track.duration) * 100);
  });

  function seek(seconds) {
    if (!current.value) {
      return;
    }
    player.seek(seconds);
    position.value = player.position();
  }

  onUnmounted(() => {
    stopTimer();
    player.stop();
  });

  return {
    tracks,
    current,
    currentIndex,
    playing,
    position,
    progress,
    analyser,
    select,
    toggle,
    next: () => advance(1),
    prev: () => advance(-1),
    seek,
    source
  };
}
