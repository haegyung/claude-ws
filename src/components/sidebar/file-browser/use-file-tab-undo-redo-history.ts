'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseFileTabUndoRedoHistoryOptions {
  editedContent: string;
  originalContent: string;
  setEditedContent: (content: string) => void;
}

export function useFileTabUndoRedoHistory({
  editedContent,
  originalContent,
  setEditedContent,
}: UseFileTabUndoRedoHistoryOptions) {
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    const current = editedContent;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    setEditedContent(previous);
    setPast(newPast);
    setFuture([current, ...future]);
  }, [canUndo, editedContent, past, future, setEditedContent]);

  const handleRedo = useCallback(() => {
    if (!canRedo) return;
    const current = editedContent;
    const next = future[0];
    const newFuture = future.slice(1);
    setEditedContent(next);
    setFuture(newFuture);
    setPast([...past, current]);
  }, [canRedo, editedContent, future, past, setEditedContent]);

  // Track previous content for undo (debounced)
  const lastTrackedContentRef = useRef<string>(originalContent);

  useEffect(() => {
    lastTrackedContentRef.current = originalContent;
  }, [originalContent]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (editedContent !== lastTrackedContentRef.current && editedContent !== originalContent) {
        setPast(prev => [...prev, lastTrackedContentRef.current]);
        lastTrackedContentRef.current = editedContent;
        setFuture([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [editedContent, originalContent]);

  const resetHistory = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  /** Push current editedContent onto past stack (used by merge) */
  const pushToPast = useCallback((content: string) => {
    setPast(prev => [...prev, content]);
    setFuture([]);
  }, []);

  return {
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    resetHistory,
    pushToPast,
  };
}
