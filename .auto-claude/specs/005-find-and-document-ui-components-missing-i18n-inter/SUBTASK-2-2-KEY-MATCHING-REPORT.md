# Translation Key Matching Report
**Generated:** 2026-01-23
**Subtask:** 2.2 - Match hardcoded strings to existing translation keys
**Purpose:** Identify which hardcoded strings can reuse existing translation keys to avoid duplicates

---

## Executive Summary

This report cross-references the 200+ hardcoded strings found in Phase 1 with the 2,500+ existing translation keys documented in Phase 2.1. The goal is to maximize reuse of existing translation keys and minimize duplication.

**Key Findings:**
- **Total Hardcoded Strings:** 200+
- **Can Reuse Existing Keys:** ~80 (40%)
- **Need New Translation Keys:** ~120 (60%)
- **Duplicate Avoidance Savings:** 80 fewer new keys needed

---

## Part 1: Hardcoded Strings That Can Reuse Existing Keys

### Category 1: Common Buttons (HIGH Priority - 25+ strings)

These hardcoded button labels can reuse keys from `common:buttons.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "Cancel" | `common:buttons.cancel` | common.json (line ~30) | 25+ files |
| "Delete" | `common:buttons.delete` | common.json (line ~31) | 20+ files |
| "Save" | `common:buttons.save` | common.json (line ~29) | 15+ files |
| "Close" | `common:buttons.close` | common.json (line ~50) | 12+ files |
| "Confirm" | `common:buttons.confirm` | common.json (line ~33) | 10+ files |
| "Create" | `common:buttons.create` | common.json (line ~35) | 8+ files |
| "Retry" | `common:buttons.retry` | common.json (line ~38) | 5+ files |
| "Refresh" | `common:buttons.refresh` | common.json (line ~39) | 5+ files |
| "Back" | `common:buttons.back` | common.json (line ~49) | 3+ files |
| "Next" | `common:buttons.next` | common.json (line ~51) | 3+ files |
| "Skip" | `common:buttons.skip` | common.json (line ~52) | 2+ files |
| "Continue" | `common:buttons.continue` | common.json (line ~53) | 5+ files |

**Implementation:** Replace all hardcoded button text with `t('common:buttons.{action}')` calls.

---

### Category 2: Common Labels (HIGH Priority - 20+ strings)

These labels can reuse keys from `common:labels.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "Loading" | `common:labels.loading` | common.json (line ~70) | 10+ files |
| "Error" | `common:labels.error` | common.json (line ~71) | 15+ files |
| "Success" | `common:labels.success` | common.json (line ~72) | 8+ files |
| "Optional" | `common:labels.optional` | common.json (line ~73) | 10+ files |
| "Required" | `common:labels.required` | common.json (line ~74) | 12+ files |
| "Description" | `common:labels.description` | **NEW KEY NEEDED** | 5+ files |
| "Repository" | `common:labels.repository` | **NEW KEY NEEDED** | 8+ files |
| "Open" | `common:labels.open` | **NEW KEY NEEDED** | 5+ files |
| "Closed" | `common:labels.closed` | **NEW KEY NEEDED** | 5+ files |
| "All" | `common:labels.all` | **NEW KEY NEEDED** | 8+ files |

**Note:** Some common labels don't exist yet and should be added to `common:labels.*` for reuse.

---

### Category 3: Accessibility Labels (MEDIUM Priority - 15+ strings)

These aria-labels can reuse keys from `common:accessibility.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "Edit" | `common:accessibility.editAriaLabel` | common.json (line ~120) | AgentTools.tsx |
| "Delete" | `common:accessibility.deleteAriaLabel` | common.json (line ~121) | AgentTools.tsx |
| "Refresh" | `common:accessibility.refreshAriaLabel` | common.json (line ~125) | TaskFileExplorerDrawer.tsx |
| "Close" | `common:accessibility.closeAriaLabel` | common.json (line ~126) | TaskFileExplorerDrawer.tsx |

**Implementation:** Use `t('common:accessibility.{action}AriaLabel')` for accessibility labels.

---

### Category 4: Navigation Items (HIGH Priority - 5+ strings)

These navigation labels can reuse keys from `navigation:items.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "Insights" | `navigation:items.insights` | navigation.json (line ~20) | Insights.tsx |
| "Kanban" | `navigation:items.kanban` | navigation.json (line ~15) | roadmap/RoadmapTabs.tsx |
| "GitHub PRs" | `navigation:items.githubPRs` | navigation.json (line ~25) | Various |

