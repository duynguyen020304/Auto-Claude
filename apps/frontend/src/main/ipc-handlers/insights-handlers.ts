import { ipcMain, app } from "electron";
import type { BrowserWindow } from "electron";
import path from "path";
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { debugError } from "../../shared/utils/debug-logger";
import {
  IPC_CHANNELS,
  getSpecsDir,
  AUTO_BUILD_PATHS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
} from "../../shared/constants";
import type {
  IPCResult,
  InsightsSession,
  InsightsSessionSummary,
  InsightsModelConfig,
  RoadmapItemContext,
  IdeationItemContext,
  RoadmapFeature,
  Task,
  TaskMetadata,
  AppSettings,
  ActiveSession,
} from "../../shared/types";
import { projectStore } from "../project-store";
import { insightsService } from "../insights-service";
import { safeSendToRenderer } from "./utils";

/**
 * Read insights feature settings from the settings file
 */
function getInsightsFeatureSettings(): InsightsModelConfig {
  const settingsPath = path.join(app.getPath("userData"), "settings.json");

  try {
    if (existsSync(settingsPath)) {
      const content = readFileSync(settingsPath, "utf-8");
      const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(content) };

      // Get insights-specific settings from Agent Settings
      // Use nullish coalescing at property level to handle partial settings objects
      const featureModels = settings.featureModels ?? DEFAULT_FEATURE_MODELS;
      const featureThinking = settings.featureThinking ?? DEFAULT_FEATURE_THINKING;

      return {
        profileId: "balanced", // Default profile for settings-based config
        model: featureModels.insights ?? DEFAULT_FEATURE_MODELS.insights,
        thinkingLevel: featureThinking.insights ?? DEFAULT_FEATURE_THINKING.insights,
      };
    }
  } catch (error) {
    debugError("[Insights Handler] Failed to read feature settings:", error);
  }

  // Return defaults if settings file doesn't exist or fails to parse
  return {
    profileId: "balanced", // Default profile for settings-based config
    model: DEFAULT_FEATURE_MODELS.insights,
    thinkingLevel: DEFAULT_FEATURE_THINKING.insights,
  };
}

/**
 * Register all insights-related IPC handlers
 */
