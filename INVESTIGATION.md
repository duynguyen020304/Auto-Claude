# Investigation: Chat Generation State Pollution Between Conversations

**Date:** 2026-01-22
**Investigator:** AI Agent
**Issue:** Chat generation state leaks between open conversations when users switch between them

---

## Executive Summary

The investigation reveals that the frontend state architecture in `insights-store.ts` has **good session isolation design** but is **missing abort/cleanup logic** when users switch sessions. The root cause is that `switchSession()` does not abort ongoing generations or clean up tracking state, causing streaming updates to continue processing in the background.

---

## 1. Current Architecture

### 1.1 State Management Structure

The `InsightsState` interface uses a **dual-state pattern** with:

```typescript
interface InsightsState {
  // Session tracking
  currentSessionId: string | null;
  session: InsightsSession | null;
  sessions: InsightsSessionSummary[];

  // Per-session state storage (Map-based isolation)
  sessionStates: Map<string, InsightsSessionState>;

  // Active generation tracking
  generatingSessionIds: Map<string, string>; // projectId -> sessionId

  // Top-level mirrored fields (for easy access)
  status: InsightsChatStatus;
  streamingContent: string;
  currentTool: ToolUsage | null;
  toolsUsed: InsightsToolUsage[];
  fileMentions: FileMention[];
}
```

**Key Design Patterns:**

1. **Map-based Per-Session State:** `sessionStates` Map stores all streaming state separately for each session
2. **Top-Level Mirroring:** Current session's state is mirrored to top-level fields for easy component access
3. **Generation Tracking:** `generatingSessionIds` Map tracks which session is actively generating for each project

### 1.2 State Update Flow (Streaming)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Streaming Update Flow                        │
└─────────────────────────────────────────────────────────────────────┘

  Backend IPC Event
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  setupInsightsListeners() (line 777)                          │
  │  - onInsightsStreamChunk receives chunk                       │
  │  - Gets generatingSessionId from generatingSessionIds Map    │
  │  - Returns early if no session tracked (cross-project guard)  │
  └──────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  IPC Handler Logic (lines 798-1100)                           │
  │  - Updates sessionStates[targetSessionId] with chunk data    │
  │  - Checks: state.currentSessionId === targetSessionId        │
  │  - If match: Updates top-level mirrored fields                │
  │  - If no match: Only updates sessionStates Map (isolation)    │
  └──────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Component Render                                             │
  │  - Components read top-level fields via useInsightsStore()   │
  │  - Only see current session's streaming state                 │
  └──────────────────────────────────────────────────────────────┘
```

### 1.3 Session Switching Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Session Switch Flow (CURRENT)                   │
└─────────────────────────────────────────────────────────────────────┘

  User clicks different session in sidebar
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  handleSelectSession() (Insights.tsx:160)                    │
  │  - Calls switchSession(projectId, sessionId)                │
  └──────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  switchSession() (insights-store.ts:704)                     │
  │  1. Calls window.electronAPI.switchInsightsSession()         │
  │  2. Calls setSession(result.data)                            │
  │  3. NOTE: No abort of previous session's generation!         │
  │  4. NOTE: No cleanup of generatingSessionIds!                │
  └──────────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  setSession() (insights-store.ts:132)                        │
  │  1. Gets sessionId from session parameter                    │
  │  2. Ensures session state exists in sessionStates Map        │
  │  3. Restores state from sessionStates[sessionId] to          │
  │     top-level fields (status, streamingContent, etc.)        │
  │  4. Updates currentSessionId                                  │
  └──────────────────────────────────────────────────────────────┘
        │
        ▼
  Component now displays new session's state
```

---

## 2. Root Cause Analysis

### 2.1 The Bug

When a user switches from **Session A (generating)** to **Session B**:

1. ❌ **No Abort:** `switchSession()` does NOT abort the ongoing generation in Session A
2. ❌ **No Cleanup:** `generatingSessionIds` Map still contains `projectId -> sessionA` mapping
3. ❌ **Background Processing:** IPC chunks continue arriving for Session A
4. ✅ **Proper Storage:** Chunks ARE correctly stored in `sessionStates[sessionA]` (Map isolation works)
5. ✅ **Proper Guard:** Top-level fields ARE NOT updated (guard `state.currentSessionId === targetSessionId` works)
6. ❌ **Resource Leak:** Generation continues consuming backend resources unnecessarily
7. ❌ **UI Confusion:** If user switches back to Session A, they see mid-generation state that may be confusing

### 2.2 Why This Happens

**Missing Infrastructure:**

1. **No AbortController:** The frontend has no mechanism to abort ongoing generations
   - `sendMessage()` (line 635) calls `window.electronAPI.sendInsightsMessage()` but doesn't create/store AbortController
   - Backend API doesn't support abort signals