**Implementation:** Use `t('navigation:items.{itemName}')` for navigation elements.

---

### Category 5: Task Status Labels (HIGH Priority - 10+ strings)

These status labels can reuse keys from `tasks:status.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "Backlog" | `tasks:status.backlog` | tasks.json (line ~20) | Kanban board |
| "Queue" | `tasks:status.queue` | tasks.json (line ~21) | Kanban board |
| "In Progress" | `tasks:status.inProgress` | tasks.json (line ~22) | Kanban board |
| "Completed" | `tasks:status.completed` | tasks.json (line ~23) | Kanban board |
| "Needs Review" | `tasks:status.needsReview` | tasks.json (line ~24) | Kanban board |

**Implementation:** Use `t('tasks:status.{statusName}')` for task status indicators.

---

### Category 6: Task Actions (HIGH Priority - 15+ strings)

These action labels can reuse keys from `tasks:actions.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "Start" | `tasks:actions.start` | tasks.json (line ~40) | Task cards |
| "Stop" | `tasks:actions.stop` | tasks.json (line ~41) | Task cards |
| "Recover" | `tasks:actions.recover` | tasks.json (line ~42) | Task cards |
| "Delete" | `tasks:actions.delete` | tasks.json (line ~43) | Task cards |
| "Edit" | `tasks:actions.edit` | tasks.json (line ~44) | Task cards |

**Implementation:** Use `t('tasks:actions.{actionName}')` for task action buttons.

---

### Category 7: Settings Sections (MEDIUM Priority - 8+ strings)

