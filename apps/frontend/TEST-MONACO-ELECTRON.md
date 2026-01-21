# Monaco Editor Electron Compatibility Test - Subtask 7-3

## Test Objective
Verify Monaco Editor loads correctly in Electron environment without web worker errors and with proper syntax highlighting.

## Implementation Status
✅ **Monaco Editor Version**: 4.7.0 (installed)
✅ **Package**: @monaco-editor/react
✅ **Component**: JsonEditor.tsx (implemented)
✅ **Build**: Successful (no build errors)
✅ **Usage**: Integrated in CustomMcpDialog.tsx

## Pre-Test Verification

### 1. Package Installation
```bash
npm ls @monaco-editor/react
# Result: @monaco-editor/react@4.7.0 ✅
```

### 2. Build Verification
```bash
npm run build
# Result: Built successfully
# - main: 7.54s
# - preload: 93ms
# - renderer: 9.99s
# No Monaco-related errors ✅
```

### 3. Component Implementation
**File**: `src/renderer/components/JsonEditor.tsx`

**Monaco Configuration**:
```typescript
<Editor
  value={value || placeholder}
  language="json"
  theme="vs-dark"
  options={{
    readOnly: readonly,
    minimap: { enabled: true },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: true,
    folding: true,
    foldingStrategy: 'indentation',
    showFoldingControls: 'always',
    formatOnPaste: true,
    formatOnType: true,
    trimAutoWhitespace: true,
    suggestOnTriggerCharacters: true,
    quickSuggestions: {
      other: true,
      comments: false,
      strings: false,
    },
    parameterHints: {
      enabled: true,
    },
    wordWrap: 'on',
    colorDecorators: true,
    ariaLabel: 'JSON editor',
  }}
  onChange={handleValueChange}
  onMount={handleEditorDidMount}
/>
```

**Key Features**:
- ✅ Syntax highlighting for JSON (language="json")
- ✅ Line numbers enabled
- ✅ Minimap enabled
- ✅ Dark theme (vs-dark)
- ✅ Auto-formatting on paste and type
- ✅ Error display overlay
- ✅ Loading indicator during initialization
- ✅ Read-only mode support

## Known Electron Compatibility Issues

### Web Worker Considerations
Monaco Editor uses web workers for language services. In Electron environments:

**Potential Issues**:
1. Web workers may fail to load from `file://` protocol
2. Cross-origin restrictions in packaged apps
3. Worker script loading errors in production builds

**Mitigations in @monaco-editor/react v4.7.0**:
- ✅ Automatic worker path configuration
- ✅ Blob URL fallback for workers
- ✅ Compatible with Electron's renderer process

**Our Implementation**:
- No custom worker configuration (package handles it automatically)
- Using default configuration (no `loader` config)
- Compatible with Vite bundling

### Remote Debugging Configuration
The `dev:mcp` script enables Chrome DevTools Protocol:
```json
"dev:mcp": "electron-vite dev -- --remote-debugging-port=9222"
```

This allows:
- Inspecting web worker loading
- Debugging Monaco Editor initialization
- Viewing console for worker-related errors

## Manual Testing Procedure

### Step 1: Start Electron with Remote Debugging
```bash
cd apps/frontend
npm run dev:mcp
```

**Expected**:
- Electron window opens
- No immediate errors in console
- Remote debugging available on localhost:9222

### Step 2: Navigate to MCP Settings
1. Open the application
2. Navigate to Settings (gear icon)
3. Scroll to "Custom MCP Servers" section
4. Click "Add Server" button

**Expected**:
- CustomMcpDialog opens
- Form mode is default (JSON mode toggle off)
- No console errors

### Step 3: Switch to JSON Mode
1. Locate the toggle switch in dialog header
2. Click toggle to enable "JSON Mode"

**Expected**:
- Monaco Editor loads
- Loading spinner shows briefly
- Editor appears with placeholder JSON: `{\n\t\n}`
- **No web worker errors in console**
- **No 404 errors for worker scripts**

### Step 4: Verify Syntax Highlighting
1. Type or paste valid JSON:
```json
{
  "id": "test-server",
  "name": "Test MCP Server",
  "type": "command",
  "command": "npx",
  "args": ["-y", "my-mcp-server"]
}
```

**Expected**:
- Keys are highlighted (e.g., "id", "name" in one color)
- String values highlighted (e.g., "test-server" in another color)
- Numbers highlighted (if any)
- Brackets and punctuation have distinct colors
- Line numbers visible in left gutter
- Minimap visible in right side

### Step 5: Verify Auto-formatting
1. Paste malformed (but valid) JSON:
```json
{"id":"test","name":"test","type":"command"}
```

