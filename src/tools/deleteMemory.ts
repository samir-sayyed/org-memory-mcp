import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { getRequiredString } from '../utils/validation.js';

export const DELETE_MEMORY_TOOL_NAME = 'delete_memory';

export function deleteMemoryTool(client: BedrockMemoryClient) {
  return {
    name: DELETE_MEMORY_TOOL_NAME,
    description: 'Delete a memory record by its memoryId.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'The unique identifier of the memory to delete',
        },
      },
      required: ['memory_id'],
    },
  };
}

export async function handleDeleteMemory(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const memoryId = getRequiredString(args?.memory_id, 'memory_id');
    await client.deleteMemoryRecord(memoryId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              deletedMemoryId: memoryId,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error deleting memory: ${error.message}` }],
      isError: true,
    };
  }
}
