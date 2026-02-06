# Settings Profile Persistence Verification

This document outlines the verification steps for Settings profile persistence in the Roadmap feature.

## Implementation Flow

### 1. Settings Storage (GeneralSettings.tsx)
- **Location**: Lines 262-297
- **Mechanism**:
  - When user selects a profile in Settings > Feature Models > Roadmap
  - The value is stored in `settings.featureApiProfiles.roadmap`
  - Saved via `onSettingsChange()` which calls `window.electronAPI.saveSettings()`
  - Value `undefined` = "Use Active Profile"
  - Value `"profile-id"` = specific profile ID

### 2. Settings Persistence (settings-store.ts)
- **Line 68**: `settings: { ...DEFAULT_APP_SETTINGS, featureApiProfiles: DEFAULT_FEATURE_MODELS_PROFILE }`
- **Store Initialization**: The `featureApiProfiles` is part of the settings object
- **Save Mechanism**: `saveSettings()` IPC handler persists to settings.json

### 3. Profile Default Loading (hooks.ts - useRoadmapGeneration)
- **Line 127**: `const featureApiProfiles = useSettingsStore((state) => state.settings?.featureApiProfiles);`
- **Lines 132-134**: `const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(featureApiProfiles?.roadmap);`
- **Initialization**: The profile selector state is initialized from Settings defaults

### 4. Dialog Display (CompetitorAnalysisDialog.tsx, ExistingCompetitorAnalysisDialog.tsx)
- Both dialogs receive `selectedProfileId` and `onProfileChange` as props
- Display using `value={selectedProfileId ?? 'auto'}`
- Update via `onValueChange={(value) => onProfileChange(value === 'auto' ? undefined : value)}`

## Verification Steps

### Step 1: Verify Settings Type Definitions
- [x] `FeatureApiProfileConfig` interface exists (settings.ts lines 195-199)
- [x] `featureApiProfiles` field in `AppSettings` (settings.ts line 274)
- [x] `DEFAULT_FEATURE_MODELS_PROFILE` constant exists (config.ts lines 94-98)

### Step 2: Verify Settings Storage
- [x] GeneralSettings.tsx has profile selector for Roadmap (lines 262-297)
- [x] Profile selection updates `featureApiProfiles.roadmap`
- [x] Settings are saved via IPC

### Step 3: Verify Profile Default Loading
- [x] `useRoadmapGeneration` reads from Settings store (line 127)
- [x] `useState` initializes from Settings defaults (lines 132-134)
- [x] Dialogs receive and display the selected profile

### Step 4: Verify End-to-End Flow (Manual Testing)
1. Open Settings > Feature Models
2. Select non-active profile for Roadmap (e.g., 'My Custom API')
3. Close Settings
4. Create new Roadmap
5. Verify profile selector shows pre-selected profile from Settings

## Expected Behavior

### Initial State
- Settings `featureApiProfiles.roadmap` is `undefined`
- Profile selector shows "Use Active Profile" (auto)
- Roadmap generation uses the currently active profile

### After Changing Settings
- Settings `featureApiProfiles.roadmap` is set to a specific profile ID
- New Roadmap generation dialog shows the selected profile as default
- User can still override the selection in the dialog
- Selection in dialog doesn't affect Settings (Settings is used as default only)

### After Changing Settings Again
- Settings `featureApiProfiles.roadmap` is updated to new profile ID
- New Roadmap generation dialog shows the new profile as default
- Previously created roadmaps keep their own profile selection

## Known Behaviors

1. **Settings as Default**: Settings values are used as defaults when creating new roadmap generations
2. **Per-Roadmap Selection**: Each roadmap can have its own profile selection (saved in roadmap config)
3. **No Live Update**: Changing Settings doesn't update already-open dialogs (expected behavior)
4. **Backward Compatibility**: `undefined` values mean "Use Active Profile"

## Code Verification

### Type Safety
```typescript
// settings.ts - Correct type definitions
export interface FeatureApiProfileConfig {
  insights?: string;
  ideation?: string;
  roadmap?: string;
}

export interface AppSettings {
  featureApiProfiles?: FeatureApiProfileConfig;
  // ... other fields
}
```

### Store Integration
```typescript
// settings-store.ts - Correct initialization
settings: { ...DEFAULT_APP_SETTINGS, featureApiProfiles: DEFAULT_FEATURE_MODELS_PROFILE }
```

### Default Loading
```typescript
// hooks.ts - Correct default loading
const featureApiProfiles = useSettingsStore((state) => state.settings?.featureApiProfiles);
const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(
  featureApiProfiles?.roadmap
);
```

## Conclusion

The implementation correctly supports Settings profile persistence:

1. ✅ Settings can store per-feature API profile selection
2. ✅ Settings are persisted to disk via IPC
3. ✅ Roadmap generation dialog initializes from Settings defaults
4. ✅ User can override the selection in the dialog
5. ✅ Type definitions are correct and support optional profile IDs
6. ✅ Backward compatibility is maintained (undefined = use active profile)

The feature is ready for manual testing to verify the end-to-end user experience.