2. **No Cleanup Logic:** `switchSession()` (line 704) lacks cleanup steps
   - Should abort previous session's generation (if any)
   - Should clear `generatingSessionIds` entry for previous session
   - Should reset streaming state for previous session

3. **No Aborted State Tracking:** No way to mark a session as "aborted" vs "completed"
   - IPC chunks arrive even after switch
   - No check for "was this session aborted?" in IPC handler

### 2.3 What Works Well

The architecture has **good isolation design**:

- ✅ `sessionStates` Map properly separates state per session
- ✅ IPC listeners check `currentSessionId === targetSessionId` before updating top-level fields
- ✅ `setSession()` correctly restores session state from Map
- ✅ Components only access top-level fields (clean access pattern)

**The only missing piece is abort/cleanup on session switch.**

---

## 3. State Flow Diagram

### 3.1 Normal Flow (No Session Switch)

```
User sends message in Session A
    │
    ▼
sendMessage() → generatingSessionIds.set(projectId, sessionA)
    │
    ▼
Backend streams chunks → IPC events
    │
    ▼
IPC handler checks: generatingSessionIds.get(projectId) === sessionA ✓
    │
    ▼
Updates sessionStates[sessionA] AND top-level fields
    │
    ▼
Component displays streaming content
    │
    ▼
Chunk 'done' → generatingSessionIds.delete(projectId)
    │
    ▼
Generation complete
```

### 3.2 Problem Flow (Session Switch During Generation)

```
User sends message in Session A
    │
    ▼
sendMessage() → generatingSessionIds.set(projectId, sessionA)
    │
    ▼
Backend streams chunks → IPC events
    │
    ├────────────────────────────────────────┐
    ▼                                        │
IPC handler processes chunks for A           │ User switches to Session B
    │                                        │
    ▼                                        │
Updates sessionStates[sessionA]              ▼
    │                                    switchSession()
    │                                        │
    ▼                                        ▼
User sees streaming in A             No abort! No cleanup!
    │                                        │
    │                                        ▼
    │                                   generatingSessionIds
    │                                   STILL has projectId→sessionA!
    │                                        │
    ▼                                        ▼
More chunks arrive for A               IPC handler sees:
    │                                   generatingSessionIds.get(projectId)
    ▼                                   STILL returns sessionA! ✓
IPC handler STILL processes chunks
    │
    ▼
Updates sessionStates[sessionA]
    │
    ▼
Component B (current) doesn't show chunks
(guard: currentSessionId === sessionA ✗)
    │
    ▼
BUT Session A's state in Map keeps updating!
    │
    ▼
Backend resources wasted on orphaned generation
```

---

## 4. Recommended Fix Approach

### 4.1 High-Level Strategy

**Add abort/cleanup infrastructure** without breaking existing isolation:

1. **Phase 1: Add Abort Capability** - Add AbortController tracking to state
2. **Phase 2: Implement Cleanup Logic** - Add cleanup actions to store
3. **Phase 3: Hook Into Session Switch** - Call cleanup when switching sessions
4. **Phase 4: Add Guards** - Drop chunks for aborted sessions
5. **Phase 5: Testing** - Verify isolation with comprehensive tests

### 4.2 Implementation Phases

#### Phase 1: Abort Infrastructure

**Changes to `insights-store.ts`:**

```typescript
interface InsightsState {
  // NEW: Track abort controllers per session
  abortControllers: Map<string, AbortController>;

  // NEW: Actions for abort and cleanup
  abortGeneration: (sessionId: string) => void;
  cleanupSessionState: (sessionId: string) => void;
}
```

**Implementation:**
1. Add `abortControllers: new Map<string, AbortController>()` to initial state
2. Implement `abortGeneration(sessionId)` action:
   - Get AbortController from Map
   - Call `controller.abort()`
   - Remove from Map
   - Clear `generatingSessionIds` entry if this was the active generation

3. Implement `cleanupSessionState(sessionId)` action:
   - Call `abortGeneration(sessionId)`
   - Reset `sessionStates[sessionId]` to initial state
   - Clear `streamingContent`, `currentTool`, `toolsUsed` for that session

#### Phase 2: Update sendMessage to Create AbortController

**Changes to `sendMessage()` function (line 635):**

