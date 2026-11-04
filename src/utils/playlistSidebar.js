// 长按拖动的本地排序：按保存的 key 顺序排列歌单条目（未记录的保持原相对顺序）
export const applyPlaylistOrder = (entries, savedOrder = []) => {
  const order = Array.isArray(savedOrder) ? savedOrder.map(String) : [];
  const rank = new Map(order.map((key, index) => [key, index]));
  const fallback = order.length;
  return entries
    .map((entry, index) => ({
      entry,
      index,
      rank: rank.has(entry.key) ? rank.get(entry.key) : fallback
    }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map(({ entry }) => entry);
};

export const buildPlaylistSidebarItems = (playlists, { savedOrder = [] } = {}) => {
  const items = [
    { key: 'guess', type: 'guess', name: '猜你喜欢' },
    { key: 'daily', type: 'daily', name: '每日推荐' }
  ];

  const entries = (Array.isArray(playlists) ? playlists : [])
    .filter((playlist) => playlist?.id)
    .map((playlist) => ({
      key: `pl-${playlist.id}`,
      type: 'playlist',
      id: playlist.id,
      idType: playlist.idType,
      name: String(playlist.name || '').trim() || '歌单'
    }));

  items.push(...applyPlaylistOrder(entries, savedOrder));
  items.push({ key: 'import', type: 'import', name: '导入音乐…' });
  return items;
};
