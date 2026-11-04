import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_ARG,
  formatTrayTooltip,
  hasSettingsArg
} from '../shared/ipc.js';

test('detects the --settings launch argument', () => {
  assert.equal(hasSettingsArg(['C:\\app\\jello.exe', SETTINGS_ARG]), true);
  assert.equal(hasSettingsArg(['C:\\app\\jello.exe']), false);
  assert.equal(hasSettingsArg([]), false);
  assert.equal(hasSettingsArg(undefined), false);
});

test('formats the tray tooltip from playback state', () => {
  assert.equal(
    formatTrayTooltip({ playing: true, title: '晴天', artist: '周杰伦' }),
    '正在播放：晴天 - 周杰伦'
  );
  assert.equal(
    formatTrayTooltip({ playing: false, title: '晴天', artist: '周杰伦' }),
    '已暂停：晴天 - 周杰伦'
  );
  // 无歌手时不悬挂分隔符
  assert.equal(formatTrayTooltip({ playing: true, title: '晴天' }), '正在播放：晴天');
  // 无歌曲/空状态回退应用名
  assert.equal(formatTrayTooltip({ playing: true, title: '', artist: '' }), 'Jello Music Framework');
  assert.equal(formatTrayTooltip(null), 'Jello Music Framework');
  assert.equal(formatTrayTooltip(), 'Jello Music Framework');
});
