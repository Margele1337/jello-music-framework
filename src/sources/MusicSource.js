/**
 * Data source adapter contract.
 *
 * A source owns catalog and stream resolution. The framework never talks to a
 * specific provider: swap this implementation to plug in your own library,
 * local files, or an authorized remote service.
 *
 * resolveStream(track) may return:
 *   { kind: 'tone', frequencies: number[], duration: number }  // built-in demo
 *   { kind: 'url', url: string }                               // your player handles it
 */
export class MusicSource {
  async listTracks() {
    throw new Error('listTracks() is not implemented');
  }

  async search(query) {
    throw new Error(`search() is not implemented for "${query}"`);
  }

  async resolveStream(track) {
    throw new Error(`resolveStream() is not implemented for "${track?.id ?? 'unknown'}"`);
  }
}
