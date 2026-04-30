import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { resolveNamespace } from '../utils/namespaces.js';
import { loadConfig } from '../utils/config.js';
import {
  getLimit,
  getMemoryType,
  getNormalizedTags,
  getOptionalString,
  getReadScope,
} from '../utils/validation.js';

export const GET_MEMORIES_TOOL_NAME = 'get_memories';

export function getMemoriesTool(client: BedrockMemoryClient) {
  return {
    name: GET_MEMORIES_TOOL_NAME,
    description:
      'Browse long-term memory records with optional filtering by scope, project, memory type, or tags. ' +
      'Use this advanced tool when you need record browsing rather than semantic search.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['user', 'project', 'org', 'all'],
          default: 'all',
          description: 'Which namespace-scoped memories to list',
        },
        project: {
          type: 'string',
          description: 'Filter to a specific project',
        },
        memory_type: {
          type: 'string',
          enum: ['style', 'architecture', 'bugfix', 'api_pattern', 'preference', 'general'],
          description: 'Filter by memory type',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (matches any)',
        },
        limit: {
          type: 'number',
          default: 20,
          minimum: 1,
          maximum: 100,
          description: 'Maximum results to return',
        },
      },
    },
  };
}

export async function handleGetMemories(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const config = loadConfig();
    const scope = args?.scope ? getReadScope(args.scope) : 'all';
    const project = getOptionalString(args?.project);
    const memoryType = Object.prototype.hasOwnProperty.call(args || {}, 'memory_type')
      ? getMemoryType(args?.memory_type)
      : undefined;
    const searchTags = getNormalizedTags(args?.tags);
    const limit = getLimit(args?.limit, 20, 100);

    if (scope === 'project' && !project) {
      throw new Error('project is required when scope is "project"');
    }

    const namespace = resolveNamespace(config, scope, project);

    const results = await client.listMemoryRecords(namespace, limit);

    let filtered = results;

    if (memoryType) {
      filtered = filtered.filter((r) => {
        const meta = r.metadata || {};
        const mt = meta.memory_type;
        return mt && 'stringValue' in mt && mt.stringValue === memoryType;
      });
    }

    if (searchTags) {
      filtered = filtered.filter((r) => {
        const meta = r.metadata || {};
        const tagsMeta = meta.tags;
        if (!tagsMeta || !('stringValue' in tagsMeta)) return false;
        try {
          const recordTags = JSON.parse(tagsMeta.stringValue!) as string[];
          for (const tag of searchTags) { if (tag && recordTags.includes(tag)) return true; } return false;
        } catch {
          return false;
        }
      });
    }

    const formatted = filtered.map((r) => ({
      memoryId: r.memoryRecordId,
      content: r.content && 'text' in r.content ? r.content.text : 'N/A',
      namespaces: r.namespaces,
      createdAt: r.createdAt,
      metadata: Object.fromEntries(
        Object.entries(r.metadata || {}).map(([k, v]) => [
          k,
          'stringValue' in v ? v.stringValue : v,
        ])
      ),
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              scope,
              count: formatted.length,
              totalAvailable: results.length,
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
      content: [{ type: 'text', text: `Error listing memories: ${error.message}` }],
      isError: true,
    };
  }
}