export function registerInsightsHandlers(getMainWindow: () => BrowserWindow | null): void {
  // ============================================
  // Insights Operations
  // ============================================

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_GET_SESSION,
    async (_, projectId: string): Promise<IPCResult<InsightsSession | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const session = insightsService.loadSession(projectId, project.path);
      return { success: true, data: session };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_GET_ROADMAP_FEATURE,
    async (_, projectId: string, featureId: string): Promise<IPCResult<RoadmapFeature>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const roadmapPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.ROADMAP_DIR,
        AUTO_BUILD_PATHS.ROADMAP_FILE
      );

      if (!existsSync(roadmapPath)) {
        return { success: false, error: "Roadmap not found" };
      }

      try {
        const content = readFileSync(roadmapPath, "utf-8");
        const rawRoadmap = JSON.parse(content);

        // Find the feature by ID
        const rawFeature = rawRoadmap.features?.find((f: { id: string }) => f.id === featureId);
        if (!rawFeature) {
          return { success: false, error: "Feature not found" };
        }

        // Transform snake_case to camelCase for frontend
        const feature: RoadmapFeature = {
          id: rawFeature.id,
          title: rawFeature.title,
          description: rawFeature.description,
          rationale: rawFeature.rationale || "",
          priority: rawFeature.priority || "should",
          complexity: rawFeature.complexity || "medium",
          impact: rawFeature.impact || "medium",
          phaseId: rawFeature.phase_id,
          dependencies: rawFeature.dependencies || [],
          status: rawFeature.status || "under_review",
          acceptanceCriteria: rawFeature.acceptance_criteria || [],
          userStories: rawFeature.user_stories || [],
          linkedSpecId: rawFeature.linked_spec_id,
          competitorInsightIds: (rawFeature.competitor_insight_ids as string[]) || undefined,
        };

        return { success: true, data: feature };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get feature details",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_GET_IDEATION_ITEM,
    async (_, projectId: string, ideaId: string): Promise<IPCResult<IdeationItemContext>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const ideationPath = path.join(
        project.path,
        AUTO_BUILD_PATHS.IDEATION_DIR,
        AUTO_BUILD_PATHS.IDEATION_FILE
      );

      if (!existsSync(ideationPath)) {
        return { success: false, error: "Ideation not found" };
      }

      try {
        const content = readFileSync(ideationPath, "utf-8");
        const ideation = JSON.parse(content);

        // Find the idea by ID
        const rawIdea = ideation.ideas?.find((i: { id: string }) => i.id === ideaId);
        if (!rawIdea) {
          return { success: false, error: "Ideation item not found" };
        }

        // Transform to IdeationItemContext format
        const idea: IdeationItemContext = {
          ideaId: rawIdea.id,
          title: rawIdea.title,
          description: rawIdea.description,
          rationale: rawIdea.rationale || "",
          type: rawIdea.type,
          status: rawIdea.status,
          estimatedEffort: rawIdea.estimatedEffort || "medium",
          affectedFiles: rawIdea.affectedFiles || [],
          existingPatterns: rawIdea.existingPatterns || [],
          buildsUpon: rawIdea.buildsUpon || [],
          implementationApproach: rawIdea.implementationApproach,
        };

        return { success: true, data: idea };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to get ideation item details",
        };
      }
    }
  );

  ipcMain.on(
    IPC_CHANNELS.INSIGHTS_SEND_MESSAGE,
    async (
      _,
      sessionId: string,
      projectId: string,
      message: string,
      modelConfig?: InsightsModelConfig
    ) => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.INSIGHTS_ERROR,
          sessionId,
          projectId,
          "Project not found"
        );
        return;
      }

      // Get feature settings from Agent Settings and merge with provided config
      const featureSettings = getInsightsFeatureSettings();
      const configWithSettings: InsightsModelConfig = {
        // Start with feature settings as defaults
        ...featureSettings,
        // Override with any explicitly provided config
        ...modelConfig,
      };

      console.log("[Insights Handler] Using model config:", {
        sessionId,
        model: configWithSettings.model,
        thinkingLevel: configWithSettings.thinkingLevel,
      });

      // Await the async sendMessage to ensure proper error handling and
      // that all async operations (like getProcessEnv) complete before
      // the handler returns. This fixes race conditions on Windows where
      // environment setup wouldn't complete before process spawn.
      try {
        await insightsService.sendMessage(
          sessionId,
          projectId,
          project.path,
          message,
          configWithSettings
        );
      } catch (error) {
        // Errors during sendMessage (executor errors) are already emitted via
        // the 'error' event, but we catch here to prevent unhandled rejection
        // and ensure all error types are reported to the UI
        console.error("[Insights IPC] Error in sendMessage:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        safeSendToRenderer(
          getMainWindow,
          IPC_CHANNELS.INSIGHTS_ERROR,
          sessionId,
          projectId,
          `Failed to send message: ${errorMessage}`
        );
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CLEAR_SESSION,
    async (_, _sessionId: string, projectId: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      insightsService.clearSession(projectId, project.path);
      return { success: true };
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CREATE_TASK,
    async (
      _,
      projectId: string,
      title: string,
      description: string,
      metadata?: TaskMetadata
    ): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: "Auto Claude not initialized for this project" };
      }

      try {
        // Generate a unique spec ID based on existing specs
        // Get specs directory path
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specsDir = path.join(project.path, specsBaseDir);

        // Find next available spec number
        let specNumber = 1;
        if (existsSync(specsDir)) {
          const existingDirs = readdirSync(specsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          const existingNumbers = existingDirs
            .map((name) => {
              const match = name.match(/^(\d+)/);
              return match ? parseInt(match[1], 10) : 0;
            })
            .filter((n) => n > 0);

          if (existingNumbers.length > 0) {
            specNumber = Math.max(...existingNumbers) + 1;
          }
        }

        // Create spec ID with zero-padded number and slugified title
        const slugifiedTitle = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .substring(0, 50);
        const specId = `${String(specNumber).padStart(3, "0")}-${slugifiedTitle}`;

        // Create spec directory
        const specDir = path.join(specsDir, specId);
        mkdirSync(specDir, { recursive: true });

        // Build metadata with source type
        const taskMetadata: TaskMetadata = {
          sourceType: "insights",
          ...metadata,
        };

        // Create initial implementation_plan.json
        const now = new Date().toISOString();
        const implementationPlan = {
          feature: title,
          description: description,
          created_at: now,
          updated_at: now,
          status: "pending",
          phases: [],
        };

        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2), 'utf-8');

        // Save task metadata
        const metadataPath = path.join(specDir, "task_metadata.json");
        writeFileSync(metadataPath, JSON.stringify(taskMetadata, null, 2), 'utf-8');

        // Create the task object
        const task: Task = {
          id: specId,
          specId: specId,
          projectId,
          title,
          description,
          status: "backlog",
          subtasks: [],
          logs: [],
          metadata: taskMetadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return { success: true, data: task };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create task",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CREATE_SPEC_FROM_ROADMAP,
    async (
      _,
      projectId: string,
      roadmapContext: RoadmapItemContext,
      chatContext?: string // Additional context gathered from chat
    ): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: "Auto Claude not initialized for this project" };
      }

      try {
        // Generate a unique spec ID based on existing specs
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specsDir = path.join(project.path, specsBaseDir);

        // Find next available spec number
        let specNumber = 1;
        if (existsSync(specsDir)) {
          const existingDirs = readdirSync(specsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          const existingNumbers = existingDirs
            .map((name) => {
              const match = name.match(/^(\d+)/);
              return match ? parseInt(match[1], 10) : 0;
            })
            .filter((n) => n > 0);

          if (existingNumbers.length > 0) {
            specNumber = Math.max(...existingNumbers) + 1;
          }
        }

        // Create spec ID with zero-padded number and slugified title
        const slugifiedTitle = roadmapContext.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .substring(0, 50);
        const specId = `${String(specNumber).padStart(3, "0")}-${slugifiedTitle}`;

        // Create spec directory
        const specDir = path.join(specsDir, specId);
        mkdirSync(specDir, { recursive: true });

        // Build description with rationale and chat context
        const descriptionParts: string[] = [roadmapContext.description];
        if (roadmapContext.rationale) {
          descriptionParts.push(`\n\n**Rationale:**\n${roadmapContext.rationale}`);
        }
        if (chatContext) {
          descriptionParts.push(`\n\n**Additional Context from Chat:**\n${chatContext}`);
        }

        // Build metadata with source type indicating it came from roadmap exploration
        const taskMetadata: TaskMetadata = {
          sourceType: "roadmap",
          featureId: roadmapContext.featureId,
        };

        // Create initial implementation_plan.json
        const now = new Date().toISOString();
        const implementationPlan = {
          feature: roadmapContext.title,
          description: descriptionParts.join("\n"),
          created_at: now,
          updated_at: now,
          status: "pending",
          phases: [],
        };

        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2), "utf-8");

        // Create spec.md with pre-filled roadmap data
        const specContent = `# Specification: ${roadmapContext.title}

## Overview

${roadmapContext.description}

${roadmapContext.rationale ? `\n## Rationale\n\n${roadmapContext.rationale}` : ""}

