<template>
  <div class="sigma-search-box">
    <SigmaTextField
      class="sigma-search-box-field"
      v-model="keyword"
      placeholder="搜索本地音乐..."
      @submit="doSearch"
    />
    <SigmaScrollablePanel class="sigma-search-box-results" ref="resultsEl">
      <SigmaThumbnailButton
        v-for="(card, index) in cards"
        :key="card.key"
        :type="card.type"
        :cover="card.cover"
        :title="card.title"
        :artist="card.artist"
        :style="cardStyle(index)"
        @click="onCardClick(card)"
      />
    </SigmaScrollablePanel>
    <p v-if="status" class="sigma-search-box-status">{{ status }}</p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import artworkImg from '../../assets/sigma/music/artwork.png';
import {
  getDailyRecommend,
  getPlaylistTracks,
  searchSongs
} from '../../services/source/localLibrary.js';
import SigmaTextField from './SigmaTextField.vue';
import SigmaScrollablePanel from './SigmaScrollablePanel.vue';
import SigmaThumbnailButton from './SigmaThumbnailButton.vue';

const props = defineProps({
  player: { type: Object, default: null }
});

const emit = defineEmits(['open-playlist', 'search']);

const keyword = ref('');
const cards = ref([]);
const status = ref('');
const resultsEl = ref(null);

let requestToken = 0;

const cardStyle = (index) => ({
  left: `${[0, 183, 366][index % 3]}px`,
  top: `${90 + Math.floor(index / 3) * 220}px`
});

const toSongCard = (song) => ({
  type: 'song',
  key: `sn-${song.hash}`,
  hash: song.hash,
  title: song.name,
  artist: song.author,
  cover: song.img || artworkImg,
  timelen: song.timeLength,
  song
});

const doSearch = async () => {
  const text = keyword.value.trim();
  emit('search', text);
  const token = ++requestToken;

  if (!text) {
    cards.value = [];
    status.value = '';
    return;
  }

  cards.value = [];
  status.value = '搜索中…';

  try {
    const songs = await searchSongs(text);
    if (token !== requestToken) return;
    cards.value = songs.map(toSongCard);
    if (!cards.value.length) status.value = '没有找到本地歌曲';
    else status.value = '';
  } catch (error) {
    if (token === requestToken) status.value = error?.message || '搜索失败';
  }
};

const showPlaylist = async (item) => {
  const target = typeof item === 'string' ? { id: item } : (item || {});
  if (!target.id) return;

  const token = ++requestToken;
  cards.value = [];
  status.value = '正在载入歌单…';

  try {
    const songs = await getPlaylistTracks(target);
    if (token !== requestToken) return;
    cards.value = songs.map(toSongCard);
    status.value = songs.length ? '' : '这个歌单还没有歌曲';
  } catch (error) {
    if (token === requestToken) status.value = error?.message || '歌单载入失败';
  }
};

const loadDailyRecommend = async () => {
  const token = ++requestToken;
  cards.value = [];
  status.value = '正在载入每日推荐…';

  try {
    const songs = await getDailyRecommend();
    if (token !== requestToken) return;
    cards.value = songs.map(toSongCard);
    status.value = songs.length ? '' : '音乐库为空，点击右侧 + 导入音乐文件夹';
  } catch (error) {
    if (token === requestToken) status.value = error?.message || '音乐库载入失败';
  }
};

const clear = () => {
  requestToken += 1;
  cards.value = [];
  status.value = '';
};

onMounted(loadDailyRecommend);

defineExpose({
  showPlaylist,
  loadDailyRecommend,
  clear
});

const onCardClick = (card) => {
  if (!props.player) return;
  if (card.type === 'playlist') {
    emit('open-playlist', {
      id: card.id,
      idType: card.idType,
      listId: card.listId,
      name: card.name
    });
    void showPlaylist(card);
    return;
  }

  const songs = cards.value
    .filter((item) => item.type === 'song')
    .map((item) => item.song);
  props.player.playSongList?.(songs, card.hash);
};
</script>

<style scoped>
.sigma-search-box {
  position: absolute;
  left: 250px;
  top: 0;
  width: 550px;
  height: 506px;
  z-index: 2;
}

.sigma-search-box-field {
  left: 30px;
  top: 14px;
  width: 490px;
  height: 70px;
  z-index: 3;
}

.sigma-search-box-results {
  left: 0;
  top: 0;
  width: 550px;
  height: 506px;
}

.sigma-search-box-status {
  position: absolute;
  left: 30px;
  right: 30px;
  top: 50%;
  transform: translateY(-50%);
  margin: 0;
  color: rgba(254, 254, 254, 0.55);
  font-family: 'SigmaLight', sans-serif;
  font-size: 13px;
  line-height: 18px;
  text-align: center;
  pointer-events: none;
  z-index: 3;
}
</style>
