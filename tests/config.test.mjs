import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigError, formatConfigError, loadConfig } from '../build/utils/config.js';

const ENV_KEYS = [
  'AWS_REGION',
  'MEMORY_ARN',
  'ORG_ID',
  'ACTOR_ID',
  'ACTOR_ROLE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
];

function withEnv(overrides, fn) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of ENV_KEYS) {
    const nextValue = overrides[key];
    if (nextValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = nextValue;
    }
  }

  return Promise.resolve(fn()).finally(() => {
    for (const key of ENV_KEYS) {
      const previousValue = previous[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  });
}

test('loadConfig defaults AWS_REGION for local use', async () => {
  await withEnv(
    {
      MEMORY_ARN: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/test-memory',
      ORG_ID: 'local-org',
      ACTOR_ID: 'local-user',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.awsRegion, 'us-west-2');
    }
  );
});

test('loadConfig rejects malformed memory arns', async () => {
  await withEnv(
    {
      MEMORY_ARN: 'not-an-arn',
      ORG_ID: 'local-org',
      ACTOR_ID: 'local-user',
    },
    () => {
      assert.throws(() => loadConfig(), ConfigError);
    }
  );
});

test('formatConfigError includes local setup guidance', () => {
  const message = formatConfigError(new ConfigError('Missing required environment variable MEMORY_ARN'));

  assert.match(message, /Org Memory MCP configuration error/);
  assert.match(message, /MEMORY_ARN=/);
  assert.match(message, /\.env\.example/);
});