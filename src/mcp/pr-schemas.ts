import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { PROVENANCE_ROLES } from '../pr/provenance.js'

const PROVENANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['harness', 'version', 'models', 'session', 'role'],
  description:
    'Claim provenance values. Extra fields are determined by the repository scope in supervisor config, never by tool arguments.',
  properties: {
    harness: { type: 'string', description: 'Harness name (for example claude-code).' },
    version: { type: 'string', description: 'Harness version.' },
    models: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Model or models used.',
    },
    session: { type: 'string', description: 'Agent session identifier.' },
    role: {
      type: 'string',
      enum: [...PROVENANCE_ROLES],
      description: 'Claim role: author, shepherd, or reviewer.',
    },
    fields: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Values for extra provenance fields configured for the repository scope.',
    },
  },
} as const

export const PR_VALIDATE_TOOL: Tool = {
  name: 'pr_validate',
  description:
    'Validate a pull request title, description, and provenance comment against the supervisor PR rules and the configured provenance fields for the repository scope before pushing.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['repository', 'title', 'body'],
    properties: {
      repository: { type: 'string', description: 'Target repository as <owner>/<repo>.' },
      title: { type: 'string', description: 'Pull request title.' },
      body: { type: 'string', description: 'Pull request description Markdown.' },
      provenance: PROVENANCE_SCHEMA,
      provenanceComment: {
        type: 'string',
        description:
          'Raw provenance comment Markdown to validate instead of structured provenance.',
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}

export const PR_CREATE_TOOL: Tool = {
  name: 'pr_create',
  description:
    'Validate and open a pull request on GitHub, strip any credentials before writing, post one fixed-format provenance comment using the scope provenance fields from supervisor config, and inherit the linked issue milestone and projects.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['repository', 'head', 'title', 'body', 'provenance'],
    properties: {
      repository: { type: 'string', description: 'Target repository as <owner>/<repo>.' },
      head: { type: 'string', description: 'Head branch containing the changes.' },
      base: { type: 'string', description: 'Base branch (defaults to repository default branch).' },
      title: { type: 'string', description: 'Pull request title.' },
      body: { type: 'string', description: 'Pull request description Markdown.' },
      draft: { type: 'boolean', description: 'Open as a draft pull request.' },
      issue: {
        type: 'integer',
        minimum: 1,
        description: 'Linked issue number in repository for milestone and project inheritance.',
      },
      provenance: PROVENANCE_SCHEMA,
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
}

export const PR_UPDATE_TOOL: Tool = {
  name: 'pr_update',
  description:
    'Validate and update a pull request description on GitHub, strip any credentials before writing, create or update the single provenance comment using the scope provenance fields from supervisor config, and inherit the linked issue milestone and projects.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['repository', 'pr', 'provenance'],
    properties: {
      repository: { type: 'string', description: 'Target repository as <owner>/<repo>.' },
      pr: { type: 'integer', minimum: 1, description: 'Pull request number.' },
      title: { type: 'string', description: 'Updated pull request title.' },
      body: { type: 'string', description: 'Updated pull request description Markdown.' },
      issue: {
        type: 'integer',
        minimum: 1,
        description: 'Linked issue number in repository for milestone and project inheritance.',
      },
      provenance: PROVENANCE_SCHEMA,
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
}
