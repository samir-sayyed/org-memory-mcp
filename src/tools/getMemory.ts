import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { getRequiredString } from '../utils/validation.js';

export const GET_MEMORY_TOOL_NAME = 'get_memory';

export function getMemoryTool(client: BedrockMemoryClient) {
  return {
    name: GET_MEMORY_TOOL_NAME,
    description: 'Retrieve a single memory record by its unique memoryId.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'The unique identifier of the memory record',
        },
      },
      required: ['memory_id'],
    },
  };
}

export async function handleGetMemory(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const memoryId = getRequiredString(args?.memory_id, 'memory_id');
    const record = await client.getMemoryRecord(memoryId);

    if (!record) {
      return {
        content: [{ type: 'text', text: `Memory not found: ${memoryId}` }],
        isError: true,
      };
    }

    const formatted = {
      memoryId: record.memoryRecordId,
      content: record.content && 'text' in record.content ? record.content.text : 'N/A',
      namespaces: record.namespaces,
      createdAt: record.createdAt,
      metadata: Object.fromEntries(
        Object.entries(record.metadata || {}).map(([k, v]) => [
          k,
          'stringValue' in v ? v.stringValue : v,
        ])
      ),
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(formatted, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error retrieving memory: ${error.message}` }],
      isError: true,
    };
  }
}
