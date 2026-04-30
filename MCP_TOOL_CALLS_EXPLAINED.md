# MCP Tool Calls Explained

This document explains every MCP tool exposed by this service and how each one interacts with AWS Bedrock AgentCore Memory in simple language.

## What This MCP Service Does

This repo is an MCP server. An AI agent such as Copilot, Cursor, or Cline can call one of the tools exposed by this server. Most of those tools read from or write to AWS Bedrock AgentCore Memory.

The main entry point is [src/index.ts](src/index.ts). It does two important jobs:

1. It tells the MCP client which tools exist.
2. It routes each incoming tool call to the correct handler.

For memory-related tools, the handlers call [src/aws/bedrockAgentCore.ts](src/aws/bedrockAgentCore.ts), which wraps the AWS SDK and hides the lower-level AgentCore API details.

## The Common Request Flow

Most tool calls follow the same path:

1. An MCP client calls a tool such as `add_memory` or `search_memories`.
2. [src/index.ts](src/index.ts) matches the tool name and calls the correct handler in [src/tools](src/tools).
3. The handler validates the input.
4. The handler loads environment config from [src/utils/config.ts](src/utils/config.ts).
5. The handler resolves the correct namespace using [src/utils/namespaces.ts](src/utils/namespaces.ts).
6. The handler calls a method on `BedrockMemoryClient`.
7. `BedrockMemoryClient` sends the real AWS Bedrock AgentCore Memory command.
8. The handler formats the result as JSON text and returns it to the MCP client.

In simple terms: the MCP tool is the front door, the tool handler is the translator, and `BedrockMemoryClient` is the part that actually talks to AgentCore Memory.

## How Memories Are Organized

This service separates memories by namespace. A namespace is just a path that tells AgentCore Memory where the record belongs.

| Scope | Namespace Pattern | Meaning |
| --- | --- | --- |
| `user` | `/org/{orgId}/user/{actorId}/` | Private memories for one developer |
| `project` | `/org/{orgId}/project/{projectId}/` | Shared memories for one project/team |
| `org` | `/org/{orgId}/shared/` | Shared memories for the whole organization |
| `all` | User + org, and project only if `project` is provided | Search or list across multiple places |

The namespace logic lives in [src/utils/namespaces.ts](src/utils/namespaces.ts).

## Required Config

Before any memory call works, the server needs these environment values from [src/utils/config.ts](src/utils/config.ts):

- `AWS_REGION`: AWS region for AgentCore Memory
- `MEMORY_ARN`: the memory store to use
- `ORG_ID`: the organization id used in namespaces and metadata
- `ACTOR_ID`: the current user or agent identity

Optional AWS credentials can also be provided if the environment does not already have them.

## Tool Summary

| Tool | Plain meaning | Client method used | AWS command used | Memory interaction |
| --- | --- | --- | --- | --- |
| `add_memory` | Save a new memory | `batchCreateMemoryRecords` | `BatchCreateMemoryRecordsCommand` | Direct write |
| `search_memories` | Semantic search | `retrieveMemoryRecords` | `RetrieveMemoryRecordsCommand` | Direct read |
| `get_memories` | List memories | `listMemoryRecords` | `ListMemoryRecordsCommand` | Direct read |
| `get_memory` | Get one memory by id | `getMemoryRecord` | `GetMemoryRecordCommand` | Direct read |
| `update_memory` | Change an existing memory | `batchUpdateMemoryRecords` | `BatchUpdateMemoryRecordsCommand` | Direct write |
| `delete_memory` | Remove a memory | `deleteMemoryRecord` | `DeleteMemoryRecordCommand` | Direct write |
| `get_user_profile` | Build a profile summary from memories | `listMemoryRecords` | `ListMemoryRecordsCommand` | Indirect read and aggregation |
| `launch_dashboard` | Start the dashboard UI | None in the handler itself | None in the handler itself | No direct memory call in the handler |

## Detailed Explanation Of Every Tool

### 1. `add_memory`

Handler: [src/tools/addMemory.ts](src/tools/addMemory.ts)

Use this when the agent wants to save a lesson, preference, pattern, or decision for later.

What happens internally:

1. The handler checks that `content` exists.
2. It reads `scope` and optional `project`.
3. It turns the scope into a namespace.
4. It builds metadata such as `memory_type`, `scope`, `project`, `language`, and `tags`.
5. It calls `client.batchCreateMemoryRecords(...)`.

How it interacts with Agent Core Memory:

