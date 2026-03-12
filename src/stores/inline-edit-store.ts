/**
 * Inline Edit Store - State management for inline AI code editing
 *
 * Manages edit sessions, streaming state, and diff preview.
 * Ephemeral store - no database persistence.
 *
 * Session lifecycle actions extracted to inline-edit-store-session-lifecycle-actions.ts
 */

import { create } from 'zustand';
import type { DiffResult } from '@/lib/diff-generator';
import {
  startSessionAction,
  setInstructionAction,
  startGeneratingAction,
  appendGeneratedCodeAction,
  completeGenerationAction,
  setErrorAction,
  acceptEditAction,
  rejectEditAction,
  cancelEditAction,
} from './inline-edit-store-session-lifecycle-actions';

export interface CodeSelection {
  from: number;
  to: number;
  text: string;
  startLine: number;
  endLine: number;
}

export type EditSessionStatus = 'prompting' | 'generating' | 'preview' | 'applying';

export interface EditSession {
  sessionId: string;
  filePath: string;
  selection: CodeSelection;
  instruction: string;
  originalCode: string;
  generatedCode: string;
  diff: DiffResult | null;
  status: EditSessionStatus;
  error: string | null;
  createdAt: number;
}

interface InlineEditState {
  sessions: Record<string, EditSession>;
  dialogOpen: boolean;
  dialogFilePath: string | null;
  dialogPosition: { x: number; y: number } | null;
}

interface InlineEditActions {
  // Session lifecycle — delegated to inline-edit-store-session-lifecycle-actions
  startSession: (filePath: string, sessionId: string, selection: CodeSelection) => void;
  setInstruction: (filePath: string, instruction: string) => void;
  startGenerating: (filePath: string) => void;
  appendGeneratedCode: (filePath: string, chunk: string) => void;
  completeGeneration: (filePath: string, finalCode: string, diff: DiffResult) => void;
  setError: (filePath: string, error: string) => void;
  acceptEdit: (filePath: string) => string | null;
  rejectEdit: (filePath: string) => void;
  cancelEdit: (filePath: string) => void;

  // Dialog control
  openDialog: (filePath: string, position?: { x: number; y: number }) => void;
  closeDialog: () => void;

  // Queries
  getSession: (filePath: string) => EditSession | null;
  hasActiveSession: (filePath: string) => boolean;
}

type InlineEditStore = InlineEditState & InlineEditActions;

export const useInlineEditStore = create<InlineEditStore>((set, get) => ({
  sessions: {},
  dialogOpen: false,
  dialogFilePath: null,
  dialogPosition: null,

  startSession: (filePath, sessionId, selection) =>
    startSessionAction(filePath, sessionId, selection, set),
  setInstruction: (filePath, instruction) => setInstructionAction(filePath, instruction, set),
  startGenerating: (filePath) => startGeneratingAction(filePath, set),
  appendGeneratedCode: (filePath, chunk) => appendGeneratedCodeAction(filePath, chunk, set),
  completeGeneration: (filePath, finalCode, diff) =>
    completeGenerationAction(filePath, finalCode, diff, set),
  setError: (filePath, error) => setErrorAction(filePath, error, set),
  acceptEdit: (filePath) => acceptEditAction(filePath, get, set),
  rejectEdit: (filePath) => rejectEditAction(filePath, set),
  cancelEdit: (filePath) => cancelEditAction(filePath, set),

  openDialog: (filePath, position) =>
    set({ dialogOpen: true, dialogFilePath: filePath, dialogPosition: position || null }),
  closeDialog: () => set({ dialogOpen: false, dialogFilePath: null, dialogPosition: null }),

  getSession: (filePath) => get().sessions[filePath] || null,
  hasActiveSession: (filePath) => !!get().sessions[filePath],
}));
