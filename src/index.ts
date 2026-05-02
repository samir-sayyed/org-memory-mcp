#!/usr/bin/env node
/**
 * Org Memory MCP Server
 * Provides org-wide persisted memory for AI coding agents via AWS Bedrock AgentCore.
 *
 * Architecture:
 *   Short-term memory (CreateEvent) → AgentCore auto-extracts → Long-term memory
 *   Direct LTM CRUD via BatchCreate/Update for manual overrides
 *
 * Tools:
 *   save_conversation  — Primary: store conversation turns → auto-extraction
 *   retrieve_context   — Combined short-term + long-term context retrieval
 *   create_memory      — Manual: direct write to long-term memory
 *   search_memories    — Semantic search across all memory types
 *   get_memories       — Advanced browse/filter for long-term memory records
 *   get_memory         — Advanced record lookup by ID
 *   update_memory      — Advanced shared-record update
 *   delete_memory      — Advanced shared-record delete
 *   get_user_profile   — Derived actor summary from shared memory
 *   memory_status      — Diagnostics and health check
 *   launch_dashboard   — Local dashboard UI
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

import { ConfigError, formatConfigError, loadConfig } from './utils/config.js';
import { initSession, getActiveSessionId } from './utils/session.js';
import { BedrockMemoryClient } from './aws/bedrockAgentCore.js';

import {
  ADD_MEMORY_TOOL_NAME,
  CREATE_MEMORY_INPUT_SCHEMA,
  CREATE_MEMORY_TOOL_DESCRIPTION,
  CREATE_MEMORY_TOOL_NAME,
  handleAddMemory,
} from './tools/addMemory.js';
import { SEARCH_MEMORIES_TOOL_NAME, handleSearchMemories } from './tools/searchMemories.js';
import { GET_MEMORIES_TOOL_NAME, handleGetMemories } from './tools/getMemories.js';
import { GET_MEMORY_TOOL_NAME, handleGetMemory } from './tools/getMemory.js';
import { UPDATE_MEMORY_TOOL_NAME, handleUpdateMemory } from './tools/updateMemory.js';
import { DELETE_MEMORY_TOOL_NAME, handleDeleteMemory } from './tools/deleteMemory.js';
import { GET_USER_PROFILE_TOOL_NAME, handleGetUserProfile } from './tools/getUserProfile.js';
import { LAUNCH_DASHBOARD_TOOL_NAME, launchDashboardTool, handleLaunchDashboard } from './tools/launchDashboard.js';
import { SAVE_CONVERSATION_TOOL_NAME, handleSaveConversation } from './tools/saveConversation.js';
import { RETRIEVE_CONTEXT_TOOL_NAME, handleRetrieveContext } from './tools/retrieveContext.js';
import { MEMORY_STATUS_TOOL_NAME, handleMemoryStatus } from './tools/memoryStatus.js';
import { TRIGGER_EXTRACTION_TOOL_NAME, handleTriggerExtraction } from './tools/triggerExtraction.js';
import { LIST_EXTRACTION_JOBS_TOOL_NAME, handleListExtractionJobs } from './tools/listExtractionJobs.js';

class OrgMemoryMcpServer {
  private server: Server;
  private _memoryClient: BedrockMemoryClient | null = null;

  private get memoryClient(): BedrockMemoryClient {
    if (!this._memoryClient) {
      const config = loadConfig();
      this._memoryClient = new BedrockMemoryClient(config);
    }
    return this._memoryClient;
  }

  private closeMemoryClient() {
    if (!this._memoryClient) {
      return;
    }

    this._memoryClient.close();
    this._memoryClient = null;
  }

  constructor() {
    // Initialise session — no config required, auto-generates an ID if SESSION_ID is absent
    const sessionId = initSession(process.env.SESSION_ID);
    console.error(`[Session] Active session: ${sessionId}`);

    this.server = new Server(
      {
        name: 'org-memory-mcp',
        version: '1.2.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      this.closeMemoryClient();
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // ── Primary: Short-term → Auto-extraction ──────────────
        {
          name: SAVE_CONVERSATION_TOOL_NAME,
          description:
            'Store conversation turns in short-term memory. AgentCore automatically extracts ' +
            'insights (facts, preferences, summaries) into long-term memory in the background. ' +
            'This is the RECOMMENDED way to store conversational data.',
          inputSchema: {
            type: 'object',
            properties: {
              messages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    role: {
                      type: 'string',
                      enum: ['user', 'assistant'],
                      description: 'The role of the message sender',
                    },
                    content: {
                      type: 'string',
                      description: 'The message content',
                    },
                  },
                  required: ['role', 'content'],
                },
                description: 'Conversation messages to store',
              },
              session_id: {
                type: 'string',
                description: 'Optional session ID override. Auto-generated if not provided.',
              },
              project: {
                type: 'string',
                description: 'Optional project context for the conversation',
              },
              language: {
                type: 'string',
                description: 'Optional programming language context',
              },
            },
            required: ['messages'],
          },
        },
        // ── Combined context retrieval ─────────────────────────
        {
          name: RETRIEVE_CONTEXT_TOOL_NAME,
          description:
            'Retrieve relevant context from both short-term (current session history) and ' +
            'long-term memory (auto-extracted insights + manually saved records). ' +
            'Use this to get comprehensive context before responding to the user.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'What context is needed, described in natural language',
              },
              include_session: {
                type: 'boolean',
                default: true,
                description: 'Include current session conversation history (default: true)',
              },
              session_id: {
                type: 'string',
                description: 'Which session to pull history from (defaults to current)',
              },
              scope: {
                type: 'string',
                enum: ['user', 'project', 'org', 'all'],
                default: 'all',
                description: 'Scope for long-term memory search',
              },
              project: {
                type: 'string',
                description: 'Project filter for long-term memories',
              },
              min_score: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Minimum relevance score (0-1). Higher = more relevant results only.',
              },
              limit: {
                type: 'number',
                default: 10,
                minimum: 1,
                maximum: 50,
              },
            },
            required: ['query'],
          },
        },
        // ── Manual long-term memory CRUD ───────────────────────
        {
          name: CREATE_MEMORY_TOOL_NAME,
          description: CREATE_MEMORY_TOOL_DESCRIPTION,
          inputSchema: CREATE_MEMORY_INPUT_SCHEMA,
        },
        {
          name: SEARCH_MEMORIES_TOOL_NAME,
          description:
            'Semantic search across all memory — both manually saved records and auto-extracted ' +
            'insights from AgentCore strategies (facts, preferences, summaries).',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language search query',
              },
              scope: {
                type: 'string',
                enum: ['user', 'project', 'org', 'all'],
                default: 'all',
                description: 'Which memories to search',
              },
              project: {
                type: 'string',
                description: 'Project filter',
              },
              memory_type: {
                type: 'string',
                enum: ['style', 'architecture', 'bugfix', 'api_pattern', 'preference', 'general'],
                description: 'Filter by memory type (manual records only)',
              },
              include_strategy_memories: {
                type: 'boolean',
                default: true,
                description: 'Also search auto-extracted memories from AgentCore strategies',
              },
              limit: {
                type: 'number',
                default: 10,
                minimum: 1,
                maximum: 50,
              },
            },
            required: ['query'],
          },
        },
        {
          name: GET_MEMORIES_TOOL_NAME,
          description:
            'Advanced browse tool for long-term memory records when no semantic query exists.',
          inputSchema: {
            type: 'object',
            properties: {
              scope: {
                type: 'string',
                enum: ['user', 'project', 'org', 'all'],
                default: 'all',
              },
              project: { type: 'string' },
              memory_type: {
                type: 'string',
                enum: ['style', 'architecture', 'bugfix', 'api_pattern', 'preference', 'general'],
              },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
              limit: {
                type: 'number',
                default: 20,
                minimum: 1,
                maximum: 100,
              },
            },
          },
        },
        {
          name: GET_MEMORY_TOOL_NAME,
          description: 'Advanced lookup for a single memory record by its memoryId.',
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
        },
        {
          name: UPDATE_MEMORY_TOOL_NAME,
          description: 'Advanced shared-memory operation: update an existing record by its memoryId.',
          inputSchema: {
            type: 'object',
            properties: {
              memory_id: { type: 'string' },
              content: { type: 'string' },
              scope: {
                type: 'string',
                enum: ['user', 'project', 'org'],
              },
              project: { type: 'string' },
              memory_type: {
                type: 'string',
                enum: ['style', 'architecture', 'bugfix', 'api_pattern', 'preference', 'general'],
              },
              language: { type: 'string' },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['memory_id', 'content'],
          },
        },
        {
          name: DELETE_MEMORY_TOOL_NAME,
          description: 'Advanced shared-memory operation: delete a memory record by its memoryId.',
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
        },
        // ── Derived views & diagnostics ───────────────────────
        {
          name: GET_USER_PROFILE_TOOL_NAME,
          description:
            'Get a derived summary of the current actor\'s preferences, languages, projects, ' +
            'memory stats, and current session info from the shared memory resource.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: MEMORY_STATUS_TOOL_NAME,
          description:
            'Check memory system health: current session, short-term event count, ' +
            'long-term record counts, active namespaces, and usage tips.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: TRIGGER_EXTRACTION_TOOL_NAME,
          description:
            'Trigger an on-demand memory extraction job. AgentCore will immediately process ' +
            'short-term events into long-term memory records. Use when you need insights NOW.',
          inputSchema: {
            type: 'object',
            properties: {
              session_id: {
                type: 'string',
                description: 'Optional session ID to target for extraction',
              },
            },
          },
        },
        {
          name: LIST_EXTRACTION_JOBS_TOOL_NAME,
          description:
            'List recent memory extraction jobs and their status. Shows which strategy jobs ' +
            'are running, completed, or failed.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                default: 20,
                minimum: 1,
                maximum: 50,
                description: 'Maximum jobs to return',
              },
            },
          },
        },
        launchDashboardTool(),
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          // Short-term → auto-extraction
          case SAVE_CONVERSATION_TOOL_NAME:
            return handleSaveConversation(this.memoryClient, args);
          case RETRIEVE_CONTEXT_TOOL_NAME:
            return handleRetrieveContext(this.memoryClient, args);

          // Manual long-term CRUD
          case CREATE_MEMORY_TOOL_NAME:
          case ADD_MEMORY_TOOL_NAME:
            return handleAddMemory(this.memoryClient, args);
          case SEARCH_MEMORIES_TOOL_NAME:
            return handleSearchMemories(this.memoryClient, args);
          case GET_MEMORIES_TOOL_NAME:
            return handleGetMemories(this.memoryClient, args);
          case GET_MEMORY_TOOL_NAME:
            return handleGetMemory(this.memoryClient, args);
          case UPDATE_MEMORY_TOOL_NAME:
            return handleUpdateMemory(this.memoryClient, args);
          case DELETE_MEMORY_TOOL_NAME:
            return handleDeleteMemory(this.memoryClient, args);

          // Profile & diagnostics
          case GET_USER_PROFILE_TOOL_NAME:
            return handleGetUserProfile(this.memoryClient, args);
          case MEMORY_STATUS_TOOL_NAME:
            return handleMemoryStatus(this.memoryClient, args);
          case TRIGGER_EXTRACTION_TOOL_NAME:
            return handleTriggerExtraction(this.memoryClient, args);
          case LIST_EXTRACTION_JOBS_TOOL_NAME:
            return handleListExtractionJobs(this.memoryClient, args);
          case LAUNCH_DASHBOARD_TOOL_NAME:
            return handleLaunchDashboard(args);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof ConfigError) {
          return {
            content: [{ type: 'text', text: formatConfigError(error) }],
            isError: true,
          };
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Org Memory MCP server running on stdio');
    console.error(`[Session] ${getActiveSessionId()}`);
  }
}

function handleFatalStartupError(error: unknown): never {
  console.error(formatConfigError(error));
  process.exit(1);
}

try {
  const server = new OrgMemoryMcpServer();
  server.run().catch(handleFatalStartupError);
} catch (error) {
  handleFatalStartupError(error);
}
