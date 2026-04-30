const MEMORY_TYPES = new Set([
  'style',
  'architecture',
  'bugfix',
  'api_pattern',
  'preference',
  'general',
]);

const WRITE_SCOPES = new Set(['user', 'project', 'org']);
const READ_SCOPES = new Set(['user', 'project', 'org', 'all']);

export function getRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} is required and must be a non-empty string`);
  }

  return value.trim();
}

export function getOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getWriteScope(value: unknown): 'user' | 'project' | 'org' {
  if (typeof value !== 'string' || !WRITE_SCOPES.has(value)) {
    throw new Error('scope must be one of: user, project, org');
  }

  return value as 'user' | 'project' | 'org';
}

export function getReadScope(value: unknown): 'user' | 'project' | 'org' | 'all' {
  if (typeof value !== 'string' || !READ_SCOPES.has(value)) {
    throw new Error('scope must be one of: user, project, org, all');
  }

  return value as 'user' | 'project' | 'org' | 'all';
}

export function getMemoryType(value: unknown):
  | 'style'
  | 'architecture'
  | 'bugfix'
  | 'api_pattern'
  | 'preference'
  | 'general' {
  if (typeof value !== 'string' || !MEMORY_TYPES.has(value)) {
    throw new Error(
      'memory_type must be one of: style, architecture, bugfix, api_pattern, preference, general'
    );
  }

  return value as
    | 'style'
    | 'architecture'
    | 'bugfix'
    | 'api_pattern'
    | 'preference'
    | 'general';
}

export function getNormalizedTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const tags = value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return tags.length > 0 ? tags : undefined;
}

export function getLimit(value: unknown, defaultValue: number, maxValue: number): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`limit must be an integer between 1 and ${maxValue}`);
  }

  if (value < 1 || value > maxValue) {
    throw new Error(`limit must be between 1 and ${maxValue}`);
  }

  return value;
}