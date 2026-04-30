/**
 * Memory types for the Org Memory MCP Server
 */

// ── Conversation types (for short-term memory) ──────────────────────

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionInfo {
  sessionId: string;
  actorId: string;
  startedAt: string;
  eventCount?: number;
}

// ── Context retrieval (combined STM + LTM) ──────────────────────────

export interface ContextResult {
  sessionContext: Array<{
    role: string;
    content: string;
    timestamp?: string;
    eventId?: string;
  }>;
  longTermInsights: Array<{
    memoryId: string;
    content: string;
    score?: number;
    namespaces?: string[];
    metadata?: Record<string, string>;
  }>;
}

// ── Long-term memory types ──────────────────────────────────────────

export interface MemoryMetadata {
  memory_type: 'style' | 'architecture' | 'bugfix' | 'api_pattern' | 'preference' | 'general';
  project?: string;
  language?: string;
  tags?: string[];
  scope: 'user' | 'project' | 'org';
  [key: string]: any;
}

export interface MemoryRecord {
  id: string;
  content: string;
  actorId: string;
  orgId: string;
  projectId?: string;
  metadata: MemoryMetadata;
  createdAt: string;
  updatedAt?: string;
  score?: number;
}

export interface AddMemoryInput {
  content: string;
  memoryType: MemoryMetadata['memory_type'];
  project?: string;
  language?: string;
  tags?: string[];
  scope?: 'user' | 'project' | 'org';
}

export interface SearchMemoryInput {
  query: string;
  scope?: 'user' | 'project' | 'org' | 'all';
  project?: string;
  memoryType?: MemoryMetadata['memory_type'];
  limit?: number;
}

export interface ListMemoryInput {
  scope?: 'user' | 'project' | 'org' | 'all';
  project?: string;
  memoryType?: MemoryMetadata['memory_type'];
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface UpdateMemoryInput {
  memoryId: string;
  content: string;
  metadata?: Partial<MemoryMetadata>;
}

export interface UserProfile {
  actorId: string;
  orgId: string;
  preferences: string[];
  memoryCount: number;
  topLanguages: string[];
  topProjects: string[];
}