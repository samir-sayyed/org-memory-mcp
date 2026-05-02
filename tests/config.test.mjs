import assert from 'node:assert/strict';
import test from 'node:test';

import { ConfigError, formatConfigError, loadConfig } from '../build/utils/config.js';

const ENV_KEYS = [
  'AWS_REGION',
  'MEMORY_ARN',
  'ORG_ID',
  'ACTOR_ID',
  'ACTOR_ROLE',
  'AUTH_TOKEN',
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

test('loadConfig defaults AWS_REGION and ACTOR_ROLE for local use', async () => {
  await withEnv(
    {
      MEMORY_ARN: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/test-memory',
      ORG_ID: 'local-org',
      ACTOR_ID: 'local-user',
      AUTH_TOKEN: 'test-token',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.awsRegion, 'us-west-2');
      assert.equal(config.actorRole, 'developer');
    }
  );
});

test('loadConfig rejects malformed memory arns', async () => {
  await withEnv(
    {
      MEMORY_ARN: 'not-an-arn',
      ORG_ID: 'local-org',
      ACTOR_ID: 'local-user',
      AUTH_TOKEN: 'test-token',
    },
    () => {
      assert.throws(() => loadConfig(), ConfigError);
    }
  );
});

test('loadConfig auto-sanitizes email-style ACTOR_ID', async () => {
  await withEnv(
    {
      MEMORY_ARN: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/test-memory',
      ORG_ID: 'test-org',
      ACTOR_ID: 'samir@dev.com',
      AUTH_TOKEN: 'test-token',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.actorId, 'samir-at-dev-com');
    }
  );
});

test('loadConfig auto-sanitizes dot-containing ORG_ID', async () => {
  await withEnv(
    {
      MEMORY_ARN: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/test-memory',
      ORG_ID: 'my.company.org',
      ACTOR_ID: 'test-user',
      AUTH_TOKEN: 'test-token',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.orgId, 'my-company-org');
    }
  );
});

test('loadConfig preserves already-valid identifiers', async () => {
  await withEnv(
    {
      MEMORY_ARN: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/test-memory',
      ORG_ID: 'acme-corp',
      ACTOR_ID: 'alice_dev',
      AUTH_TOKEN: 'test-token',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.orgId, 'acme-corp');
      assert.equal(config.actorId, 'alice_dev');
    }
  );
});

test('formatConfigError includes local setup guidance', () => {
  const message = formatConfigError(new ConfigError('Missing required environment variable MEMORY_ARN'));

  assert.match(message, /Org Memory MCP configuration error/);
  assert.match(message, /MEMORY_ARN=/);
  assert.match(message, /\.env\.example/);
});