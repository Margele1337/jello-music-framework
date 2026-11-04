import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_DEFAULTS, sanitizeSettings } from '../shared/settings.js';

test('setting defaults are frozen and keep only local-player settings', () => {
  assert.equal(Object.isFrozen(SETTING_DEFAULTS), true);
  assert.equal(SETTING_DEFAULTS.volume, 1);
  assert.equal(SETTING_DEFAULTS.quality, undefined);
  assert.equal(SETTING_DEFAULTS.dataSource, undefined);
  assert.equal(SETTING_DEFAULTS.proxyUrl, undefined);
});

test('sanitize keeps known keys and drops unknown ones', () => {
  const next = sanitizeSettings({
    quality: 'flac',
    unknown: 'drop',
    minimizeToTray: true
  });
  assert.deepEqual(next, { minimizeToTray: true });
});

test('sanitize clamps volume and rejects wrong types', () => {
  assert.deepEqual(sanitizeSettings({ volume: 2 }), { volume: 1 });
  assert.deepEqual(sanitizeSettings({ volume: -1 }), { volume: 0 });
  assert.deepEqual(sanitizeSettings({ volume: 'loud' }), {});
  assert.deepEqual(sanitizeSettings({ masterVolume: 1.5 }), { masterVolume: 1 });
  assert.deepEqual(sanitizeSettings({ masterVolume: -0.1 }), { masterVolume: 0 });
  assert.deepEqual(sanitizeSettings({ masterVolume: 'loud' }), {});
  assert.deepEqual(sanitizeSettings({ minimizeToTray: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ desktopLyrics: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ desktopLyrics: true }), { desktopLyrics: true });
  assert.deepEqual(sanitizeSettings({ spectrum: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ spectrum: true }), { spectrum: true });
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings([]), {});
});

test('sanitize validates spectrum preset and opacity ranges', () => {
  assert.deepEqual(sanitizeSettings({ spectrumPreset: 'retro' }), {});
  assert.deepEqual(sanitizeSettings({ spectrumPreset: 'original' }), { spectrumPreset: 'original' });
  assert.deepEqual(sanitizeSettings({ spectrumPreset: 'legacy' }), { spectrumPreset: 'legacy' });
  // 历史存档里的 wide（旧预设 2）迁移到 legacy
  assert.deepEqual(sanitizeSettings({ spectrumPreset: 'wide' }), { spectrumPreset: 'legacy' });
  assert.equal(SETTING_DEFAULTS.spectrumPreset, 'legacy');

  assert.deepEqual(sanitizeSettings({ spectrumInfoOpacity: 0.4 }), { spectrumInfoOpacity: 0.4 });
  assert.deepEqual(sanitizeSettings({ spectrumInfoOpacity: 5 }), { spectrumInfoOpacity: 1 });
  assert.deepEqual(sanitizeSettings({ spectrumInfoOpacity: -1 }), { spectrumInfoOpacity: 0.1 });
  assert.deepEqual(sanitizeSettings({ spectrumInfoOpacity: 'x' }), {});
  assert.deepEqual(sanitizeSettings({ spectrumOpacity: 0.4 }), { spectrumInfoOpacity: 0.4 });
  assert.deepEqual(sanitizeSettings({ spectrumBarOpacity: 9 }), { spectrumBarOpacity: 1 });
  assert.deepEqual(sanitizeSettings({ spectrumBarOpacity: 0 }), { spectrumBarOpacity: 0.1 });
  assert.deepEqual(sanitizeSettings({ spectrumMouseFade: false }), { spectrumMouseFade: false });
  assert.deepEqual(sanitizeSettings({ spectrumMouseFadeRadius: 9999 }), { spectrumMouseFadeRadius: 600 });
  assert.deepEqual(sanitizeSettings({ spectrumMouseFadeRadius: 10 }), { spectrumMouseFadeRadius: 80 });
});

test('sanitize validates new audio/system settings', () => {
  assert.deepEqual(sanitizeSettings({ playbackRate: 1.25 }), { playbackRate: 1.25 });
  assert.deepEqual(sanitizeSettings({ playbackRate: 1.1 }), {});
  assert.deepEqual(sanitizeSettings({ loudnessNormalization: true }), { loudnessNormalization: true });
  assert.deepEqual(sanitizeSettings({ loudnessNormalization: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ autoStart: true, preventAppSuspension: true }), {
    autoStart: true,
    preventAppSuspension: true
  });
  assert.deepEqual(sanitizeSettings({ audioOutputDevice: 'abc:123-def_4.5' }), {
    audioOutputDevice: 'abc:123-def_4.5'
  });
  assert.deepEqual(sanitizeSettings({ audioOutputDevice: 'bad id with spaces' }), {});
  assert.deepEqual(sanitizeSettings({ audioOutputDevice: 'x'.repeat(129) }), {});
  assert.deepEqual(sanitizeSettings({ desktopLyricsFont: 'Noto Sans SC' }), {
    desktopLyricsFont: 'Noto Sans SC'
  });
});
