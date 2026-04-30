/**
 * memory_status — Diagnostic tool for memory health and stats.
 *
 * Reports current session info, memory counts, active namespaces,
 * and overall system health.
 */

import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { loadConfig } from '../utils/config.js';
import { getActiveSessionId } from '../utils/session.js';
import {
  getUserNamespace,
  getOrgSharedNamespace,
  getStrategyNamespacePath,
} from '../utils/namespaces.js';

export const MEMORY_STATUS_TOOL_NAME = 'memory_status';

export async function handleMemoryStatus(
  client: BedrockMemoryClient,
  _args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const config = loadConfig();
    const sessionId = getActiveSessionId();
    const userNs = getUserNamespace(config);
    const orgNs = getOrgSharedNamespace(config);

    // Count short-term events in current session
    let sessionEventCount = 0;
    try {
      const events = await client.listEvents(sessionId);
      sessionEventCount = events.length;
    } catch {
      // Session may not have events yet
    }

    // Count long-term records in user namespace
    let userRecordCount = 0;
    try {
      const userRecords = await client.listMemoryRecords(userNs);
      userRecordCount = userRecords.length;
    } catch {
      // Namespace may not exist yet
    }

    // Count long-term records in org namespace
    let orgRecordCount = 0;
    try {
      const orgRecords = await client.listMemoryRecords(orgNs);
      orgRecordCount = orgRecords.length;
    } catch {
      // Namespace may not exist yet
    }

    // Check for strategy-extracted records
    let strategyRecordCount = 0;
    try {
      const strategyPath = getStrategyNamespacePath(config);
      const strategyResults = await client.retrieveMemoryRecordsByPath(
        'memory status check',
        strategyPath,
        1
      );
      strategyRecordCount = strategyResults.length;
    } catch {
      // Strategy records may not exist
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              memoryId: client.getMemoryId(),
              actorId: client.getActorId(),
              orgId: client.getOrgId(),
              currentSession: {
                sessionId,
                eventCount: sessionEventCount,
              },
              longTermMemory: {
                userRecords: userRecordCount,
                orgRecords: orgRecordCount,
                hasStrategyRecords: strategyRecordCount > 0,
              },
              namespaces: {
                user: userNs,
                org: orgNs,
                strategyPath: getStrategyNamespacePath(config),
              },
              tips: [
                'Use save_conversation to store conversations → AgentCore auto-extracts insights.',
                'Use retrieve_context to get combined session + long-term context.',
                'Use add_memory for direct manual writes to long-term memory.',
                'Use search_memories for semantic search across all long-term records.',
              ],
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error checking memory status: ${error.message}` }],
      isError: true,
    };
  }
}
