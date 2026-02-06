/**
 * Review QA Service - AI-powered code explanation for human review phase
 *
 * This service manages the execution of the Python review_qa_runner.py script
 * and streams AI responses to the renderer process.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import type { ReviewQAStreamChunk } from '../shared/types';
import { InsightsConfig } from './insights/config';

/**
 * Active review QA session
 */
interface ActiveSession {
  specId: string;
  projectId: string;
  process: ChildProcess;
  startedAt: Date;
}

/**
 * Configuration for review QA
 */
export interface ReviewQAConfigOptions {
  model?: string;
  thinkingLevel?: string;
}

/**
 * Service for AI-powered code explanation during human review phase
 */
export class ReviewQAService extends EventEmitter {
  private config: InsightsConfig;
  private activeSessions: Map<string, ActiveSession> = new Map();

  constructor() {
    super();
    this.config = new InsightsConfig();
  }

  /**
   * Configure paths for Python and auto-claude source
   */
  configure(pythonPath?: string, autoBuildSourcePath?: string): void {
    this.config.configure(pythonPath, autoBuildSourcePath);
  }

  /**
   * Start a review QA session for a task
   *
   * @param sessionId - Unique session ID (typically spec ID)
   * @param specId - Spec ID for the task
   * @param projectId - Project ID
   * @param specDir - Path to the spec directory
   * @param question - User's question about the changes
   * @param configOptions - Optional model configuration
   */
  async startSession(
    sessionId: string,
    specId: string,
    projectId: string,
    specDir: string,
    question: string,
    configOptions?: ReviewQAConfigOptions
  ): Promise<void> {
    // Check if session is already active
    if (this.activeSessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} is already active`);
    }

    // Get Python executable path
    const pythonPath = this.config.getPythonPath();
    if (!pythonPath) {
      throw new Error('Python environment not configured');
    }

    // Get auto-claude source path
    const autoBuildSource = this.config.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      throw new Error('Auto Claude source not found');
    }

    const runnerPath = path.join(autoBuildSource, 'runners', 'review_qa_runner.py');

    // Emit status event
    this.emit('status', sessionId, projectId, {
      phase: 'thinking',
      message: 'Analyzing changes and preparing response...'
    });

    // Get process environment
    const processEnv = await this.config.getProcessEnv();

    // Build command arguments
    const args = [
      runnerPath,
      '--spec-dir', specDir,
      '--question', question,
    ];

    // Add model config if provided
    if (configOptions?.model) {
      args.push('--model', configOptions.model);
    }

    if (configOptions?.thinkingLevel) {
      args.push('--thinking-level', configOptions.thinkingLevel);
    }

    // Spawn the Python process
    const process = spawn(pythonPath, args, {
      env: processEnv,
      cwd: specDir,
    });

    // Track the active session
    const activeSession: ActiveSession = {
      specId,
      projectId,
      process,
      startedAt: new Date(),
    };
    this.activeSessions.set(sessionId, activeSession);

    // Handle process output
    let currentTool = '';
    let buffer = '';

    process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      buffer += text;

      // Process line by line
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line) continue;

        // Check for tool markers
        if (line.startsWith('__TOOL_START__:')) {
          try {
            const toolData = JSON.parse(line.substring('__TOOL_START__:'.length));
            currentTool = toolData.name || '';
            // Emit tool start event
            this.emit('stream-chunk', sessionId, projectId, {
              type: 'tool_start',
              toolName: currentTool,
              toolInput: toolData.input || '',
            } as unknown as ReviewQAStreamChunk);
          } catch (e) {
            // Invalid JSON, treat as regular text
            this.emit('stream-chunk', sessionId, projectId, {
              type: 'text',
              content: line,
            } as ReviewQAStreamChunk);
          }
        } else if (line.startsWith('__TOOL_END__:')) {
          // Emit tool end event
          this.emit('stream-chunk', sessionId, projectId, {
            type: 'tool_end',
            toolName: currentTool,
          } as unknown as ReviewQAStreamChunk);
          currentTool = '';
        } else {
          // Regular text output
          this.emit('stream-chunk', sessionId, projectId, {
            type: 'text',
            content: line,
          } as ReviewQAStreamChunk);
        }
      }
    });

    // Handle process errors
    process.stderr?.on('data', (data: Buffer) => {
      const errorMsg = data.toString('utf-8');
      console.error('[Review QA Service] stderr:', errorMsg);
      this.emit('error', sessionId, projectId, errorMsg);
    });

    // Handle process completion
    process.on('close', (code: number | null) => {
      this.activeSessions.delete(sessionId);

      // Flush any remaining buffer
      if (buffer.trim()) {
        this.emit('stream-chunk', sessionId, projectId, {
          type: 'text',
          content: buffer,
        } as ReviewQAStreamChunk);
      }

      // Emit completion event
      this.emit('stream-chunk', sessionId, projectId, {
        type: 'done',
      } as ReviewQAStreamChunk);

      if (code !== 0 && code !== null) {
        this.emit('error', sessionId, projectId, `Process exited with code ${code}`);
      }
    });

    // Handle process spawn errors
    process.on('error', (error) => {
      this.activeSessions.delete(sessionId);
      this.emit('error', sessionId, projectId, error.message);
    });
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Cancel an active session
   */
  cancelSession(sessionId: string): boolean {
    const activeSession = this.activeSessions.get(sessionId);
    if (!activeSession) {
      return false;
    }

    activeSession.process.kill();
    this.activeSessions.delete(sessionId);
    return true;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): Array<{ sessionId: string; specId: string; projectId: string; startedAt: Date }> {
    return Array.from(this.activeSessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      specId: session.specId,
      projectId: session.projectId,
      startedAt: session.startedAt,
    }));
  }

  /**
   * Get project ID for an active session
   */
  getProjectIdForSession(sessionId: string): string | undefined {
    return this.activeSessions.get(sessionId)?.projectId;
  }
}
