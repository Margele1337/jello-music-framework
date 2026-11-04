# Architecture

Jello Music Framework is split into four layers. Each layer has one job, and the renderer never
receives credentials, provider endpoints or Node.js capabilities.

## Layers

### 1. Electron main process — `electron/main.cjs`

- Creates and owns the application window.
- Enables `contextIsolation`, `sandbox` and disables `nodeIntegration`.
- Denies new windows and cross-origin navigation.
- Exposes a single read-only IPC channel (`app:info`) through `electron/preload.cjs`.

### 2. Renderer — `src/`

- Vue 3 single-page UI: sidebar, now-playing view, library, lyrics and spectrum.
- Holds presentation state only.
- Talks to the data source through the `MusicSource` contract.
- Runs with a strict CSP; it has no Node.js access.

### 3. Playback core — `src/core/DemoPlayer.js`

- Demonstrates a playable Web Audio graph: oscillators, gain, analyser.
- Implements load / play / pause / seek / position.
- In a production player, replace this with an `HTMLAudioElement`, a Web Audio graph, or a native
  media backend. The UI only depends on the methods listed above.

### 4. Data source — `src/sources/`

- `MusicSource.js` defines the adapter contract.
- `DemoSource.js` returns three locally synthesized tracks. It never touches the network.

## Data flow

```text
user clicks play
  -> usePlayer.play()
  -> DemoPlayer.play()            (creates AudioContext on first gesture)
  -> Spectrum reads AnalyserNode
  -> usePlayer timer updates progress
  -> track ends -> advance(1) -> source.resolveStream(next track)
```

Catalog data flows the other way:

```text
source.listTracks()
  -> usePlayer.tracks
  -> App library view
```

## Adapter contract

```js
class MusicSource {
  async listTracks() {}          // -> Track[]
  async search(query) {}         // -> Track[]
  async resolveStream(track) {}  // -> { kind: 'tone' | 'url', ... }
}
```

`Track`:

```js
{
  id: string,
  title: string,
  artist: string,
  duration: number,   // seconds
  lyrics?: string[]
}
```

`resolveStream` may return:

- `{ kind: 'tone', frequencies: number[], duration: number }` — understood by `DemoPlayer`.
- `{ kind: 'url', url: string }` — requires extending the playback core.

## Security boundaries

| Boundary | Rule |
| --- | --- |
| Renderer to Node.js | No access; `contextIsolation` + `sandbox` |
| Renderer to main | One allowlisted IPC channel |
| Window creation | Denied by default |
| Navigation | Denied unless it stays on the dev server |
| Network | Not used by the demo source; adapters own their transport |
| Content | No bundled media; CSP restricts sources |

## Extending

1. Add an adapter under `src/sources/`.
2. Swap the source in `src/composables/usePlayer.js`.
3. If using remote audio, add the required origins to the CSP `media-src` / `connect-src` and
   implement URL playback in the core layer.
4. Keep secrets out of the renderer. If a provider requires credentials, exchange them in the main
   process and expose only narrow, allowlisted operations.
