/**
 * Inline Edit Store Session Lifecycle Actions - Edit session state transitions for AI inline code editing
 *
 * Extracted from inline-edit-store.ts to keep the store file under 200 lines.
 * Contains: startSession, setInstruction, startGenerating, appendGeneratedCode,
 * completeGeneration, setError, acceptEdit, rejectEdit, cancelEdit.
 */

import type { DiffResult } from '@/lib/diff-generator';
import type { CodeSelection, EditSession, EditSessionStatus } from './inline-edit-store';

interface InlineEditSlice {
  sessions: Record<string, EditSession>;
  dialogOpen: boolean;
  dialogFilePath: string | null;
}

type SetFn = (
  updater:
    | ((s: InlineEditSlice) => Partial<InlineEditSlice>)
    | Partial<InlineEditSlice>
) => void;
type GetFn = () => InlineEditSlice;

// ── startSession ───────────────────────────────────────────────────────────

export function startSessionAction(
  filePath: string,
  sessionId: string,
  selection: CodeSelection,
  set: SetFn
): void {
  set((state) => ({
    sessions: {
      ...state.sessions,
      [filePath]: {
        sessionId,
        filePath,
        selection,
        instruction: '',
        originalCode: selection.text,
        generatedCode: '',
        diff: null,
        status: 'prompting' as EditSessionStatus,
        error: null,
        createdAt: Date.now(),
      },
    },
  }));
}

// ── setInstruction ─────────────────────────────────────────────────────────

export function setInstructionAction(filePath: string, instruction: string, set: SetFn): void {
  set((state) => {
    const session = state.sessions[filePath];
    if (!session) return state;
    return { sessions: { ...state.sessions, [filePath]: { ...session, instruction } } };
  });
}

// ── startGenerating ────────────────────────────────────────────────────────

export function startGeneratingAction(filePath: string, set: SetFn): void {
  set((state) => {
    const session = state.sessions[filePath];
    if (!session) return state;
    return {
      sessions: {
        ...state.sessions,
        [filePath]: { ...session, status: 'generating' as EditSessionStatus, generatedCode: '', error: null },
      },
    };
  });
}

// ── appendGeneratedCode ────────────────────────────────────────────────────

export function appendGeneratedCodeAction(filePath: string, chunk: string, set: SetFn): void {
  set((state) => {
    const session = state.sessions[filePath];
    if (!session || session.status !== 'generating') return state;
    return {
      sessions: {
        ...state.sessions,
        [filePath]: { ...session, generatedCode: session.generatedCode + chunk },
      },
    };
  });
}

// ── completeGeneration ─────────────────────────────────────────────────────

export function completeGenerationAction(
  filePath: string,
  finalCode: string,
  diff: DiffResult,
  set: SetFn
): void {
  set((state) => {
    const session = state.sessions[filePath];
    if (!session) return state;
    return {
      sessions: {
        ...state.sessions,
        [filePath]: { ...session, status: 'preview' as EditSessionStatus, generatedCode: finalCode, diff },
      },
    };
  });
}

// ── setError ───────────────────────────────────────────────────────────────

export function setErrorAction(filePath: string, error: string, set: SetFn): void {
  set((state) => {
    const session = state.sessions[filePath];
    if (!session) return state;
    return {
      sessions: {
        ...state.sessions,
        [filePath]: { ...session, status: 'prompting' as EditSessionStatus, error },
      },
    };
  });
}

// ── acceptEdit ─────────────────────────────────────────────────────────────

export function acceptEditAction(filePath: string, get: GetFn, set: SetFn): string | null {
  const session = get().sessions[filePath];
  if (!session || session.status !== 'preview') return null;
  const generatedCode = session.generatedCode;
  set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [filePath]: _removed, ...rest } = state.sessions;
    return { sessions: rest };
  });
  return generatedCode;
}

// ── rejectEdit ─────────────────────────────────────────────────────────────

export function rejectEditAction(filePath: string, set: SetFn): void {
  set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [filePath]: _removed, ...rest } = state.sessions;
    return { sessions: rest };
  });
}

// ── cancelEdit ─────────────────────────────────────────────────────────────

export function cancelEditAction(filePath: string, set: SetFn): void {
  set((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [filePath]: _removed, ...rest } = state.sessions;
    return {
      sessions: rest,
      dialogOpen: state.dialogFilePath === filePath ? false : state.dialogOpen,
      dialogFilePath: state.dialogFilePath === filePath ? null : state.dialogFilePath,
    };
  });
}
