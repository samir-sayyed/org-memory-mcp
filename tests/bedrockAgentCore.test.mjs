import assert from 'node:assert/strict';
import test from 'node:test';

import { BedrockMemoryClient } from '../build/aws/bedrockAgentCore.js';

function createClient() {
  return new BedrockMemoryClient({
    awsRegion: 'us-west-2',
    memoryArn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/test-memory',
    orgId: 'test-org',
    actorId: 'test-user',
  });
}

test('listMemoryRecords follows nextToken pagination within a namespace', async () => {
  const client = createClient();
  const calls = [];

  client.client = {
    send: async (command) => {
      calls.push(command.input);

      if (!command.input.nextToken) {
        return {
          memoryRecordSummaries: [
            { memoryRecordId: '1' },
            { memoryRecordId: '2' },
          ],
          nextToken: 'page-2',
        };
      }

      return {
        memoryRecordSummaries: [{ memoryRecordId: '3' }],
      };
    },
  };

  const results = await client.listMemoryRecords('/org/test-org/user/test-user/', 3);

  assert.equal(results.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].maxResults, 3);
  assert.equal(calls[1].maxResults, 1);
  assert.equal(calls[1].nextToken, 'page-2');
});

test('listMemoryRecordsByPath follows nextToken pagination within a namespace path', async () => {
  const client = createClient();
  const calls = [];

  client.client = {
    send: async (command) => {
      calls.push(command.input);

      if (!command.input.nextToken) {
        return {
          memoryRecordSummaries: [
            { memoryRecordId: '1' },
            { memoryRecordId: '2' },
          ],
          nextToken: 'page-2',
        };
      }

      return {
        memoryRecordSummaries: [{ memoryRecordId: '3' }],
      };
    },
  };

  const results = await client.listMemoryRecordsByPath('/org/test-org/', 3);

  assert.equal(results.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].namespacePath, '/org/test-org/');
  assert.equal(calls[0].maxResults, 3);
  assert.equal(calls[1].maxResults, 1);
  assert.equal(calls[1].nextToken, 'page-2');
});

test('getMemoryRecord only converts ResourceNotFoundException into null', async () => {
  const client = createClient();

  client.client = {
    send: async () => {
      const error = new Error('missing');
      error.name = 'ResourceNotFoundException';
      throw error;
    },
  };

  assert.equal(await client.getMemoryRecord('missing-id'), null);

  client.client = {
    send: async () => {
      const error = new Error('access denied');
      error.name = 'AccessDeniedException';
      throw error;
    },
  };

  await assert.rejects(() => client.getMemoryRecord('forbidden-id'), /access denied/);
});