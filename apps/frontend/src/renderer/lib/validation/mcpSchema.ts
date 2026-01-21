/**
 * JSON Schema validation for CustomMcpServer using Ajv
 */

import type { CustomMcpServer } from '../../../shared/types';

// JSON Schema type definition (compatible with Ajv v6)
interface JSONSchemaObject {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JSONSchemaDefinition>;
  additionalProperties?: boolean | JSONSchemaDefinition;
  items?: JSONSchemaDefinition;
  enum?: (string | number | boolean | null)[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  nullable?: boolean;
  description?: string;
  if?: JSONSchemaObject;
  then?: JSONSchemaObject;
  else?: JSONSchemaObject;
  const?: string | number | boolean;
  propertiesAdditionalProperties?: boolean | JSONSchemaDefinition;
  [key: string]: any; // Allow additional JSON Schema properties
}

type JSONSchemaDefinition = JSONSchemaObject | boolean | JSONSchemaDefinition[];

/**
 * JSON Schema for CustomMcpServer validation
 *
 * This schema validates MCP server configurations with conditional requirements:
 * - Command servers: require 'command' field, 'args' optional
 * - HTTP servers: require 'url' field, 'headers' optional
 */
export const customMcpServerSchema: JSONSchemaObject = {
  type: 'object',
  required: ['id', 'name', 'type'],
  properties: {
    id: {
      type: 'string',
      minLength: 1,
      description: 'Unique identifier for the server',
    },
    name: {
      type: 'string',
      minLength: 1,
      description: 'Display name shown in UI',
    },
    type: {
      type: 'string',
      enum: ['command', 'http'],
      description: 'Server type (command-based or HTTP-based)',
    },
    command: {
      type: 'string',
      minLength: 1,
      description: 'Command to execute (for type: command)',
      nullable: true,
    },
    args: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Arguments for the command (for type: command)',
      nullable: true,
    },
    url: {
      type: 'string',
      minLength: 1,
      description: 'HTTP URL (for type: http)',
      nullable: true,
    },
    headers: {
      type: 'object',
      additionalProperties: {
        type: 'string',
      },
      description: 'HTTP headers (for type: http)',
      nullable: true,
    },
    description: {
      type: 'string',
      description: 'Optional description shown in UI',
      nullable: true,
    },
  },
  if: {
    properties: {
      type: { const: 'command' },
    },
  },
  then: {
    required: ['command'],
    properties: {
      command: { nullable: false },
    },
  },
  else: {
    if: {
      properties: {
        type: { const: 'http' },
      },
    },
    then: {
      required: ['url'],
      properties: {
        url: { nullable: false },
      },
    },
  },
};

/**
 * Type guard to check if data is a valid CustomMcpServer
 * Use this when you need to validate data at runtime
 *
 * @example
 * ```ts
 * if (isCustomMcpServer(data)) {
 *   // data is safely typed as CustomMcpServer
 * }
 * ```
 */
export type CustomMcpServerValidation = {
  valid: boolean;
  errors?: Array<string>;
};

/**
 * Validates a CustomMcpServer object against the schema
 *
 * Note: This function requires Ajv to be imported before use.
 * Import Ajv at the top level before calling this function.
 *
 * @param data - The data to validate
 * @param ajv - An instance of Ajv (with allErrors: true recommended)
 * @returns Validation result with error messages if invalid
 *
 * @example
 * ```ts
 * import Ajv from 'ajv';
 * const ajv = new Ajv({ allErrors: true });
 * const result = validateCustomMcpServer(data, ajv);
 * ```
 */
export function validateCustomMcpServer(
  data: unknown,
  ajv: any
): CustomMcpServerValidation {
  const validate = ajv.compile(customMcpServerSchema);
  const valid = validate(data);

  if (valid) {
    return { valid: true };
  }

  const errors = validate.errors?.map((error: any) => {
    // Ajv v6 uses dataPath, v8+ uses instancePath
    const path = error.dataPath || error.instancePath || 'root';
    const message = error.message || 'unknown error';
    return `${path}: ${message}`;
  });

  return {
    valid: false,
    errors,
  };
}
