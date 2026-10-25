const test = require('node:test');
const assert = require('node:assert/strict');
const { convertShareUrl } = require('../js/converter.js');

test('converts a standard share.google URL', () => {
  assert.deepEqual(convertShareUrl('https://share.google/ABC123'), {
    token: 'ABC123',
    url: 'https://www.google.com/share.google?q=ABC123'
  });
});

test('adds HTTPS when the scheme is omitted', () => {
  assert.equal(convertShareUrl('share.google/AbC-123_x').url,
    'https://www.google.com/share.google?q=AbC-123_x');
});

test('accepts the www share.google host', () => {
  assert.equal(convertShareUrl('https://www.share.google/testToken').token, 'testToken');
});

test('normalizes uppercase protocol and hostname', () => {
  assert.equal(convertShareUrl('HTTPS://SHARE.GOOGLE/example').token, 'example');
});

test('uses the first path segment, matching the reference behavior', () => {
  assert.equal(convertShareUrl('https://share.google/first/second').token, 'first');
});

test('encodes special characters in the token for the output query', () => {
  assert.equal(convertShareUrl('https://share.google/token%20name').url,
    'https://www.google.com/share.google?q=token%2520name');
});

test('rejects an empty value', () => {
  assert.throws(() => convertShareUrl('   '), /Please paste/);
});

test('rejects hostnames that only resemble share.google', () => {
  assert.throws(() => convertShareUrl('https://share.google.attacker.example/token'), /valid share\.google/);
});

test('rejects non-HTTP protocols', () => {
  assert.throws(() => convertShareUrl('ftp://share.google/token'), /HTTP or HTTPS/);
});

test('rejects a URL that has no share token', () => {
  assert.throws(() => convertShareUrl('https://share.google/'), /token was not found/);
});

test('rejects URLs containing embedded credentials', () => {
  assert.throws(() => convertShareUrl('https://someone:secret@share.google/token'), /without a username or password/);
});
