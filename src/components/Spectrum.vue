<template>
  <div class="spectrum" aria-hidden="true">
    <i v-for="(height, index) in bars" :key="index" :style="{ height: `${height}%` }"></i>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps({
  analyser: {
    type: Object,
    default: null
  }
});

const BAR_COUNT = 28;
const bars = ref(Array.from({ length: BAR_COUNT }, () => 6));
const data = new Uint8Array(128);
let frameId = 0;

function draw() {
  frameId = requestAnimationFrame(draw);

  const analyser = props.analyser;
  if (!analyser) {
    return;
  }

  analyser.getByteFrequencyData(data);
  const next = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const index = Math.floor((i * data.length) / BAR_COUNT);
    const value = data[index] / 255;
    next.push(Math.max(6, Math.round(value * 100)));
  }
  bars.value = next;
}

onMounted(() => {
  frameId = requestAnimationFrame(draw);
});

onUnmounted(() => {
  cancelAnimationFrame(frameId);
});
</script>
