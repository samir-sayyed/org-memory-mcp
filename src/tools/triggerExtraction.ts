/**
 * trigger_extraction — Force immediate processing of short-term events into long-term memory.
 *
 * AgentCore auto-extracts insights in background, but this tool triggers
 * an on-demand extraction job. Useful when you want insights NOW.
 */

import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';

export const TRIGGER_EXTRACTION_TOOL_NAME = 'trigger_extraction';

export async function handleTriggerExtraction(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const sessionId = typeof args?.session_id === 'string' ? args.session_id : undefined;
    const jobId = await client.startMemoryExtractionJob(sessionId);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              jobId,
              message: 'Extraction job started. AgentCore is processing short-term events into long-term memory. Check list_extraction_jobs for status.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error triggering extraction: ${error.message}` }],
      isError: true,
    };
  }
}
