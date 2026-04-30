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

export const UPDATE_MEMORY_TOOL_NAME = 'update_memory';

function flattenMetadata(metadata?: Record<string, any>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata || {}).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object' || !('stringValue' in value)) {
        return [];
      }

      return value.stringValue ? [[key, value.stringValue]] : [];
    })
  );
}

function deriveScope(
  namespaces: string[] | undefined,
  metadata: Record<string, string>
): 'user' | 'project' | 'org' {
  if (metadata.scope === 'user' || metadata.scope === 'project' || metadata.scope === 'org') {
    return metadata.scope;
  }

  const namespace = namespaces?.[0] || '';
  if (namespace.includes('/project/')) {
    return 'project';
  }

  if (namespace.includes('/shared/')) {
    return 'org';
  }

  return 'user';
}

export function updateMemoryTool(client: BedrockMemoryClient) {
  return {
    name: UPDATE_MEMORY_TOOL_NAME,
    description:
      'Update an existing memory record by its memoryId. You can change the content and metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'The unique identifier of the memory to update',
        },
        content: {
          type: 'string',
          description: 'The new content for the memory',
        },
        scope: {
          type: 'string',
          enum: ['user', 'project', 'org'],
          description: 'New scope (optional, keeps current if not provided)',
        },
        project: {
          type: 'string',
          description: 'New project (optional)',
        },
        memory_type: {
          type: 'string',
          enum: ['style', 'architecture', 'bugfix', 'api_pattern', 'preference', 'general'],
          description: 'New memory type (optional)',
        },
        language: {
          type: 'string',
          description: 'Programming language (optional)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags (optional)',
        },
      },
      required: ['memory_id', 'content'],
    },
  };
}

export async function handleUpdateMemory(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const config = loadConfig();
    const memoryId = getRequiredString(args?.memory_id, 'memory_id');
    const content = getRequiredString(args?.content, 'content');
    const existingRecord = await client.getMemoryRecord(memoryId);

    if (!existingRecord) {
      return {
        content: [{ type: 'text', text: `Memory not found: ${memoryId}` }],
        isError: true,
      };
    }

    const existingMetadata = flattenMetadata(existingRecord.metadata as Record<string, any>);
    const existingScope = deriveScope(existingRecord.namespaces, existingMetadata);
    const nextScope = args?.scope ? getWriteScope(args.scope) : existingScope;
    const nextProject = Object.prototype.hasOwnProperty.call(args || {}, 'project')
      ? getOptionalString(args?.project)
      : existingMetadata.project;
    const nextLanguage = Object.prototype.hasOwnProperty.call(args || {}, 'language')
      ? getOptionalString(args?.language)
      : existingMetadata.language;
    const nextMemoryType = Object.prototype.hasOwnProperty.call(args || {}, 'memory_type')
      ? getMemoryType(args?.memory_type)
      : existingMetadata.memory_type;
    const hasTagUpdate = Object.prototype.hasOwnProperty.call(args || {}, 'tags');
    const nextTags = hasTagUpdate ? getNormalizedTags(args?.tags) : undefined;

    if (nextScope === 'project' && !nextProject) {
      throw new Error('project is required when scope is "project"');
    }

    const namespace = resolveNamespace(config, nextScope, nextProject) as string;
    const metadata: Record<string, string> = Object.fromEntries(
      Object.entries(existingMetadata).filter(
        ([key]) => key !== 'orgId' && key !== 'actorId' && key !== 'updatedAt'
      )
    );

    metadata.scope = nextScope;

    if (nextMemoryType) {
      metadata.memory_type = nextMemoryType;
    }

    if (nextProject) {
      metadata.project = nextProject;
    } else {
      delete metadata.project;
    }

    if (nextLanguage) {
      metadata.language = nextLanguage;
    } else {
      delete metadata.language;
    }

    if (hasTagUpdate) {
      if (nextTags) {
        metadata.tags = JSON.stringify(nextTags);
      } else {
        delete metadata.tags;
      }
    }

    await client.batchUpdateMemoryRecords(namespace, [
      {
        recordId: memoryId,
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
              memoryId,
              scope: nextScope,
              namespace,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error updating memory: ${error.message}` }],
      isError: true,
    };
  }
}
