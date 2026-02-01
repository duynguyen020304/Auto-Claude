import { spawn, ChildProcess } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import type {
  InsightsChatMessage,
  InsightsChatStatus,
  InsightsStreamChunk,
  InsightsToolUsage,
  InsightsModelConfig,
} from '../../shared/types';
import { MODEL_ID_MAP } from '../../shared/constants';
import { InsightsConfig } from './config';
import { detectRateLimit, createSDKRateLimitInfo } from '../rate-limit-detector';
import { SessionQueue, SessionPriority } from './session-queue';
import { RollingWindowRateLimiter } from './rate-limiter';

/**
 * Rate limiting configuration
 */
interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

/**
 * Default rate limit: 10 sessions per minute
 */
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60000 // 1 minute
};

/**
 * Message processor result
 */
interface ProcessorResult {
  fullResponse: string;
  suggestedTask?: InsightsChatMessage['suggestedTask'];
  toolsUsed: InsightsToolUsage[];
}

/**
 * Python process executor for insights
 * Handles spawning and managing the Python insights runner process
 */
export class InsightsExecutor extends EventEmitter {
  private config: InsightsConfig;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private sessionQueue: SessionQueue;
  private rateLimiter: RollingWindowRateLimiter;
  private rateLimitConfig: RateLimitConfig;

  constructor(
    config: InsightsConfig,
    sessionQueue: SessionQueue,
    rateLimitConfig: RateLimitConfig = DEFAULT_RATE_LIMIT
  ) {
    super();
    this.config = config;
    this.sessionQueue = sessionQueue;
    this.rateLimiter = new RollingWindowRateLimiter();
    this.rateLimitConfig = rateLimitConfig;
  }

  /**
   * Check if a session is currently active
   */
  isSessionActive(sessionId: string): boolean {
    return this.activeProcesses.has(sessionId);
  }

  /**
   * Cancel an active session
   */
  cancelSession(sessionId: string, projectId: string): boolean {
    const existingProcess = this.activeProcesses.get(sessionId);
    if (!existingProcess) return false;

    existingProcess.kill();
    this.activeProcesses.delete(sessionId);
    this.sessionQueue.removeActiveSession(sessionId, projectId);
    return true;
  }

  /**
   * Update rate limit configuration
   */
  updateRateLimitConfig(config: Partial<RateLimitConfig>): void {
    this.rateLimitConfig = { ...this.rateLimitConfig, ...config };
  }

  /**
   * Get current rate limit configuration
   */
  getRateLimitConfig(): RateLimitConfig {
    return { ...this.rateLimitConfig };
  }

  /**
   * Get rate limiter instance (for testing)
   */
  getRateLimiter(): RollingWindowRateLimiter {
    return this.rateLimiter;
  }

  /**
   * Get current rate limit usage for a project
   */
  getRateLimitUsage(projectId: string): number {
    return this.rateLimiter.getUsage(projectId, this.rateLimitConfig.windowMs);
  }

  /**
   * Clear rate limit data for a specific project
   */
  clearRateLimit(projectId: string): void {
    this.rateLimiter.clearProject(projectId);
  }

  /**
   * Clear all rate limit data
   */
  clearAllRateLimits(): void {
    this.rateLimiter.clearAll();
  }

