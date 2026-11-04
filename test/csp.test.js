import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsp } from '../shared/csp.js';
import { LOCAL_SCHEME } from '../shared/localScheme.js';

const directiveOf = (policy, name) => {
  const part = policy.split(';').find((directive) => directive.trim().startsWith(name));
  return part ? part.trim().replace(new RegExp(`^${name}\\s*`), '') : '';
};

test('document directives stay locked down', () => {
  const policy = buildCsp({ dev: false });
  assert.match(policy, /^default-src 'self';/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.match(policy, new RegExp(`img-src 'self' data: ${LOCAL_SCHEME}:`));
});

test('media flows only through the local scheme and the self-decode blob', () => {
  const media = directiveOf(buildCsp({ dev: false }), 'media-src');
  assert.equal(media, `blob: ${LOCAL_SCHEME}:`);
});

test('connect-src carries no remote hosts, no wide schemes, no dev port', () => {
  const connect = directiveOf(buildCsp({ dev: false }), 'connect-src');
  assert.equal(connect, `'self' ${LOCAL_SCHEME}:`);
  assert.ok(!/(^|\s)https?:(\s|$)/.test(connect));
  assert.ok(!connect.includes('5173'));
});

test('dev policy adds the Vite HMR origins, prod never does', () => {
  const dev = directiveOf(buildCsp({ dev: true }), 'connect-src');
  assert.match(dev, /ws:\/\/127\.0\.0\.1:5173/);
  assert.match(dev, /http:\/\/127\.0\.0\.1:5173/);
  assert.ok(!buildCsp({ dev: false }).includes('5173'));
});
