/**
 * save_conversation — Primary ingestion tool for short-term memory.
 *
 * Stores conversation turns as events in AgentCore short-term memory using
 * CreateEvent. AgentCore's built-in strategies (Semantic, UserPreference,
 * Summary) automatically extract insights into long-term memory in the background.
 *
 * This is the RECOMMENDED way to store conversational data.
 * Use `add_memory` only for explicit manual writes to long-term memory.
 */

import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { getActiveSessionId } from '../utils/session.js';
import { getRequiredString, getOptionalString } from '../utils/validation.js';
import { ConversationMessage } from '../types/memory.js';

export const SAVE_CONVERSATION_TOOL_NAME = 'save_conversation';

export async function handleSaveConversation(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    // Validate messages
    const messages = args?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages is required and must be a non-empty array of { role, content } objects');
    }

    const validatedMessages: ConversationMessage[] = messages.map((msg: any, idx: number) => {
      if (!msg || typeof msg !== 'object') {
        throw new Error(`messages[${idx}] must be an object with role and content`);
      }

      const role = msg.role?.toLowerCase?.();
      if (role !== 'user' && role !== 'assistant') {
        throw new Error(`messages[${idx}].role must be "user" or "assistant", got "${msg.role}"`);
      }

      const content = getRequiredString(msg.content, `messages[${idx}].content`);
      return { role: role as 'user' | 'assistant', content };
    });

    // Use provided session ID or the active one
    const sessionId = getOptionalString(args?.session_id) || getActiveSessionId();

    // Build optional metadata
    const metadata: Record<string, string> = {};
    const project = getOptionalString(args?.project);
    const language = getOptionalString(args?.language);
    if (project) metadata.project = project;
    if (language) metadata.language = language;

    // Create the event — this feeds AgentCore's extraction pipeline
    const eventId = await client.createConversationEvent(
      sessionId,
      validatedMessages,
      Object.keys(metadata).length > 0 ? metadata : undefined
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              eventId,
              sessionId,
              messageCount: validatedMessages.length,
              note: 'Conversation saved to short-term memory. AgentCore will automatically extract insights (facts, preferences, summaries) into long-term memory in the background.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error saving conversation: ${error.message}` }],
      isError: true,
    };
  }
}
