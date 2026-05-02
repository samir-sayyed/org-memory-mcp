/**
 * list_extraction_jobs — View recent memory extraction jobs.
 *
 * Shows status of background jobs that convert short-term events
 * into long-term memory records via AgentCore strategies.
 */

import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';

export const LIST_EXTRACTION_JOBS_TOOL_NAME = 'list_extraction_jobs';

export async function handleListExtractionJobs(
  client: BedrockMemoryClient,
  args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const maxResults = typeof args?.limit === 'number' && args.limit > 0 && args.limit <= 50
      ? args.limit
      : 20;

    const jobs = await client.listMemoryExtractionJobs(maxResults);

    const formatted = jobs.map((j: any) => ({
      jobId: j.jobID,
      status: j.status,
      strategyId: j.strategyId,
      sessionId: j.sessionId,
      failureReason: j.failureReason,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              count: formatted.length,
              jobs: formatted,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error listing extraction jobs: ${error.message}` }],
      isError: true,
    };
  }
}
