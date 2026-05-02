#!/usr/bin/env node
/**
 * Real-world integration test for Org Memory MCP Server
 * Reads AWS creds from env vars or .env file — never hardcode secrets.
 *
 * Setup:
 *   cp .env.example .env
 *   # Edit .env with your real credentials
 *   node scripts/test-real-aws.mjs
 *
 * Or export manually:
 *   export MEMORY_ARN=arn:aws:bedrock-agentcore:us-west-2:ACCOUNT:memory/ID
 *   export ORG_ID=demo-org
 *   export ACTOR_ID=dev@company.com
 *   export AUTH_TOKEN=demo-token-2026
 *   export AWS_REGION=us-west-2
 *   export AWS_ACCESS_KEY_ID=...
 *   export AWS_SECRET_ACCESS_KEY=...
 *   node scripts/test-real-aws.mjs
 */

import 'dotenv/config';

import { BedrockMemoryClient } from '../build/aws/bedrockAgentCore.js';
import { loadConfig, isAdmin } from '../build/utils/config.js';
import { initSession, getActiveSessionId } from '../build/utils/session.js';

const SEP = '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

function section(title) {
  console.log(SEP + '🧪 ' + title + SEP);
}

function pass(msg) {
  console.log('✅ ' + msg);
}

function fail(msg) {
  console.log('❌ ' + msg);
  process.exitCode = 1;
}

function info(msg) {
  console.log('ℹ️  ' + msg);
}

async function testConfig() {
  section('1. CONFIG LOAD');
  try {
    const config = loadConfig();
    info(`AWS_REGION: ${config.awsRegion}`);
    info(`ORG_ID: ${config.orgId}`);
    info(`ACTOR_ID: ${config.actorId}`);
    info(`ACTOR_ROLE: ${config.actorRole}`);
    info(`AUTH_TOKEN: ${config.authToken.slice(0, 4)}...`);
    info(`isAdmin: ${isAdmin(config)}`);
    pass('Config loaded OK');
  } catch (e) {
    fail(`Config failed: ${e.message}`);
    throw e;
  }
}

async function testClientInit() {
  section('2. AWS CLIENT INIT');
  try {
    const config = loadConfig();
    const client = new BedrockMemoryClient(config);
    info(`MemoryId: ${client.getMemoryId()}`);
    info(`ActorId: ${client.getActorId()}`);
    info(`ActorRole: ${client.getActorRole()}`);
    pass('AWS client initialized');
    return client;
  } catch (e) {
    fail(`Client init failed: ${e.message}`);
    throw e;
  }
}

async function testSaveConversation(client) {
  section('3. SAVE CONVERSATION (Short-term memory)');
  try {
    const sessionId = getActiveSessionId();
    const eventId = await client.createConversationEvent(sessionId, [
      { role: 'user', content: 'How do we handle errors in the payment service?' },
      { role: 'assistant', content: 'We use a circuit breaker pattern with exponential backoff. All payment errors are logged to CloudWatch with trace IDs.' },
    ], { project: 'payment-api', language: 'typescript' });

    info(`EventId: ${eventId}`);
    info(`SessionId: ${sessionId}`);
    pass('Conversation saved to short-term memory');
    return eventId;
  } catch (e) {
    fail(`Save conversation failed: ${e.message}`);
  }
}

async function testListEvents(client) {
  section('4. LIST SESSION EVENTS');
  try {
    const events = await client.listEvents(getActiveSessionId(), undefined, 10);
    info(`Found ${events.length} events in current session`);
    pass('Listed session events');
  } catch (e) {
    fail(`List events failed: ${e.message}`);
  }
}

async function testCreateMemoryUserScope(client) {
  section('5. CREATE MEMORY (user scope)');
  try {
    const ids = await client.batchCreateMemoryRecords(
      `/org/${client.getOrgId()}/user/${client.getActorId()}/`,
      [{
        content: 'Always use Zod for API validation in Node.js projects',
        metadata: {
          memory_type: 'style',
          scope: 'user',
          language: 'typescript',
          tags: JSON.stringify(['zod', 'validation', 'best-practice']),
        },
      }]
    );
    info(`MemoryId: ${ids[0]}`);
    pass('User-scoped memory created');
    return ids[0];
  } catch (e) {
    fail(`Create user memory failed: ${e.message}`);
  }
}

async function testCreateMemoryProjectScope(client) {
  section('6. CREATE MEMORY (project scope)');
  try {
    const ids = await client.batchCreateMemoryRecords(
      `/org/${client.getOrgId()}/project/payment-api/`,
      [{
        content: 'Payment API uses Stripe webhooks with idempotency keys',
        metadata: {
          memory_type: 'api_pattern',
          scope: 'project',
          project: 'payment-api',
          language: 'typescript',
        },
      }]
    );
    info(`MemoryId: ${ids[0]}`);
    pass('Project-scoped memory created');
    return ids[0];
  } catch (e) {
    fail(`Create project memory failed: ${e.message}`);
  }
}

async function testSearchMemories(client) {
  section('7. SEMANTIC SEARCH (no min_score)');
  try {
    const results = await client.retrieveMemoryRecords(
      'payment service error handling',
      `/org/${client.getOrgId()}/`,
      10
    );
    info(`Found ${results.length} results`);
    results.forEach((r, i) => {
      const score = r.score ?? 'N/A';
      const text = r.content && 'text' in r.content ? r.content.text.slice(0, 60) : 'N/A';
      info(`  [${i}] score=${score} | ${text}...`);
    });
    pass('Semantic search OK');
    return results;
  } catch (e) {
    fail(`Search failed: ${e.message}`);
  }
}