```typescript
export function sendMessage(projectId: string, message: string, modelConfig?: InsightsModelConfig): void {
  // ... existing code ...

  // NEW: Create and store AbortController
  const controller = new AbortController();
  useInsightsStore.setState((state) => ({
    abortControllers: new Map(state.abortControllers).set(session.id, controller)
  }));

  // Store the projectId -> sessionId mapping
  useInsightsStore.setState((state) => ({
    generatingSessionIds: new Map(state.generatingSessionIds).set(projectId, session.id)
  }));

  // TODO: Pass signal to backend (requires backend API change)
  window.electronAPI.sendInsightsMessage(projectId, message, configToUse);
}
```

#### Phase 3: Abort on Session Switch

**Changes to `switchSession()` function (line 704):**

```typescript
export async function switchSession(projectId: string, sessionId: string): Promise<void> {
  const store = useInsightsStore.getState();

  // NEW: Abort ongoing generation in previous session
  const previousSessionId = store.session?.id;
  if (previousSessionId && previousSessionId !== sessionId) {
    const cleanup = useInsightsStore.getState().cleanupSessionState;
    cleanup(previousSessionId); // Abort and clean up previous session
  }

  const result = await window.electronAPI.switchInsightsSession(projectId, sessionId);

  if (result.success && result.data) {
    useInsightsStore.getState().setSession(result.data);
  }
}
```

#### Phase 4: Drop Chunks for Aborted Sessions

**Changes to IPC listener (line 779):**

```typescript
const unsubStreamChunk = window.electronAPI.onInsightsStreamChunk(
  (projectId, chunk: InsightsStreamChunk) => {
    const store = useInsightsStore.getState();
    const generatingSessionId = store.generatingSessionIds.get(projectId);

    // If we don't have a tracked session, user switched away
    if (!generatingSessionId) {
      console.warn('[InsightsStore] Dropping chunk for project with no tracked session');
      return;
    }

    const targetSessionId = generatingSessionId;

    // NEW: Check if session was aborted
    const controller = store.abortControllers.get(targetSessionId);
    if (controller && controller.signal.aborted) {
      console.warn(`[InsightsStore] Dropping chunk for aborted session ${targetSessionId}`);
      return;
    }

    // ... existing chunk processing logic ...
  }
);
```

#### Phase 5: Component Cleanup

**Changes to `Insights.tsx` (line 116):**

```typescript
useEffect(() => {
  loadInsightsSession(projectId);
  resetStatus();
  const cleanup = setupInsightsListeners();

  // NEW: Cleanup on unmount
  return () => {
    const store = useInsightsStore.getState();
    if (store.session?.id) {
      store.cleanupSessionState(store.session.id);
    }
    cleanup();
  };
}, [projectId]);
```

### 4.3 Backend API Changes (Optional but Recommended)

**If backend supports abort signals:**

```typescript
// In preload/main process
window.electronAPI.sendInsightsMessage = (
  projectId: string,
  message: string,
  modelConfig?: InsightsModelConfig,
  signal?: AbortSignal  // NEW parameter
) => {
  // Pass signal to backend streaming function
  return insightsStreamHandler(projectId, message, modelConfig, signal);
};
```

### 4.4 Validation Guards (Defensive Programming)

**Add session ID checks to all state update actions:**

```typescript
setStatus: (status) => {
  const currentSessionId = _get().currentSessionId;

  return set((state) => {
    // Validate session ID
    if (!currentSessionId) {
      console.warn('[InsightsStore] Attempted to set status with no active session');
      return state;
    }

    // ... existing logic ...
  });
}
```

---

## 5. Edge Cases & Considerations

### 5.1 Edge Cases to Handle

1. **Rapid Session Switching**
   - User switches A→B→C→A quickly
   - Solution: Each switch aborts previous, only current session generates

2. **Generation Completes After Switch**
   - Session A generation completes after user switched to B
   - Solution: IPC chunks for A dropped (generatingSessionIds check)
   - Final message should be stored in sessionStates[A] for later restoration

3. **Network Errors During Generation**
   - Error state should not leak to other sessions
   - Solution: Error handling is already session-scoped (good design)

4. **Unmounted Conversations**
   - User navigates away from Insights page entirely
   - Solution: useEffect cleanup in Insights.tsx calls cleanupSessionState

5. **Multiple Concurrent Generations**
   - Architecture doesn't support concurrent generations per project
   - `generatingSessionIds` is Map<projectId, sessionId> - one per project
   - This is by design - new messages auto-abort previous generation

### 5.2 Performance Considerations

- **Memory Cleanup:** `abortControllers` Map grows with each session
  - Solution: Clean up entries when sessions are deleted (setSessions already does this for other Maps)

- **Abort Latency:** There may be a delay between switch and abort taking effect
  - IPC chunks may arrive between switch call and abort completion
  - Solution: Abort check in IPC handler drops these late chunks

