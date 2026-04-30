/**
 * retrieve_context — Combined short-term + long-term memory retrieval.
 *
 * Queries both the current session's conversation history (short-term events)
 * and semantically relevant extracted insights (long-term records) to provide
 * the agent with comprehensive context.
 *
 * This follows AWS's recommended pattern:
 *   Step 5: Retrieve past interactions from short-term memory (ListEvents)
 *   Step 6: Use long-term memories for personalized assistance (RetrieveMemoryRecords)
 */

import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { resolveNamespace, getStrategyNamespacePath } from '../utils/namespaces.js';
import { loadConfig } from '../utils/config.js';
import { getActiveSessionId } from '../utils/session.js';
import { getRequiredString, getOptionalString, getReadScope, getLimit } from '../utils/validation.js';

export const RETRIEVE_CONTEXT_TOOL_NAME = 'retrieve_context';

export async function handleRetrieveContext(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const config = loadConfig();
    const query = getRequiredString(args?.query, 'query');
    const includeSession = args?.include_session !== false; // default true
    const sessionId = getOptionalString(args?.session_id) || getActiveSessionId();
    const scope = args?.scope ? getReadScope(args.scope) : 'all';
    const project = getOptionalString(args?.project);
    const limit = getLimit(args?.limit, 10, 50);

    // ── Short-term memory: current session events ──────────────────
    let sessionContext: Array<{
      role: string;
      content: string;
      timestamp?: string;
      eventId?: string;
    }> = [];

    if (includeSession) {
      try {
        const events = await client.listEvents(sessionId, undefined, 50);
        // Events come in reverse chronological order, reverse for display
        const reversed = [...events].reverse();
        for (const event of reversed) {
          const payload = (event as any).payload;
          if (Array.isArray(payload)) {
            for (const item of payload) {
              if (item.conversational) {
                sessionContext.push({
                  role: item.conversational.role || 'UNKNOWN',
                  content: item.conversational.content?.text || '',
                  timestamp: (event as any).eventTimestamp?.toISOString?.() || undefined,
                  eventId: (event as any).eventId || undefined,
                });
              }
            }
          }
        }
      } catch (err: any) {
        // Non-fatal: session may not have events yet
        sessionContext = [];
      }
    }

    // ── Long-term memory: org-namespace records ────────────────────
    const namespace = resolveNamespace(config, scope, project);
    let orgRecords: any[] = [];
    try {
      const results = await client.retrieveMemoryRecords(query, namespace, limit);
      orgRecords = results.map((r) => ({
        memoryId: r.memoryRecordId,
        content: r.content && 'text' in r.content ? r.content.text : 'N/A',
        score: r.score,
        source: 'manual',
        namespaces: r.namespaces,
        metadata: Object.fromEntries(
          Object.entries(r.metadata || {}).map(([k, v]) => [
            k,
            'stringValue' in v ? v.stringValue : v,
          ])
        ),
      }));
    } catch {
      // Non-fatal
    }

    // ── Long-term memory: strategy-extracted records ───────────────
    let strategyRecords: any[] = [];
    try {
      const strategyPath = getStrategyNamespacePath(config);
      const results = await client.retrieveMemoryRecordsByPath(query, strategyPath, limit);
      strategyRecords = results.map((r) => ({
        memoryId: r.memoryRecordId,
        content: r.content && 'text' in r.content ? r.content.text : 'N/A',
        score: r.score,
        source: 'auto-extracted',
        namespaces: r.namespaces,
        metadata: Object.fromEntries(
          Object.entries(r.metadata || {}).map(([k, v]) => [
            k,
            'stringValue' in v ? v.stringValue : v,
          ])
        ),
      }));
    } catch {
      // Non-fatal: strategy records may not exist yet
    }

    // ── Merge and deduplicate LTM results ──────────────────────────
    const seenIds = new Set<string>();
    const allLtm = [...orgRecords, ...strategyRecords]
      .filter((r) => {
        if (seenIds.has(r.memoryId)) return false;
        seenIds.add(r.memoryId);
        return true;
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              sessionId,
              query,
              sessionContext: {
                eventCount: sessionContext.length,
                events: sessionContext,
              },
              longTermInsights: {
                count: allLtm.length,
                records: allLtm,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error retrieving context: ${error.message}` }],
      isError: true,
    };
  }
}
