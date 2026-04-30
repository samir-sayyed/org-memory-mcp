/**
 * Namespace utilities for AWS Bedrock AgentCore Memory
 * Organizes memories hierarchically for org-wide sharing
 *
 * Namespace hierarchy:
 *   /org/{orgId}/user/{actorId}/     → Private developer memories
 *   /org/{orgId}/project/{projectId}/ → Project-scoped memories
 *   /org/{orgId}/shared/              → Org-wide approved patterns
 *
 * Strategy namespaces (managed by AgentCore):
 *   /strategy/{strategyId}/actors/{actorId}/ → Semantic / UserPreference
 *   /strategy/{strategyId}/actor/{actorId}/session/{sessionId}/ → Summaries
 */

import { Config } from './config.js';

export function getUserNamespace(config: Config): string {
  return `/org/${config.orgId}/user/${config.actorId}/`;
}

export function getProjectNamespace(config: Config, projectId: string): string {
  return `/org/${config.orgId}/project/${projectId}/`;
}

export function getOrgSharedNamespace(config: Config): string {
  return `/org/${config.orgId}/shared/`;
}

export function getOrgRootNamespace(config: Config): string {
  return `/org/${config.orgId}/`;
}

/**
 * Get a namespace path prefix for querying all strategy-extracted records for an actor.
 * AgentCore stores strategy outputs under /strategy/{strategyId}/actors/{actorId}/
 * Using a broad prefix lets us search across all strategies at once.
 */
export function getStrategyNamespacePath(config: Config): string {
  return `/strategy/`;
}

/**
 * Get the namespace path prefix scoped to a specific actor across all strategies.
 * Useful for retrieveMemoryRecords with namespacePath to find all extracted
 * insights for a particular user.
 */
export function getActorStrategyNamespacePath(config: Config): string {
  // Strategy namespaces use varying formats:
  //   /strategy/{id}/actors/{actorId}/
  //   /strategy/{id}/actor/{actorId}/session/{sessionId}/
  // We search broadly from /strategy/ and filter by actor in results
  return `/strategy/`;
}

/**
 * Resolve namespace based on scope and optional project
 */
export function resolveNamespace(
  config: Config,
  scope: 'user' | 'project' | 'org' | 'all' = 'user',
  projectId?: string
): string | string[] {
  switch (scope) {
    case 'user':
      return getUserNamespace(config);
    case 'project':
      if (!projectId) {
        throw new Error('projectId is required when scope is "project"');
      }
      return getProjectNamespace(config, projectId);
    case 'org':
      return getOrgSharedNamespace(config);
    case 'all':
      return [
        getUserNamespace(config),
        getOrgSharedNamespace(config),
        ...(projectId ? [getProjectNamespace(config, projectId)] : []),
      ];
    default:
      return getUserNamespace(config);
  }
}