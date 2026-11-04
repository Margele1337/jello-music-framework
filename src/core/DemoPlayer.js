/**
 * Tiny Web Audio player used by the demo source.
 *
 * It synthesizes a chord locally, so the framework can demonstrate playback,
 * seeking and a real analyser without downloading or bundling any audio.
 * A production adapter can replace this with an HTMLAudioElement, WebAudio
 * graph, or native media backend.
 */
export class DemoPlayer {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.nodes = null;
    this.track = null;
    this.startedAt = 0;
    this.pausedAt = 0;
    this.playing = false;
  }

  load(track) {
    this.stop();
    this.track = track;
    this.pausedAt = 0;
  }

  async play() {
    if (!this.track || this.playing) {
      return;
    }
    if (this.pausedAt >= this.track.duration) {
      this.pausedAt = 0;
    }

    this._ensureContext();
    await this.ctx.resume();

    const now = this.ctx.currentTime;
    this.startedAt = now - this.pausedAt;

    const mix = this.ctx.createGain();
    mix.gain.value = 0.06;
    mix.connect(this.analyser);

    const remaining = this.track.duration - this.pausedAt;
    this.nodes = (this.track.frequencies ?? [220]).map((frequency, index) => {
      const osc = this.ctx.createOscillator();
      osc.type = index === 0 ? 'sine' : 'triangle';
      osc.frequency.value = frequency;

      const gain = this.ctx.createGain();
      gain.gain.value = index === 0 ? 1 : 0.35;

      osc.connect(gain);
      gain.connect(mix);
      osc.start(now);
      osc.stop(now + remaining);
      return { osc, gain };
    });

    this.playing = true;
  }

  pause() {
    if (!this.playing) {
      return;
    }
    this.pausedAt = this.position();
    this._stopNodes();
    this.playing = false;
  }

  seek(seconds) {
    const wasPlaying = this.playing;
    this._stopNodes();
    this.playing = false;
    this.pausedAt = Math.max(0, Math.min(Number(seconds) || 0, this.track?.duration ?? 0));
    if (wasPlaying) {
      this.play();
    }
  }

  stop() {
    this._stopNodes();
    this.playing = false;
  }

  position() {
    if (!this.playing || !this.ctx || !this.track) {
      return this.pausedAt;
    }
    return Math.min(this.track.duration, this.ctx.currentTime - this.startedAt);
  }

  getAnalyser() {
    return this.analyser;
  }

  _ensureContext() {
    if (this.ctx) {
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.ctx.destination);
  }

  _stopNodes() {
    if (!this.nodes) {
      return;
    }
    for (const { osc, gain } of this.nodes) {
      try {
        osc.stop();
      } catch {
        // Oscillator may have already reached its scheduled stop.
      }
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected.
      }
    }
    this.nodes = null;
  }
}
