import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { resolveNamespace, getStrategyNamespacePath } from '../utils/namespaces.js';
import { loadConfig } from '../utils/config.js';
import {
  getLimit,
  getMemoryType,
  getOptionalString,
  getReadScope,
  getRequiredString,
} from '../utils/validation.js';

function getMinScore(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

export const SEARCH_MEMORIES_TOOL_NAME = 'search_memories';

export function searchMemoriesTool(client: BedrockMemoryClient) {
  return {
    name: SEARCH_MEMORIES_TOOL_NAME,
    description:
      'Semantic search across all memory — both manually saved records and auto-extracted insights ' +
      'from AgentCore strategies (facts, preferences, summaries). Searches across your private memories, ' +
      'project memories, org-wide shared memories, and strategy-extracted memories.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural language search query. Example: "How do we handle errors in the payment service?"',
        },
        scope: {
          type: 'string',
          enum: ['user', 'project', 'org', 'all'],
          default: 'all',
          description: 'Which memories to search: user, project, org, or all (default)',
        },
        project: {
          type: 'string',
          description: 'Project identifier (filters to project scope)',
        },
        memory_type: {
          type: 'string',
          enum: ['style', 'architecture', 'bugfix', 'api_pattern', 'preference', 'general'],
          description: 'Filter by memory type (only applies to manually saved records)',
        },
        include_strategy_memories: {
          type: 'boolean',
          default: true,
          description: 'Also search auto-extracted memories from AgentCore strategies',
        },
        min_score: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Minimum relevance score (0-1). Higher = more relevant results only.',
        },
        limit: {
          type: 'number',
          default: 10,
          minimum: 1,
          maximum: 50,
          description: 'Maximum results to return',
        },
      },
      required: ['query'],
    },
  };
}

export async function handleSearchMemories(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const config = loadConfig();
    const query = getRequiredString(args?.query, 'query');
    const scope = args?.scope ? getReadScope(args.scope) : 'all';
    const project = getOptionalString(args?.project);
    const memoryType = Object.prototype.hasOwnProperty.call(args || {}, 'memory_type')
      ? getMemoryType(args?.memory_type)
      : undefined;
    const includeStrategyMemories = args?.include_strategy_memories !== false; // default true
    const limit = getLimit(args?.limit, 10, 50);
    const minScore = getMinScore(args?.min_score);

    if (scope === 'project' && !project) {
      throw new Error('project is required when scope is "project"');
    }

    const namespace = resolveNamespace(config, scope, project);

    // Search manually saved records in org namespaces
    const results = await client.retrieveMemoryRecords(query, namespace, limit, minScore);

    // Also search strategy-extracted records
    let strategyResults: any[] = [];
    if (includeStrategyMemories) {
      try {
        const strategyPath = getStrategyNamespacePath(config);
        strategyResults = await client.retrieveMemoryRecordsByPath(query, strategyPath, limit, minScore);
      } catch {
        // Strategy records may not exist yet — non-fatal
      }
    }

    // Merge and deduplicate
    const seenIds = new Set<string>();
    const allResults = [...results, ...strategyResults].filter((r) => {
      const id = r.memoryRecordId;
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    // Apply memory_type filter (only for manually saved records with this metadata)
    const filtered = memoryType
      ? allResults.filter((r) => {
          const meta = r.metadata || {};
          const mt = meta.memory_type;
          return mt && 'stringValue' in mt && mt.stringValue === memoryType;
        })
      : allResults;

    // Sort by score and limit
    const sorted = filtered
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, limit);

    const formatted = sorted.map((r) => {
      const isStrategyRecord = r.namespaces?.some((ns: string) => ns.startsWith('/strategy/'));
      return {
        memoryId: r.memoryRecordId,
        content: r.content && 'text' in r.content ? r.content.text : 'N/A',
        score: r.score,
        source: isStrategyRecord ? 'auto-extracted' : 'manual',
        namespaces: r.namespaces,
        createdAt: r.createdAt,
        metadata: Object.fromEntries(
          Object.entries(r.metadata || {}).map(([k, v]) => [
            k,
            v && typeof v === 'object' && 'stringValue' in v ? (v as any).stringValue : v,
          ])
        ),
      };
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              query,
              scope,
              includeStrategyMemories,
              count: formatted.length,
              results: formatted,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error searching memories: ${error.message}` }],
      isError: true,
    };
  }
}
