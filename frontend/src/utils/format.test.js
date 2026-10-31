/**
 * format.test.js -- Unit tests for request error helpers.
 * Run with: npm test  (Node's built-in test runner, no dependencies)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRequestError, errorDetail } from './format.js';

test('network failures ("Failed to fetch") explain that the backend is unreachable', () => {
  const message = describeRequestError(new TypeError('Failed to fetch'));
  assert.match(message, /Could not reach the CodeSeek backend at http:\/\/127\.0\.0\.1:8000/);
});

test('backend errors keep their own message', () => {
  assert.equal(describeRequestError(new Error('Uploaded ZIP exceeds the 100 MB limit')), 'Uploaded ZIP exceeds the 100 MB limit');
  assert.equal(describeRequestError(new Error(''), 'Update failed.'), 'Update failed.');
});

test('errorDetail reads string and validation-list details', () => {
  assert.equal(errorDetail({ detail: 'Only .zip files are accepted' }, 'x'), 'Only .zip files are accepted');
  assert.equal(errorDetail({ detail: [{ msg: 'Field required' }, { msg: 'Too long' }] }, 'x'), 'Field required; Too long');
  assert.equal(errorDetail({}, 'Upload failed (HTTP 500)'), 'Upload failed (HTTP 500)');
  assert.equal(errorDetail(null, 'fallback'), 'fallback');
});