These settings labels can reuse keys from `settings:sections.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "General" | `settings:sections.general` | settings.json (line ~20) | project-settings |
| "Theme" | `settings:sections.theme` | settings.json (line ~25) | project-settings |
| "Memory" | `settings:sections.memory` | settings.json (line ~30) | project-settings |
| "Security" | `settings:sections.security` | settings.json (line ~35) | project-settings |

**Implementation:** Use `t('settings:sections.{sectionName}')` for settings section headers.

---

### Category 8: Time Formatting (MEDIUM Priority - 3+ strings)

These time labels can reuse keys from `common:time.*`:

| Hardcoded String | Existing Key | Key Location | Files Affected |
|------------------|--------------|--------------|----------------|
| "Just now" | `common:time.justNow` | common.json (line ~200) | ChatHistorySidebar.tsx |
| "Xm ago" | `common:time.minutesAgo` | common.json (line ~201) | ChatHistorySidebar.tsx |
| "Xh ago" | `common:time.hoursAgo` | common.json (line ~202) | ChatHistorySidebar.tsx |

**Implementation:** Use `t('common:time.{timeUnit}')` for relative time display.

---

## Part 2: Hardcoded Strings That Need New Translation Keys

### Category 1: Feature-Specific Buttons (HIGH Priority - 15+ strings)

These buttons don't have existing common keys and need new keys:

| Hardcoded String | Suggested Key | Namespace | Files Affected |
|------------------|---------------|-----------|----------------|
| "Test" | `agentTools:buttons.test` | NEW NAMESPACE | AgentTools.tsx |
| "Generate" | `ideation:buttons.generate` | ideation.json | IdeationDialogs.tsx |
| "Apply" | `changelog:buttons.apply` | changelog.json | ChangelogFilters.tsx |
| "Create Pool" | `credentialProfiles:buttons.createPool` | credentialProfiles.json | PoolFormDialog.tsx |
| "Create Profile" | `credentialProfiles:buttons.createProfile` | credentialProfiles.json | ProfileFormDialog.tsx |
| "Add Workspace" | `workspace:buttons.addWorkspace` | workspace.json | AddWorkspaceModal.tsx |
| "Create Issue" | `githubIssues:buttons.createIssue` | githubIssues.json | IssueListHeader.tsx |
| "Create MR" | `gitlabMR:buttons.createMR` | gitlabMR.json | CreateMergeRequestDialog.tsx |

**Recommendation:** Create new translation files for feature-specific namespaces.

---

### Category 2: Form Labels (HIGH Priority - 30+ strings)

These labels need new keys (many should be added to `common:labels.*`):

| Hardcoded String | Suggested Key | Namespace | Rationale |
|------------------|---------------|-----------|-----------|
| "Owner" | `common:labels.owner` | common.json | Reusable across GitHub/GitLab |
| "Visibility" | `common:labels.visibility` | common.json | Reusable for repo settings |
| "Format" | `common:labels.format` | common.json | Reusable for changelog/config |
| "Audience" | `common:labels.audience` | common.json | Reusable for changelog |
| "Emojis" | `common:labels.emojis` | common.json | Reusable for changelog |
| "Team" | `common:labels.team` | common.json | Reusable for Linear/integrations |
| "Sound" | `common:labels.sound` | common.json | Reusable for settings |
| "Projects" | `common:labels.projects` | common.json | Reusable for workspace |
| "Assignees" | `common:labels.assignees` | common.json | Reusable for issues/MRs |
| "Milestone" | `common:labels.milestone` | common.json | Reusable for issues/MRs |
| "Changes" | `common:labels.changes` | common.json | Reusable for git operations |

**Recommendation:** Add these common labels to `common:labels.*` for maximum reuse.

---

### Category 3: Placeholder Text (MEDIUM Priority - 20+ strings)

These placeholders need new keys:

| Hardcoded String | Suggested Key | Namespace |
|------------------|---------------|-----------|
| "Enter your token..." | `dialogs:envConfig.enterTokenPlaceholder` | dialogs.json |
| "Select a branch" | `dialogs:githubSetup.selectBranchPlaceholder` | dialogs.json |
| "Ask about your codebase..." | `insights:searchPlaceholder` | insights.json |
| "Select tag..." | `changelog:selectTagPlaceholder` | changelog.json |
| "Search issues..." | `githubIssues:searchPlaceholder` | githubIssues.json |
| "Search merge requests..." | `gitlabMR:searchPlaceholder` | gitlabMR.json |
| "Search tasks..." | `linear:searchTasksPlaceholder` | linear.json |
| "My App Workspace" | `workspace:workspaceNamePlaceholder` | workspace.json |
| "Backend, frontend, and mobile apps for My App" | `workspace:workspaceDescriptionPlaceholder` | workspace.json |

**Recommendation:** Placeholders use `*Placeholder` suffix convention.

---

### Category 4: Dialog Titles (HIGH Priority - 25+ strings)

These dialog titles need new keys:

| Hardcoded String | Suggested Key | Namespace |
|------------------|---------------|-----------|
| "Ideation Configuration" | `dialogs:ideation.configuration` | dialogs.json |
| "Add More Ideas" | `dialogs:ideation.addMoreIdeas` | dialogs.json |
| "Delete conversation?" | `dialogs:chatHistory.deleteConversation` | dialogs.json |
| "Delete Worktree?" | `dialogs:worktrees.deleteWorktree` | dialogs.json |
| "Delete Terminal Worktree?" | `dialogs:worktrees.deleteTerminalWorktree` | dialogs.json |
| "Environment Variables" | `dialogs:envConfig.title` | dialogs.json |
| "GitHub Setup" | `dialogs:githubSetup.title` | dialogs.json |
| "Add Workspace" | `dialogs:workspace.addWorkspace` | dialogs.json |

**Recommendation:** Dialog titles follow `dialogs:feature.action` pattern.

---

### Category 5: Error Messages (HIGH Priority - 15+ strings)

These error messages need new keys:

| Hardcoded String | Suggested Key | Namespace |
|------------------|---------------|-----------|
| "Failed to detect repository" | `errors:github.failedToDetectRepo` | errors.json |
| "Failed to load branches" | `errors:github.failedToLoadBranches` | errors.json |
| "Please enter a repository name" | `errors:github.enterRepoName` | errors.json |
| "Please select an owner for the repository" | `errors:github.selectOwner` | errors.json |
| "Failed to save profile" | `errors:credentialProfiles.saveFailed` | errors.json |
| "Failed to create workspace" | `errors:workspace.createFailed` | errors.json |

**Recommendation:** Error messages follow `errors:feature.errorType` pattern.

---

### Category 6: Confirmation Messages (HIGH Priority - 10+ strings)

These confirmation messages need new keys:

| Hardcoded String | Suggested Key | Namespace |
|------------------|---------------|-----------|
| "This will permanently delete this conversation..." | `insights:chatHistory.deleteWarning` | insights.json |
| "This will permanently delete this worktree..." | `worktrees:deleteWarning` | worktrees.json |
| "This will permanently delete this terminal worktree..." | `worktrees:deleteTerminalWarning` | worktrees.json |

**Recommendation:** Use `*Warning` or `*Description` suffix for confirmation messages.

---

### Category 7: Empty State Messages (MEDIUM Priority - 8+ strings)

These empty state messages need new keys:

| Hardcoded String | Suggested Key | Namespace |
|------------------|---------------|-----------|
| "No conversations yet" | `insights:chatHistory.noConversations` | insights.json |
| "No issues found" | `githubIssues:noIssuesFound` | githubIssues.json |
| "No merge requests found" | `gitlabMR:noMergeRequestsFound` | gitlabMR.json |
| "No memories found" | `context:memories.noMemoriesFound` | context.json |

**Recommendation:** Empty states follow `feature:noItemsFound` pattern.

---

### Category 8: Tab Labels (HIGH Priority - 12+ strings)

These tab labels need new keys:

| Hardcoded String | Suggested Key | Namespace |
|------------------|---------------|-----------|
| "Profiles" | `credentialProfiles:tabs.profiles` | credentialProfiles.json |
| "Pools" | `credentialProfiles:tabs.pools` | credentialProfiles.json |
| "Kanban" | `roadmap:tabs.kanban` | roadmap.json |
| "Phases" | `roadmap:tabs.phases` | roadmap.json |
| "Overview" | `context:projectIndex.overview` | context.json |
| "Services" | `context:projectIndex.services` | context.json |

**Recommendation:** Tab labels follow `feature:tabs.tabName` pattern.

---

### Category 9: Content Labels (HIGH Priority - 20+ strings)

These content labels need new keys:

| Hardcoded String | Suggested Key | Namespace |
|------------------|---------------|-----------|
| "Total" | `context:memories.total` | context.json |
| "Sessions" | `context:memories.sessions` | context.json |
| "Codebase" | `context:memories.codebase` | context.json |
| "Patterns" | `context:memories.patterns` | context.json |
| "Gotchas" | `context:memories.gotchas` | context.json |
| "Databases" | `context:services.databases` | context.json |
| "Email" | `context:services.email` | context.json |
| "Payments" | `context:services.payments` | context.json |
| "Cache" | `context:services.cache` | context.json |

**Recommendation:** Content labels organize information displays under feature namespaces.

---

## Part 3: New Translation Files Needed

Based on the analysis, these new translation files should be created:

### 1. **credentialProfiles.json** (NEW)
```json
{
  "tabs": {
    "profiles": "Profiles",
    "pools": "Pools"
  },
  "buttons": {
    "createPool": "Create Pool",
    "createProfile": "Create Profile"
  },
  "dialogs": {
    "createPool": "Create Credential Pool",
    "createProfile": "Create Credential Profile"
  },
  "selection": {
    "manual": "Manual",
    "oauth": "OAuth"
  }
}
```

### 2. **context.json** (NEW)
```json
{
  "memories": {
    "searchPlaceholder": "Search for patterns, insights, gotchas...",
    "total": "Total",
    "sessions": "Sessions",
    "codebase": "Codebase",
    "patterns": "Patterns",
    "gotchas": "Gotchas",
    "source": "Source",
    "patternType": "Pattern Type",
    "noMemoriesFound": "No memories found"
  },
  "services": {
    "databases": "Databases",
    "email": "Email",
    "payments": "Payments",
    "cache": "Cache"
  },
  "projectIndex": {
    "overview": "Overview",
    "services": "Services"
  }
}
```

### 3. **workspace.json** (NEW)
```json
{
  "buttons": {
    "addWorkspace": "Add Workspace"
  },
  "dialogs": {
    "addWorkspace": "Add Workspace"
  },
  "workspaceNamePlaceholder": "My App Workspace",
  "workspaceDescriptionPlaceholder": "Backend, frontend, and mobile apps for My App"
}
```

### 4. **githubIssues.json** (NEW)
```json
{
  "buttons": {
    "createIssue": "Create Issue"
  },
  "searchPlaceholder": "Search issues...",
  "noIssuesFound": "No issues found"
}
```

### 5. **gitlabMR.json** (NEW)
```json
{
  "buttons": {
    "createMR": "Create MR"
  },
  "searchPlaceholder": "Search merge requests...",
  "titlePlaceholder": "Merge request title",
  "descriptionPlaceholder": "Describe the changes in this merge request...",
  "noMergeRequestsFound": "No merge requests found"
}
```

### 6. **changelog.json** (EXTEND)
```json
{
  "buttons": {
    "apply": "Apply"
  },
  "selectTagPlaceholder": "Select tag...",
  "headLatest": "HEAD (latest)",
  "aiInstructionsPlaceholder": "Add any special instructions for the AI...",
  "format": {
    "allCommits": "All commits",
    "byTag": "By tag"
  }
}
```

---

## Part 4: Keys to Add to Existing Translation Files

### common.json (EXTEND)
Add these new common labels for maximum reuse:

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
    "repository": "Repository",
    "projects": "Projects",
    "description": "Description",
    "assignees": "Assignees",
    "milestone": "Milestone",
    "open": "Open",
    "closed": "Closed",
    "all": "All",
    "overview": "Overview",
    "changes": "Changes",
    "labels": "Labels"
  },
  "time": {
    "today": "Today",
    "yesterday": "Yesterday",
    "daysAgo": "{{days}} days ago"
  }
}
```