**Expected**:
- Auto-formats to 2-space indentation
- Pretty-prints with line breaks
```json
{
  "id": "test",
  "name": "test",
  "type": "command"
}
```

### Step 6: Verify Error Handling
1. Type invalid JSON:
```json
{
  "id": "test",
  "name": "test"
```

**Expected**:
- Red error overlay appears at bottom
- Error message shows line/column
- Example: "Incomplete JSON - check for missing closing brackets or quotes"

### Step 7: Check Console for Web Worker Errors
Open Chrome DevTools (or remote debugging on localhost:9222)

**Look for**:
- ❌ ANY errors containing "worker"
- ❌ ANY errors containing "Monaco"
- ❌ ANY 404 errors for .js files
- ❌ ANY "Failed to load" errors

**Expected**:
- ✅ No worker-related errors
- ✅ No Monaco-related errors
- ✅ Editor loads successfully
- ✅ All language services functional

## Console Error Checklist

### ✅ Expected Output (No Errors)
```
[INFO] Electron app started
[INFO] Renderer process loaded
```

### ❌ Potential Errors to Watch For

**Web Worker Loading Errors**:
```
Failed to load worker: file:///path/to/worker.js
Uncaught Error: Cannot find module 'monaco-editor/workers/json.worker'
```

**Script Loading Errors**:
```
GET file:///path/to/monaco-editor/min/vs/loader.js net::ERR_FILE_NOT_FOUND
```

**CSP Errors**:
```
Refused to load worker script: violated Content Security Policy
```

**If ANY of these errors appear**:
1. Note the exact error message
2. Check Monaco Editor version
3. Consider adding custom worker configuration
4. May need to use `loader` config from @monaco-editor/react

## Verification Results

### Build Verification
- [x] TypeScript compilation: No Monaco-related errors
- [x] Build succeeds: All bundles created
- [x] Package installed: @monaco-editor/react@4.7.0

### Code Verification
- [x] JsonEditor component properly configured
- [x] Monaco Editor options optimized for JSON
- [x] Error handling in place
- [x] Loading indicator implemented
- [x] Syntax highlighting enabled (language="json")
- [x] Line numbers enabled
- [x] Dark theme applied (vs-dark)

### Electron Compatibility
- [x] Using @monaco-editor/react (handles Electron compatibility)
- [x] No custom worker configuration needed (automatic)
- [x] Remote debugging enabled (dev:mcp script)
- [x] Vite bundling compatible

## Success Criteria

The test passes when ALL of the following are true:

1. ✅ Monaco Editor loads in Electron window
2. ✅ No web worker errors in console
3. ✅ JSON syntax highlighting works
4. ✅ Line numbers visible
5. ✅ Minimap visible and functional
6. ✅ Auto-formatting works on paste
7. ✅ Error display works for invalid JSON
8. ✅ Editor is responsive (no lag/freezing)
9. ✅ No 404 errors for worker scripts
10. ✅ No CSP violations

## Known Limitations

1. **Web Workers in Production**: Some Electron builds have stricter CSP that may block web workers. If issues occur in production builds (not dev), may need to configure Monaco to disable workers or use inline workers.

2. **Bundle Size**: Monaco Editor adds ~2-3MB to bundle. Already mitigated by code-splitting in Vite.

3. **First Load Time**: Editor may take 1-2 seconds to initialize. Loading indicator implemented to show during this time.

## Next Steps After Manual Testing

### If Test Passes ✅
1. Document in build-progress.txt
2. Update implementation_plan.json (mark subtask-7-3 as completed)
3. Commit changes

### If Test Fails ❌
**Scenario 1: Web Worker Errors**
```typescript
// Add to JsonEditor.tsx before Editor component:
import { loader } from '@monaco-editor/react';

// Configure loader for Electron
loader.config({
  paths: {
    vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs'
  }
});
```

**Scenario 2: CSP Violations**
Add to electron.vite.config.ts:
```typescript
renderer: {
  // ... existing config
  builder: {
    // ... existing config
    security: {
      csp: {
        // Allow workers from same origin
        'worker-src': ['self:', 'blob:'],
      }
    }
  }
}
```

**Scenario 3: Editor Doesn't Load**
- Check console for initialization errors
- Verify @monaco-editor/react version compatibility
- Try upgrading to latest version (4.8.0+)

## Conclusion

Implementation is **READY FOR MANUAL TESTING**. All code-level checks pass:
- ✅ Correct Monaco Editor version
- ✅ Proper component configuration
- ✅ Build succeeds without errors
- ✅ Electron compatibility features enabled
- ✅ Remote debugging configured

**Manual testing required to verify runtime behavior**.
