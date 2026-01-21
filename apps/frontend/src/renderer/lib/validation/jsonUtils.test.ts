/**
 * Tests for JSON Parse Utilities
 * Tests JSON parsing, validation, and error formatting functions
 */
import { describe, it, expect } from 'vitest';
import {
  parseJson,
  formatParseError,
  validateCustomMcpServerObj,
  validateCustomMcpServers,
  formatValidationErrors,
  parseAndValidateMcpServers,
  formatMcpServerParseResult,
  validateAndFormatErrors
} from './jsonUtils';
import type { CustomMcpServer } from '../../../shared/types';

describe('JSON Parse Utilities', () => {
  describe('parseJson', () => {
    it('should parse valid JSON object', () => {
      const json = '{"name": "Test", "value": 123}';
      const result = parseJson(json);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'Test', value: 123 });
      expect(result.error).toBeUndefined();
    });

    it('should parse valid JSON array', () => {
      const json = '[1, 2, 3, "test"]';
      const result = parseJson(json);
      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3, 'test']);
    });

    it('should parse valid JSON string', () => {
      const json = '"hello"';
      const result = parseJson(json);
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    it('should parse valid JSON number', () => {
      const json = '42';
      const result = parseJson(json);
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    it('should parse valid JSON boolean', () => {
      const json = 'true';
      const result = parseJson(json);
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should parse valid JSON null', () => {
      const json = 'null';
      const result = parseJson(json);
      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should catch syntax errors for missing closing brace', () => {
      const json = '{"name": "Test"';
      const result = parseJson(json);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.line).toBeDefined();
      expect(result.column).toBeDefined();
      expect(result.error).toBeTruthy();
    });

    it('should catch syntax errors for trailing comma', () => {
      const json = '{"name": "Test",}';
      const result = parseJson(json);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should catch syntax errors for single quotes', () => {
      const json = "{'name': 'Test'}";
      const result = parseJson(json);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should catch syntax errors for unexpected token', () => {
      const json = '{"name": Test}'; // missing quotes around Test
      const result = parseJson(json);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('syntax');
    });

    it('should handle empty JSON', () => {
      const result = parseJson('');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should provide line and column for syntax errors', () => {
      const json = '{"name": "Test"\n"age": 30'; // missing closing brace on line 2
      const result = parseJson(json);
      expect(result.success).toBe(false);
      expect(result.line).toBeGreaterThan(0);
      expect(result.column).toBeGreaterThan(0);
    });

    it('should extract position from error message', () => {
      const json = '{"name": "Test", "value"'; // incomplete JSON
      const result = parseJson(json);
      expect(result.success).toBe(false);
      // Position should be extracted and converted to line/column
      expect(result.line).toBeDefined();
      expect(result.column).toBeDefined();
    });
  });

  describe('formatParseError', () => {
    it('should return empty string for successful parse', () => {
      const result = parseJson('{"test": true}');
      const formatted = formatParseError(result);
      expect(formatted).toBe('');
    });

    it('should format error with line and column', () => {
      const result = {
        success: false,
        error: 'Invalid JSON syntax',
        line: 5,
        column: 12
      };
      const formatted = formatParseError(result);
      expect(formatted).toContain('Invalid JSON syntax');
      expect(formatted).toContain('line 5');
      expect(formatted).toContain('column 12');
    });

    it('should return error message when line/column missing', () => {
      const result = {
        success: false,
        error: 'Failed to parse JSON'
      };
      const formatted = formatParseError(result);
      expect(formatted).toBe('Failed to parse JSON');
    });

    it('should handle missing error message', () => {
      const result = {
        success: false
      };
      const formatted = formatParseError(result);
      expect(formatted).toContain('Failed to parse JSON');
    });
  });

  describe('validateCustomMcpServerObj', () => {
    it('should validate valid command server', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'command',
        command: 'npx'
      };
      const result = validateCustomMcpServerObj(server);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(server);
      expect(result.errors).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it('should validate valid HTTP server', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'http',
        url: 'https://example.com/mcp'
      };
      const result = validateCustomMcpServerObj(server);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(server);
      expect(result.errors).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it('should return errors for invalid server missing name', () => {
      const server = { id: 'test', type: 'command' };
      const result = validateCustomMcpServerObj(server);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('name');
      expect(result.errorCount).toBeGreaterThan(0);
    });

    it('should return errors for command server missing command', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'command'
      };
      const result = validateCustomMcpServerObj(server);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('command');
    });

    it('should return errors for HTTP server missing url', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'http'
      };
      const result = validateCustomMcpServerObj(server);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('url');
    });

    it('should include server name in error messages when provided', () => {
      const server = {
        id: 'test',
        name: 'MyServer',
        type: 'command'
      };
      const result = validateCustomMcpServerObj(server, 'MyServer');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Server');
      expect(result.errors[0]).toContain('MyServer');
    });

    it('should return multiple errors for multiple validation failures', () => {
      const server = {
        id: 'test'
        // missing name and type
      };
      const result = validateCustomMcpServerObj(server);
      expect(result.valid).toBe(false);
      expect(result.errorCount).toBeGreaterThan(1);
    });

    it('should accept server with optional fields', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'command',
        command: 'npx',
        args: ['-y', 'server'],
        description: 'My test server'
      };
      const result = validateCustomMcpServerObj(server);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(server);
    });
  });

  describe('validateCustomMcpServers', () => {
    it('should validate array of valid servers', () => {
      const servers = [
        { id: 's1', name: 'Server 1', type: 'command', command: 'npx' },
        { id: 's2', name: 'Server 2', type: 'http', url: 'https://example.com' }
      ];
      const result = validateCustomMcpServers(servers);
      expect(result.valid).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it('should aggregate errors from multiple invalid servers', () => {
      const servers = [
        { id: 's1' }, // missing name, type, command/url
        { id: 's2' }  // missing name, type, command/url
      ];
      const result = validateCustomMcpServers(servers);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errorCount).toBeGreaterThan(0);
    });

    it('should handle mix of valid and invalid servers', () => {
      const servers = [
        { id: 's1', name: 'Server 1', type: 'command', command: 'npx' },
        { id: 's2' }, // invalid
        { id: 's3', name: 'Server 3', type: 'http', url: 'https://example.com' }
      ];
      const result = validateCustomMcpServers(servers);
      expect(result.valid).toBe(false);
      expect(result.data).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should use server index when name is missing', () => {
      const servers = [
        { id: 's1' },
        { id: 's2', name: 'Named Server', type: 'command', command: 'npx' },
        { id: 's3' }
      ];
      const result = validateCustomMcpServers(servers);
      expect(result.valid).toBe(false);
      // First server should be referenced as #1
      expect(result.errors.some(e => e.includes('#1'))).toBe(true);
      // Third server should be referenced as #3
      expect(result.errors.some(e => e.includes('#3'))).toBe(true);
    });

    it('should return empty array for empty input', () => {
      const result = validateCustomMcpServers([]);
      expect(result.valid).toBe(true);
      expect(result.data).toEqual([]);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('formatValidationErrors', () => {
    it('should return empty string for no errors', () => {
      const formatted = formatValidationErrors([]);
      expect(formatted).toBe('');
    });

    it('should format single error', () => {
      const errors = ['Error 1'];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toContain('1 validation error');
      expect(formatted).toContain('Error 1');
    });

    it('should format multiple errors', () => {
      const errors = ['Error 1', 'Error 2', 'Error 3'];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toContain('3 validation errors');
      expect(formatted).toContain('Error 1');
      expect(formatted).toContain('Error 2');
      expect(formatted).toContain('Error 3');
      expect(formatted).toContain('•'); // bullet points
    });

    it('should limit errors when maxErrors specified', () => {
      const errors = ['Error 1', 'Error 2', 'Error 3', 'Error 4', 'Error 5'];
      const formatted = formatValidationErrors(errors, 3);
      expect(formatted).toContain('5 validation errors');
      expect(formatted).toContain('Error 1');
      expect(formatted).toContain('Error 2');
      expect(formatted).toContain('Error 3');
      expect(formatted).toContain('2 more'); // remaining errors
      expect(formatted).not.toContain('Error 4');
      expect(formatted).not.toContain('Error 5');
    });

    it('should show singular "error" for single error', () => {
      const errors = ['Only error'];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toContain('1 validation error');
      expect(formatted).not.toContain('errors');
    });

    it('should show plural "errors" for multiple errors', () => {
      const errors = ['Error 1', 'Error 2'];
      const formatted = formatValidationErrors(errors);
      expect(formatted).toContain('2 validation errors');
    });

    it('should show singular "more" for single remaining error', () => {
      const errors = ['Error 1', 'Error 2'];
      const formatted = formatValidationErrors(errors, 1);
      expect(formatted).toContain('1 more error');
    });

    it('should show plural "more" for multiple remaining errors', () => {
      const errors = ['Error 1', 'Error 2', 'Error 3'];
      const formatted = formatValidationErrors(errors, 1);
      expect(formatted).toContain('2 more errors');
    });
  });

  describe('parseAndValidateMcpServers', () => {
    it('should parse and validate server array', () => {
      const json = JSON.stringify([
        { id: 's1', name: 'Server 1', type: 'command', command: 'npx' }
      ]);
      const result = parseAndValidateMcpServers(json);
      expect(result.valid).toBe(true);
      expect(result.servers).toHaveLength(1);
      expect(result.servers?.[0].name).toBe('Server 1');
      expect(result.errors).toHaveLength(0);
      expect(result.parseError).toBeUndefined();
    });

    it('should handle single server object', () => {
      const json = JSON.stringify(
        { id: 's1', name: 'Server 1', type: 'command', command: 'npx' }
      );
      const result = parseAndValidateMcpServers(json);
      expect(result.valid).toBe(true);
      expect(result.servers).toHaveLength(1);
      expect(result.servers?.[0].name).toBe('Server 1');
    });

    it('should return parse errors for invalid JSON', () => {
      const result = parseAndValidateMcpServers('{invalid}');
      expect(result.valid).toBe(false);
      expect(result.parseError).toBeDefined();
      expect(result.parseError).toBeTruthy();
    });

    it('should return validation errors for invalid servers', () => {
      const json = JSON.stringify([{ id: 's1' }]); // missing name, type
      const result = parseAndValidateMcpServers(json);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.parseError).toBeUndefined();
    });

    it('should return error for non-object non-array JSON', () => {
      const result = parseAndValidateMcpServers('"just a string"');
      expect(result.valid).toBe(false);
      expect(result.parseError).toContain('Invalid format');
    });

    it('should return error for null JSON', () => {
      const result = parseAndValidateMcpServers('null');
      expect(result.valid).toBe(false);
      expect(result.parseError).toContain('Invalid format');
    });

    it('should return error for number JSON', () => {
      const result = parseAndValidateMcpServers('123');
      expect(result.valid).toBe(false);
      expect(result.parseError).toContain('Invalid format');
    });

    it('should handle empty array', () => {
      const json = '[]';
      const result = parseAndValidateMcpServers(json);
      expect(result.valid).toBe(true);
      expect(result.servers).toEqual([]);
      expect(result.errors).toHaveLength(0);
    });

    it('should aggregate both parse and validation errors appropriately', () => {
      const json = '{invalid json'; // parse error
      const result = parseAndValidateMcpServers(json);
      expect(result.valid).toBe(false);
      expect(result.parseError).toBeDefined();
      // No validation errors if parse failed
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('formatMcpServerParseResult', () => {
    it('should format parse error when present', () => {
      const result = {
        valid: false,
        errors: [],
        parseError: 'Invalid JSON at line 5, column 12'
      };
      const formatted = formatMcpServerParseResult(result);
      expect(formatted).toContain('Invalid JSON');
      expect(formatted).toContain('line 5');
    });

    it('should format validation errors when no parse error', () => {
      const result = {
        valid: false,
        errors: ['Error 1', 'Error 2'],
        parseError: undefined
      };
      const formatted = formatMcpServerParseResult(result);
      expect(formatted).toContain('2 validation error');
      expect(formatted).toContain('Error 1');
      expect(formatted).toContain('Error 2');
    });

    it('should return empty string for valid result', () => {
      const result = {
        valid: true,
        servers: [],
        errors: []
      };
      const formatted = formatMcpServerParseResult(result);
      expect(formatted).toBe('');
    });

    it('should prioritize parse error over validation errors', () => {
      const result = {
        valid: false,
        errors: ['Validation error'],
        parseError: 'Parse error'
      };
      const formatted = formatMcpServerParseResult(result);
      expect(formatted).toContain('Parse error');
    });
  });

  describe('validateAndFormatErrors', () => {
    it('should return valid result for valid server', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'command',
        command: 'npx'
      };
      const result = validateAndFormatErrors(server);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.errorCount).toBe(0);
    });

    it('should return validation errors for invalid server', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'http'
        // missing url
      };
      const result = validateAndFormatErrors(server);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
      // Error message should mention url is required
      expect(result.errors.some(e => e.toLowerCase().includes('url'))).toBe(true);
    });

    it('should return validation errors for command server missing command', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'command'
        // missing command
      };
      const result = validateAndFormatErrors(server);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
      // Error message should mention command is required
      expect(result.errors.some(e => e.toLowerCase().includes('command'))).toBe(true);
    });

    it('should return validation errors for invalid type', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'invalid'
      };
      const result = validateAndFormatErrors(server);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return validation errors for empty id', () => {
      const server = {
        id: '',
        name: 'Test',
        type: 'command',
        command: 'npx'
      };
      const result = validateAndFormatErrors(server);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle multiple errors with formatting', () => {
      const server = {
        id: 'test',
        name: 'Test',
        type: 'http'
        // missing url
      };
      const result = validateAndFormatErrors(server);
      expect(result.valid).toBe(false);
      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
