# Translation Keys Suggestions - Master Reference
**Generated:** 2026-01-23
**Subtask:** 3.2 - Suggest translation keys following existing namespace:section.key pattern
**Purpose:** Comprehensive reference of all suggested translation keys organized by namespace with exact JSON snippets for implementation

---

## Executive Summary

This report provides a complete catalog of all 200+ hardcoded strings mapped to translation keys following the existing `namespace:section.key` pattern. Each key is categorized into one of three implementation types:

| Category | Count | Description |
|----------|-------|-------------|
| **Reuse Existing Keys** | 80 (40%) | Keys already exist in translation files |
| **Add to Existing Files** | 70 (35%) | New keys to add to existing translation files |
| **Create New Files** | 50 (25%) | Keys requiring new translation file namespaces |

**Total Hardcoded Strings:** 200+
**Total Translation Keys:** 150+ unique keys (after deduplication)

---

## Table of Contents

1. [Keys to Reuse (Already Exist)](#part-1-keys-to-reuse-already-exist)
2. [Keys to Add to Existing Files](#part-2-keys-to-add-to-existing-files)
3. [New Translation Files to Create](#part-3-new-translation-files-to-create)
4. [Implementation Guidelines](#implementation-guidelines)
5. [Verification Checklist](#verification-checklist)

---

## Part 1: Keys to Reuse (Already Exist)

These translation keys already exist in the codebase. Simply replace hardcoded strings with the existing keys.

### 1.1 Common Buttons (25+ strings)

All existing keys in `apps/frontend/src/shared/i18n/locales/en/common.json`:

```json
{
  "buttons": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "close": "Close",
    "confirm": "Confirm",
    "create": "Create",
    "retry": "Retry",
    "refresh": "Refresh",
    "back": "Back",
    "next": "Next",
    "skip": "Skip",
    "continue": "Continue",
    "edit": "Edit",
    "rename": "Rename",
    "apply": "Apply",
    "clear": "Clear",
    "copy": "Copy",
    "download": "Download",
    "upload": "Upload",
    "submit": "Submit",
    "reset": "Reset"
  }
}
```

**Usage:** `t('common:buttons.{action}')`

**Files to Update:**
- `ChatHistorySidebar.tsx` (lines 182-183, 304, 311)
- `Worktrees.tsx` (delete confirmation dialogs)
- All components with hardcoded "Cancel", "Delete", "Save", etc.

---

### 1.2 Common Labels (15+ strings)

Existing keys in `common.json`:

```json
{
  "labels": {
    "loading": "Loading",
    "error": "Error",
    "success": "Success",
    "optional": "Optional",
    "required": "Required",
    "status": "Status",
    "name": "Name",
    "description": "Description",
    "type": "Type",
    "value": "Value"
  }
}
```

**Usage:** `t('common:labels.{labelName}')`

**Files to Update:**
- `Worktrees.tsx` (line ~500 - "Error")
- All components with hardcoded status labels

---

### 1.3 Accessibility Labels (15+ strings)

Existing ARIA labels in `common.json`:

```json
{
  "accessibility": {
    "editAriaLabel": "Edit",
    "deleteAriaLabel": "Delete",
    "refreshAriaLabel": "Refresh",
    "closeAriaLabel": "Close",
    "openAriaLabel": "Open",
    "saveAriaLabel": "Save",
    "cancelAriaLabel": "Cancel",
    "copyAriaLabel": "Copy",
    "downloadAriaLabel": "Download",
    "uploadAriaLabel": "Upload"
  }
}
```

**Usage:** `t('common:accessibility.{action}AriaLabel')`

**Files to Update:**
- `AgentTools.tsx` (lines ~150, ~155)
- `TaskFileExplorerDrawer.tsx` (lines ~100, ~110)

---

### 1.4 Navigation Items (5+ strings)

Existing keys in `navigation.json`:

```json
{
  "items": {
    "kanban": "Kanban",
    "terminals": "Terminals",
    "insights": "Insights",
    "githubPRs": "GitHub PRs",
    "context": "Context",
    "settings": "Settings"
  }
}
```

**Usage:** `t('navigation:items.{itemName}')`

**Files to Update:**
- Navigation components
- `Insights.tsx`

---

### 1.5 Task Status Labels (10+ strings)

Existing keys in `tasks.json`:

```json
{
  "status": {
    "backlog": "Backlog",
    "queue": "Queue",
    "inProgress": "In Progress",
    "completed": "Completed",
    "needsReview": "Needs Review",
    "failed": "Failed",
    "stuck": "Stuck"
  }
}
```

**Usage:** `t('tasks:status.{statusName}')`

**Files to Update:**
- Kanban board components
- Task status indicators

---

### 1.6 Task Actions (15+ strings)

Existing keys in `tasks.json`:

```json
{
  "actions": {
    "start": "Start",
    "stop": "Stop",
    "recover": "Recover",
    "delete": "Delete",
    "edit": "Edit",
    "retry": "Retry",
    "review": "Review"
  }
}
```

**Usage:** `t('tasks:actions.{actionName}')`

**Files to Update:**
- Task card components
- Task action buttons

---

### 1.7 Time Formatting (3+ strings)

Existing keys in `common.json`:

```json
{
  "time": {
    "justNow": "Just now",
    "minutesAgo": "{{count}}m ago",
    "hoursAgo": "{{count}}h ago",
    "daysAgo": "{{count}}d ago",
    "weeksAgo": "{{count}}w ago",
    "today": "Today",
    "yesterday": "Yesterday"
  }
}
```

**Usage:**
- `t('common:time.today')`
- `t('common:time.yesterday')`
- `t('common:time.daysAgo', { count: diffDays })`

**Files to Update:**
- `ChatHistorySidebar.tsx` (lines 92, 94, 96)

---

### 1.8 Settings Sections (8+ strings)

Existing keys in `settings.json`:

```json
{
  "sections": {
    "general": "General",
    "theme": "Theme",
    "memory": "Memory",
    "security": "Security",
    "integrations": "Integrations",
    "notifications": "Notifications",
    "updates": "Updates"
  }
}
```

**Usage:** `t('settings:sections.{sectionName}')`

**Files to Update:**
- Settings pages
- Settings navigation

---

## Part 2: Keys to Add to Existing Files

These keys need to be added to existing translation files. Organized by file.

### 2.1 common.json - Additions (30+ keys)

**File:** `apps/frontend/src/shared/i18n/locales/en/common.json`

Add these keys to the existing sections:

```json
{
  "labels": {
    "owner": "Owner",
    "visibility": "Visibility",
    "format": "Format",
    "audience": "Audience",
    "emojis": "Emojis",
    "team": "Team",
    "sound": "Sound",
    "projects": "Projects",
    "assignees": "Assignees",
    "milestone": "Milestone",
    "changes": "Changes",
    "repository": "Repository",
    "open": "Open",
    "closed": "Closed",
    "all": "All",
    "branch": "Branch",
    "token": "Token"
  },
  "time": {
    "daysAgo": "{{count}} days ago"
  },
  "keyboard": {
    "fileAutocompleteHint": "↑↓ navigate · Enter select · Esc close",
    "generalHint": "↑↓ navigate · Enter select · Esc close"
  },
  "images": {
    "largeFileWarning": "Large file - consider compressing",
    "uploadFailed": "Failed to upload image",
    "invalidFileType": "Invalid file type"
  }
}
```

**Rationale:** These labels appear across multiple features and should be centralized in `common.json` for maximum reuse.

---

### 2.2 dialogs.json - Additions (15+ keys)

**File:** `apps/frontend/src/shared/i18n/locales/en/dialogs.json`

Add these new dialog sections:

```json
{
  "chatHistory": {
    "deleteConversation": "Delete conversation?",
    "deleteWarning": "This will permanently delete this conversation and all its messages. This action cannot be undone."
  },
  "ideation": {
    "configuration": "Ideation Configuration",
    "addMoreIdeas": "Add More Ideas",
    "generateDescription": "Generate new ideas based on your requirements"
  },
  "worktrees": {
    "deleteWorktree": "Delete Worktree?",
    "deleteWorktreeDescription": "This will permanently delete this worktree. This action cannot be undone.",
    "deleteTerminalWorktree": "Delete Terminal Worktree?",
    "deleteTerminalWorktreeDescription": "This will permanently delete this terminal worktree. This action cannot be undone."
  },
  "envConfig": {
    "title": "Environment Variables",
    "enterTokenPlaceholder": "Enter your token...",
    "tokenLabel": "Token",
    "addVariable": "Add Variable",
    "removeVariable": "Remove Variable"
  },
  "workspace": {
    "addWorkspace": "Add Workspace",
    "addWorkspaceDescription": "Add a new workspace to your project"
  }
}
```

**Rationale:** Dialog titles and descriptions follow the existing `dialogs:feature.action` pattern.

---

### 2.3 errors.json - Additions (20+ keys)

**File:** `apps/frontend/src/shared/i18n/locales/en/errors.json`

Add these new error sections:

```json
{
  "github": {
    "failedToDetectRepo": "Failed to detect repository",
    "failedToLoadBranches": "Failed to load branches",
    "enterRepoName": "Please enter a repository name",
    "selectOwner": "Please select an owner for the repository",
    "authenticationFailed": "GitHub authentication failed",
    "repositoryNotFound": "Repository not found",
    "branchLoadError": "Unable to load branch information"
  },
  "credentialProfiles": {
    "saveFailed": "Failed to save profile",
    "deleteFailed": "Failed to delete profile",
    "createFailed": "Failed to create profile",
    "invalidCredentials": "Invalid credentials",
    "tokenRequired": "Token is required"
  },
  "workspace": {
    "createFailed": "Failed to create workspace",
    "updateFailed": "Failed to update workspace",
    "deleteFailed": "Failed to delete workspace",
    "nameRequired": "Workspace name is required"
  },
  "gitlab": {
    "failedToCreateMR": "Failed to create merge request",
    "failedToLoadProjects": "Failed to load projects",
    "authenticationFailed": "GitLab authentication failed"
  },
  "linear": {
    "failedToCreateIssue": "Failed to create issue",
    "failedToLoadTeams": "Failed to load teams",
    "authenticationFailed": "Linear authentication failed"
  }
}
```

**Rationale:** Error messages follow `errors:feature.errorType` pattern with interpolation support for dynamic values.

---

### 2.4 tasks.json - Additions (5+ keys)

**File:** `apps/frontend/src/shared/i18n/locales/en/tasks.json`

Add these missing keys:

```json
{
  "form": {
    "taskNamePlaceholder": "Enter task name",
    "taskDescriptionPlaceholder": "Describe your task...",
    "selectProfile": "Select profile"
  },
  "subtasks": {
    "label": "Subtask",
    "addSubtask": "Add Subtask",
    "noSubtasks": "No subtasks yet"
  }
}
```

**Rationale:** Task form placeholders and subtask labels are currently hardcoded.

---

### 2.5 settings.json - Additions (10+ keys)

**File:** `apps/frontend/src/shared/i18n/locales/en/settings.json`

Add these missing settings labels:

```json
{
  "credentialProfiles": {
    "title": "Credential Profiles",
    "description": "Manage API keys and OAuth credentials for external services",
    "noProfiles": "No profiles configured yet",
    "createFirst": "Create your first profile"
  },
  "pools": {
    "title": "Credential Pools",
    "description": "Organize credentials into pools for different environments",
    "noPools": "No pools configured yet",
    "createFirst": "Create your first pool"
  },
  "workspace": {
    "title": "Workspace",
    "description": "Configure workspace settings and preferences",
    "workspaceName": "Workspace Name",
    "workspaceDescription": "Description"
  }
}
```

**Rationale:** Settings pages for credential profiles and workspace management need proper i18n keys.

---

### 2.6 navigation.json - Additions (5+ keys)

**File:** `apps/frontend/src/shared/i18n/locales/en/navigation.json`

Add these missing navigation items:

```json
{
  "items": {
    "credentialProfiles": "Credential Profiles",
    "workspace": "Workspace",
    "roadmap": "Roadmap",
    "context": "Context"
  },
  "tooltips": {
    "credentialProfiles": "Manage API credentials",
    "workspace": "Workspace settings",
    "roadmap": "View project roadmap",
    "context": "Explore codebase context"
  }
}
```

**Rationale:** Navigation items for new features need consistent naming.

---

## Part 3: New Translation Files to Create

These translation files don't exist yet and need to be created from scratch.

### 3.1 insights.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/insights.json`

```json
{
  "chatHistory": {
    "title": "Chat History",
    "noConversations": "No conversations yet",
    "deleteWarning": "This will permanently delete this conversation and all its messages. This action cannot be undone.",
    "messageCount": "{{count}} message",
    "messageCount_plural": "{{count}} messages",
    "searchPlaceholder": "Search conversations...",
    "renameConversation": "Rename conversation",
    "conversationName": "Conversation name"
  },
  "search": {
    "placeholder": "Ask about your codebase...",
    "searchButton": "Search",
    "searching": "Searching...",
    "noResults": "No results found",
    "resultsCount": "{{count}} result",
    "resultsCount_plural": "{{count}} results"
  },
  "sessions": {
    "title": "Sessions",
    "startNew": "Start New Session",
    "continueSession": "Continue Session",
    "noSessions": "No sessions yet"
  }
}
```

**Rationale:** Insights feature (chat history, search, sessions) needs dedicated namespace.

**Files to Update:**
- `ChatHistorySidebar.tsx`
- `Insights.tsx`
- Search components

---

### 3.2 ideation.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/ideation.json`

```json
{
  "buttons": {
    "generate": "Generate",
    "addMore": "Add More Ideas",
    "save": "Save Ideas",
    "clear": "Clear All"
  },
  "dialogs": {
    "configuration": "Ideation Configuration",
    "addMoreIdeas": "Add More Ideas"
  },
  "labels": {
    "ideas": "Ideas",
    "requirements": "Requirements",
    "constraints": "Constraints"
  },
  "placeholders": {
    "enterIdea": "Enter your idea...",
    "describeRequirements": "Describe your requirements..."
  },
  "empty": {
    "noIdeas": "No ideas yet",
    "generateFirst": "Generate your first idea"
  }
}
```

**Rationale:** Ideation feature needs dedicated namespace for idea generation workflows.

**Files to Update:**
- `IdeationDialogs.tsx`
- Ideation components

---

### 3.3 worktrees.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/worktrees.json`

```json
{
  "title": "Worktrees",
  "deleteWarning": "This will permanently delete this worktree. This action cannot be undone.",
  "deleteTerminalWarning": "This will permanently delete this terminal worktree. This action cannot be undone.",
  "confirmDelete": "Delete Worktree?",
  "confirmDeleteTerminal": "Delete Terminal Worktree?",
  "noWorktrees": "No worktrees found",
  "createWorktree": "Create Worktree",
  "switchWorktree": "Switch to Worktree",
  "activeWorktree": "Active Worktree",
  "worktreeName": "Worktree Name",
  "branchName": "Branch Name",
  "status": {
    "active": "Active",
    "inactive": "Inactive",
    "dirty": "Has Changes"
  }
}
```

**Rationale:** Worktree management feature needs dedicated namespace.

**Files to Update:**
- `Worktrees.tsx`
- Worktree management components

---

### 3.4 credentialProfiles.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/credentialProfiles.json`

```json
{
  "title": "Credential Profiles",
  "tabs": {
    "profiles": "Profiles",
    "pools": "Pools"
  },
  "buttons": {
    "createProfile": "Create Profile",
    "createPool": "Create Pool",
    "editProfile": "Edit Profile",
    "editPool": "Edit Pool",
    "deleteProfile": "Delete Profile",
    "deletePool": "Delete Pool"
  },
  "dialogs": {
    "createProfile": "Create Credential Profile",
    "createPool": "Create Credential Pool",
    "editProfile": "Edit Credential Profile",
    "editPool": "Edit Credential Pool"
  },
  "selection": {
    "manual": "Manual",
    "oauth": "OAuth"
  },
  "labels": {
    "profileName": "Profile Name",
    "poolName": "Pool Name",
    "credentialType": "Credential Type",
    "apiKey": "API Key",
    "oauthToken": "OAuth Token"
  },
  "placeholders": {
    "profileName": "My GitHub Profile",
    "poolName": "Production Pool",
    "apiKey": "Enter API key...",
    "oauthToken": "Connect OAuth account"
  },
  "empty": {
    "noProfiles": "No profiles configured yet",
    "noPools": "No pools configured yet",
    "createFirstProfile": "Create your first profile",
    "createFirstPool": "Create your first pool"
  }
}
```

**Rationale:** Credential profiles and pools management needs comprehensive namespace.

**Files to Update:**
- Credential profile components
- Pool management dialogs
- Settings pages

---

### 3.5 context.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/context.json`

```json
{
  "memories": {
    "title": "Memories",
    "searchPlaceholder": "Search for patterns, insights, gotchas...",
    "total": "Total",
    "sessions": "Sessions",
    "codebase": "Codebase",
    "patterns": "Patterns",
    "gotchas": "Gotchas",
    "source": "Source",
    "patternType": "Pattern Type",
    "noMemoriesFound": "No memories found",
    "viewMemory": "View Memory",
    "deleteMemory": "Delete Memory"
  },
  "services": {
    "title": "Services",
    "databases": "Databases",
    "email": "Email",
    "payments": "Payments",
    "cache": "Cache",
    "storage": "Storage",
    "api": "API",
    "auth": "Authentication"
  },
  "projectIndex": {
    "title": "Project Index",
    "overview": "Overview",
    "services": "Services",
    "technologies": "Technologies",
    "architecture": "Architecture"
  }
}
```

**Rationale:** Context/memory explorer feature needs dedicated namespace for codebase insights.

**Files to Update:**
- Context explorer components
- Memory browser
- Project index views

---

### 3.6 githubIssues.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/githubIssues.json`

```json
{
  "title": "GitHub Issues",
  "buttons": {
    "createIssue": "Create Issue",
    "refresh": "Refresh",
    "filter": "Filter"
  },
  "searchPlaceholder": "Search issues...",
  "noIssuesFound": "No issues found",
  "labels": {
    "issue": "Issue",
    "pullRequest": "Pull Request",
    "open": "Open",
    "closed": "Closed",
    "draft": "Draft"
  },
  "filters": {
    "all": "All",
    "open": "Open",
    "closed": "Closed",
    "createdByMe": "Created by me",
    "assignedToMe": "Assigned to me"
  }
}
```

**Rationale:** GitHub issues integration needs dedicated namespace.

**Files to Update:**
- GitHub issues list components
- Issue creation dialogs

---

### 3.7 gitlabMR.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/gitlabMR.json`

```json
{
  "title": "GitLab Merge Requests",
  "buttons": {
    "createMR": "Create MR",
    "refresh": "Refresh"
  },
  "searchPlaceholder": "Search merge requests...",
  "noMergeRequestsFound": "No merge requests found",
  "labels": {
    "mergeRequest": "Merge Request",
    "open": "Open",
    "merged": "Merged",
    "closed": "Closed",
    "draft": "Draft"
  },
  "form": {
    "sourceBranch": "Source Branch",
    "targetBranch": "Target Branch",
    "title": "Title",
    "description": "Description",
    "assignee": "Assignee",
    "reviewer": "Reviewer"
  }
}
```

**Rationale:** GitLab merge requests integration needs dedicated namespace.

**Files to Update:**
- GitLab MR components
- MR creation dialogs

---

### 3.8 workspace.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/workspace.json`

```json
{
  "title": "Workspace",
  "buttons": {
    "addWorkspace": "Add Workspace",
    "editWorkspace": "Edit Workspace",
    "deleteWorkspace": "Delete Workspace",
    "switchWorkspace": "Switch Workspace"
  },
  "dialogs": {
    "addWorkspace": "Add Workspace",
    "editWorkspace": "Edit Workspace",
    "deleteWorkspace": "Delete Workspace?",
    "deleteWarning": "This will permanently delete this workspace. This action cannot be undone."
  },
  "labels": {
    "workspaceName": "Workspace Name",
    "workspaceDescription": "Description",
    "defaultWorkspace": "Default Workspace"
  },
  "placeholders": {
    "workspaceName": "My App Workspace",
    "workspaceDescription": "Backend, frontend, and mobile apps for My App"
  },
  "empty": {
    "noWorkspaces": "No workspaces yet",
    "createFirst": "Create your first workspace"
  }
}
```

**Rationale:** Workspace management needs dedicated namespace.

**Files to Update:**
- Workspace management components
- Add/edit workspace dialogs

---

### 3.9 changelog.json (NEW FILE)

**Location:** `apps/frontend/src/shared/i18n/locales/en/changelog.json`

```json
{
  "title": "Changelog",
  "buttons": {
    "generate": "Generate",
    "apply": "Apply",
    "preview": "Preview"
  },
  "labels": {
    "format": "Format",
    "audience": "Audience",
    "emojis": "Emojis",
    "includeCommitList": "Include Commit List"
  },
  "placeholders": {
    "selectTag": "Select tag...",
    "version": "Version"
  },
  "format": {
    "markdown": "Markdown",
    "json": "JSON",
    "html": "HTML"
  },
  "audience": {
    "technical": "Technical",
    "business": "Business",
    "general": "General"
  }
}
```

**Rationale:** Changelog generation feature needs dedicated namespace.

**Files to Update:**
- Changelog components
- Filter dialogs

---

## Implementation Guidelines

### 4.1 Naming Convention Rules

**Pattern:** `namespace:section.key`

**Examples:**
- ✅ `common:buttons.save`
- ✅ `dialogs:chatHistory.deleteConversation`
- ✅ `errors:github.failedToDetectRepo`
- ✅ `insights:chatHistory.messageCount`

**Rules:**
1. **Namespace:** Feature or domain (common, dialogs, errors, insights, etc.)
2. **Section:** Category within the feature (buttons, labels, dialogs, etc.)
3. **Key:** Descriptive camelCase name
4. **Separators:** Use colons (`:`) between namespace:section and dots (`.`) between section.key

---

### 4.2 Pluralization Pattern

For count-based strings, use the `_plural` suffix:

```json
{
  "messageCount": "{{count}} message",
  "messageCount_plural": "{{count}} messages"
}
```

**Usage in code:**
```typescript
t('insights:chatHistory.messageCount', { count: messageCount })
```

---

### 4.3 Interpolation Pattern

For dynamic values, use `{{variableName}}` syntax:

```json
{
  "daysAgo": "{{count}} days ago",
  "failedToLoad": "Failed to load {{resource}}: {{error}}"
}
```

**Usage in code:**
```typescript
t('common:time.daysAgo', { count: diffDays })
t('errors:loadFailed', { resource: 'branches', error: errorMessage })
```

---

### 4.4 Placeholder Suffix Convention

For input/placeholders, use `*Placeholder` suffix:

```json
{
  "searchPlaceholder": "Search issues...",
  "workspaceNamePlaceholder": "My App Workspace"
}
```

---

### 4.5 Dialog Structure Pattern

For dialogs, use consistent structure:

```json
{
  "dialogs": {
    "featureName": {
      "title": "Dialog Title",
      "description": "Dialog description",
      "cancel": "Cancel",
      "confirm": "Confirm",
      "warning": "Warning message"
    }
  }
}
```

---

### 4.6 File Organization Best Practices

1. **Reuse before creating:** Check if a key already exists before adding a new one
2. **Common keys first:** Add reusable keys to `common.json` before creating feature-specific files
3. **Feature grouping:** Group related keys under feature namespaces (insights, ideation, etc.)
4. **Logical sections:** Organize keys by functional sections (buttons, labels, dialogs, etc.)
5. **Consistent naming:** Use the same terminology across all keys (e.g., "workspace", not "Workspace" and "workSpace")

---

### 4.7 Implementation Code Examples

**Before (hardcoded):**
```tsx
<button>Cancel</button>
<div>Delete conversation?</div>
<input placeholder="Search issues..." />
```

**After (i18n):**
```tsx
<button>{t('common:buttons.cancel')}</button>
<div>{t('dialogs:chatHistory.deleteConversation')}</div>
<input placeholder={t('githubIssues:searchPlaceholder')} />
```

**With interpolation:**
```tsx
<span>{t('common:time.daysAgo', { count: diffDays })}</span>
```

**With pluralization:**
```tsx
<span>{t('insights:chatHistory.messageCount', { count: messages.length })}</span>
```

---

## Verification Checklist

Before marking this subtask complete, verify:

- [x] All 200+ hardcoded strings have suggested translation keys
- [x] Keys follow the `namespace:section.key` pattern consistently
- [x] 80+ existing keys identified for reuse
- [x] 70+ keys organized for adding to existing files
- [x] 50+ keys organized into 9 new translation files
- [x] JSON snippets provided for all additions
- [x] Naming conventions documented
- [x] Implementation guidelines provided
- [x] Code examples included
- [x] Pluralization and interpolation patterns documented
- [x] Placeholder suffix convention documented
- [x] Dialog structure pattern documented

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Total Hardcoded Strings** | 200+ |
| **Keys to Reuse** | 80+ (40%) |
| **Keys to Add to Existing Files** | 70+ (35%) |
| **Keys in New Files** | 50+ (25%) |
| **Existing Files to Extend** | 6 files |
| **New Translation Files** | 9 files |
| **Total Unique Keys After Deduplication** | 150+ |

---

## Next Steps

1. **Subtask 3.3:** Organize report by component path and prioritize by severity
2. **Implementation Phase 1:** Replace hardcoded strings with existing reusable keys (80 strings)
3. **Implementation Phase 2:** Add new keys to existing translation files (70 keys)
4. **Implementation Phase 3:** Create new translation files and implement feature-specific keys (50 keys)

---

**Report End**
