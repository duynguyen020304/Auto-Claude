/**
 * JSON parsing and validation utilities for CustomMcpServer configurations
 *
 * Provides functions for:
 * - Parsing JSON with detailed error reporting
 * - Validating against CustomMcpServer schema
 * - Formatting validation errors in user-friendly messages
 */

import Ajv from 'ajv';
import type { CustomMcpServer } from '../../../shared/types';
import {
  customMcpServerSchema,
  validateCustomMcpServer,
} from './mcpSchema';

/**
 * Result of JSON parsing operation
 */
export interface JsonParseResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  line?: number;
  column?: number;
}

/**
 * Result of JSON validation operation
 */
export interface ValidationResult<T = CustomMcpServer> {
  valid: boolean;
  data?: T;
  errors: string[];
  errorCount: number;
}

/**
 * Result of parsing and validating MCP server configuration(s)
 */
export interface McpServerParseResult {
  valid: boolean;
  servers?: CustomMcpServer[];
  errors: string[];
  parseError?: string;
}

/**
 * Parse JSON string with detailed error reporting
 *
 * @param jsonString - The JSON string to parse
 * @returns Parse result with data or error details
 *
 * @example
 * ```ts
 * const result = parseJson<CustomMcpServer>('{"id": "test", ...}');
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(`Error at line ${result.line}, column ${result.column}: ${result.error}`);
 * }
 * ```
 */
export function parseJson<T = unknown>(jsonString: string): JsonParseResult<T> {
  try {
    const data = JSON.parse(jsonString) as T;
    return {
      success: true,
      data,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Try to extract line and column from error message
    // JSON.parse errors typically look like: "Unexpected token } in JSON at position 42"
    const positionMatch = errorMessage.match(/position (\d+)/);
    let line = 1;
    let column = 1;

    if (positionMatch) {
      const position = parseInt(positionMatch[1], 10);
      const lines = jsonString.substring(0, position).split('\n');
      line = lines.length;
      column = lines[lines.length - 1].length + 1;
    }

    // Create user-friendly error message
    let friendlyError = errorMessage;
    if (errorMessage.includes('Unexpected token')) {
      const tokenMatch = errorMessage.match(/Unexpected token (.+?) in JSON/);
      const token = tokenMatch ? tokenMatch[1] : 'syntax';
      friendlyError = `Invalid JSON syntax: unexpected ${token}`;
    } else if (errorMessage.includes('Unexpected end')) {
      friendlyError = 'Invalid JSON: incomplete or truncated data';
    } else if (errorMessage.includes('Unexpected string')) {
      friendlyError = 'Invalid JSON: malformed string or property name';
    }

    return {
      success: false,
      error: friendlyError,
      line,
      column,
    };
  }
}

/**
 * Format a JSON parse error into a user-friendly message
 *
 * @param result - The parse result from parseJson()
 * @returns Formatted error string with line/column if available
 *
 * @example
 * ```ts
 * const result = parseJson(jsonString);
 * if (!result.success) {
 *   const errorMsg = formatParseError(result);
 *   // Returns: "Invalid JSON syntax at line 5, column 12: unexpected }"
 * }
 * ```
 */
export function formatParseError(result: JsonParseResult): string {
  if (result.success) {
    return '';
  }

  const { error, line, column } = result;
  if (line !== undefined && column !== undefined) {
    return `${error} at line ${line}, column ${column}`;
  }
  return error || 'Failed to parse JSON';
}

/**
 * Validate a single CustomMcpServer object against the schema
 *
 * @param data - The data to validate
 * @param serverName - Optional server name for error messages
 * @returns Validation result with errors if invalid
 *
 * @example
 * ```ts
 * const result = validateCustomMcpServerObj(data, 'my-server');
 * if (!result.valid) {
 *   console.error(result.errors); // ["url is required for http type"]
 * }
 * ```
 */
export function validateCustomMcpServerObj(
  data: unknown,
  serverName?: string
): ValidationResult<CustomMcpServer> {
  // Create Ajv instance for validation
  const ajv = new Ajv({ allErrors: true });
  const schemaResult = validateCustomMcpServer(data, ajv);

  if (schemaResult.valid) {
    return {
      valid: true,
      data: data as CustomMcpServer,
      errors: [],
      errorCount: 0,
    };
  }

  const errors = schemaResult.errors || [];
  const serverPrefix = serverName ? `Server '${serverName}': ` : '';

  return {
    valid: false,
    errors: errors.map((err) => `${serverPrefix}${err}`),
    errorCount: errors.length,
  };
}

/**
 * Validate an array of CustomMcpServer objects
 *
 * @param servers - Array of server configurations to validate
 * @returns Validation result with aggregated errors
 *
 * @example
 * ```ts
 * const result = validateCustomMcpServers(serverArray);
 * if (!result.valid) {
 *   console.error(`${result.errorCount} errors found:`, result.errors);
 * }
 * ```
 */
export function validateCustomMcpServers(
  servers: unknown[]
): ValidationResult<CustomMcpServer[]> {
  const allErrors: string[] = [];
  const validServers: CustomMcpServer[] = [];

  servers.forEach((server, index) => {
    const serverName =
      typeof server === 'object' && server !== null && 'name' in server
        ? String(server.name)
        : `#${index + 1}`;

    const result = validateCustomMcpServerObj(server, serverName);

    if (result.valid && result.data) {
      validServers.push(result.data);
    } else {
      allErrors.push(...result.errors);
    }
  });

  return {
    valid: allErrors.length === 0,
    data: validServers,
    errors: allErrors,
    errorCount: allErrors.length,
  };
}

/**
 * Format validation errors into a user-friendly list
 *
 * @param errors - Array of error strings
 * @param maxErrors - Maximum number of errors to display (default: all)
 * @returns Formatted error message with count
 *
 * @example
 * ```ts
 * const errors = ['url is required', 'name is required'];
 * const msg = formatValidationErrors(errors, 10);
 * // Returns: "Found 2 validation errors:\n• url is required\n• name is required"
 * ```
 */
export function formatValidationErrors(
  errors: string[],
  maxErrors?: number
): string {
  if (errors.length === 0) {
    return '';
  }

  const displayErrors = maxErrors !== undefined ? errors.slice(0, maxErrors) : errors;
  const additionalCount = errors.length - displayErrors.length;

  let message = `Found ${errors.length} validation error${errors.length > 1 ? 's' : ''}:\n`;
  message += displayErrors.map((err) => `• ${err}`).join('\n');

  if (additionalCount > 0) {
    message += `\n... and ${additionalCount} more error${additionalCount > 1 ? 's' : ''}`;
  }

  return message;
}

/**
 * Parse and validate JSON input for MCP server configuration(s)
 *
 * Accepts either a single server object or an array of servers.
 * Returns both parse errors and validation errors.
 *
 * @param jsonString - The JSON string to parse and validate
 * @returns Complete parse and validation result
 *
 * @example
 * ```ts
 * const result = parseAndValidateMcpServers(jsonString);
 * if (result.valid) {
 *   console.log(`Parsed ${result.servers.length} servers`);
 * } else {
 *   if (result.parseError) {
 *     console.error('Parse error:', result.parseError);
 *   }
 *   if (result.errors.length > 0) {
 *     console.error('Validation errors:', result.errors);
 *   }
 * }
 * ```
 */
export function parseAndValidateMcpServers(
  jsonString: string
): McpServerParseResult {
  // Step 1: Parse JSON
  const parseResult = parseJson<unknown>(jsonString);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: [],
      parseError: formatParseError(parseResult),
    };
  }

  // Step 2: Normalize to array (support single object or array)
  let dataArray: unknown[];
  if (Array.isArray(parseResult.data)) {
    dataArray = parseResult.data;
  } else if (parseResult.data !== null && typeof parseResult.data === 'object') {
    dataArray = [parseResult.data];
  } else {
    return {
      valid: false,
      errors: [],
      parseError:
        'Invalid format: expected a server object or array of servers',
    };
  }

  // Step 3: Validate all servers
  const validationResult = validateCustomMcpServers(dataArray);

  return {
    valid: validationResult.valid,
    servers: validationResult.data,
    errors: validationResult.errors,
  };
}

