import { MusicSource } from './MusicSource.js';

const TRACKS = [
  {
    id: 'aurora',
    title: 'Aurora',
    artist: 'Jello Demo',
    duration: 24,
    frequencies: [220.0, 277.18, 329.63],
    lyrics: [
      'Light across the quiet room',
      'A slow chord, a steady loom',
      'Nothing here to download',
      'Only sound we made ourselves'
    ]
  },
  {
    id: 'night-drive',
    title: 'Night Drive',
    artist: 'Jello Demo',
    duration: 28,
    frequencies: [196.0, 246.94, 293.66],
    lyrics: [
      'Headlights on an empty lane',
      'Low notes fall like quiet rain',
      'Keep the window, keep the frame',
      'Let the framework hold the chain'
    ]
  },
  {
    id: 'soft-static',
    title: 'Soft Static',
    artist: 'Jello Demo',
    duration: 32,
    frequencies: [174.61, 220.0, 261.63],
    lyrics: [
      'A gentle hiss beneath the tone',
      'A room of wires, still unknown',
      'Build your source and make it yours',
      'The player stays, the data goes'
    ]
  }
];

export class DemoSource extends MusicSource {
  async listTracks() {
    return TRACKS.map((track) => ({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      lyrics: [...track.lyrics]
    }));
  }

  async search(query) {
    const needle = String(query ?? '').trim().toLowerCase();
    const tracks = await this.listTracks();
    if (!needle) {
      return tracks;
    }
    return tracks.filter((track) =>
      track.title.toLowerCase().includes(needle) ||
      track.artist.toLowerCase().includes(needle)
    );
  }

  async resolveStream(track) {
    const full = TRACKS.find((item) => item.id === track.id);
    if (!full) {
      throw new Error(`Unknown demo track: ${track.id}`);
    }
    return {
      kind: 'tone',
      frequencies: [...full.frequencies],
      duration: full.duration
    };
  }
}
