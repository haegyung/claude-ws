'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useActiveProject } from '@/hooks/use-active-project';
import { useTaskStore } from '@/stores/task-store';
import { useContextMentionStore } from '@/stores/context-mention-store';
import { useProjectStore } from '@/stores/project-store';
import { useFileSync } from '@/hooks/use-file-sync';
import { useTranslations } from 'next-intl';
import { useFileTabSearch } from '@/components/sidebar/file-browser/use-file-tab-search';
import { useFileTabUndoRedoHistory } from '@/components/sidebar/file-browser/use-file-tab-undo-redo-history';

export interface FileContent {
  content: string | null;
  language: string | null;
  size: number;
  isBinary: boolean;
  mimeType: string;
}

interface UseFileTabStateOptions {
  tabId: string;
  filePath: string;
}

export function useFileTabState({ tabId, filePath }: UseFileTabStateOptions) {
  const activeProject = useActiveProject();
  const t = useTranslations('editor');
  const tCommon = useTranslations('common');
  const tSidebar = useTranslations('sidebar');
  const { editorPosition, setEditorPosition, updateTabDirty, pendingEditorPosition, clearPendingEditorPosition } = useSidebarStore();
  const { selectedTask, createTask, selectTask } = useTaskStore();
  const { addFileMention, addLineMention } = useContextMentionStore();
  const { selectedProjectIds } = useProjectStore();

  const isMarkdownFile = filePath.endsWith('.md') || filePath.endsWith('.mdx');

  // Markdown view mode (persisted in localStorage)
  const [viewMode, setViewMode] = useState<'preview' | 'code'>(() => {
    if (typeof window === 'undefined') return 'preview';
    return (localStorage.getItem('markdown-view-mode') as 'preview' | 'code') || 'preview';
  });

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => {
      const newMode = prev === 'preview' ? 'code' : 'preview';
      localStorage.setItem('markdown-view-mode', newMode);
      return newMode;
    });
  }, []);

  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [selection, setSelection] = useState<{ startLine: number; endLine: number } | null>(null);
  const fetchedPathRef = useRef<string | null>(null);

  // Editor state
  const [originalContent, setOriginalContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const isDirty = originalContent !== editedContent;

  // Extracted hooks
  const undoRedo = useFileTabUndoRedoHistory({ editedContent, originalContent, setEditedContent });
  const search = useFileTabSearch({ editedContent });

  // File sync - polls for external changes
  const [showDiffResolver, setShowDiffResolver] = useState(false);

  const fileSync = useFileSync({
    filePath: !loading && content && !content.isBinary ? filePath : null,
    basePath: activeProject?.path ?? null,
    currentContent: editedContent,
    originalContent,
    pollInterval: 5000,
    enabled: !loading && !!content && !content.isBinary,
    onRemoteChange: useCallback(() => {
      setShowDiffResolver(true);
    }, []),
    onSilentUpdate: useCallback((remoteContent: string) => {
      setEditedContent(remoteContent);
      setOriginalContent(remoteContent);
      undoRedo.resetHistory();
    }, []),
  });

  const handleAcceptRemote = useCallback(() => {
    if (fileSync.remoteContent !== null) {
      setEditedContent(fileSync.remoteContent);
      setOriginalContent(fileSync.remoteContent);
      undoRedo.resetHistory();
      fileSync.acceptRemote();
    }
  }, [fileSync, undoRedo]);

  const handleKeepLocal = useCallback(() => {
    fileSync.keepLocal();
  }, [fileSync]);

  const handleMerge = useCallback((mergedContent: string) => {
    setEditedContent(mergedContent);
    undoRedo.pushToPast(editedContent);
    fileSync.clearConflict();
  }, [editedContent, fileSync, undoRedo]);

  // Notify store of dirty state changes
  useEffect(() => {
    updateTabDirty(tabId, isDirty);
  }, [tabId, isDirty]);

  // Warn user before closing browser with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Fetch file content
  useEffect(() => {
    if (!filePath || !activeProject?.path) {
      setContent(null);
      setOriginalContent('');
      setEditedContent('');
      setSaveStatus('idle');
      undoRedo.resetHistory();
      fetchedPathRef.current = null;
      return;
    }

    if (fetchedPathRef.current === filePath) return;

    console.log('[FileTabContent] Fetching file content', { filePath, timestamp: Date.now() });
    fetchedPathRef.current = filePath;

    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/files/content?basePath=${encodeURIComponent(activeProject.path)}&path=${encodeURIComponent(filePath)}`
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to fetch file');
        }
        const data = await res.json();
        setContent(data);
        setOriginalContent(data.content || '');
        setEditedContent(data.content || '');
        setSaveStatus('idle');
        undoRedo.resetHistory();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [filePath, activeProject?.path]);

  // Reset editor position when file changes
  useEffect(() => {
    setEditorPosition(null);
  }, [filePath]);

  // Check for pending editor position after file loads
  useEffect(() => {
    if (pendingEditorPosition && pendingEditorPosition.filePath === filePath && !loading && content) {
      const timer = setTimeout(() => {
        setEditorPosition({
          lineNumber: pendingEditorPosition.lineNumber,
          column: pendingEditorPosition.column || 0,
          matchLength: pendingEditorPosition.matchLength || 0
        });
        clearPendingEditorPosition();
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [pendingEditorPosition, filePath, loading, content]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!isDirty || !filePath || !activeProject?.path) return;

    setSaveStatus('saving');
    try {
      const res = await fetch('/api/files/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePath: activeProject.path,
          path: filePath,
          content: editedContent,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      setOriginalContent(editedContent);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1500);
    } catch (err) {
      console.error('Save error:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [isDirty, filePath, activeProject?.path, editedContent]);

  // Keyboard shortcut: Cmd+S / Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && saveStatus !== 'saving') {
          handleSave();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, saveStatus, handleSave]);

  const handleContentChange = useCallback((newContent: string) => {
    setEditedContent(newContent);
  }, []);

  const handleCopy = async () => {
    if (content?.content) {
      await navigator.clipboard.writeText(content.content);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setExportOpen(false);
      }, 500);
    }
  };

  const fileName = filePath.split('/').pop() || filePath;

  const handleDownload = () => {
    if (content?.content) {
      const blob = new Blob([content.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // Handle attaching file to chat using context mention system
  const handleAttachToChat = async (createNew = false) => {
    if (!activeProject?.path) return;

    try {
      let targetTask = selectedTask;

      if (createNew || !targetTask) {
        const projectId = selectedProjectIds[0];
        if (!projectId) {
          alert(tSidebar('selectProject'));
          return;
        }

        const name = filePath.split('/').pop() || filePath;
        const newTask = await createTask(projectId, `Edit ${name}`, `I want to work on ${filePath}`);
        targetTask = newTask;
      }

      const name = filePath.split('/').pop() || filePath;

      if (selection) {
        addLineMention(targetTask.id, name, filePath, selection.startLine, selection.endLine);
      } else {
        addFileMention(targetTask.id, name, filePath);
      }

      if (targetTask.id !== selectedTask?.id) {
        selectTask(targetTask.id);
      }
    } catch (error) {
      console.error('Failed to attach file:', error);
      alert(error instanceof Error ? error.message : t('addFileToChat'));
    }
  };

  return {
    activeProject,
    t,
    tCommon,
    tSidebar,
    fileName,
    isMarkdownFile,
    content,
    loading,
    error,
    editedContent,
    editorPosition,
    isDirty,
    saveStatus,
    canUndo: undoRedo.canUndo,
    canRedo: undoRedo.canRedo,
    viewMode,
    toggleViewMode,
    // Search (spread from extracted hook)
    ...search,
    selection,
    setSelection,
    copied,
    exportOpen,
    setExportOpen,
    handleSave,
    handleUndo: undoRedo.handleUndo,
    handleRedo: undoRedo.handleRedo,
    handleContentChange,
    handleCopy,
    handleDownload,
    handleAttachToChat,
    fileSync,
    showDiffResolver,
    setShowDiffResolver,
    handleAcceptRemote,
    handleKeepLocal,
    handleMerge,
    selectedTask,
    filePath,
  };
}
