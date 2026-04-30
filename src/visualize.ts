/**
 * Memory Visualization Dashboard Server
 * Serves a live dashboard at http://localhost:3001
 * No external dependencies — uses Node.js built-in http module.
 *
 * API endpoints:
 *   /api/memories   — Long-term memory records (manual + all namespaces)
 *   /api/session    — Short-term events from the current session
 *   /api/status     — Memory system health & stats
 *   /api/strategies — Auto-extracted records from strategy namespaces
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { BedrockMemoryClient } from './aws/bedrockAgentCore.js';
import { loadConfig } from './utils/config.js';
import { initSession, getActiveSessionId } from './utils/session.js';
import {
  getUserNamespace,
  getOrgSharedNamespace,
  getStrategyNamespacePath,
  getProjectNamespace,
} from './utils/namespaces.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPort = process.env.PORT;
const PORT = rawPort ? Number.parseInt(rawPort, 10) : 3001;

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid PORT value: ${rawPort}`);
}

const config = loadConfig();
initSession(config.sessionId);
const client = new BedrockMemoryClient(config);

interface EnrichedMemory {
  memoryId: string;
  content: string;
  namespace: string;
  scope: 'user' | 'project' | 'org' | 'strategy';
  projectName: string | null;
  source: 'manual' | 'auto-extracted';
  memoryType: string | null;
  strategyType: 'semantic' | 'preference' | 'summary' | null;
  language: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  orgId: string;
  actorId: string;
}

function deriveScope(namespace: string): { scope: 'user' | 'project' | 'org' | 'strategy'; projectName: string | null; strategyType: 'semantic' | 'preference' | 'summary' | null } {
  if (namespace.startsWith('/strategy/')) {
    let strategyType: 'semantic' | 'preference' | 'summary' | null = null;
    // Attempt to infer from common naming conventions or path structures if metadata isn't enough
    // In actual AWS AgentCore, you'd usually map the strategy ID to its type.
    // For visualization purposes, we might guess based on content/metadata later, but let's set a default.
    return { scope: 'strategy', projectName: null, strategyType: 'semantic' }; // Will be refined in enrichRecord
  }
  if (namespace.includes('/user/')) return { scope: 'user', projectName: null, strategyType: null };
  if (namespace.includes('/project/')) {
    const match = namespace.match(/\/project\/([^/]+)\//);
    return { scope: 'project', projectName: match ? match[1] : null, strategyType: null };
  }
  if (namespace.includes('/shared/')) return { scope: 'org', projectName: null, strategyType: null };
  return { scope: 'user', projectName: null, strategyType: null };
}

function enrichRecord(r: any): EnrichedMemory {
  const ns = (r.namespaces?.[0] || '') as string;
  const { scope, projectName } = deriveScope(ns);
  const meta = (r.metadata || {}) as Record<string, { stringValue?: string }>;

  let strategyType: 'semantic' | 'preference' | 'summary' | null = null;
  if (scope === 'strategy') {
    // Attempt to categorize based on typical metadata or namespace hints if available
    const stratName = (meta['strategyName']?.stringValue || ns).toLowerCase();
    if (stratName.includes('pref')) strategyType = 'preference';
    else if (stratName.includes('sum')) strategyType = 'summary';
    else strategyType = 'semantic';
  }

  const createdAt =
    meta['x-amz-agentcore-memory-createdAt']?.stringValue ||
    (r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ''));

  const updatedAt =
    meta['x-amz-agentcore-memory-updatedAt']?.stringValue ||
    createdAt;

  const tagsRaw = meta['tags']?.stringValue || '';
  const tags = tagsRaw ? tagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean) : [];

  return {
    memoryId: r.memoryRecordId || '',
    content: (r.content && 'text' in r.content ? (r.content as { text: string }).text : '') || '',
    namespace: ns,
    scope,
    projectName,
    source: scope === 'strategy' ? 'auto-extracted' : 'manual',
    memoryType: meta['memory_type']?.stringValue || null,
    strategyType,
    language: meta['language']?.stringValue || null,
    tags,
    createdAt,
    updatedAt,
    orgId: meta['orgId']?.stringValue || config.orgId,
    actorId: meta['actorId']?.stringValue || config.actorId,
  };
}

async function fetchAllMemories(): Promise<EnrichedMemory[]> {
  const userNs = getUserNamespace(config);
  const orgNs = getOrgSharedNamespace(config);
  const titanNs = getProjectNamespace(config, 'titan');

  let userRecords: any[] = [];
  let orgRecords: any[] = [];
  let titanRecords: any[] = [];

  try {
    [userRecords, orgRecords, titanRecords] = await Promise.all([
      client.listMemoryRecords(userNs).catch(() => []),
      client.listMemoryRecords(orgNs).catch(() => []),
      client.listMemoryRecords(titanNs).catch(() => []),
    ]);
  } catch (error: any) {
    throw new Error(`Failed to load memories from Bedrock AgentCore: ${error.message}`);
  }

  const allRecords = [...userRecords, ...orgRecords, ...titanRecords];

  // Deduplicate by memoryId
  const seen = new Set<string>();
  const unique = allRecords.filter((r) => {
    const id = r.memoryRecordId || '';
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return unique.map(enrichRecord);
}

async function fetchStrategyMemories(): Promise<EnrichedMemory[]> {
  try {
    const strategyPath = getStrategyNamespacePath(config);
    const results = await client.retrieveMemoryRecordsByPath(
      'all strategy extracted records',
      strategyPath,
      50
    );
    return results.map(enrichRecord);
  } catch {
    return [];
  }
}

async function fetchSessionEvents(): Promise<any[]> {
  const currentSessionId = getActiveSessionId();
  const sessionIds = [currentSessionId, 'session-demo-titan-1', 'session-demo-python-1', 'session-demo-ui-1'];
  
  let allEvents: any[] = [];
  
  for (const sid of sessionIds) {
    try {
      const events = await client.listEvents(sid, undefined, 100);
      const mappedEvents = events.map((event: any) => {
        const messages: any[] = [];
      if (Array.isArray(event.payload)) {
        for (const item of event.payload) {
          if (item.conversational) {
            messages.push({
              role: item.conversational.role || 'UNKNOWN',
              content: item.conversational.content?.text || '',
            });
          }
        }
      }
        return {
          eventId: event.eventId || '',
          sessionId: sid,
          timestamp: event.eventTimestamp?.toISOString?.() || '',
          messages,
          metadata: Object.fromEntries(
            Object.entries(event.metadata || {}).map(([k, v]: [string, any]) => [
              k,
              v?.stringValue || v,
            ])
          ),
        };
      });
      allEvents = allEvents.concat(mappedEvents);
    } catch { /* ignore if session doesn't exist */ }
  }
  return allEvents;
}

