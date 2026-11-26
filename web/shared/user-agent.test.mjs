import assert from 'node:assert/strict';
import test from 'node:test';
import { describeUserAgent } from './user-agent.ts';

/** Verifies the short labels for common desktop and mobile browsers. */
test('names browser, major version and operating system', () => {
  assert.equal(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'), 'Firefox 120 on Linux');
  assert.equal(
    describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'),
    'Edge 131 on Windows'
  );
  assert.equal(
    describeUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'),
    'Chrome 131 on Android'
  );
  assert.equal(
    describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'),
    'Safari 18 on iOS'
  );
  assert.equal(
    describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'),
    'Safari 18 on macOS'
  );
});

/** Verifies that apps keep their own product name and that empty values stay empty. */
test('keeps the product token of non-browser clients and ignores empty values', () => {
  assert.equal(describeUserAgent('okhttp/4.12.0'), 'okhttp/4.12.0');
  assert.equal(
    describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36'),
    'Chrome 131 on Linux'
  );
  assert.equal(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) SomethingNew/1.0'), 'Browser on Linux');
  assert.equal(describeUserAgent('KeePassium/1.53 (iPhone; iOS 18.1)'), 'KeePassium/1.53 on iOS');
  assert.equal(describeUserAgent(''), null);
  assert.equal(describeUserAgent(null), null);
});
