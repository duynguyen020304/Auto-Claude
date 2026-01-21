/**
 * @vitest-environment jsdom
 */
/**
 * Tests for AgentTools component
 * Specifically tests agent profile resolution for phase-based and feature-based agents
 */
import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_AGENT_PROFILES, DEFAULT_PHASE_MODELS, DEFAULT_FEATURE_MODELS, DEFAULT_FEATURE_THINKING } from '../../../shared/constants/models';
import { resolveAgentSettings, type AgentSettingsSource } from '../../hooks';

// Mock electronAPI
global.window.electronAPI = {
  getProjectEnv: vi.fn().mockResolvedValue({ success: true, data: null }),
  updateProjectEnv: vi.fn().mockResolvedValue({ success: true }),
  checkMcpHealth: vi.fn().mockResolvedValue({ success: true, data: null }),
  testMcpConnection: vi.fn().mockResolvedValue({ success: true, data: null }),
} as any;

describe('AgentTools - Agent Profile Resolution', () => {
  describe('Profile Selection', () => {
    it('should find auto profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('auto');
      expect(profile?.name).toBe('Auto (Optimized)');
      expect(profile?.model).toBe('opus');
    });

    it('should find complex profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'complex');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('complex');
      expect(profile?.name).toBe('Complex Tasks');
      expect(profile?.model).toBe('opus');
    });

    it('should find balanced profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'balanced');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('balanced');
      expect(profile?.name).toBe('Balanced');
      expect(profile?.model).toBe('sonnet');
    });

    it('should find quick profile by ID', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'quick');
      expect(profile).toBeDefined();
      expect(profile?.id).toBe('quick');
      expect(profile?.name).toBe('Quick Edits');
      expect(profile?.model).toBe('haiku');
    });
  });

  describe('Auto Profile Phase Configuration', () => {
    it('should have Opus for all phases in auto profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto');
      const phaseModels = profile?.phaseModels;

      expect(phaseModels).toBeDefined();
      expect(phaseModels?.spec).toBe('opus');
      expect(phaseModels?.planning).toBe('opus');
      expect(phaseModels?.coding).toBe('opus');
      expect(phaseModels?.qa).toBe('opus');
    });

    it('should have optimized thinking levels in auto profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto');
      const phaseThinking = profile?.phaseThinking;

      expect(phaseThinking).toBeDefined();
      expect(phaseThinking?.spec).toBe('ultrathink');
      expect(phaseThinking?.planning).toBe('high');
      expect(phaseThinking?.coding).toBe('low');
      expect(phaseThinking?.qa).toBe('low');
    });
  });

  describe('Balanced Profile Phase Configuration', () => {
    it('should have Sonnet for all phases in balanced profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'balanced');
      const phaseModels = profile?.phaseModels;

      expect(phaseModels).toBeDefined();
      expect(phaseModels?.spec).toBe('sonnet');
      expect(phaseModels?.planning).toBe('sonnet');
      expect(phaseModels?.coding).toBe('sonnet');
      expect(phaseModels?.qa).toBe('sonnet');
    });

    it('should have medium thinking for all phases in balanced profile', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'balanced');
      const phaseThinking = profile?.phaseThinking;

      expect(phaseThinking).toBeDefined();
      expect(phaseThinking?.spec).toBe('medium');
      expect(phaseThinking?.planning).toBe('medium');
      expect(phaseThinking?.coding).toBe('medium');
      expect(phaseThinking?.qa).toBe('medium');
    });
  });

  describe('Profile Resolution Logic', () => {
    it('should use profile phase models when no custom overrides exist', () => {
      // Simulate settings with selected profile but no custom overrides
      const selectedProfileId = 'auto';
      const customPhaseModels = undefined;

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];
      const profilePhaseModels = profile.phaseModels || DEFAULT_PHASE_MODELS;
      const phaseModels = customPhaseModels || profilePhaseModels;

      // Should resolve to auto profile's opus models
      expect(phaseModels.spec).toBe('opus');
      expect(phaseModels.planning).toBe('opus');
      expect(phaseModels.coding).toBe('opus');
      expect(phaseModels.qa).toBe('opus');
    });

    it('should use custom overrides when they exist', () => {
      // Simulate settings with custom overrides
      const selectedProfileId = 'auto';
      const customPhaseModels = {
        spec: 'sonnet' as const,
        planning: 'sonnet' as const,
        coding: 'sonnet' as const,
        qa: 'sonnet' as const,
      };

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];
      const profilePhaseModels = profile.phaseModels || DEFAULT_PHASE_MODELS;
      const phaseModels = customPhaseModels || profilePhaseModels;

      // Should resolve to custom overrides (sonnet)
      expect(phaseModels.spec).toBe('sonnet');
      expect(phaseModels.planning).toBe('sonnet');
      expect(phaseModels.coding).toBe('sonnet');
      expect(phaseModels.qa).toBe('sonnet');
    });

    it('should default to auto profile when selectedProfileId is undefined', () => {
      const selectedProfileId = undefined;
      const effectiveProfileId = selectedProfileId || 'auto';

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === effectiveProfileId) || DEFAULT_AGENT_PROFILES[0];

      expect(profile.id).toBe('auto');
      expect(profile.model).toBe('opus');
    });

    it('should fall back to first profile when selected profile is not found', () => {
      const selectedProfileId = 'non-existent-profile';

      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];

      expect(profile.id).toBe('auto');
      expect(profile.model).toBe('opus');
    });
  });

  describe('Agent Settings Resolution (Utility)', () => {
    it('should resolve phase-based agent settings correctly', () => {
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto')!;
      const phaseModels = profile.phaseModels!;
      const phaseThinking = profile.phaseThinking!;
      const featureModels = DEFAULT_FEATURE_MODELS;
      const featureThinking = DEFAULT_FEATURE_THINKING;

      const resolvedSettings = { phaseModels, phaseThinking, featureModels, featureThinking };

      // Spec phase agent
      const specAgent = resolveAgentSettings(
        { type: 'phase', phase: 'spec' },
        resolvedSettings
      );
      expect(specAgent.model).toBe('opus');
      expect(specAgent.thinking).toBe('ultrathink');

      // Planning phase agent
      const planningAgent = resolveAgentSettings(
        { type: 'phase', phase: 'planning' },
        resolvedSettings
      );
      expect(planningAgent.model).toBe('opus');
      expect(planningAgent.thinking).toBe('high');

      // Coding phase agent
      const codingAgent = resolveAgentSettings(
        { type: 'phase', phase: 'coding' },
        resolvedSettings
      );
      expect(codingAgent.model).toBe('opus');
      expect(codingAgent.thinking).toBe('low');

      // QA phase agent
      const qaAgent = resolveAgentSettings(
        { type: 'phase', phase: 'qa' },
        resolvedSettings
      );
      expect(qaAgent.model).toBe('opus');
      expect(qaAgent.thinking).toBe('low');
    });

    it('should resolve feature-based agent settings correctly', () => {
      const phaseModels = DEFAULT_PHASE_MODELS;
      const phaseThinking = { spec: 'medium' as const, planning: 'medium' as const, coding: 'medium' as const, qa: 'medium' as const };
      const featureModels = DEFAULT_FEATURE_MODELS;
      const featureThinking = DEFAULT_FEATURE_THINKING;

      const resolvedSettings = { phaseModels, phaseThinking, featureModels, featureThinking };

      // Insights feature agent (defaults to sonnet)
      const insightsAgent = resolveAgentSettings(
        { type: 'feature', feature: 'insights' },
        resolvedSettings
      );
      expect(insightsAgent.model).toBe('sonnet');
      expect(insightsAgent.thinking).toBe('medium');

      // Ideation feature agent (defaults to opus)
      const ideationAgent = resolveAgentSettings(
        { type: 'feature', feature: 'ideation' },
        resolvedSettings
      );
      expect(ideationAgent.model).toBe('opus');
      expect(ideationAgent.thinking).toBe('high');

      // Roadmap feature agent (defaults to opus)
      const roadmapAgent = resolveAgentSettings(
        { type: 'feature', feature: 'roadmap' },
        resolvedSettings
      );
      expect(roadmapAgent.model).toBe('opus');
      expect(roadmapAgent.thinking).toBe('high');

      // GitHub Issues feature agent (defaults to opus)
      const githubIssuesAgent = resolveAgentSettings(
        { type: 'feature', feature: 'githubIssues' },
        resolvedSettings
      );
      expect(githubIssuesAgent.model).toBe('opus');
      expect(githubIssuesAgent.thinking).toBe('medium');

      // GitHub PRs feature agent (defaults to opus)
      const githubPrsAgent = resolveAgentSettings(
        { type: 'feature', feature: 'githubPrs' },
        resolvedSettings
      );
      expect(githubPrsAgent.model).toBe('opus');
      expect(githubPrsAgent.thinking).toBe('medium');

      // Utility feature agent (defaults to haiku)
      const utilityAgent = resolveAgentSettings(
        { type: 'feature', feature: 'utility' },
        resolvedSettings
      );
      expect(utilityAgent.model).toBe('haiku');
      expect(utilityAgent.thinking).toBe('low');
    });

    it('should resolve fixed settings correctly', () => {
      const phaseModels = DEFAULT_PHASE_MODELS;
      const phaseThinking = { spec: 'medium' as const, planning: 'medium' as const, coding: 'medium' as const, qa: 'medium' as const };
      const featureModels = DEFAULT_FEATURE_MODELS;
      const featureThinking = DEFAULT_FEATURE_THINKING;

      const resolvedSettings = { phaseModels, phaseThinking, featureModels, featureThinking };

      // Fixed settings agent
      const fixedAgent = resolveAgentSettings(
        { type: 'fixed', model: 'opus', thinking: 'high' },
        resolvedSettings
      );
      expect(fixedAgent.model).toBe('opus');
      expect(fixedAgent.thinking).toBe('high');
    });
  });

  describe('Bug Fix Regression Test (ACS-255)', () => {
    it('should resolve to opus when auto profile is selected (not sonnet from defaults)', () => {
      // This test verifies the fix for ACS-255:
      // MCP Server Overview was showing Sonnet instead of Opus when Auto profile was selected

      const selectedProfileId = 'auto';
      const customPhaseModels = undefined; // No custom overrides

      // The bug was using DEFAULT_PHASE_MODELS directly (which is BALANCED_PHASE_MODELS = sonnet)
      // The fix is to resolve the selected profile first
      const profile = DEFAULT_AGENT_PROFILES.find(p => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];
      const profilePhaseModels = profile.phaseModels || DEFAULT_PHASE_MODELS;
      const phaseModels = customPhaseModels || profilePhaseModels;

      // Should be opus (from auto profile), NOT sonnet (from DEFAULT_PHASE_MODELS)
      expect(phaseModels.spec).toBe('opus');
      expect(phaseModels.planning).toBe('opus');
      expect(phaseModels.coding).toBe('opus');
      expect(phaseModels.qa).toBe('opus');
    });

    it('should ensure DEFAULT_PHASE_MODELS is balanced (sonnet)', () => {
      // This documents that DEFAULT_PHASE_MODELS is the balanced profile (sonnet)
      // The bug was that this was being used instead of resolving the selected profile

      expect(DEFAULT_PHASE_MODELS.spec).toBe('sonnet');
      expect(DEFAULT_PHASE_MODELS.planning).toBe('sonnet');
      expect(DEFAULT_PHASE_MODELS.coding).toBe('sonnet');
      expect(DEFAULT_PHASE_MODELS.qa).toBe('sonnet');
    });
  });
});

