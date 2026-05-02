/**
 * trigger_extraction — Request on-demand memory extraction.
 *
 * AgentCore auto-extracts insights in the background via configured strategies.
 * This tool attempts to start an extraction job for immediate processing.
 * Requires pre-configured extraction job templates on your Memory resource.
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
              message: 'Extraction job started. AgentCore will process short-term events into long-term memory.',
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              message: 'On-demand extraction requires a pre-configured extraction job template.',
              detail: error.message,
              note: 'Auto-extraction still runs in the background via your configured strategies.',
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}
