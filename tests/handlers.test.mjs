import assert from 'node:assert/strict';
import test from 'node:test';

import { handleAddMemory } from '../build/tools/addMemory.js';
import { handleGetMemories } from '../build/tools/getMemories.js';
import { handleGetUserProfile } from '../build/tools/getUserProfile.js';
import { handleGetMemory } from '../build/tools/getMemory.js';
import { handleSearchMemories } from '../build/tools/searchMemories.js';
import { handleUpdateMemory } from '../build/tools/updateMemory.js';

const ENV_KEYS = ['AWS_REGION', 'MEMORY_ARN', 'ORG_ID', 'ACTOR_ID'];

function withRequiredEnv(fn) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  process.env.AWS_REGION = 'us-west-2';
  process.env.MEMORY_ARN = 'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/test-memory';
  process.env.ORG_ID = 'test-org';
  process.env.ACTOR_ID = 'test-user';

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

test('add_memory rejects missing memory_type before any write', async () => {
  await withRequiredEnv(async () => {
    let called = false;
    const result = await handleAddMemory(
      {
        batchCreateMemoryRecords: async () => {
          called = true;
          return [];
        },
      },
      { content: 'remember this' }
    );

    assert.equal(called, false);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /memory_type must be one of/);
  });
});

test('update_memory preserves existing namespace when scope is omitted', async () => {
  await withRequiredEnv(async () => {
    const calls = [];

    const result = await handleUpdateMemory(
      {
        getMemoryRecord: async () => ({
          memoryRecordId: 'mem-1',
          namespaces: ['/org/test-org/shared/'],
          metadata: {
            scope: { stringValue: 'org' },
            memory_type: { stringValue: 'architecture' },
            createdAt: { stringValue: '2026-04-24T00:00:00.000Z' },
          },
        }),
        batchUpdateMemoryRecords: async (namespace, records) => {
          calls.push({ namespace, records });
        },
      },
      { memory_id: 'mem-1', content: 'updated text' }
    );

    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.scope, 'org');
    assert.equal(payload.namespace, '/org/test-org/shared/');
    assert.equal(calls[0].namespace, '/org/test-org/shared/');
    assert.equal(calls[0].records[0].metadata.scope, 'org');
  });
});

test('search_memories requires project when scope is project', async () => {
  await withRequiredEnv(async () => {
    const result = await handleSearchMemories(
      {
        retrieveMemoryRecords: async () => [],
        retrieveMemoryRecordsByPath: async () => [],
      },
      { query: 'find this', scope: 'project' }
    );

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /project is required when scope is "project"/);
  });
});

test('get_memories rejects out-of-range limits', async () => {
  await withRequiredEnv(async () => {
    const result = await handleGetMemories(
      {
        listMemoryRecords: async () => [],
      },
      { limit: 101 }
    );

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /limit must be between 1 and 100/);
  });
});

test('get_user_profile reads full namespaces without a hardcoded cap', async () => {
  await withRequiredEnv(async () => {
    const calls = [];

    const result = await handleGetUserProfile(
      {
        listMemoryRecords: async (namespace, limit) => {
          calls.push({ namespace, limit });
          return [];
        },
        retrieveMemoryRecordsByPath: async () => [],
        listEvents: async () => [],
      },
      {}
    );

    const payload = JSON.parse(result.content[0].text);
    assert.deepEqual(calls.map((call) => call.limit), [undefined, undefined]);
    assert.equal(payload.memoryCount.total, 0);
  });
});

test('get_memories formats config failures as tool errors', async () => {
  const previous = {
    AWS_REGION: process.env.AWS_REGION,
    MEMORY_ARN: process.env.MEMORY_ARN,
    ORG_ID: process.env.ORG_ID,
    ACTOR_ID: process.env.ACTOR_ID,
  };

  delete process.env.AWS_REGION;
  delete process.env.MEMORY_ARN;
  delete process.env.ORG_ID;
  delete process.env.ACTOR_ID;

  try {
    const result = await handleGetMemories(
      {
        listMemoryRecords: async () => [],
      },
      {}
    );

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Missing required environment variable MEMORY_ARN/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('get_memory surfaces non-not-found Bedrock errors', async () => {
  await withRequiredEnv(async () => {
    const result = await handleGetMemory(
      {
        getMemoryRecord: async () => {
          throw new Error('access denied');
        },
      },
      { memory_id: 'mem-1' }
    );

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Error retrieving memory: access denied/);
  });
});