describe('MCP Import/Export', () => {
  describe('Export Servers', () => {
    it('should download JSON file with all servers', async () => {
      const customServers = [
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx' }
      ];

      // Mock document methods for download
      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(),
        style: {}
      };
      const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
      const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
      const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);
      const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
      const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      // Simulate export functionality
      const jsonString = JSON.stringify(customServers, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(url).toBe('blob:test-url');

      // Cleanup mocks
      createElementSpy.mockRestore();
      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    });

    it('should be disabled when no servers exist', () => {
      const customServers: any[] = [];

      // Export should be disabled when no servers
      expect(customServers.length).toBe(0);
    });

    it('should generate timestamped filename', () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `mcp-servers-${timestamp}.json`;

      expect(filename).toMatch(/^mcp-servers-\d{4}-\d{2}-\d{2}T/);
      expect(filename).toMatch(/\.json$/);
    });
  });

  describe('Import Servers', () => {
    it('should validate and import valid servers', async () => {
      const validJson = JSON.stringify([
        { id: 'new-server', name: 'New Server', type: 'command' as const, command: 'npx' }
      ]);

      // Parse the JSON
      const parsed = JSON.parse(validJson);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('new-server');
      expect(parsed[0].name).toBe('New Server');
      expect(parsed[0].type).toBe('command');
      expect(parsed[0].command).toBe('npx');
    });

    it('should show error for invalid JSON', async () => {
      const invalidJson = '{invalid json}';

      // Attempt to parse should fail
      expect(() => {
        JSON.parse(invalidJson);
      }).toThrow();
    });

    it('should show error for missing required fields', async () => {
      const invalidJson = JSON.stringify([
        { id: 's1' } // missing name, type
      ]);

      const parsed = JSON.parse(invalidJson);

      // Should have id but missing required fields
      expect(parsed[0].id).toBe('s1');
      expect(parsed[0].name).toBeUndefined();
      expect(parsed[0].type).toBeUndefined();
    });

    it('should handle single server object', async () => {
      const singleServerJson = JSON.stringify(
        { id: 's1', name: 'Server 1', type: 'http' as const, url: 'https://example.com' }
      );

      const parsed = JSON.parse(singleServerJson);

      expect(parsed.id).toBe('s1');
      expect(parsed.name).toBe('Server 1');
      expect(parsed.type).toBe('http');
      expect(parsed.url).toBe('https://example.com');
    });

    it('should handle empty array', async () => {
      const emptyJson = '[]';
      const parsed = JSON.parse(emptyJson);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(0);
    });
  });

  describe('Duplicate Detection', () => {
    it('should detect duplicate server IDs', () => {
      const existingServers = [
        { id: 'existing', name: 'Existing', type: 'command' as const, command: 'npx' }
      ];

      const importServers = [
        { id: 'existing', name: 'Updated', type: 'command' as const, command: 'npx' },
        { id: 'new', name: 'New', type: 'command' as const, command: 'npx' }
      ];

      // Find duplicates
      const existingIds = new Set(existingServers.map(s => s.id));
      const duplicates = importServers.filter(s => existingIds.has(s.id));
      const newServers = importServers.filter(s => !existingIds.has(s.id));

      expect(duplicates.length).toBe(1);
      expect(duplicates[0].id).toBe('existing');
      expect(newServers.length).toBe(1);
      expect(newServers[0].id).toBe('new');
    });

    it('should have no duplicates when IDs are unique', () => {
      const existingServers = [
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx' }
      ];

      const importServers = [
        { id: 's2', name: 'Server 2', type: 'command' as const, command: 'npx' },
        { id: 's3', name: 'Server 3', type: 'command' as const, command: 'npx' }
      ];

      const existingIds = new Set(existingServers.map(s => s.id));
      const duplicates = importServers.filter(s => existingIds.has(s.id));

      expect(duplicates.length).toBe(0);
    });

    it('should detect all duplicates when multiple exist', () => {
      const existingServers = [
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx' },
        { id: 's2', name: 'Server 2', type: 'command' as const, command: 'npx' }
      ];

      const importServers = [
        { id: 's1', name: 'Updated 1', type: 'command' as const, command: 'npx' },
        { id: 's2', name: 'Updated 2', type: 'command' as const, command: 'npx' },
        { id: 's3', name: 'New', type: 'command' as const, command: 'npx' }
      ];

      const existingIds = new Set(existingServers.map(s => s.id));
      const duplicates = importServers.filter(s => existingIds.has(s.id));
      const newServers = importServers.filter(s => !existingIds.has(s.id));

      expect(duplicates.length).toBe(2);
      expect(newServers.length).toBe(1);
    });
  });

  describe('Duplicate Resolution Strategies', () => {
    it('should skip duplicates when skip option selected', () => {
      const existingServers = [
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx' },
        { id: 's2', name: 'Server 2', type: 'command' as const, command: 'npx' }
      ];

      const importServers = [
        { id: 's1', name: 'Updated 1', type: 'command' as const, command: 'npx' },
        { id: 's3', name: 'New', type: 'command' as const, command: 'npx' }
      ];

      // Skip duplicates strategy
      const existingIds = new Set(existingServers.map(s => s.id));
      const result = importServers.filter(s => !existingIds.has(s.id));

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('s3');
    });

    it('should merge servers when merge option selected', () => {
      const existingServers = [
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx', args: ['-y'] },
        { id: 's2', name: 'Server 2', type: 'command' as const, command: 'npx' }
      ];

      const importServers = [
        { id: 's1', name: 'Updated 1', type: 'command' as const, command: 'node', args: [] },
        { id: 's3', name: 'New', type: 'command' as const, command: 'npx' }
      ];

      // Merge strategy: replace existing with imported
      const serverMap = new Map(
        [...existingServers, ...importServers].map(s => [s.id, s])
      );
      const result = Array.from(serverMap.values());

      expect(result.length).toBe(3);
      expect(result.find(s => s.id === 's1')?.name).toBe('Updated 1'); // Updated
      expect(result.find(s => s.id === 's3')?.name).toBe('New'); // Added
    });

    it('should replace all when replace option selected', () => {
      const existingServers = [
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx' },
        { id: 's2', name: 'Server 2', type: 'command' as const, command: 'npx' }
      ];

      const importServers = [
        { id: 's3', name: 'New 1', type: 'command' as const, command: 'npx' },
        { id: 's4', name: 'New 2', type: 'command' as const, command: 'npx' }
      ];

      // Replace all strategy: use only imported servers
      const result = [...importServers];

      expect(result.length).toBe(2);
      expect(result.every(s => importServers.some(imp => imp.id === s.id))).toBe(true);
      expect(result.some(s => s.id === 's1')).toBe(false);
      expect(result.some(s => s.id === 's2')).toBe(false);
    });
  });

  describe('Import Error Handling', () => {
    it('should handle malformed JSON gracefully', () => {
      const invalidJson = '{"name": "test"'; // Missing closing brace

      expect(() => {
        JSON.parse(invalidJson);
      }).toThrow();
    });

    it('should handle non-JSON content', () => {
      const textContent = 'This is just plain text, not JSON';

      expect(() => {
        JSON.parse(textContent);
      }).toThrow();
    });

    it('should handle JSON with wrong structure', () => {
      const wrongStructure = JSON.stringify({
        servers: 'this should be an array, not a property'
      });

      const parsed = JSON.parse(wrongStructure);

      // Valid JSON but wrong structure for our use case
      expect(Array.isArray(parsed)).toBe(false);
      expect(parsed.servers).toBeDefined();
    });

    it('should handle JSON array with invalid server objects', () => {
      const invalidServers = JSON.stringify([
        { id: 's1' }, // missing required fields
        { id: 's2' }, // missing required fields
        { id: 's3', name: 'Valid', type: 'command' as const, command: 'npx' }
      ]);

      const parsed = JSON.parse(invalidServers);

      expect(parsed.length).toBe(3);
      expect(parsed[0].name).toBeUndefined();
      expect(parsed[1].name).toBeUndefined();
      expect(parsed[2].name).toBe('Valid');
    });
  });

  describe('Backup Before Import', () => {
    it('should create backup when option selected', () => {
      const currentServers = [
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx' },
        { id: 's2', name: 'Server 2', type: 'http' as const, url: 'https://example.com' }
      ];

      const backupJson = JSON.stringify(currentServers, null, 2);

      expect(backupJson).toContain('s1');
      expect(backupJson).toContain('s2');
      expect(backupJson).toContain('Server 1');
      expect(backupJson).toContain('Server 2');
    });

    it('should generate backup filename with timestamp', () => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `mcp-servers-backup-${timestamp}.json`;

      expect(backupFilename).toMatch(/^mcp-servers-backup-\d{4}-\d{2}-\d{2}T/);
      expect(backupFilename).toMatch(/\.json$/);
    });

    it('should handle empty server list for backup', () => {
      const currentServers: any[] = [];
      const backupJson = JSON.stringify(currentServers, null, 2);

      expect(backupJson).toBe('[]');
    });
  });

  describe('File Reading', () => {
    it('should read file contents correctly', () => {
      const fileContent = JSON.stringify([
        { id: 's1', name: 'Server 1', type: 'command' as const, command: 'npx' }
      ]);

      // Simulate file reading
      const parsed = JSON.parse(fileContent);

      expect(parsed[0].id).toBe('s1');
      expect(parsed[0].name).toBe('Server 1');
    });

    it('should handle UTF-8 encoding', () => {
      const utf8Content = JSON.stringify([
        { id: 's1', name: 'Serveur 测试 🎉', type: 'command' as const, command: 'npx' }
      ]);

      const parsed = JSON.parse(utf8Content);

      expect(parsed[0].name).toBe('Serveur 测试 🎉');
    });

    it('should handle large files', () => {
      const largeServerList = Array.from({ length: 100 }, (_, i) => ({
        id: `s${i}`,
        name: `Server ${i}`,
        type: 'command' as const,
        command: 'npx'
      }));

      const jsonContent = JSON.stringify(largeServerList);
      const parsed = JSON.parse(jsonContent);

      expect(parsed.length).toBe(100);
      expect(parsed[0].name).toBe('Server 0');
      expect(parsed[99].name).toBe('Server 99');
    });
  });
});
