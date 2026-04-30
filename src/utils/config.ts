/**
 * Configuration management for Org Memory MCP
 * All config comes from environment variables (MCP standard)
 */

export interface Config {
  awsRegion: string;
  memoryArn: string;
  orgId: string;
  actorId: string;
  actorRole?: string;
  sessionId?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function getEnv(name: string, required = true): string | undefined {
  const value = process.env[name]?.trim();
  if (required && !value) {
    throw new ConfigError(`Missing required environment variable ${name}`);
  }
  return value;
}

function validateNamespaceSegment(name: string, value: string) {
  if (/[\s/]/.test(value)) {
    throw new ConfigError(`${name} must not contain spaces or forward slashes`);
  }
}

function validateMemoryArn(memoryArn: string) {
  if (!/^arn:aws:bedrock-agentcore:[^:]+:\d{12}:memory\/.+/.test(memoryArn)) {
    throw new ConfigError(
      'MEMORY_ARN must be a Bedrock AgentCore memory ARN like ' +
      'arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/my-memory-id'
    );
  }
}

export function formatConfigError(error: unknown): string {
  if (!(error instanceof ConfigError)) {
    if (error instanceof Error) {
      return error.stack || error.message;
    }

    return String(error);
  }

  return [
    'Org Memory MCP configuration error.',
    error.message,
    'Required local variables:',
    '  MEMORY_ARN=arn:aws:bedrock-agentcore:us-west-2:123456789012:memory/my-memory-id',
    '  ORG_ID=your-org-id',
    '  ACTOR_ID=developer@company.com',
    'Optional local variables:',
    '  AWS_REGION defaults to us-west-2 when omitted',
    '  SESSION_ID auto-generated when omitted',
    '  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN when needed',
    'Use .env.example in the repo root as the starting template.',
  ].join('\n');
}

export function loadConfig(): Config {
  const config: Config = {
    awsRegion: getEnv('AWS_REGION', false) || 'us-west-2',
    memoryArn: getEnv('MEMORY_ARN', true)!,
    orgId: getEnv('ORG_ID', true)!,
    actorId: getEnv('ACTOR_ID', true)!,
    actorRole: getEnv('ACTOR_ROLE', false),
    sessionId: getEnv('SESSION_ID', false),
    awsAccessKeyId: getEnv('AWS_ACCESS_KEY_ID', false),
    awsSecretAccessKey: getEnv('AWS_SECRET_ACCESS_KEY', false),
    awsSessionToken: getEnv('AWS_SESSION_TOKEN', false),
  };

  validateMemoryArn(config.memoryArn);
  validateNamespaceSegment('ORG_ID', config.orgId);
  validateNamespaceSegment('ACTOR_ID', config.actorId);

  return config;
}