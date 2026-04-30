/**
 * AWS Bedrock AgentCore Memory Integration Layer
 * Wraps AWS SDK calls for short-term events and long-term memory records.
 *
 * Architecture:
 *   Short-term memory: CreateEvent / ListEvents — stores conversation turns per session.
 *   Long-term memory:  AgentCore's built-in strategies automatically extract insights
 *                      from short-term events into long-term memory records.
 *   Direct LTM CRUD:   BatchCreate/Update/Delete/Get/List/Retrieve — for manual overrides
 *                      and self-managed strategies.
 */

import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  ListEventsCommand,
  RetrieveMemoryRecordsCommand,
  ListMemoryRecordsCommand,
  GetMemoryRecordCommand,
  DeleteMemoryRecordCommand,
  BatchCreateMemoryRecordsCommand,
  BatchUpdateMemoryRecordsCommand,
  type MemoryRecordSummary,
} from '@aws-sdk/client-bedrock-agentcore';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Config } from '../utils/config.js';
import { ConversationMessage } from '../types/memory.js';

const AGENTCORE_MAX_ATTEMPTS = 3;
const AGENTCORE_CONNECTION_TIMEOUT_MS = 5_000;
const AGENTCORE_REQUEST_TIMEOUT_MS = 20_000;
const AGENTCORE_SOCKET_TIMEOUT_MS = 20_000;

export class BedrockMemoryClient {
  private client: BedrockAgentCoreClient;
  private memoryId: string;
  private orgId: string;
  private actorId: string;