async function fetchStatus(): Promise<any> {
  const sessionId = getActiveSessionId();
  const userNs = getUserNamespace(config);
  const orgNs = getOrgSharedNamespace(config);

  let sessionEventCount = 0;
  let userRecordCount = 0;
  let orgRecordCount = 0;
  let strategyRecordCount = 0;

  try {
    const events = await client.listEvents(sessionId);
    sessionEventCount = events.length;
  } catch { /* empty */ }

  try {
    const userRecords = await client.listMemoryRecords(userNs);
    userRecordCount = userRecords.length;
  } catch { /* empty */ }

  try {
    const orgRecords = await client.listMemoryRecords(orgNs);
    orgRecordCount = orgRecords.length;
  } catch { /* empty */ }

  try {
    const strategyPath = getStrategyNamespacePath(config);
    const r = await client.retrieveMemoryRecordsByPath('status', strategyPath, 1);
    strategyRecordCount = r.length;
  } catch { /* empty */ }

  return {
    memoryId: client.getMemoryId(),
    actorId: config.actorId,
    orgId: config.orgId,
    session: {
      sessionId,
      eventCount: sessionEventCount,
    },
    longTermMemory: {
      userRecords: userRecordCount,
      orgRecords: orgRecordCount,
      strategyRecords: strategyRecordCount,
      total: userRecordCount + orgRecordCount,
    },
    namespaces: {
      user: userNs,
      org: orgNs,
      strategyPath: getStrategyNamespacePath(config),
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/api/memories') {
    try {
      const memories = await fetchAllMemories();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ memories, fetchedAt: new Date().toISOString() }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/strategies') {
    try {
      const strategies = await fetchStrategyMemories();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ strategies, fetchedAt: new Date().toISOString() }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/session') {
    try {
      const events = await fetchSessionEvents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessionId: getActiveSessionId(),
        events,
        fetchedAt: new Date().toISOString(),
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/status') {
    try {
      const status = await fetchStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...status, fetchedAt: new Date().toISOString() }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Serve static files from visualizer directory
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
  };

  const filePath = url.pathname === '/'
    ? path.join(__dirname, 'visualizer', 'index.html')
    : path.join(__dirname, 'visualizer', path.basename(url.pathname));

  const ext = path.extname(filePath);
  const mime = MIME[ext];

  if (mime && fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Failed to read file');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Dashboard could not start because port ${PORT} is already in use. ` +
      `If the dashboard is already running, open http://localhost:${PORT} in your browser.`
    );
    process.exit(1);
  }

  console.error(`Dashboard server failed to start: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ┌─────────────────────────────────────────┐`);
  console.log(`  │   Org Memory Dashboard                  │`);
  console.log(`  │   ${url}              │`);
  console.log(`  └─────────────────────────────────────────┘\n`);
  // Auto-open in default browser (cross-platform)
  const { platform } = process;
  const openCmd = platform === 'darwin' ? `open "${url}"`
    : platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(openCmd, (err) => {
    if (err) console.log(`  Open ${url} in your browser.`);
  });
});