- **Backend Resource Usage:** Without backend abort support, backend still processes
  - Frontend abort is "client-side only" - stops processing but not backend work
  - Full solution requires backend abort signal support

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Test: Session State Isolation**
```typescript
test('state updates for Session A do not affect Session B', () => {
  // Set up two sessions
  // Update Session A's streaming content
  // Verify Session B's content unchanged
  // Verify sessionStates Map has correct entries
});
```

**Test: Abort on Switch**
```typescript
test('switching sessions aborts previous session generation', () => {
  // Start generation in Session A
  // Switch to Session B
  // Verify Session A's AbortController was aborted
  // Verify generatingSessionIds no longer has Session A
});
```

**Test: Cleanup Resets State**
```typescript
test('cleanupSessionState resets streaming state', () => {
  // Set streaming content, current tool, tools used
  // Call cleanupSessionState
  // Verify all reset to initial values
});
```

### 6.2 Integration Tests

**Test: Rapid Switching**
```typescript
test('rapid session switching A→B→C does not corrupt state', () => {
  // Start generation in A
  // Quickly switch A→B→C
  // Verify only C is active
  // Verify A and B were cleaned up
  // Verify no memory leaks in Maps
});
```

**Test: Chunks After Switch**
```typescript
test('IPC chunks arriving after switch are dropped', () => {
  // Mock IPC chunk arrival
  // Simulate session switch mid-stream
  // Send chunk for old session
  // Verify chunk dropped (console.warn called)
  // Verify top-level fields not updated
});
```

### 6.3 Manual Testing Scenarios

1. **Basic Isolation**
   - Open 3 conversations
   - Start generation in #1
   - Switch to #2, then #3
   - Verify no loading indicators in #2/#3
   - Verify messages don't appear in wrong conversations

2. **Abort Behavior**
   - Start generation in A
   - Switch to B during generation
   - Verify A's generation stops (no streaming in background)
   - Switch back to A
   - Verify A shows clean state (either continued or aborted)

3. **Rapid Switching**
   - Open 3 conversations
   - Start generation in #1
   - Quickly switch #1→#2→#3→#1
   - Verify no state corruption
   - Verify no console errors
   - Verify only active generation shows

---

## 7. Files Requiring Changes

| File | Changes Required | Lines Affected |
|------|------------------|----------------|
| `apps/frontend/src/renderer/stores/insights-store.ts` | Add abortControllers Map, abortGeneration action, cleanupSessionState action | Interface (line 30), Initial state (line 95) |
| `apps/frontend/src/renderer/stores/insights-store.ts` | Update sendMessage to create AbortController | ~line 635 |
| `apps/frontend/src/renderer/stores/insights-store.ts` | Update switchSession to call cleanup | ~line 704 |
| `apps/frontend/src/renderer/stores/insights-store.ts` | Update IPC listener to check abort state | ~line 779 |
| `apps/frontend/src/renderer/components/Insights.tsx` | Add cleanup to useEffect | ~line 116 |
| `apps/frontend/src/renderer/stores/__tests__/insights-store-isolation.test.ts` | **NEW FILE** - Unit tests for isolation | - |
| `apps/frontend/src/renderer/stores/__tests__/insights-store-switching.test.ts` | **NEW FILE** - Integration tests for switching | - |

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Breaking existing session isolation | HIGH | Comprehensive test suite before changes |
| Memory leaks from abortControllers Map | MEDIUM | Cleanup in setSessions (existing pattern) |
| Backend doesn't support abort | LOW | Frontend-only abort works (drops chunks) |
| Race condition in switch → abort | LOW | Abort check in IPC handler drops late chunks |
| Performance regression | LOW | Abort is lightweight operation |

---

## 9. Success Criteria

The fix is complete when:

1. ✅ Chat generation state is properly scoped by conversation ID
2. ✅ Loading indicators only appear for the actively generating conversation
3. ✅ Messages never appear in the wrong conversation
4. ✅ Switching conversations aborts ongoing generation in the previous conversation
5. ✅ State updates from one conversation cannot affect another conversation's state
6. ✅ Multiple conversations can be open simultaneously without state interference
7. ✅ No console errors related to state management
8. ✅ Existing tests still pass
9. ✅ New tests verify conversation isolation

---

## 10. Conclusion

The investigation reveals a **well-designed state architecture** with good session isolation patterns, but **missing abort/cleanup logic** on session switches. The fix requires:

1. Adding AbortController tracking
2. Implementing cleanup actions
3. Calling cleanup when switching sessions
4. Adding abort checks to IPC handlers
5. Comprehensive testing

The architecture is close to correct - just needs the abort/cleanup infrastructure to be complete.

---

**Next Steps:** Proceed with Phase 1 implementation per the plan above.
