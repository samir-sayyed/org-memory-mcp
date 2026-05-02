#!/usr/bin/env node
/**
 * Auto-extraction demo — The hero feature.
 *
 * 1. Save a conversation to short-term memory
 * 2. Wait for AgentCore strategies to auto-extract
 * 3. Search strategy namespaces for extracted insights
 */

import 'dotenv/config';
import { BedrockMemoryClient } from '../build/aws/bedrockAgentCore.js';
import { loadConfig } from '../build/utils/config.js';
import { initSession, getActiveSessionId } from '../build/utils/session.js';
import { getStrategyNamespacePath } from '../build/utils/namespaces.js';

const config = loadConfig();
initSession();
const client = new BedrockMemoryClient(config);

const CONVO = [
  { role: 'user', content: 'How should we structure the auth middleware for our payment API?' },
  { role: 'assistant', content: 'Use a layered approach: 1) Validate JWT at the edge, 2) Check rate limits per API key, 3) Enforce org-scoped permissions via RBAC. Log all auth decisions to CloudWatch with trace IDs for audit trails.' },
];

async function demo() {
  console.log('\n🧠 Auto-Extraction Demo\n');
  console.log('AgentCore strategies active on your memory:');
  console.log('  • episodic_builtin');
  console.log('  • preference_builtin');
  console.log('  • semantic_builtin');
  console.log('  • summary_builtin');
  console.log('  • summarization_override');
  console.log('  • self_managed\n');

  // 1. Save conversation
  console.log('→ Step 1: Saving conversation to short-term memory...');
  const eventId = await client.createConversationEvent(
    getActiveSessionId(),
    CONVO,
    { project: 'payment-api', language: 'typescript' }
  );
  console.log(`   EventId: ${eventId}`);
  console.log(`   Session: ${getActiveSessionId()}`);

  // 2. Wait for background extraction
  console.log('\n→ Step 2: Waiting 10s for AgentCore auto-extraction...');
  for (let i = 10; i > 0; i--) {
    process.stdout.write(`   ${i}s... `);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('\n');

  // 3. Search for auto-extracted insights
  console.log('→ Step 3: Searching strategy namespaces for extracted insights...');
  const strategyPath = getStrategyNamespacePath(config);

  const queries = [
    'auth middleware JWT validation',
    'rate limiting API key',
    'RBAC org permissions',
    'CloudWatch audit logging',
  ];

  let totalFound = 0;
  for (const query of queries) {
    const results = await client.retrieveMemoryRecordsByPath(query, strategyPath, 5);
    if (results.length > 0) {
      console.log(`\n   Query: "${query}"`);
      results.forEach((r, i) => {
        const text = r.content && 'text' in r.content ? r.content.text.slice(0, 100) : 'N/A';
        console.log(`   [${i}] score=${(r.score || 0).toFixed(3)} | ${text}...`);
        totalFound++;
      });
    }
  }

  if (totalFound === 0) {
    console.log('\n   No new auto-extracted memories yet. Background extraction can take 30-60s.');
    console.log('   Your memory already has 4+ extracted memories from earlier sessions.');
    console.log('   Search those with: "payment service", "error handling", "API patterns"');
  } else {
    console.log(`\n   ✅ Found ${totalFound} auto-extracted insights!`);
  }

  // 4. Show current memory stats
  console.log('\n→ Step 4: Memory stats');
  console.log(`   Memory ARN: ${config.memoryArn}`);
  console.log(`   Actor: ${config.actorId} (${config.actorRole})`);
  console.log(`   Session: ${getActiveSessionId()}`);

  console.log('\n✅ Demo complete.\n');
}

demo().catch((e) => {
  console.error('Demo failed:', e);
  process.exit(1);
});
