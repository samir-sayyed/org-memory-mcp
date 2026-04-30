# Org Memory MCP Server

An MCP (Model Context Protocol) server that provides **org-wide persisted memory** for AI coding agents (Cursor, Cline, GitHub Copilot, etc.) using **AWS Bedrock AgentCore Memory**.

## Deployment Model

This project is designed to run as **one local MCP process per developer machine**.

- Each developer runs their own instance locally.
- Multiple AI clients on that same machine (Copilot, Cursor, Cline) share the one process.
- It is **not** a shared hosted multi-user service — each developer has their own isolated memory store.

## Quick Start

No installation required — your MCP client launches it on demand via `npx`:

```json
{
  "command": "npx",
  "args": ["-y", "org-memory-mcp"],
  "env": {
    "MEMORY_ARN": "arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/your-memory-id",
    "ORG_ID": "your-org",
    "ACTOR_ID": "you@company.com"
  }
}
```

1. Add the config above to your MCP client (see [Client Setup](#client-setup) for per-client file locations)
2. Reload your MCP client — done

The server requires no running process of its own — your MCP client launches it on demand.

## Overview

When developers use AI coding agents, valuable knowledge like architecture decisions, coding preferences, bug fixes, and API patterns are often lost. This MCP server solves that by:

- **Short-term memory** — Stores conversation turns per session via `CreateEvent`, which AgentCore automatically processes into long-term insights
- **Long-term memory** — Auto-extracted facts, preferences, and summaries via AgentCore's built-in strategies (Semantic, UserPreference, Summary)
- **Manual memory CRUD** — Direct writes/reads for explicit knowledge capture
- **Semantic search** — Find relevant past decisions across all memory types
- **Org-wide sharing** — Scoped namespaces for user, project, and org-level knowledge

## Architecture

```
Cursor / Cline / Copilot
        │
        ▼
   ┌─────────────┐
   │  Org Memory  │  ← MCP Server (this repo)
   │    MCP       │
   └─────────────┘
        │
        ▼
AWS Bedrock AgentCore Memory
   ┌──────────────────────────────────────────────┐
   │  Short-Term Memory (Events by Session)        │
   │    ↓ automatic extraction ↓                   │
   │  Built-in Strategies                          │
   │    • Semantic → Facts & Knowledge             │
   │    • UserPreference → Coding Preferences      │
   │    • Summary → Session Summaries              │
   │    ↓                                          │
   │  Long-Term Memory (Extracted + Manual Records)│
   └──────────────────────────────────────────────┘
```

### How Memory Works

1. **save_conversation** → Stores conversation as short-term events via `CreateEvent`
2. **AgentCore auto-extracts** → Built-in strategies run in the background, extracting facts, preferences, and summaries into long-term memory
3. **retrieve_context** → Queries both short-term session history and long-term extracted insights
4. **add_memory** → Direct manual write to long-term memory (bypasses extraction pipeline)
5. **search_memories** → Semantic search across both manually saved and auto-extracted records

### Namespace Hierarchy

```
/org/{orgId}/user/{actorId}/      → Private developer memories (manual)
/org/{orgId}/project/{projectId}/ → Project-scoped team memories (manual)
/org/{orgId}/shared/              → Org-wide approved patterns (manual)
/strategy/{strategyId}/...        → Auto-extracted by AgentCore strategies
```

## Available Tools

| Tool | Type | Description |
|------|------|-------------|
| `save_conversation` | **Primary** | Store conversation turns → AgentCore auto-extracts insights |
| `retrieve_context` | **Primary** | Get combined short-term session + long-term context |
| `add_memory` | Manual | Direct write to long-term memory (explicit saves only) |
| `search_memories` | Query | Semantic search across all memory types |
| `get_memories` | Query | List/filter long-term memory records |
| `get_memory` | Query | Retrieve a single memory by ID |
| `update_memory` | CRUD | Update existing memory content/metadata |
| `delete_memory` | CRUD | Remove a memory by ID |
| `get_user_profile` | Profile | Developer preferences (manual + auto-extracted), stats |
| `memory_status` | Diagnostic | Session info, memory counts, system health |
| `launch_dashboard` | UI | Launch the local memory dashboard |

## Memory Types (Manual)

- `style` — Coding style preferences (indentation, naming, etc.)
- `architecture` — Design decisions and patterns
- `bugfix` — Bug solutions and error patterns
- `api_pattern` — API integration patterns
- `preference` — Personal/team preferences
- `general` — General knowledge

## Installation

### Prerequisites

1. **Node.js ≥ 18** (for `npx`)
2. **AWS account** with access to AWS Bedrock AgentCore (currently `us-west-2` or `us-east-1`)
3. **An AgentCore Memory resource** — create one in the AWS Console or via CLI:

```bash
aws bedrock-agentcore create-memory \
  --name "MyOrgMemory" \
  --region us-west-2
```

Copy the returned ARN — this is your `MEMORY_ARN`.

4. **IAM permissions** — see the [AWS IAM Permissions](#aws-iam-permissions-required) section below.

### No Installation Needed

The package is published to npm as `org-memory-mcp`. Your MCP client runs it automatically via `npx -y org-memory-mcp` — no clone, no build, no global install.

### Environment Variables Reference

The server reads config from environment variables injected by your MCP client — no `.env` file needed at runtime.

| Variable | Required | Description |
|---|---|---|
| `MEMORY_ARN` | ✅ | Full ARN of your AgentCore Memory resource |
| `ORG_ID` | ✅ | Your org identifier, e.g. `acme-corp` (no spaces or `/`) |
| `ACTOR_ID` | ✅ | Your user identifier, e.g. `alice@acme.com` (no spaces or `/`) |
| `AWS_REGION` | optional | Defaults to `us-west-2` |
| `AWS_ACCESS_KEY_ID` | optional | Only needed if not using IAM roles or AWS SSO |
| `AWS_SECRET_ACCESS_KEY` | optional | Only needed if not using IAM roles or AWS SSO |
| `SESSION_ID` | optional | Pinned session name; auto-generated as `coding-YYYYMMDD-HHMMSS-XXXX` when omitted |

### Configure Memory Strategies

For automatic long-term extraction to work, your AgentCore Memory resource must have strategies configured. Create or update your memory with:

```python
# Using AWS SDK (Boto3)
control_client.create_memory(
    name="OrgMemory",
    memoryStrategies=[
        {'semanticMemoryStrategy': {'name': 'SemanticFacts', 'namespaceTemplates': ['/strategy/{memoryStrategyId}/actors/{actorId}/']}},
        {'userPreferenceMemoryStrategy': {'name': 'UserPrefs', 'namespaceTemplates': ['/strategy/{memoryStrategyId}/actors/{actorId}/']}},
        {'summaryMemoryStrategy': {'name': 'SessionSummary', 'namespaceTemplates': ['/strategy/{memoryStrategyId}/actor/{actorId}/session/{sessionId}/']}}
    ]
)
```

## Client Setup

### GitHub Copilot (VS Code)

Edit `~/Library/Application Support/Code/User/mcp.json` (macOS) or `%APPDATA%\Code\User\mcp.json` (Windows):

```json
{
  "servers": {
    "org-memory": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "org-memory-mcp"],
      "env": {
        "AWS_REGION": "us-west-2",
        "MEMORY_ARN": "arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/your-memory-id",
        "ORG_ID": "your-org",
        "ACTOR_ID": "you@company.com",
        "SESSION_ID": "copilot"
      }
    }
  }
}
```

### Cline (VS Code Extension)

Edit `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "org-memory": {
      "command": "npx",
      "args": ["-y", "org-memory-mcp"],
      "env": {
        "AWS_REGION": "us-west-2",
        "MEMORY_ARN": "arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/your-memory-id",
        "ORG_ID": "your-org",
        "ACTOR_ID": "you@company.com",
        "SESSION_ID": "cline"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "org-memory": {
      "command": "npx",
      "args": ["-y", "org-memory-mcp"],
      "env": {
        "AWS_REGION": "us-west-2",
        "MEMORY_ARN": "arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/your-memory-id",
        "ORG_ID": "your-org",
        "ACTOR_ID": "you@company.com",
        "SESSION_ID": "cursor"
      }
    }
  }
}
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "org-memory": {
      "command": "npx",
      "args": ["-y", "org-memory-mcp"],
      "env": {
        "AWS_REGION": "us-west-2",
        "MEMORY_ARN": "arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/your-memory-id",
        "ORG_ID": "your-org",
        "ACTOR_ID": "you@company.com",
        "SESSION_ID": "claude"
      }
    }
  }
}
```

> **Multi-client session isolation**: If you run multiple AI clients (e.g. Copilot + Cline + Cursor) simultaneously, set a distinct `SESSION_ID` for each one (`"copilot"`, `"cline"`, `"cursor"`). This keeps each client's short-term conversation history separate in AgentCore. Without it, all clients share the same auto-generated session ID.

## Usage Examples

### Save a Conversation (Recommended)

```
"Remember our discussion about the payment API architecture"
```
→ Agent calls `save_conversation` with:
- `messages`: [{ role: "user", content: "..." }, { role: "assistant", content: "..." }]
- AgentCore automatically extracts key facts, preferences, and summaries

### Retrieve Context

```
"What do we know about our error handling patterns?"
```
→ Agent calls `retrieve_context` with:
- `query`: "error handling patterns"
- Returns both current session history + relevant long-term insights

### Direct Memory Save

```
"Remember that we use Zod for all API validation in the payment-api project"
```
→ Agent calls `add_memory` with:
- `content`: "Use Zod for all API validation in payment-api"
- `memory_type`: "architecture"
- `scope`: "project"
- `project`: "payment-api"

### Search Memories

```
"How do we handle errors in the payment service?"
```
→ Agent calls `search_memories` with:
- `query`: "How do we handle errors in the payment service?"
- Returns both manually saved and auto-extracted insights

### Check Memory Status

```
"What's the state of my memory?"
```
→ Agent calls `memory_status`

## Local Development Checks

Use these commands during local development:

```bash
npm run lint
npm test
npm run build
```

Useful local dashboard commands:

```bash
# Run the source dashboard directly
npm run visualize

# Run on a different local port if 3001 is already taken
PORT=3002 npm run visualize
```

The MCP launch tool uses the built dashboard files. If it reports missing dashboard build artifacts, run:

```bash
npm run build
```

## Troubleshooting

### `Org Memory MCP configuration error`

This means one of the required local environment variables is missing or invalid.

Check these first:

- `MEMORY_ARN`
- `ORG_ID`
- `ACTOR_ID`

Use `.env.example` in the repo root as the starting template.

### `Dashboard could not start because port 3001 is already in use`

This means another local process is already listening on the default dashboard port.

You can either:

- Open `http://localhost:3001` if the dashboard is already running.
- Or start another local dashboard instance with `PORT=3002 npm run visualize`.

### `Dashboard build artifacts are missing`

This comes from the `launch_dashboard` MCP tool when the built files are not present.

Fix it by running:

```bash
npm run build
```

### Auto-extracted memories not appearing

If `save_conversation` works but no auto-extracted records show in `search_memories`:

1. **Check strategies**: Ensure your Memory resource has built-in strategies (Semantic, UserPreference, Summary) configured
2. **Wait for processing**: Auto-extraction is asynchronous — allow ~60 seconds after saving
3. **Check `memory_status`**: Verify `hasStrategyRecords` is `true`

### Empty or invalid tool input

The handlers now reject invalid inputs earlier than before. Common examples:

- `add_memory` requires non-empty `content` and a valid `memory_type`
- `search_memories` with `scope: "project"` requires `project`
- `save_conversation` requires at least one message with valid `role` and `content`
- `get_memories` rejects out-of-range `limit` values
- `update_memory` preserves the existing namespace unless scope/project is explicitly changed

## Org-Wide Sharing

Memories can be scoped at three levels:

- **`user`** (default): Private to the individual developer
- **`project`**: Shared with the project team
- **`org`**: Shared company-wide as approved patterns

When searching with `scope: "all"`, the agent retrieves from:
1. Your private memories
2. Project memories (if project specified)
3. Org-wide shared memories
4. Auto-extracted strategy records

## AWS IAM Permissions Required

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock-agentcore:CreateEvent",
        "bedrock-agentcore:ListEvents",
        "bedrock-agentcore:RetrieveMemoryRecords",
        "bedrock-agentcore:ListMemoryRecords",
        "bedrock-agentcore:GetMemoryRecord",
        "bedrock-agentcore:BatchCreateMemoryRecords",
        "bedrock-agentcore:BatchUpdateMemoryRecords",
        "bedrock-agentcore:DeleteMemoryRecord"
      ],
      "Resource": "arn:aws:bedrock-agentcore:*:123456789012:memory/*"
    }
  ]
}
```

## License

ISC