/**
 * Format a complete McpServerParseResult into a user-friendly message
 *
 * @param result - The parse/validate result
 * @returns Formatted message for display
 *
 * @example
 * ```ts
 * const result = parseAndValidateMcpServers(jsonString);
 * const message = formatMcpServerParseResult(result);
 * // Returns: "Invalid JSON at line 5, column 12: unexpected }"
 * // Or: "Found 2 validation errors:\n• Server 'api': url is required\n• ..."
 * ```
 */
export function formatMcpServerParseResult(result: McpServerParseResult): string {
  if (result.parseError) {
    return result.parseError;
  }

  if (result.errors.length > 0) {
    return formatValidationErrors(result.errors);
  }

  return '';
}

/**
 * Validate a JSON object against the CustomMcpServer schema
 * and return detailed error information
 *
 * @param data - The data to validate
 * @returns Validation result with detailed errors
 */
export function validateAndFormatErrors(
  data: unknown
): ValidationResult<CustomMcpServer> {
  const result = validateCustomMcpServerObj(data);

  if (!result.valid) {
    return {
      valid: false,
      errors: result.errors.map((error) => {
        // Make errors more user-friendly
        if (error.includes("must have required property 'url'")) {
          return error.replace(
            "must have required property 'url'",
            'url is required for http type'
          );
        }
        if (error.includes("must have required property 'command'")) {
          return error.replace(
            "must have required property 'command'",
            'command is required for command type'
          );
        }
        if (error.includes('must match')) {
          return error.replace('must match', 'must be one of');
        }
        return error;
      }),
      errorCount: result.errorCount,
    };
  }

  return result;
}
