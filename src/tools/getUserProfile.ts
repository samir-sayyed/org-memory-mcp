import { BedrockMemoryClient } from '../aws/bedrockAgentCore.js';
import { resolveNamespace, getStrategyNamespacePath } from '../utils/namespaces.js';
import { loadConfig } from '../utils/config.js';
import { getActiveSessionId } from '../utils/session.js';

export const GET_USER_PROFILE_TOOL_NAME = 'get_user_profile';

export function getUserProfileTool(client: BedrockMemoryClient) {
  return {
    name: GET_USER_PROFILE_TOOL_NAME,
    description:
      'Get the current developer profile including coding preferences, top languages, ' +
      'projects, memory statistics, and auto-extracted preferences from AgentCore strategies.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };
}

export async function handleGetUserProfile(
  client: BedrockMemoryClient,
  _args: any
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    const config = loadConfig();
    const sessionId = getActiveSessionId();
    const userNs = resolveNamespace(config, 'user') as string;
    const orgNs = resolveNamespace(config, 'org') as string;

    const [userMemories, orgMemories] = await Promise.all([
      client.listMemoryRecords(userNs),
      client.listMemoryRecords(orgNs),
    ]);

    const allMemories = [...userMemories, ...orgMemories];

    // Extract preferences (style + preference memories from manual saves)
    const manualPreferences = allMemories
      .filter((r) => {
        const mt = r.metadata?.memory_type;
        return mt && 'stringValue' in mt && (mt.stringValue === 'style' || mt.stringValue === 'preference');
      })
      .map((r) => (r.content && 'text' in r.content ? r.content.text : ''))
      .filter(Boolean);

    // Query auto-extracted preferences from strategy namespace
    let autoExtractedPreferences: string[] = [];
    try {
      const strategyPath = getStrategyNamespacePath(config);
      const strategyResults = await client.retrieveMemoryRecordsByPath(
        'user preferences coding style',
        strategyPath,
        10
      );
      autoExtractedPreferences = strategyResults
        .map((r) => (r.content && 'text' in r.content ? r.content.text : ''))
        .filter(Boolean) as string[];
    } catch {
      // Strategy records may not exist yet
    }

    // Extract top languages
    const languageCounts: Record<string, number> = {};
    allMemories.forEach((r) => {
      const lang = r.metadata?.language;
      const langVal = lang && 'stringValue' in lang ? lang.stringValue : '';
      if (langVal) {
        languageCounts[langVal] = (languageCounts[langVal] || 0) + 1;
      }
    });
    const topLanguages = Object.entries(languageCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang]) => lang);

    // Extract top projects
    const projectCounts: Record<string, number> = {};
    allMemories.forEach((r) => {
      const proj = r.metadata?.project;
      const projVal = proj && 'stringValue' in proj ? proj.stringValue : '';
      if (projVal) {
        projectCounts[projVal] = (projectCounts[projVal] || 0) + 1;
      }
    });
    const topProjects = Object.entries(projectCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([proj]) => proj);

    // Get current session info
    let sessionEventCount = 0;
    try {
      const events = await client.listEvents(sessionId);
      sessionEventCount = events.length;
    } catch {
      // No events yet
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              actorId: config.actorId,
              orgId: config.orgId,
              currentSession: {
                sessionId,
                eventCount: sessionEventCount,
              },
              memoryCount: {
                user: userMemories.length,
                orgShared: orgMemories.length,
                total: allMemories.length,
              },
              preferences: {
                manual: manualPreferences,
                autoExtracted: autoExtractedPreferences,
              },
              topLanguages,
              topProjects,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: `Error loading profile: ${error.message}` }],
      isError: true,
    };
  }
}