### dialogs.json (EXTEND)
Add these new dialog titles:

```json
{
  "ideation": {
    "configuration": "Ideation Configuration",
    "addMoreIdeas": "Add More Ideas"
  },
  "chatHistory": {
    "deleteConversation": "Delete conversation?"
  },
  "worktrees": {
    "deleteWorktree": "Delete Worktree?",
    "deleteTerminalWorktree": "Delete Terminal Worktree?"
  },
  "envConfig": {
    "title": "Environment Variables",
    "enterTokenPlaceholder": "Enter your token..."
  },
  "githubSetup": {
    "title": "GitHub Setup",
    "selectBranchPlaceholder": "Select a branch"
  },
  "credentialProfiles": {
    "createPool": "Create Credential Pool",
    "createProfile": "Create Credential Profile"
  },
  "workspace": {
    "addWorkspace": "Add Workspace"
  }
}
```

### errors.json (EXTEND)
Add these new error messages:

```json
{
  "github": {
    "failedToDetectRepo": "Failed to detect repository",
    "failedToLoadBranches": "Failed to load branches",
    "enterRepoName": "Please enter a repository name",
    "selectOwner": "Please select an owner for the repository"
  },
  "credentialProfiles": {
    "saveFailed": "Failed to save profile"
  },
  "workspace": {
    "createFailed": "Failed to create workspace"
  }
}
```