  constructor(config: Config) {
    const clientConfig: any = {
      region: config.awsRegion,
      maxAttempts: AGENTCORE_MAX_ATTEMPTS,
      retryMode: 'standard' as const,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: AGENTCORE_CONNECTION_TIMEOUT_MS,
        requestTimeout: AGENTCORE_REQUEST_TIMEOUT_MS,
        socketTimeout: AGENTCORE_SOCKET_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      }),
    };

    if (config.awsAccessKeyId && config.awsSecretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
        ...(config.awsSessionToken && { sessionToken: config.awsSessionToken }),
      };
    }

    this.client = new BedrockAgentCoreClient(clientConfig);
    this.memoryId = config.memoryArn.includes(":memory/") ? config.memoryArn.split(":memory/")[1] : config.memoryArn;
    this.orgId = config.orgId;
    this.actorId = config.actorId;
  }

  close(): void {
    this.client.destroy();
  }

  private toMeta(value: string) {
    return { stringValue: value };
  }

  private toText(text: string) {
    return { text };
  }

  // ── Short-Term Memory (Events) ────────────────────────────────────

  /**
   * Store a conversation as short-term memory events.
   * This is the PRIMARY ingestion path — AgentCore's built-in strategies
   * (Semantic, UserPreference, Summary) automatically extract insights
   * from these events into long-term memory.
   *
   * Messages are formatted with proper USER/ASSISTANT roles as required
   * by the built-in strategies.
   */
  async createConversationEvent(
    sessionId: string,
    messages: ConversationMessage[],
    metadata?: Record<string, string>
  ): Promise<string> {
    const payload = messages.map((msg) => ({
      conversational: {
        content: this.toText(msg.content),
        role: msg.role === 'user' ? 'USER' as const : 'ASSISTANT' as const,
      },
    }));

    const command = new CreateEventCommand({
      memoryId: this.memoryId,
      actorId: this.actorId,
      sessionId,
      eventTimestamp: new Date(),
      payload,
      metadata: {
        orgId: this.toMeta(this.orgId),
        ...(metadata &&
          Object.fromEntries(
            Object.entries(metadata).map(([k, v]) => [k, this.toMeta(v)])
          )),
      },
    });

    const response = await this.client.send(command);
    return response.event?.eventId || '';
  }

  /** Create a short-term event that feeds into long-term memory extraction */
  async createEvent(
    sessionId: string,
    content: string,
    namespace: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    const command = new CreateEventCommand({
      memoryId: this.memoryId,
      actorId: this.actorId,
      sessionId,
      eventTimestamp: new Date(),
      payload: [
        {
          conversational: {
            content: this.toText(content),
            role: 'USER',
          },
        },
      ],
      metadata: {
        orgId: this.toMeta(this.orgId),
        namespace: this.toMeta(namespace),
        ...(metadata &&
          Object.fromEntries(
            Object.entries(metadata).map(([k, v]) => [k, this.toMeta(v)])
          )),
      },
    });

    const response = await this.client.send(command);
    return response.event?.eventId || '';
  }

  /** List short-term events for a session */
  async listEvents(sessionId: string, namespace?: string, maxResults?: number) {
    const command = new ListEventsCommand({
      memoryId: this.memoryId,
      actorId: this.actorId,
      sessionId,
      ...(maxResults && { maxResults }),
      ...(namespace && {
        metadataFilter: {
          conditions: [
            {
              leftOperand: { property: 'namespace' },
              operator: 'Equals',
              rightExpression: { metadataValue: this.toMeta(namespace) },
            },
          ],
        },
      }),
    });

    const response = await this.client.send(command);
    return response.events || [];
  }

  // ── Long-Term Memory (Records) ────────────────────────────────────

  /** Semantic search across long-term memory records */
  async retrieveMemoryRecords(
    query: string,
    namespace: string | string[],
    limit: number = 10
  ): Promise<MemoryRecordSummary[]> {
    const namespaces = Array.isArray(namespace) ? namespace : [namespace];
    const allResults: MemoryRecordSummary[] = [];

    for (const ns of namespaces) {
      let nextToken: string | undefined;
      let namespaceResultCount = 0;

      do {
        const remaining = limit - namespaceResultCount;
        const command = new RetrieveMemoryRecordsCommand({
          memoryId: this.memoryId,
          namespace: ns,
          searchCriteria: {
            searchQuery: query,
            topK: limit,
          },
          maxResults: Math.min(100, remaining),
          nextToken,
        });

        const response = await this.client.send(command);
        if (response.memoryRecordSummaries) {
          allResults.push(...response.memoryRecordSummaries);
          namespaceResultCount += response.memoryRecordSummaries.length;
        }

        nextToken = response.nextToken;
      } while (nextToken && namespaceResultCount < limit);
    }

    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    return allResults.slice(0, limit);
  }

  /**
   * Semantic search using namespacePath prefix.
   * This searches across all sub-namespaces under the given path,
   * which is useful for querying all strategy-extracted records.
   */
  async retrieveMemoryRecordsByPath(
    query: string,
    namespacePath: string,
    limit: number = 10
  ): Promise<MemoryRecordSummary[]> {
    const allResults: MemoryRecordSummary[] = [];
    let nextToken: string | undefined;

    do {
      const remaining = limit - allResults.length;
      const command = new RetrieveMemoryRecordsCommand({
        memoryId: this.memoryId,
        namespacePath,
        searchCriteria: {
          searchQuery: query,
          topK: limit,
        },
        maxResults: Math.min(100, remaining),
        nextToken,
      });

      const response = await this.client.send(command);
      if (response.memoryRecordSummaries) {
        allResults.push(...response.memoryRecordSummaries);
      }

      nextToken = response.nextToken;
    } while (nextToken && allResults.length < limit);

    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    return allResults.slice(0, limit);
  }

  /** List long-term memory records in a namespace */
  async listMemoryRecords(
    namespace: string | string[],
    limit?: number
  ): Promise<MemoryRecordSummary[]> {
    const namespaces = Array.isArray(namespace) ? namespace : [namespace];
    const allResults: MemoryRecordSummary[] = [];

    for (const ns of namespaces) {
      let nextToken: string | undefined;
      let namespaceResultCount = 0;

      do {
        const remaining = limit === undefined ? 100 : Math.max(limit - namespaceResultCount, 0);
        if (limit !== undefined && remaining === 0) {
          break;
        }

        const command = new ListMemoryRecordsCommand({
          memoryId: this.memoryId,
          namespace: ns,
          maxResults: Math.min(100, remaining),
          nextToken,
        });

        const response = await this.client.send(command);
        if (response.memoryRecordSummaries) {
          allResults.push(...response.memoryRecordSummaries);
          namespaceResultCount += response.memoryRecordSummaries.length;
        }

        nextToken = response.nextToken;
      } while (nextToken);
    }

    return allResults;
  }

  /** List long-term memory records under a namespacePath prefix */
  async listMemoryRecordsByPath(
    namespacePath: string,
    limit?: number
  ): Promise<MemoryRecordSummary[]> {
    const allResults: MemoryRecordSummary[] = [];
    let nextToken: string | undefined;

    do {
      const remaining = limit === undefined ? 100 : Math.max(limit - allResults.length, 0);
      if (limit !== undefined && remaining === 0) {
        break;
      }

      const command = new ListMemoryRecordsCommand({
        memoryId: this.memoryId,
        namespacePath,
        maxResults: Math.min(100, remaining),
        nextToken,
      });

      const response = await this.client.send(command);
      if (response.memoryRecordSummaries) {
        allResults.push(...response.memoryRecordSummaries);
      }

      nextToken = response.nextToken;
    } while (nextToken);

    return allResults;
  }

  /** Get a single memory record by ID */
  async getMemoryRecord(recordId: string): Promise<MemoryRecordSummary | null> {
    try {
      const command = new GetMemoryRecordCommand({
        memoryId: this.memoryId,
        memoryRecordId: recordId,
      });

      const response = await this.client.send(command);
      return response.memoryRecord || null;
    } catch (error: any) {
      if (error?.name === 'ResourceNotFoundException') {
        return null;
      }

      throw error;
    }
  }

  /** Create long-term memory records directly (batch) */
  async batchCreateMemoryRecords(
    namespace: string,
    records: Array<{
      content: string;
      metadata?: Record<string, string>;
    }>
  ): Promise<string[]> {
    const memoryRecords = records.map((r, idx) => ({
      requestIdentifier: `req-${Date.now()}-${idx}`,
      namespaces: [namespace],
      content: this.toText(r.content),
      timestamp: new Date(),
      metadata: {
        orgId: this.toMeta(this.orgId),
        actorId: this.toMeta(this.actorId),
        createdAt: this.toMeta(new Date().toISOString()),
        ...(r.metadata &&
          Object.fromEntries(
            Object.entries(r.metadata).map(([k, v]) => [k, this.toMeta(v)])
          )),
      },
    }));

    const command = new BatchCreateMemoryRecordsCommand({
      memoryId: this.memoryId,
      records: memoryRecords,
    });

    const response = await this.client.send(command);
    return (
      (response.successfulRecords
        ?.map((r) => r.memoryRecordId)
        .filter(Boolean) as string[]) || []
    );
  }

  /** Update existing memory records */
  async batchUpdateMemoryRecords(
    namespace: string,
    records: Array<{
      recordId: string;
      content: string;
      metadata?: Record<string, string>;
    }>
  ): Promise<void> {
    const memoryRecords = records.map((r) => ({
      memoryRecordId: r.recordId,
      timestamp: new Date(),
      content: this.toText(r.content),
      namespaces: [namespace],
      metadata: {
        orgId: this.toMeta(this.orgId),
        actorId: this.toMeta(this.actorId),
        updatedAt: this.toMeta(new Date().toISOString()),
        ...(r.metadata &&
          Object.fromEntries(
            Object.entries(r.metadata).map(([k, v]) => [k, this.toMeta(v)])
          )),
      },
    }));

    const command = new BatchUpdateMemoryRecordsCommand({
      memoryId: this.memoryId,
      records: memoryRecords,
    });

    await this.client.send(command);
  }

  /** Delete a memory record */
  async deleteMemoryRecord(recordId: string): Promise<void> {
    const command = new DeleteMemoryRecordCommand({
      memoryId: this.memoryId,
      memoryRecordId: recordId,
    });

    await this.client.send(command);
  }

  /** Get the memory ID (for diagnostics) */
  getMemoryId(): string {
    return this.memoryId;
  }

  /** Get the actor ID (for diagnostics) */
  getActorId(): string {
    return this.actorId;
  }

  /** Get the org ID (for diagnostics) */
  getOrgId(): string {
    return this.orgId;
  }
}
