/**
 * TaskCreationWizard - Dialog for creating new tasks
 *
 * Now uses the shared TaskModalLayout for consistent styling with other task modals,
 * and TaskFormFields for the form content.
 *
 * Features unique to creation (not in TaskEditDialog):
 * - Draft persistence (auto-save to localStorage)
 * - File explorer drawer sidebar
 * - Git branch selection options
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronDown, ChevronUp, RotateCcw, FolderTree, GitBranch, Info } from 'lucide-react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Combobox } from './ui/combobox';
import { TaskModalLayout } from './task-form/TaskModalLayout';
import { TaskFormFields } from './task-form/TaskFormFields';
import { TaskFileExplorerDrawer } from './TaskFileExplorerDrawer';
import { createTask, saveDraft, loadDraft, clearDraft, isDraftEmpty } from '../stores/task-store';
import { useProjectStore } from '../stores/project-store';
import { buildBranchOptions } from '../lib/branch-utils';
import { cn } from '../lib/utils';
import type { TaskCategory, TaskPriority, TaskComplexity, TaskImpact, TaskMetadata, ImageAttachment, TaskDraft, ModelType, ThinkingLevel, ReferencedFile, GitBranchDetail } from '../../shared/types';
import type { PhaseModelConfig, PhaseThinkingConfig } from '../../shared/types/settings';
import {
  DEFAULT_AGENT_PROFILES,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING
} from '../../shared/constants';
import { useSettingsStore } from '../stores/settings-store';

interface TaskCreationWizardProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Special value for "use project default" branch
const PROJECT_DEFAULT_BRANCH = '__project_default__';

export function TaskCreationWizard({
  projectId,
  open,
  onOpenChange
}: TaskCreationWizardProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const { settings } = useSettingsStore();
  const selectedProfile = DEFAULT_AGENT_PROFILES.find(
    p => p.id === settings.selectedAgentProfile
  ) || DEFAULT_AGENT_PROFILES.find(p => p.id === 'auto')!;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClassification, setShowClassification] = useState(false);
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [showGitOptions, setShowGitOptions] = useState(false);

  // Git options state - using structured GitBranchDetail for type indicators
  const [branches, setBranches] = useState<GitBranchDetail[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string>(PROJECT_DEFAULT_BRANCH);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('');
  // Worktree isolation - default to true for safety
  const [useWorktree, setUseWorktree] = useState(true);

  // Get project path from project store
  const projects = useProjectStore((state) => state.projects);
  const projectPath = useMemo(() => {
    const project = projects.find((p) => p.id === projectId);
    return project?.path ?? null;
  }, [projects, projectId]);

  // Build branch options using shared utility - groups by local/remote with type indicators
  const branchOptions = useMemo(() => {
    return buildBranchOptions(branches, {
      t,
      includeProjectDefault: {
        value: PROJECT_DEFAULT_BRANCH,
        branchName: projectDefaultBranch,
        labelKey: projectDefaultBranch
          ? 'tasks:wizard.gitOptions.useProjectDefaultWithBranch'
          : 'tasks:wizard.gitOptions.useProjectDefault',
      },
    });
  }, [branches, projectDefaultBranch, t]);

  // Determine if the selected branch is local (for useLocalBranch flag)
  const isSelectedBranchLocal = useMemo(() => {
    if (baseBranch === PROJECT_DEFAULT_BRANCH) return false;
    const selectedGitBranchDetail = branches.find((b) => b.name === baseBranch);
    return selectedGitBranchDetail?.type === 'local';
  }, [baseBranch, branches]);

  // Classification fields
  const [category, setCategory] = useState<TaskCategory | ''>('');
  const [priority, setPriority] = useState<TaskPriority | ''>('');
  const [complexity, setComplexity] = useState<TaskComplexity | ''>('');
  const [impact, setImpact] = useState<TaskImpact | ''>('');

  // Model configuration
  const [profileId, setProfileId] = useState<string>(settings.selectedAgentProfile || 'auto');
  const [model, setModel] = useState<ModelType | ''>(selectedProfile.model);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | ''>(selectedProfile.thinkingLevel);
  const [phaseModels, setPhaseModels] = useState<PhaseModelConfig | undefined>(
    settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS
  );
  const [phaseThinking, setPhaseThinking] = useState<PhaseThinkingConfig | undefined>(
    settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING
  );

  // Images and files
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [referencedFiles, setReferencedFiles] = useState<ReferencedFile[]>([]);

  // API profile selection
  const [apiProfileId, setApiProfileId] = useState<string>('');
  const [planningApiProfileId, setPlanningApiProfileId] = useState<string>('');
  const [codingApiProfileId, setCodingApiProfileId] = useState<string>('');
  const [qaApiProfileId, setQaApiProfileId] = useState<string>('');

  // Review setting
  const [requireReviewBeforeCoding, setRequireReviewBeforeCoding] = useState(false);

  // Draft state
  const [isDraftRestored, setIsDraftRestored] = useState(false);

  // Load draft when dialog opens
  useEffect(() => {
    if (open && projectId) {
      const draft = loadDraft(projectId);
      if (draft && !isDraftEmpty(draft)) {
        setTitle(draft.title);
        setDescription(draft.description);
        setCategory(draft.category);
        setPriority(draft.priority);
        setComplexity(draft.complexity);
        setImpact(draft.impact);
        setProfileId(draft.profileId || settings.selectedAgentProfile || 'auto');
        setModel(draft.model || selectedProfile.model);
        setThinkingLevel(draft.thinkingLevel || selectedProfile.thinkingLevel);
        setPhaseModels(draft.phaseModels || settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS);
        setPhaseThinking(draft.phaseThinking || settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING);
        setApiProfileId(draft.apiProfileId || '');
        setPlanningApiProfileId(draft.planningApiProfileId || '');
        setCodingApiProfileId(draft.codingApiProfileId || '');
        setQaApiProfileId(draft.qaApiProfileId || '');
        setImages(draft.images);
        setReferencedFiles(draft.referencedFiles ?? []);
        setRequireReviewBeforeCoding(draft.requireReviewBeforeCoding ?? false);
        setIsDraftRestored(true);

        if (draft.category || draft.priority || draft.complexity || draft.impact) {
          setShowClassification(true);
        }
      } else {
        // No draft - reset to clean state for new task creation
        // This ensures no stale data from previous task creation persists
        setTitle('');
        setDescription('');
        setCategory('');
        setPriority('');
        setComplexity('');
        setImpact('');
        setProfileId(settings.selectedAgentProfile || 'auto');
        setModel(selectedProfile.model);
        setThinkingLevel(selectedProfile.thinkingLevel);
        setPhaseModels(settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS);
        setPhaseThinking(settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING);
        setApiProfileId('');
        setPlanningApiProfileId('');
        setCodingApiProfileId('');
        setQaApiProfileId('');
        setImages([]);
        setReferencedFiles([]);
        setRequireReviewBeforeCoding(false);
        setBaseBranch(PROJECT_DEFAULT_BRANCH);
        setUseWorktree(true);
        setIsDraftRestored(false);
        setShowClassification(false);
        setShowFileExplorer(false);
        setShowGitOptions(false);
      }
    }
  }, [open, projectId, settings.selectedAgentProfile, settings.customPhaseModels, settings.customPhaseThinking, selectedProfile.model, selectedProfile.thinkingLevel, selectedProfile.phaseModels, selectedProfile.phaseThinking]);

  // Fetch branches when dialog opens - using structured branch data with type indicators
  useEffect(() => {
    let isMounted = true;

    const fetchBranches = async () => {
      if (!projectPath) return;
      if (isMounted) setIsLoadingBranches(true);
      try {
        // Use structured branch data with type indicators
        const result = await window.electronAPI.getGitBranchesWithInfo(projectPath);
        if (isMounted && result.success && result.data) {
          setBranches(result.data);
        }
      } catch (err) {
        console.error('Failed to fetch branches:', err);
      } finally {
        if (isMounted) setIsLoadingBranches(false);
      }
    };

    const fetchProjectDefaultBranch = async () => {
      if (!projectId) return;
      try {
        const result = await window.electronAPI.getProjectEnv(projectId);
        if (isMounted && result.success && result.data?.defaultBranch) {
          setProjectDefaultBranch(result.data.defaultBranch);
        } else if (projectPath) {
          const detectResult = await window.electronAPI.detectMainBranch(projectPath);
          if (isMounted && detectResult.success && detectResult.data) {
            setProjectDefaultBranch(detectResult.data);
          }
        }
      } catch (err) {
        console.error('Failed to fetch project default branch:', err);
      }
    };

    if (open && projectPath) {
      fetchBranches();
      fetchProjectDefaultBranch();
    }

    return () => {
      isMounted = false;
    };
  }, [open, projectPath, projectId]);

  /**
   * Get current form state as a draft
   */
  const getCurrentDraft = useCallback((): TaskDraft => ({
    projectId,
    title,
    description,
    category,
    priority,
    complexity,
    impact,
    profileId,
    model,
    thinkingLevel,
    phaseModels,
    phaseThinking,
    apiProfileId,
    planningApiProfileId,
    codingApiProfileId,
    qaApiProfileId,
    images,
    referencedFiles,
    requireReviewBeforeCoding,
    savedAt: new Date()
  }), [projectId, title, description, category, priority, complexity, impact, profileId, model, thinkingLevel, phaseModels, phaseThinking, apiProfileId, planningApiProfileId, codingApiProfileId, qaApiProfileId, images, referencedFiles, requireReviewBeforeCoding]);

  /**
   * Handle description change
   */
  const handleDescriptionChange = (newValue: string) => {
    setDescription(newValue);
  };

  const handleCreate = async () => {
    if (!description.trim()) {
      setError(t('tasks:form.errors.descriptionRequired'));
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const metadata: TaskMetadata = { sourceType: 'manual' };
      if (category) metadata.category = category;
      if (priority) metadata.priority = priority;
      if (complexity) metadata.complexity = complexity;
      if (impact) metadata.impact = impact;
      if (model) metadata.model = model;
      if (thinkingLevel) metadata.thinkingLevel = thinkingLevel;
      if (phaseModels && phaseThinking) {
        metadata.isAutoProfile = profileId === 'auto';
        metadata.phaseModels = phaseModels;
        metadata.phaseThinking = phaseThinking;
      }
      if (apiProfileId) metadata.apiProfileId = apiProfileId;
      if (planningApiProfileId) metadata.planningApiProfileId = planningApiProfileId;
      if (codingApiProfileId) metadata.codingApiProfileId = codingApiProfileId;
      if (qaApiProfileId) metadata.qaApiProfileId = qaApiProfileId;
      if (images.length > 0) metadata.attachedImages = images;
      if (referencedFiles.length > 0) metadata.referencedFiles = referencedFiles;
      if (requireReviewBeforeCoding) metadata.requireReviewBeforeCoding = true;
      // Always include baseBranch - resolve PROJECT_DEFAULT_BRANCH to actual branch name
      // This ensures the backend always knows which branch to use for worktree creation
      if (baseBranch === PROJECT_DEFAULT_BRANCH) {
        // Use the resolved project default branch
        if (projectDefaultBranch) metadata.baseBranch = projectDefaultBranch;
      } else if (baseBranch) {
        metadata.baseBranch = baseBranch;
      }
      // Pass worktree preference - false means use --direct mode
      if (!useWorktree) metadata.useWorktree = false;
      // Set useLocalBranch when user explicitly selects a local branch
      // This preserves gitignored files (.env, configs) by not switching to origin
      if (isSelectedBranchLocal) metadata.useLocalBranch = true;

      const task = await createTask(projectId, title.trim(), description.trim(), metadata);
      if (task) {
        clearDraft(projectId);
        resetForm();
        onOpenChange(false);
      } else {
        setError(t('tasks:wizard.errors.createFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:errors.unknownError'));
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('');
    setPriority('');
    setComplexity('');
    setImpact('');
    setProfileId(settings.selectedAgentProfile || 'auto');
    setModel(selectedProfile.model);
    setThinkingLevel(selectedProfile.thinkingLevel);
    setPhaseModels(settings.customPhaseModels || selectedProfile.phaseModels || DEFAULT_PHASE_MODELS);
    setPhaseThinking(settings.customPhaseThinking || selectedProfile.phaseThinking || DEFAULT_PHASE_THINKING);
    setApiProfileId('');
    setPlanningApiProfileId('');
    setCodingApiProfileId('');
    setQaApiProfileId('');
    setImages([]);
    setReferencedFiles([]);
    setRequireReviewBeforeCoding(false);
    setBaseBranch(PROJECT_DEFAULT_BRANCH);
    setUseWorktree(true);
    setError(null);
    setShowClassification(false);
    setShowFileExplorer(false);
    setShowGitOptions(false);
    setIsDraftRestored(false);
  };

  const handleClose = () => {
    if (isCreating) return;

    const draft = getCurrentDraft();
    if (!isDraftEmpty(draft)) {
      saveDraft(draft);
    } else {
      clearDraft(projectId);
    }

    resetForm();
    onOpenChange(false);
  };

  const handleDiscardDraft = () => {
    clearDraft(projectId);
    resetForm();
    setError(null);
  };

  return (
    <TaskModalLayout
      open={open}
      onOpenChange={handleClose}
      title={t('tasks:wizard.createTitle')}
      description={t('tasks:wizard.createDescription')}
      disabled={isCreating}
      sidebar={
        projectPath && (
          <TaskFileExplorerDrawer
            isOpen={showFileExplorer}
            onClose={() => setShowFileExplorer(false)}
            projectPath={projectPath}
          />
        )
      }
      sidebarOpen={showFileExplorer}
      footer={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Draft restored indicator */}
            {isDraftRestored && (
              <div className="flex items-center gap-2">
                <span className="text-xs bg-info/10 text-info px-2 py-1 rounded-md">
                  {t('tasks:wizard.draftRestored')}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleDiscardDraft}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {t('tasks:wizard.startFresh')}
                </Button>
              </div>
            )}

            {/* File Explorer Toggle */}
            {projectPath && (
              <Button
                type="button"
                variant={showFileExplorer ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowFileExplorer(!showFileExplorer)}
                disabled={isCreating}
                className="gap-1.5"
              >
                <FolderTree className="h-4 w-4" />
                {showFileExplorer ? t('tasks:wizard.hideFiles') : t('tasks:wizard.browseFiles')}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleClose} disabled={isCreating}>
              {t('common:buttons.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={isCreating || !description.trim()}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('tasks:wizard.creating')}
                </>
              ) : (
                t('tasks:wizard.createTask')
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Worktree isolation info banner */}
        <div className="flex items-start gap-3 p-4 bg-info/10 border border-info/30 rounded-lg">
          <Info className="h-5 w-5 text-info flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-foreground mb-1">
              {t('tasks:wizard.worktreeNotice.title')}
            </h4>
            <p className="text-sm text-muted-foreground">
              {t('tasks:wizard.worktreeNotice.description')}
            </p>
          </div>
        </div>

        {/* Main form fields */}
        <TaskFormFields
          description={description}
          onDescriptionChange={handleDescriptionChange}
          descriptionPlaceholder={t('tasks:wizard.descriptionPlaceholder')}
          title={title}
          onTitleChange={setTitle}
          profileId={profileId}
          model={model}
          thinkingLevel={thinkingLevel}
          phaseModels={phaseModels}
          phaseThinking={phaseThinking}
          onProfileChange={(newProfileId, newModel, newThinkingLevel) => {
            setProfileId(newProfileId);
            setModel(newModel);
            setThinkingLevel(newThinkingLevel);
          }}
          onModelChange={setModel}
          onThinkingLevelChange={setThinkingLevel}
          onPhaseModelsChange={setPhaseModels}
          onPhaseThinkingChange={setPhaseThinking}
          planningApiProfileId={planningApiProfileId}
          onPlanningApiProfileChange={setPlanningApiProfileId}
          codingApiProfileId={codingApiProfileId}
          onCodingApiProfileChange={setCodingApiProfileId}
          qaApiProfileId={qaApiProfileId}
          onQaApiProfileChange={setQaApiProfileId}
          category={category}
          priority={priority}
          complexity={complexity}
          impact={impact}
          onCategoryChange={setCategory}
          onPriorityChange={setPriority}
          onComplexityChange={setComplexity}
          onImpactChange={setImpact}
          showClassification={showClassification}
          onShowClassificationChange={setShowClassification}
          images={images}
          onImagesChange={setImages}
          requireReviewBeforeCoding={requireReviewBeforeCoding}
          onRequireReviewChange={setRequireReviewBeforeCoding}
          disabled={isCreating}
          error={error}
          onError={setError}
          idPrefix="create"
        />

        {/* Git Options Toggle - unique to creation */}
        <button
          type="button"
          onClick={() => setShowGitOptions(!showGitOptions)}
          className={cn(
            'flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors',
            'w-full justify-between py-2 px-3 rounded-md hover:bg-muted/50'
          )}
          disabled={isCreating}
          aria-expanded={showGitOptions}
          aria-controls="git-options-section"
        >
          <span className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            {t('tasks:wizard.gitOptions.title')}
            {baseBranch && baseBranch !== PROJECT_DEFAULT_BRANCH && (
              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {baseBranch}
              </span>
            )}
          </span>
          {showGitOptions ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {/* Git Options */}
        {showGitOptions && (
          <div id="git-options-section" className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="space-y-2">
              <Label htmlFor="base-branch" className="text-sm font-medium text-foreground">
                {t('tasks:wizard.gitOptions.baseBranchLabel')}
              </Label>
              <Combobox
                id="base-branch"
                value={baseBranch}
                onValueChange={setBaseBranch}
                options={branchOptions}
                placeholder={projectDefaultBranch
                  ? t('tasks:wizard.gitOptions.useProjectDefaultWithBranch', { branch: projectDefaultBranch })
                  : t('tasks:wizard.gitOptions.useProjectDefault')
                }
                searchPlaceholder={t('tasks:wizard.gitOptions.searchBranches')}
                emptyMessage={t('tasks:wizard.gitOptions.noBranchesFound')}
                disabled={isCreating || isLoadingBranches}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                {t('tasks:wizard.gitOptions.helpText')}
              </p>
            </div>
          </div>
        )}
      </div>
    </TaskModalLayout>
  );
}