${
  roadmapContext.acceptanceCriteria && roadmapContext.acceptanceCriteria.length > 0
    ? `
## Acceptance Criteria

${roadmapContext.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}
`
    : ""
}

${
  roadmapContext.dependencies && roadmapContext.dependencies.length > 0
    ? `
## Dependencies

${roadmapContext.dependencies.map((d) => `- ${d}`).join("\n")}
`
    : ""
}

${chatContext ? `\n## Additional Context\n\n${chatContext}` : ""}

## Source

Created from roadmap feature: ${roadmapContext.featureId}
Generated at: ${new Date().toISOString()}
`;

        const specPath = path.join(specDir, "spec.md");
        writeFileSync(specPath, specContent, "utf-8");

        // Save task metadata
        const metadataPath = path.join(specDir, "task_metadata.json");
        writeFileSync(metadataPath, JSON.stringify(taskMetadata, null, 2), "utf-8");

        // Create the task object
        const task: Task = {
          id: specId,
          specId: specId,
          projectId,
          title: roadmapContext.title,
          description: descriptionParts.join("\n"),
          status: "backlog",
          subtasks: [],
          logs: [],
          metadata: taskMetadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return { success: true, data: task };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create spec from roadmap",
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CREATE_SPEC_FROM_IDEATION,
    async (
      _,
      projectId: string,
      ideationContext: IdeationItemContext,
      chatContext?: string // Additional context gathered from chat
    ): Promise<IPCResult<Task>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      if (!project.autoBuildPath) {
        return { success: false, error: "Auto Claude not initialized for this project" };
      }

      try {
        // Generate a unique spec ID based on existing specs
        const specsBaseDir = getSpecsDir(project.autoBuildPath);
        const specsDir = path.join(project.path, specsBaseDir);

        // Find next available spec number
        let specNumber = 1;
        if (existsSync(specsDir)) {
          const existingDirs = readdirSync(specsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          const existingNumbers = existingDirs
            .map((name) => {
              const match = name.match(/^(\d+)/);
              return match ? parseInt(match[1], 10) : 0;
            })
            .filter((n) => n > 0);

          if (existingNumbers.length > 0) {
            specNumber = Math.max(...existingNumbers) + 1;
          }
        }

        // Create spec ID with zero-padded number and slugified title
        const slugifiedTitle = ideationContext.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .substring(0, 50);
        const specId = `${String(specNumber).padStart(3, "0")}-${slugifiedTitle}`;

        // Create spec directory
        const specDir = path.join(specsDir, specId);
        mkdirSync(specDir, { recursive: true });

        // Build description with rationale and chat context
        const descriptionParts: string[] = [ideationContext.description];
        if (ideationContext.rationale) {
          descriptionParts.push(`\n\n**Rationale:**\n${ideationContext.rationale}`);
        }
        if (chatContext) {
          descriptionParts.push(`\n\n**Additional Context from Chat:**\n${chatContext}`);
        }

        // Build metadata with source type indicating it came from ideation exploration
        const taskMetadata: TaskMetadata = {
          sourceType: "ideation",
          ideaId: ideationContext.ideaId,
        };

        // Create initial implementation_plan.json
        const now = new Date().toISOString();
        const implementationPlan = {
          feature: ideationContext.title,
          description: descriptionParts.join("\n"),
          created_at: now,
          updated_at: now,
          status: "pending",
          phases: [],
        };

        const planPath = path.join(specDir, AUTO_BUILD_PATHS.IMPLEMENTATION_PLAN);
        writeFileSync(planPath, JSON.stringify(implementationPlan, null, 2), "utf-8");

        // Create spec.md with pre-filled ideation data
        const specContent = `# Specification: ${ideationContext.title}

