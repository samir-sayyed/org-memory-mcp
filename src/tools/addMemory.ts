import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { resolveNamespace } from '../utils/namespaces.js';
import { loadConfig } from '../utils/config.js';
import {
  getMemoryType,
  getNormalizedTags,
  getOptionalString,
  getRequiredString,
  getWriteScope,
} from '../utils/validation.js';

export const CREATE_MEMORY_TOOL_NAME = 'create_memory';
export const ADD_MEMORY_TOOL_NAME = 'add_memory';

export const CREATE_MEMORY_TOOL_DESCRIPTION =
  'Directly create a long-term memory record, bypassing the automatic extraction pipeline. ' +
  'Use save_conversation instead for regular conversational data — AgentCore will auto-extract insights. ' +
  'Use create_memory only for explicit manual saves like architecture decisions, coding style preferences, ' +
  'bug fix solutions, or project conventions that you want stored deterministically.';

export const CREATE_MEMORY_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description:
        'The memory content to store. Be concise but descriptive. Example: "Use async/await over callbacks for all new Node.js services in the payment-api project"',
    },
    memory_type: {
      type: 'string',
      enum: ['style', 'architecture', 'bugfix', 'api_pattern', 'preference', 'general'],
      description: 'Category of the memory',
    },
    scope: {
      type: 'string',
      enum: ['user', 'project', 'org'],
      default: 'user',
      description:
        'Namespace scope: user=actor-scoped, project=project-shared, org=org-shared',
    },
    project: {
      type: 'string',
      description: 'Project identifier (required when scope=project)',
    },
    language: {
      type: 'string',
      description: 'Programming language this memory relates to, e.g. "typescript", "python"',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags for filtering, e.g. ["react", "hooks", "best-practice"]',
    },
  },
  required: ['content', 'memory_type'],
} as const;

export function addMemoryTool(client: BedrockMemoryClient) {
  return {
    name: CREATE_MEMORY_TOOL_NAME,
    description: CREATE_MEMORY_TOOL_DESCRIPTION,
    inputSchema: CREATE_MEMORY_INPUT_SCHEMA,
  };
}

export async function handleAddMemory(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const config = loadConfig();
    const content = getRequiredString(args?.content, 'content');
    const memoryType = getMemoryType(args?.memory_type);
    const scope = args?.scope ? getWriteScope(args.scope) : 'user';
    const project = getOptionalString(args?.project);
    const language = getOptionalString(args?.language);
    const tags = getNormalizedTags(args?.tags);

    if (scope === 'project' && !project) {
      throw new Error('project is required when scope is "project"');
    }

    const namespace = resolveNamespace(config, scope, project) as string;

    const metadata: Record<string, string> = {
      memory_type: memoryType,
      scope,
      ...(project && { project }),
      ...(language && { language }),
      ...(tags && { tags: JSON.stringify(tags) }),
    };

    const recordIds = await client.batchCreateMemoryRecords(namespace, [
      {
        content,
        metadata,
      },
    ]);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              memoryId: recordIds[0] || 'unknown',
              scope,
              namespace,
              content_preview: content.slice(0, 200),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error storing memory: ${error.message}` }],
      isError: true,
    };
  }
}
