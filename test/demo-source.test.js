import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoSource } from '../src/sources/DemoSource.js';

test('demo source exposes well-formed local tracks', async () => {
  const source = new DemoSource();
  const tracks = await source.listTracks();

  assert.ok(tracks.length >= 3);
  for (const track of tracks) {
    assert.equal(typeof track.id, 'string');
    assert.equal(typeof track.title, 'string');
    assert.equal(typeof track.artist, 'string');
    assert.ok(track.duration > 0);
    assert.ok(!JSON.stringify(track).includes('http'));
  }
});

test('demo source resolves a locally synthesized stream', async () => {
  const source = new DemoSource();
  const [track] = await source.listTracks();
  const stream = await source.resolveStream(track);

  assert.equal(stream.kind, 'tone');
  assert.ok(stream.frequencies.length > 0);
  assert.ok(stream.duration > 0);
});

test('demo source searches the local catalog', async () => {
  const source = new DemoSource();
  const results = await source.search('night');

  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Night Drive');
});