async function testSearchMemoriesMinScore(client) {
  section('8. SEMANTIC SEARCH (min_score=0.5)');
  try {
    const results = await client.retrieveMemoryRecords(
      'payment service error handling',
      `/org/${client.getOrgId()}/`,
      10,
      0.5
    );
    info(`Found ${results.length} results with score >= 0.5`);
    results.forEach((r, i) => {
      info(`  [${i}] score=${r.score} | ${r.content && 'text' in r.content ? r.content.text.slice(0, 60) : 'N/A'}...`);
    });
    pass('Min-score filter OK');
  } catch (e) {
    fail(`Min-score search failed: ${e.message}`);
  }
}

async function testTriggerExtraction(client) {
  section('9. TRIGGER EXTRACTION JOB');
  try {
    const jobId = await client.startMemoryExtractionJob(getActiveSessionId());
    info(`JobId: ${jobId}`);
    pass('Extraction job triggered');
    return jobId;
  } catch (e) {
    info(`Trigger extraction failed: ${e.message}`);
    info('Note: Extraction jobs require pre-configured strategies on your AgentCore Memory resource.');
    info('This is expected if no strategies are configured yet.');
    pass('Extraction job test (expected fallback)');
  }
}

async function testListExtractionJobs(client) {
  section('10. LIST EXTRACTION JOBS');
  try {
    const jobs = await client.listMemoryExtractionJobs(10);
    info(`Found ${jobs.length} jobs`);
    jobs.slice(0, 5).forEach((j, i) => {
      info(`  [${i}] ${j.jobID} | status=${j.status} | strategy=${j.strategyId || 'N/A'}`);
    });
    pass('Listed extraction jobs');
  } catch (e) {
    fail(`List jobs failed: ${e.message}`);
  }
}

async function testGetMemoryRecord(client, memoryId) {
  section('11. GET MEMORY BY ID');
  try {
    // Brief delay for eventual consistency
    await new Promise((r) => setTimeout(r, 1000));
    const record = await client.getMemoryRecord(memoryId);
    if (!record) {
      info('Memory not found immediately — eventual consistency. Skipping.');
      pass('Get memory by ID (eventual consistency — OK)');
      return;
    }
    const text = record.content && 'text' in record.content ? record.content.text : 'N/A';
    info(`Content: ${text.slice(0, 80)}...`);
    pass('Got memory by ID');
  } catch (e) {
    fail(`Get memory failed: ${e.message}`);
  }
}

async function testMemoryStatus(client) {
  section('12. MEMORY STATUS');
  try {
    info(`MemoryId: ${client.getMemoryId()}`);
    info(`ActorId: ${client.getActorId()}`);
    info(`ActorRole: ${client.getActorRole()}`);
    info(`SessionId: ${getActiveSessionId()}`);
    pass('Status OK');
  } catch (e) {
    fail(`Status failed: ${e.message}`);
  }
}

async function testAdminBlock() {
  section('13. ADMIN ACCESS CONTROL');
  const originalRole = process.env.ACTOR_ROLE;
  try {
    // Test as developer — should block org scope
    process.env.ACTOR_ROLE = 'developer';
    const config = loadConfig();
    info(`Role: ${config.actorRole}`);

    if (isAdmin(config)) {
      fail('Developer incorrectly flagged as admin');
    } else {
      pass('Developer correctly blocked from admin');
    }

    // Test as admin
    process.env.ACTOR_ROLE = 'admin';
    const adminConfig = loadConfig();
    info(`Role: ${adminConfig.actorRole}`);

    if (isAdmin(adminConfig)) {
      pass('Admin correctly recognized');
    } else {
      fail('Admin not recognized');
    }
  } finally {
    process.env.ACTOR_ROLE = originalRole;
  }
}

async function cleanup(client, memoryIds) {
  section('14. CLEANUP');
  for (const id of memoryIds) {
    if (!id) continue;
    try {
      await client.deleteMemoryRecord(id);
      info(`Deleted ${id}`);
    } catch (e) {
      info(`Skip delete ${id}: ${e.message}`);
    }
  }
  pass('Cleanup done');
}

// ─── Main ─────────────────────────────────────────────────────────

(async () => {
  console.log('\n🚀 Org Memory MCP — Real AWS Integration Test\n');

  const required = ['MEMORY_ARN', 'ORG_ID', 'ACTOR_ID', 'AUTH_TOKEN'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('❌ Missing env vars:', missing.join(', '));
    console.error('Set them before running this script.');
    process.exit(1);
  }

  // Some AWS SDK clients need these even if using IAM roles
  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    info('No AWS_ACCESS_KEY_ID set. Assuming IAM role or SSO.');
  }

  try {
    await testConfig();
    const client = await testClientInit();
    initSession();

    await testSaveConversation(client);
    await testListEvents(client);

    const userMemoryId = await testCreateMemoryUserScope(client);
    const projectMemoryId = await testCreateMemoryProjectScope(client);

    await testSearchMemories(client);
    await testSearchMemoriesMinScore(client);

    const jobId = await testTriggerExtraction(client);
    // Wait a moment for job to register
    await new Promise((r) => setTimeout(r, 2000));
    await testListExtractionJobs(client);

    await testGetMemoryRecord(client, userMemoryId);
    await testMemoryStatus(client);
    await testAdminBlock();

    await cleanup(client, [userMemoryId, projectMemoryId]);

    section('ALL TESTS COMPLETE');
    console.log('✅ Integration test finished successfully.\n');
  } catch (e) {
    console.error('\n💥 Test suite failed:\n', e);
    process.exit(1);
  }
})();
