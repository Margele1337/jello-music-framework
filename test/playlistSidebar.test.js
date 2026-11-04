import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlaylistOrder, buildPlaylistSidebarItems } from '../src/utils/playlistSidebar.js';

const names = (items) => items.map((item) => item.name);

const localPlaylists = [
  { id: 'local-all', name: '本地音乐', idType: 'local' },
  { id: 'local-liked', name: '我喜欢', idType: 'local' },
  { id: 'local-recent', name: '最近添加', idType: 'local' }
];

test('builds fixed entries, local playlists and the import action', () => {
  const items = buildPlaylistSidebarItems(localPlaylists);
  assert.deepEqual(names(items), [
    '猜你喜欢', '每日推荐', '本地音乐', '我喜欢', '最近添加', '导入音乐…'
  ]);
  assert.deepEqual(items[2], {
    key: 'pl-local-all',
    type: 'playlist',
    id: 'local-all',
    idType: 'local',
    name: '本地音乐'
  });
  assert.equal(items[5].type, 'import');
});

test('applyPlaylistOrder reorders playlist entries by saved keys and ignores unknown keys', () => {
  const entries = [
    { key: 'pl-liked', name: '我喜欢' },
    { key: 'pl-a', name: '歌单A' },
    { key: 'pl-b', name: '歌单B' }
  ];
  const ordered = applyPlaylistOrder(entries, ['pl-a', 'pl-liked', 'pl-b']);
  assert.deepEqual(ordered.map((item) => item.name), ['歌单A', '我喜欢', '歌单B']);
  // 未记录的 key 排在已记录之后、彼此保持原相对顺序
  const partial = applyPlaylistOrder(entries, ['pl-b']);
  assert.deepEqual(partial.map((item) => item.name), ['歌单B', '我喜欢', '歌单A']);
  // 空顺序 = 原顺序
  assert.deepEqual(applyPlaylistOrder(entries, []).map((item) => item.name), ['我喜欢', '歌单A', '歌单B']);
});

test('buildPlaylistSidebarItems applies the saved drag order to playlists only', () => {
  const items = buildPlaylistSidebarItems(localPlaylists, {
    savedOrder: ['pl-local-recent', 'pl-local-all', 'pl-local-liked']
  });
  assert.deepEqual(names(items), [
    '猜你喜欢', '每日推荐', '最近添加', '本地音乐', '我喜欢', '导入音乐…'
  ]);
});

test('ignores playlists without an id', () => {
  const items = buildPlaylistSidebarItems([
    { name: '没有 id 的歌单' },
    { id: 'local-all', name: '本地音乐' }
  ]);
  assert.deepEqual(names(items), ['猜你喜欢', '每日推荐', '本地音乐', '导入音乐…']);
});