  /**
   * Execute insights query
   */
  async execute(
    sessionId: string,
    projectId: string,
    projectPath: string,
    message: string,
    conversationHistory: Array<{ role: string; content: string }>,
    modelConfig?: InsightsModelConfig,
    priority: SessionPriority = SessionPriority.NORMAL,
    roadmapItemId?: string
  ): Promise<ProcessorResult> {
    // Check if session is already active
    if (this.isSessionActive(sessionId)) {
      throw new Error(`Session ${sessionId} is already active`);
    }

    // Check rate limiting before starting session
    if (!this.rateLimiter.canStartSession(projectId, this.rateLimitConfig.limit, this.rateLimitConfig.windowMs)) {
      const currentUsage = this.rateLimiter.getUsage(projectId, this.rateLimitConfig.windowMs);
      throw new Error(
        `Rate limit exceeded: ${currentUsage}/${this.rateLimitConfig.limit} sessions per ${this.rateLimitConfig.windowMs / 1000}s. ` +
        `Please wait before starting another session.`
      );
    }

    const autoBuildSource = this.config.getAutoBuildSourcePath();
    if (!autoBuildSource) {
      throw new Error('Auto Claude source not found');
    }

    const runnerPath = path.join(autoBuildSource, 'runners', 'insights_runner.py');
    if (!existsSync(runnerPath)) {
      throw new Error('insights_runner.py not found in auto-claude directory');
    }

    // Emit thinking status
    this.emit('status', sessionId, {
      phase: 'thinking',
      message: 'Processing your message...'
    } as InsightsChatStatus);

    // Get process environment
    const processEnv = await this.config.getProcessEnv();

    // Write conversation history to temp file to avoid Windows command-line length limit
    const historyFile = path.join(
      os.tmpdir(),
      `insights-history-${sessionId}-${Date.now()}.json`
    );

    let historyFileCreated = false;
    try {
      writeFileSync(historyFile, JSON.stringify(conversationHistory), 'utf-8');
      historyFileCreated = true;
    } catch (err) {
      console.error('[Insights] Failed to write history file:', err);
      throw new Error('Failed to write conversation history to temp file');
    }

    // Build command arguments
    const args = [
      runnerPath,
      '--project-dir', projectPath,
      '--message', message,
      '--history-file', historyFile
    ];

    // Add model config if provided
    if (modelConfig) {
      const modelId = MODEL_ID_MAP[modelConfig.model] || MODEL_ID_MAP['sonnet'];
      args.push('--model', modelId);
      args.push('--thinking-level', modelConfig.thinkingLevel);
    }

    // Add roadmap item ID if provided
    if (roadmapItemId) {
      args.push('--roadmap-item-id', roadmapItemId);
    }

    // Spawn Python process
    const proc = spawn(this.config.getPythonPath(), args, {
      cwd: autoBuildSource,
      env: processEnv
    });

    this.activeProcesses.set(sessionId, proc);
    this.sessionQueue.markSessionActive(sessionId, projectId);

    return new Promise((resolve, reject) => {
      let fullResponse = '';
      let suggestedTask: InsightsChatMessage['suggestedTask'] | undefined;
      const toolsUsed: InsightsToolUsage[] = [];
      let allInsightsOutput = '';
      let stderrOutput = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        // Collect output for rate limit detection (keep last 10KB)
        allInsightsOutput = (allInsightsOutput + text).slice(-10000);

        // Process output lines
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('__TASK_SUGGESTION__:')) {
            this.handleTaskSuggestion(sessionId, line, (task) => {
              suggestedTask = task;
            });
          } else if (line.startsWith('__ROADMAP_FEATURE__:')) {
            this.handleRoadmapFeature(sessionId, line);
          } else if (line.startsWith('__TOOL_START__:')) {
            this.handleToolStart(sessionId, line, toolsUsed);
          } else if (line.startsWith('__TOOL_END__:')) {
            this.handleToolEnd(sessionId, line);
          } else if (line.trim()) {
            fullResponse += line + '\n';
            this.emit('stream-chunk', sessionId, {
              type: 'text',
              content: line + '\n'
            } as InsightsStreamChunk);
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        // Collect stderr for rate limit detection and error reporting
        allInsightsOutput = (allInsightsOutput + text).slice(-10000);
        stderrOutput = (stderrOutput + text).slice(-2000);
        console.error('[Insights]', text);
      });

      proc.on('close', (code) => {
        this.activeProcesses.delete(sessionId);
        this.sessionQueue.removeActiveSession(sessionId, projectId);

        // Cleanup temp files
        if (historyFileCreated && existsSync(historyFile)) {
          try {
            unlinkSync(historyFile);
          } catch (cleanupErr) {
            console.error('[Insights] Failed to cleanup history file:', cleanupErr);
          }
        }

        // Check for rate limit if process failed
        if (code !== 0) {
          this.handleRateLimit(sessionId, allInsightsOutput);
        }

        if (code === 0) {
          this.emit('stream-chunk', sessionId, {
            type: 'done'
          } as InsightsStreamChunk);

          this.emit('status', sessionId, {
            phase: 'complete'
          } as InsightsChatStatus);

          resolve({
            fullResponse: fullResponse.trim(),
            suggestedTask,
            toolsUsed
          });
        } else {
          // Include stderr output in error message for debugging
          const stderrSummary = stderrOutput.trim()
            ? `\n\nError output:\n${stderrOutput.slice(-500)}`
            : '';
          const error = `Process exited with code ${code}${stderrSummary}`;
          this.emit('stream-chunk', sessionId, {
            type: 'error',
            error
          } as InsightsStreamChunk);

          this.emit('error', sessionId, error);
          reject(new Error(error));
        }
      });

      proc.on('error', (err) => {
        this.activeProcesses.delete(sessionId);
        this.sessionQueue.removeActiveSession(sessionId, projectId);

        // Cleanup temp files
        if (historyFileCreated && existsSync(historyFile)) {
          try {
            unlinkSync(historyFile);
          } catch (cleanupErr) {
            console.error('[Insights] Failed to cleanup history file:', cleanupErr);
          }
        }

        this.emit('error', sessionId, err.message);
        reject(err);
      });
    });
  }

  /**
   * Handle task suggestion from output
   */
  private handleTaskSuggestion(
    sessionId: string,
    line: string,
    onTaskFound: (task: InsightsChatMessage['suggestedTask']) => void
  ): void {
    try {
      const taskJson = line.substring('__TASK_SUGGESTION__:'.length);
      const suggestedTask = JSON.parse(taskJson);
      onTaskFound(suggestedTask);
      this.emit('stream-chunk', sessionId, {
        type: 'task_suggestion',
        suggestedTask
      } as InsightsStreamChunk);
    } catch {
      // Not valid JSON, treat as normal text (should not emit here as it's already handled)
    }
  }

  /**
   * Handle tool start marker
   */
  private handleToolStart(
    sessionId: string,
    line: string,
    toolsUsed: InsightsToolUsage[]
  ): void {
    try {
      const toolJson = line.substring('__TOOL_START__:'.length);
      const toolData = JSON.parse(toolJson);
      // Accumulate tool usage for persistence
      toolsUsed.push({
        name: toolData.name,
        input: toolData.input,
        timestamp: new Date()
      });
      this.emit('stream-chunk', sessionId, {
        type: 'tool_start',
        tool: {
          name: toolData.name,
          input: toolData.input
        }
      } as InsightsStreamChunk);
    } catch {
      // Ignore parse errors for tool markers
    }
  }

  /**
   * Handle tool end marker
   */
  private handleToolEnd(sessionId: string, line: string): void {
    try {
      const toolJson = line.substring('__TOOL_END__:'.length);
      const toolData = JSON.parse(toolJson);
      this.emit('stream-chunk', sessionId, {
        type: 'tool_end',
        tool: {
          name: toolData.name
        }
      } as InsightsStreamChunk);
    } catch {
      // Ignore parse errors for tool markers
    }
  }

  /**
   * Handle roadmap feature marker
   */
  private handleRoadmapFeature(sessionId: string, line: string): void {
    try {
      const featureJson = line.substring('__ROADMAP_FEATURE__:'.length);
      const featureData = JSON.parse(featureJson);
      this.emit('stream-chunk', sessionId, {
        type: 'roadmap_feature',
        roadmapFeature: {
          id: featureData.id,
          title: featureData.title,
          status: featureData.status || 'planned',
          priority: featureData.priority || 'should',
          phaseId: featureData.phaseId,
          externalUrl: featureData.externalUrl,
          action: featureData.action
        }
      } as InsightsStreamChunk);
    } catch {
      // Ignore parse errors for roadmap feature markers
    }
  }

  /**
   * Handle rate limit detection
   */
  private handleRateLimit(sessionId: string, output: string): void {
    const rateLimitDetection = detectRateLimit(output);
    if (rateLimitDetection.isRateLimited) {
      console.warn('[Insights] Rate limit detected:', {
        sessionId,
        resetTime: rateLimitDetection.resetTime,
        limitType: rateLimitDetection.limitType,
        suggestedProfile: rateLimitDetection.suggestedProfile?.name
      });

      // Use sessionId as taskId for rate limit tracking
      const rateLimitInfo = createSDKRateLimitInfo('other', rateLimitDetection, {
        taskId: sessionId
      });
      this.emit('sdk-rate-limit', sessionId, rateLimitInfo);
    }
  }
}
