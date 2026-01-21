/**
 * Tests for MCP Schema Validator
 * Tests JSON schema validation for CustomMcpServer type
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Ajv from 'ajv';
import { validateCustomMcpServer, customMcpServerSchema } from './mcpSchema';

describe('MCP Schema Validator', () => {
  let ajv: InstanceType<typeof Ajv>;

  beforeEach(() => {
    ajv = new Ajv({ allErrors: true });
  });

  describe('validateCustomMcpServer', () => {
    it('should pass validation for valid command server', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx',
        args: ['-y', 'my-mcp-server']
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should pass validation for valid HTTP server', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'https://example.com/mcp'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should pass validation for command server with optional fields', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx',
        args: ['-y', 'my-mcp-server'],
        description: 'My custom MCP server'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should pass validation for HTTP server with headers', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'https://example.com/mcp',
        headers: {
          'Authorization': 'Bearer token123'
        }
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail validation when required fields missing', () => {
      const server = {
        id: 'test-server',
        type: 'command'
        // missing 'name'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain('name');
    });

    it('should fail validation when id is missing', () => {
      const server = {
        name: 'Test Server',
        type: 'command',
        command: 'npx'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('id');
    });

    it('should fail validation when type is missing', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        command: 'npx'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('type');
    });

    it('should fail validation for command server without command', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command'
        // missing 'command'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain('command');
    });

    it('should fail validation for HTTP server without url', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http'
        // missing 'url'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
      expect(result.errors?.[0]).toContain('url');
    });

    it('should fail validation for invalid type', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'invalid'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]).toContain('type');
    });

    it('should fail validation for empty id', () => {
      const server = {
        id: '',
        name: 'Test Server',
        type: 'command',
        command: 'npx'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('id');
    });

    it('should fail validation for empty name', () => {
      const server = {
        id: 'test-server',
        name: '',
        type: 'command',
        command: 'npx'
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('name');
    });

    it('should fail validation for empty command', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: ''
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('command');
    });

    it('should fail validation for empty url', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: ''
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('url');
    });

    it('should allow omitting command for http type', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'https://example.com/mcp'
        // command field omitted
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should allow omitting url for command type', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx'
        // url field omitted
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should allow empty args array', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx',
        args: []
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should allow omitting args', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx'
        // args field omitted
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should allow empty headers object', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'https://example.com/mcp',
        headers: {}
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should allow omitting headers', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'https://example.com/mcp'
        // headers field omitted
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should allow omitting description', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx'
        // description field omitted
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate args array contains strings', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx',
        args: ['-y', 'my-mcp-server', '--port', '3000']
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail validation for non-string args', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'command',
        command: 'npx',
        args: ['-y', 123] // invalid: number in array
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should validate headers object contains string values', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'https://example.com/mcp',
        headers: {
          'Authorization': 'Bearer token',
          'Content-Type': 'application/json'
        }
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail validation for non-string header values', () => {
      const server = {
        id: 'test-server',
        name: 'Test Server',
        type: 'http',
        url: 'https://example.com/mcp',
        headers: {
          'X-Number': 123 // invalid: number value
        }
      };
      const result = validateCustomMcpServer(server, ajv);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('customMcpServerSchema', () => {
    it('should have correct required fields', () => {
      expect(customMcpServerSchema.required).toEqual(['id', 'name', 'type']);
    });

    it('should have correct type enum', () => {
      const typeProperty = customMcpServerSchema.properties?.type as any;
      expect(typeProperty?.enum).toEqual(['command', 'http']);
    });

    it('should have conditional validation for command type', () => {
      expect(customMcpServerSchema.if).toBeDefined();
      expect(customMcpServerSchema.then).toBeDefined();
      expect((customMcpServerSchema as any).if.properties.type.const).toBe('command');
      expect((customMcpServerSchema as any).then.required).toContain('command');
    });

    it('should have conditional validation for http type', () => {
      expect(customMcpServerSchema.else).toBeDefined();
      const elseBlock = customMcpServerSchema.else as any;
      expect(elseBlock.if).toBeDefined();
      expect(elseBlock.then).toBeDefined();
      expect(elseBlock.if.properties.type.const).toBe('http');
      expect(elseBlock.then.required).toContain('url');
    });
  });
});
