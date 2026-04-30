/**
 * Session management for AgentCore short-term memory.
 *
 * Each MCP server instance generates a unique session ID on startup.
 * This session ID groups conversation events together and allows
 * AgentCore to scope short-term memory per coding session.
 */

let _activeSessionId: string | undefined;

/**
 * Generate a human-readable session ID.
 * Format: coding-YYYYMMDD-HHMMSS-XXXX
 */
function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const rand = Math.random().toString(36).slice(2, 6);
  return `coding-${date}-${time}-${rand}`;
}

/**
 * Initialise the active session.
 * Uses the provided ID (from env) or generates one automatically.
 */
export function initSession(providedSessionId?: string): string {
  _activeSessionId = providedSessionId?.trim() || generateSessionId();
  return _activeSessionId;
}

/**
 * Return the current active session ID, generating one if none exists.
 */
export function getActiveSessionId(): string {
  if (!_activeSessionId) {
    _activeSessionId = generateSessionId();
  }
  return _activeSessionId;
}
