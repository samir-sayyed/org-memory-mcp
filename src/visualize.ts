/**
 * Memory Lens Dashboard Server
 * Serves a live dashboard at http://localhost:3001
 *
 * API endpoints:
 *   GET /api/memories       — All long-term memory records
 *   GET /api/strategies     — Auto-extracted strategy records
 *   GET /api/session        — Current session events
 *   GET /api/status         — System health & stats
 *   GET /api/search?q=...   — Semantic search with filters
 */

import 'dotenv/config';
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
  getOrgRootNamespace,
  getOrgSharedNamespace,
  getStrategyNamespacePath,
  resolveNamespace,
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

// ── Data Helpers ────────────────────────────────────

function enrichRecord(r: any) {
  const ns = (r.namespaces?.[0] || '') as string;
  const meta = (r.metadata || {}) as Record<string, { stringValue?: string }>;

  let scope: 'user' | 'project' | 'org' | 'strategy' = 'user';
  let projectName: string | null = null;
  let source: 'manual' | 'auto-extracted' = 'manual';
  let strategyType: 'semantic' | 'preference' | 'summary' | null = null;

  if (ns.startsWith('/strategy/')) {
    scope = 'strategy';
    source = 'auto-extracted';
    const stratName = (meta['strategyName']?.stringValue || ns).toLowerCase();
    if (stratName.includes('pref')) strategyType = 'preference';
    else if (stratName.includes('sum')) strategyType = 'summary';
    else strategyType = 'semantic';
  } else if (ns.includes('/project/')) {
    scope = 'project';
    const match = ns.match(/\/project\/([^/]+)\//);
    projectName = match ? match[1] : null;
  } else if (ns.includes('/shared/')) {
    scope = 'org';
  }

  const createdAt =
    meta['x-amz-agentcore-memory-createdAt']?.stringValue ||
    meta['createdAt']?.stringValue ||
    (r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt || ''));

  const tagsRaw = meta['tags']?.stringValue || '';
  let tags: string[] = [];
  if (tagsRaw) {
    try {
      const parsed = JSON.parse(tagsRaw);
      if (Array.isArray(parsed)) {
        tags = parsed.filter((t: unknown): t is string => typeof t === 'string');
      }
    } catch {
      tags = tagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean);
    }
  }

  return {
    memoryId: r.memoryRecordId || '',
    content: (r.content && 'text' in r.content ? (r.content as { text: string }).text : '') || '',
    namespace: ns,
    scope,
    projectName,
    source,
    memoryType: meta['memory_type']?.stringValue || null,
    strategyType,
    language: meta['language']?.stringValue || null,
    tags,
    score: r.score,
    createdAt,
    orgId: meta['orgId']?.stringValue || config.orgId,
    actorId: meta['actorId']?.stringValue || config.actorId,
  };
}

async function fetchAllMemories() {
  const orgRootNs = getOrgRootNamespace(config);
  let records: any[] = [];
  try {
    records = await client.listMemoryRecordsByPath(orgRootNs).catch(() => []);
  } catch { /* empty */ }

  const seen = new Set<string>();
  return records
    .filter((r) => {
      const id = r.memoryRecordId || '';
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(enrichRecord);
}

async function fetchStrategyMemories() {
  try {
    const strategyPath = getStrategyNamespacePath(config);
    const results = await client.retrieveMemoryRecordsByPath('all', strategyPath, 100);
    return results.map(enrichRecord);
  } catch {
    return [];
  }
}

async function fetchSessionEvents() {
  const sid = getActiveSessionId();
  try {
    const events = await client.listEvents(sid, undefined, 50);
    return events.map((event: any) => {
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
  } catch {
    return [];
  }
}

async function fetchStatus() {
  const sid = getActiveSessionId();
  const userNs = getUserNamespace(config);
  const orgNs = getOrgSharedNamespace(config);

  let sessionEventCount = 0;
  let userRecordCount = 0;
  let orgRecordCount = 0;

  try {
    const events = await client.listEvents(sid);
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

  return {
    memoryId: client.getMemoryId(),
    actorId: config.actorId,
    actorRole: config.actorRole,
    orgId: config.orgId,
    session: {
      sessionId: sid,
      eventCount: sessionEventCount,
    },
    longTermMemory: {
      userRecords: userRecordCount,
      orgRecords: orgRecordCount,
      total: userRecordCount + orgRecordCount,
    },
  };
}

// ── Server ──────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API: All memories
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

  // API: Strategy memories
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

  // API: Session events
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

  // API: Status
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

  // API: Search
  if (url.pathname === '/api/search') {
    try {
      const query = url.searchParams.get('q') || '';
      const scope = url.searchParams.get('scope') || 'all';
      const type = url.searchParams.get('type') || 'all';

      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing query parameter: q' }));
        return;
      }

      const namespace = resolveNamespace(
        config,
        scope as 'user' | 'project' | 'org' | 'all',
        undefined
      );

      let results: any[] = [];
      if (scope === 'strategy') {
        const strategyPath = getStrategyNamespacePath(config);
        results = await client.retrieveMemoryRecordsByPath(query, strategyPath, 20);
      } else {
        results = await client.retrieveMemoryRecords(query, namespace, 20);
      }

      let enriched = results.map(enrichRecord);

      // Client-side type filter (AgentCore doesn't filter by metadata on retrieve)
      if (type !== 'all') {
        enriched = enriched.filter((m) => m.memoryType === type);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        query,
        scope,
        type,
        count: enriched.length,
        results: enriched,
        fetchedAt: new Date().toISOString(),
      }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files
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
  console.log(`  │   Memory Lens Dashboard                 │`);
  console.log(`  │   ${url}              │`);
  console.log(`  └─────────────────────────────────────────┘\n`);
  const { platform } = process;
  const openCmd = platform === 'darwin' ? `open "${url}"`
    : platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(openCmd, (err) => {
    if (err) console.log(`  Open ${url} in your browser.`);
  });
});
