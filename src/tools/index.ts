import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { addMemoryTool } from './addMemory.js';
import { searchMemoriesTool } from './searchMemories.js';
import { getMemoriesTool } from './getMemories.js';
import { getMemoryTool } from './getMemory.js';
import { updateMemoryTool } from './updateMemory.js';
import { deleteMemoryTool } from './deleteMemory.js';
import { getUserProfileTool } from './getUserProfile.js';

export function createTools(client: BedrockMemoryClient) {
  return [
    addMemoryTool(client),
    searchMemoriesTool(client),
    getMemoriesTool(client),
    getMemoryTool(client),
    updateMemoryTool(client),
    deleteMemoryTool(client),
    getUserProfileTool(client),
  ];
}

export { SAVE_CONVERSATION_TOOL_NAME, handleSaveConversation } from './saveConversation.js';
export { RETRIEVE_CONTEXT_TOOL_NAME, handleRetrieveContext } from './retrieveContext.js';
export { MEMORY_STATUS_TOOL_NAME, handleMemoryStatus } from './memoryStatus.js';