- `BedrockMemoryClient` adds shared metadata like `orgId`, `actorId`, and `createdAt`.
- Then it sends `BatchCreateMemoryRecordsCommand` to AgentCore Memory.
- AgentCore stores the new long-term memory record in the chosen namespace.

What comes back:

- A success response with the new `memoryId`
- The scope and namespace used
- A short content preview

Important note: the current implementation now validates `content`, `memory_type`, `scope`, and project requirements before any write call is sent to AgentCore Memory.

Simple mental model: this is the main "save memory" tool.

### 2. `search_memories`

Handler: [src/tools/searchMemories.ts](src/tools/searchMemories.ts)

Use this when the agent wants to search by meaning, not by exact id.

What happens internally:

1. The handler checks that `query` exists.
2. It resolves the target namespace or list of namespaces.
3. It calls `client.retrieveMemoryRecords(query, namespace, limit)`.
4. If `memory_type` was provided, the handler applies one more filter after the AWS call returns.

How it interacts with Agent Core Memory:

- `BedrockMemoryClient` sends `RetrieveMemoryRecordsCommand`.
- AgentCore performs semantic search and returns ranked matches.
- The service sorts the results by score and returns the best matches.

What comes back:

- Matching memories
- Relevance score
- Namespace
- Metadata

Important note: when `scope` is `all`, this implementation searches user and org namespaces, and project only if `project` is explicitly provided.

Simple mental model: this is "search by idea" instead of "search by exact key".

### 3. `get_memories`

Handler: [src/tools/getMemories.ts](src/tools/getMemories.ts)

Use this when the agent wants to browse memories instead of doing semantic search.

What happens internally:

1. The handler resolves one namespace or several namespaces.
2. It calls `client.listMemoryRecords(namespace, limit)`.
3. If `memory_type` is provided, the handler filters by it after the records are returned.
4. If `tags` are provided, the handler parses the stored tags and filters in application code.

How it interacts with Agent Core Memory:

- `BedrockMemoryClient` sends `ListMemoryRecordsCommand`.
- AgentCore returns records from the requested namespace.
- The MCP service may then narrow the list locally.

What comes back:

- A list of memories
- Count of returned records
- Count of total fetched records before local filtering

Simple mental model: this is "browse what is there".

### 4. `get_memory`

Handler: [src/tools/getMemory.ts](src/tools/getMemory.ts)

Use this when the agent already knows a specific `memory_id` and wants the exact record.

What happens internally:

1. The handler checks that `memory_id` exists.
2. It calls `client.getMemoryRecord(memory_id)`.
3. If the record is missing, it returns an error message.

How it interacts with Agent Core Memory:

- `BedrockMemoryClient` sends `GetMemoryRecordCommand`.
- AgentCore returns one record by id.

What comes back:

- The memory content
- Namespace
- Created time
- Metadata

Simple mental model: this is the "open this exact memory" tool.

### 5. `update_memory`

Handler: [src/tools/updateMemory.ts](src/tools/updateMemory.ts)

Use this when the agent wants to change the text or metadata of an existing memory.

What happens internally:

1. The handler checks that `memory_id` and `content` exist.
2. It resolves a namespace from `scope` and optional `project`.
3. It builds updated metadata like `memory_type`, `scope`, `project`, `language`, and `tags`.
4. It calls `client.batchUpdateMemoryRecords(...)`.

How it interacts with Agent Core Memory:

- `BedrockMemoryClient` adds `orgId`, `actorId`, and `updatedAt`.
- Then it sends `BatchUpdateMemoryRecordsCommand`.
- AgentCore updates the stored record.

What comes back:

- A success response
- The memory id
- The scope and namespace sent with the update

Important note: the current implementation preserves the existing namespace and metadata when `scope`, `project`, `language`, or `tags` are omitted. It only moves the memory when the caller explicitly asks for a scope or project change.

Simple mental model: this is the "edit saved memory" tool.

### 6. `delete_memory`

Handler: [src/tools/deleteMemory.ts](src/tools/deleteMemory.ts)

Use this when the agent wants to permanently remove a memory.

What happens internally:

1. The handler checks that `memory_id` exists.
2. It calls `client.deleteMemoryRecord(memory_id)`.

How it interacts with Agent Core Memory:

- `BedrockMemoryClient` sends `DeleteMemoryRecordCommand`.
- AgentCore removes that record from the memory store.

What comes back:

- A simple success response with the deleted id

Simple mental model: this is the "forget this memory" tool.

### 7. `get_user_profile`

Handler: [src/tools/getUserProfile.ts](src/tools/getUserProfile.ts)