### insights.json (EXTEND)
Add these new keys:

```json
{
  "chatHistory": {
    "title": "Chat History",
    "noConversations": "No conversations yet",
    "deleteWarning": "This will permanently delete this conversation and all its messages. This action cannot be undone.",
    "accessibility": {
      "hideSidebar": "Hide sidebar",
      "showSidebar": "Show sidebar",
      "cancelSession": "Cancel this session"
    }
  },
  "searchPlaceholder": "Ask about your codebase..."
}
```

---

## Part 5: Implementation Priority for Key Matching

### Phase 1: Reuse Existing Keys (Quick Wins)
**Timeline:** Week 1
**Impact:** 80+ hardcoded strings fixed immediately

1. Replace all common button text with `common:buttons.*` (25+ strings)
2. Replace all common labels with `common:labels.*` (20+ strings)
3. Replace accessibility labels with `common:accessibility.*` (10+ strings)
4. Replace navigation items with `navigation:items.*` (5+ strings)
5. Replace task status/actions with `tasks:status.*` and `tasks:actions.*` (20+ strings)

**Quick Wins Summary:** These changes require NO new translation keys, just code replacement.

### Phase 2: Add Common Keys to common.json
**Timeline:** Week 1-2
**Impact:** Enables reuse for 30+ strings