## Overview

${ideationContext.description}

${ideationContext.rationale ? `\n## Rationale\n\n${ideationContext.rationale}` : ""}

${ideationContext.type ? `\n## Type\n\n${ideationContext.type}` : ""}

${
  ideationContext.affectedFiles && ideationContext.affectedFiles.length > 0
    ? `
## Affected Files

${ideationContext.affectedFiles.map((f) => `- ${f}`).join("\n")}
`
    : ""
}

${
  ideationContext.existingPatterns && ideationContext.existingPatterns.length > 0
    ? `
## Existing Patterns

${ideationContext.existingPatterns.map((p) => `- ${p}`).join("\n")}
`
    : ""
}

${
  ideationContext.buildsUpon && ideationContext.buildsUpon.length > 0
    ? `
## Builds Upon

${ideationContext.buildsUpon.map((b) => `- ${b}`).join("\n")}
`
    : ""
}

${ideationContext.implementationApproach ? `\n## Implementation Approach\n\n${ideationContext.implementationApproach}` : ""}

${chatContext ? `\n## Additional Context\n\n${chatContext}` : ""}

## Source

Created from ideation item: ${ideationContext.ideaId}
Type: ${ideationContext.type}
Estimated Effort: ${ideationContext.estimatedEffort}
Generated at: ${new Date().toISOString()}
`;

        const specPath = path.join(specDir, "spec.md");
        writeFileSync(specPath, specContent, "utf-8");

        // Save task metadata
        const metadataPath = path.join(specDir, "task_metadata.json");
        writeFileSync(metadataPath, JSON.stringify(taskMetadata, null, 2), "utf-8");

        // Create the task object
        const task: Task = {
          id: specId,
          specId: specId,
          projectId,
          title: ideationContext.title,
          description: descriptionParts.join("\n"),
          status: "backlog",
          subtasks: [],
          logs: [],
          metadata: taskMetadata,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        return { success: true, data: task };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create spec from ideation",
        };
      }
    }
  );

  // List all sessions for a project
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_LIST_SESSIONS,
    async (_, projectId: string): Promise<IPCResult<InsightsSessionSummary[]>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const sessions = insightsService.listSessions(project.path);
      return { success: true, data: sessions };
    }
  );

  // Create a new session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_NEW_SESSION,
    async (_, projectId: string): Promise<IPCResult<InsightsSession>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const session = insightsService.createNewSession(projectId, project.path);
      return { success: true, data: session };
    }
  );

  // Switch to a different session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_SWITCH_SESSION,
    async (_, projectId: string, sessionId: string): Promise<IPCResult<InsightsSession | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const session = insightsService.switchSession(projectId, project.path, sessionId);
      return { success: true, data: session };
    }
  );

  // Delete a session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_DELETE_SESSION,
    async (_, projectId: string, sessionId: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const success = insightsService.deleteSession(projectId, project.path, sessionId);
      if (success) {
        return { success: true };
      }
      return { success: false, error: "Failed to delete session" };
    }
  );

  // Rename a session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_RENAME_SESSION,
    async (_, projectId: string, sessionId: string, newTitle: string): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const success = insightsService.renameSession(project.path, sessionId, newTitle);
      if (success) {
        return { success: true };
      }
      return { success: false, error: "Failed to rename session" };
    }
  );

  // Update session fields
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_UPDATE_SESSION,
    async (_, projectId: string, sessionId: string, updates: Partial<InsightsSession>): Promise<IPCResult<InsightsSession | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const success = insightsService.updateSession(project.path, sessionId, updates);
      if (success) {
        // Load and return the updated session
        const updatedSession = insightsService.loadSession(projectId, project.path);
        return { success: true, data: updatedSession };
      }
      return { success: false, error: "Failed to update session" };
    }
  );

  // Update model configuration for a session
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_UPDATE_MODEL_CONFIG,
    async (
      _,
      projectId: string,
      sessionId: string,
      modelConfig: InsightsModelConfig
    ): Promise<IPCResult> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const success = insightsService.updateSessionModelConfig(
        project.path,
        sessionId,
        modelConfig
      );
      if (success) {
        return { success: true };
      }
      return { success: false, error: "Failed to update model configuration" };
    }
  );

  // Cancel a session (works for both queued and active sessions)
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_CANCEL_SESSION,
    async (_, sessionId: string): Promise<IPCResult> => {
      const success = insightsService.cancelSession(sessionId);
      if (success) {
        return { success: true };
      }
      return { success: false, error: "Session not found or could not be cancelled" };
    }
  );

  // Get all currently active (running) sessions
  ipcMain.handle(
    IPC_CHANNELS.INSIGHTS_GET_ACTIVE_SESSIONS,
    async (): Promise<IPCResult<ActiveSession[]>> => {
      const activeSessions = insightsService.getActiveSessions();
      return { success: true, data: activeSessions };
    }
  );

  // ============================================
  // Insights Event Forwarding (Service -> Renderer)
  // ============================================

  // Forward streaming chunks to renderer (routed by sessionId, projectId)
  insightsService.on("stream-chunk", (sessionId: string, projectId: string, chunk: unknown) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.INSIGHTS_STREAM_CHUNK, sessionId, projectId, chunk);
  });

  // Forward status updates to renderer (routed by sessionId, projectId)
  insightsService.on("status", (sessionId: string, projectId: string, status: unknown) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.INSIGHTS_STATUS, sessionId, projectId, status);
  });

  // Forward errors to renderer (routed by sessionId, projectId)
  insightsService.on("error", (sessionId: string, projectId: string, error: string) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.INSIGHTS_ERROR, sessionId, projectId, error);
  });

  // Forward SDK rate limit events to renderer
  insightsService.on("sdk-rate-limit", (rateLimitInfo: unknown) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.CLAUDE_SDK_RATE_LIMIT, rateLimitInfo);
  });

  // Forward session-updated events to renderer for real-time UI updates
  insightsService.on("session-updated", (projectId: string, session: unknown) => {
    safeSendToRenderer(getMainWindow, IPC_CHANNELS.INSIGHTS_SESSION_UPDATED, projectId, session);
  });
}