Use this when the agent wants a summary of the current developer's preferences and history.

This tool does not read from a separate profile table. It builds the profile by reading normal memories and summarizing them.

What happens internally:

1. The handler resolves the user namespace and org namespace.
2. It calls `listMemoryRecords` for both.
3. It combines the results.
4. It treats `style` and `preference` memories as preferences.
5. It counts languages and projects from metadata.

How it interacts with Agent Core Memory:

- `BedrockMemoryClient` sends `ListMemoryRecordsCommand` twice.
- AgentCore returns normal memory records.
- The MCP service builds a profile-shaped response from those records.

What comes back:

- `actorId`
- `orgId`
- Memory counts
- Preferences
- Top languages
- Top projects

Important note: the current implementation reads user and org namespaces, not project namespaces.

Simple mental model: this is "build my profile from my saved memories".

### 8. `launch_dashboard`

Handler: [src/tools/launchDashboard.ts](src/tools/launchDashboard.ts)

Use this when the agent wants to open the local memory dashboard in a browser.

What happens internally in the tool handler:

1. It checks whether port `3001` is already in use.
2. If the dashboard is already running, it returns the URL.
3. If not, it checks that the built dashboard files exist.
4. It starts `visualize.js` in a detached Node process.
5. It waits briefly and checks whether the port opened.

If the built files are missing, the tool returns a clear instruction to run `npm run build` or use `npm run visualize` for the source-based local dashboard.

The dashboard server itself also supports a local `PORT` override and now returns real config or Bedrock load errors instead of silently showing an empty dashboard.

How it interacts with Agent Core Memory:

- The `launch_dashboard` handler itself does not call AgentCore Memory.
- It only starts the dashboard server.
- The actual dashboard server lives in [src/visualize.ts](src/visualize.ts).
- When the browser requests `/api/memories`, that server creates a `BedrockMemoryClient` and calls `listMemoryRecords` to fetch data.

Current dashboard behavior:

- It reads user memories and org memories.
- It does not currently fetch project memories.

Simple mental model: this tool starts the UI process, and the UI process later reads memory data.

## How Metadata Is Added

The tool handlers and `BedrockMemoryClient` work together to add metadata.

Application-level metadata added by handlers:

- `memory_type`
- `scope`
- `project`
- `language`
- `tags`

Infrastructure metadata added by `BedrockMemoryClient`:

- `orgId`
- `actorId`
- `createdAt` on create
- `updatedAt` on update

One small detail: `tags` are stored as a JSON string, and some tools parse that string later when filtering.

## Which AgentCore APIs Are Actually Used

The public MCP toolset mostly uses long-term memory record APIs:

- `RetrieveMemoryRecordsCommand`
- `ListMemoryRecordsCommand`
- `GetMemoryRecordCommand`
- `BatchCreateMemoryRecordsCommand`
- `BatchUpdateMemoryRecordsCommand`
- `DeleteMemoryRecordCommand`

The wrapper class also contains short-term event methods:

- `createEvent`
- `listEvents`

Those methods are defined in [src/aws/bedrockAgentCore.ts](src/aws/bedrockAgentCore.ts), but no current MCP tool exposes them. That means the current MCP service mainly works with long-term memory records, not short-term conversation events.

## One End-To-End Example

Here is the full flow for `add_memory` in plain language:

1. The agent calls `add_memory`.
2. [src/index.ts](src/index.ts) routes the call to [src/tools/addMemory.ts](src/tools/addMemory.ts).
3. The handler loads config and resolves the correct namespace.
4. The handler prepares metadata like `memory_type`, `scope`, and `language`.
5. `BedrockMemoryClient` adds `orgId`, `actorId`, and `createdAt`.
6. `BedrockMemoryClient` sends `BatchCreateMemoryRecordsCommand` to AgentCore Memory.
7. AgentCore stores the record.
8. The tool returns a success response with the new memory id.

That same pattern applies to most of the other tools. The main differences are whether the tool is reading, writing, updating, deleting, or summarizing records.

## Quick Takeaway

If you want the shortest possible summary:

- `add_memory` saves a memory.
- `search_memories` searches by meaning.
- `get_memories` lists memories.
- `get_memory` reads one exact memory.
- `update_memory` edits a memory.
- `delete_memory` removes a memory.
- `get_user_profile` builds a profile from saved memories.
- `launch_dashboard` starts a UI, and that UI later reads memories.

Most tools talk to AgentCore Memory through one shared wrapper class, `BedrockMemoryClient`.