1. Add 20+ new common labels to `common:labels.*`
2. Add 3 time labels to `common:time.*`
3. Update French translations (`fr/common.json`)

**Benefits:** These keys will be reused across multiple features, preventing future duplication.

### Phase 3: Create Feature-Specific Namespaces
**Timeline:** Week 2-3
**Impact:** Covers remaining 120+ strings

1. Create `credentialProfiles.json` (15+ keys)
2. Create `context.json` (20+ keys)
3. Create `workspace.json` (5+ keys)
4. Create `githubIssues.json` (5+ keys)
5. Create `gitlabMR.json` (8+ keys)
6. Extend `changelog.json` (8+ keys)
7. Extend `dialogs.json` (25+ keys)
8. Extend `errors.json` (8+ keys)
9. Extend `insights.json` (10+ keys)

---

## Part 6: Duplicate Avoidance Strategy

### Principle: Maximize Key Reuse

**1. Check existing keys before creating new ones**
- Always search the 12 existing namespaces first
- If a semantically equivalent key exists, reuse it
- Only create new keys when no existing key matches

**2. Add generic keys to common.json**
- Any label/button used across 3+ features should go in common.json
- Examples: "Description", "Repository", "All", "Open", "Closed"

**3. Feature-specific keys go to feature namespaces**
- Single-feature content stays in that feature's namespace
- Examples: "Ideation Configuration", "Create Credential Pool"

**4. Use consistent naming patterns**
- Buttons: `namespace:buttons.actionName`
- Labels: `namespace:labels.labelName`
- Placeholders: `namespace:context.placeholderName`
- Errors: `errors:feature.errorType`

---

## Part 7: Verification Checklist

Before implementing i18n for hardcoded strings:

- [ ] Search all 12 existing namespaces for matching keys
- [ ] If match found, use existing key (DON'T create duplicate)
- [ ] If no match, check if key should go in common.json (for reuse)
- [ ] Only create feature-specific key if truly unique to one feature
- [ ] Follow naming conventions: `namespace:section.key` with camelCase
- [ ] Add key to BOTH en/*.json AND fr/*.json files
- [ ] Test with language switching to verify translation works

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| **Total Hardcoded Strings** | 200+ |
| **Can Reuse Existing Keys** | 80 (40%) |
| **Need New Keys in common.json** | 30 (15%) |
| **Need New Feature Namespaces** | 90 (45%) |
| **New Translation Files Needed** | 5 |
| **Existing Files to Extend** | 4 |
| **Total New Translation Keys** | ~120 |

---

## Recommendations

1. **Start with Phase 1 (Quick Wins)** - Fix 80+ strings immediately by reusing existing keys
2. **Add common labels next** - Prevent future duplication by adding 30+ common keys
3. **Create feature namespaces** - Cover remaining strings with new translation files
4. **Follow naming conventions** - Maintain consistency across all new keys
5. **Update both languages** - Always add keys to both en/*.json AND fr/*.json

---

**Report End**
