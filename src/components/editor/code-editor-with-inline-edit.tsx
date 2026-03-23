'use client';

/**
 * CodeMirror Editor with Inline AI Editing Support
 *
 * Wraps CodeMirror and adds inline AI edit functionality,
 * go-to-definition, and context mention support.
 * Press Ctrl/Cmd+I with selected code to trigger AI editing.
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { useTheme } from 'next-themes';
import {
  dispatchInlineDiff,
  type InlineEditSelection,
  type InlineEditDiffState,
} from './extensions/inline-edit';
import { useInlineEdit } from '@/hooks/use-inline-edit';
import { useInlineEditStore } from '@/stores/inline-edit-store';
import { useDefinitionHandler } from './code-editor-definition-handler';
import {
  useInlineEditHandlers,
  CodeEditorInlineEditOverlay,
} from './code-editor-inline-edit-overlay';
import { useEditorExtensions, BASIC_SETUP_OPTIONS } from './code-editor-extensions-builder';

interface EditorPosition {
  lineNumber?: number;
  column?: number;
  matchLength?: number;
}

interface CodeEditorWithInlineEditProps {
  value: string;
  onChange: (value: string) => void;
  language?: string | null;
  readOnly?: boolean;
  className?: string;
  editorPosition?: EditorPosition | null;
  focusOnNavigate?: boolean;
  /** File path for definition and inline edit */
  filePath?: string;
  /** Base project path */
  basePath?: string;
  /** Whether to enable go-to-definition */
  enableDefinitions?: boolean;
  /** Whether to enable inline edit (Ctrl+I) */
  enableInlineEdit?: boolean;
  /** Callback when text selection changes */
  onSelectionChange?: (selection: { startLine: number; endLine: number } | null) => void;
}

export function CodeEditorWithInlineEdit({
  value,
  onChange,
  language,
  readOnly = false,
  className,
  editorPosition,
  focusOnNavigate = true,
  filePath,
  basePath,
  enableDefinitions = true,
  enableInlineEdit = true,
  onSelectionChange,
}: CodeEditorWithInlineEditProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [height, setHeight] = useState<number>(400);

  const isDarkTheme = resolvedTheme === 'dark';

  // Definition handler (go-to-definition, symbol lookup)
  const definitionHandler = useDefinitionHandler({
    filePath,
    basePath,
    language,
    fileContent: value,
  });

  // Get screen position for selection (for popup positioning)
  const getSelectionPosition = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return null;

    const selection = view.state.selection.main;
    const coords = view.coordsAtPos(selection.from);
    if (!coords) return null;

    return { x: coords.left, y: coords.top };
  }, []);

  // Inline edit hook
  const inlineEdit = useInlineEdit({
    filePath: filePath || '',
    basePath: basePath || '',
    language: language || 'text',
    getSelectionPosition,
    onAccept: useCallback(
      (generatedCode: string, selection: InlineEditSelection) => {
        const view = editorViewRef.current;
        if (!view) return;

        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: generatedCode,
          },
        });

        dispatchInlineDiff(view, null);

        const newDoc = view.state.doc.toString();
        onChange(newDoc);
      },
      [onChange]
    ),
    onReject: useCallback(() => {
      const view = editorViewRef.current;
      if (view) {
        dispatchInlineDiff(view, null);
      }
    }, []),
  });

  // Inline edit and context mention handlers
  const inlineEditHandlers = useInlineEditHandlers({ filePath, inlineEdit });

  // Stable references for extensions builder
  const definitionHandlers = useMemo(() => ({
    handleDefinitionRequest: definitionHandler.handleDefinitionRequest,
    handleNavigate: definitionHandler.handleNavigate,
    handleShowPreview: definitionHandler.handleShowPreview,
    handleHidePreview: definitionHandler.handleHidePreview,
  }), [definitionHandler.handleDefinitionRequest, definitionHandler.handleNavigate, definitionHandler.handleShowPreview, definitionHandler.handleHidePreview]);

  const editHandlers = useMemo(() => ({
    handleEditRequest: inlineEditHandlers.handleEditRequest,
    handleAccept: inlineEditHandlers.handleAccept,
    handleReject: inlineEditHandlers.handleReject,
  }), [inlineEditHandlers.handleEditRequest, inlineEditHandlers.handleAccept, inlineEditHandlers.handleReject]);

  // Build CodeMirror extensions
  const extensions = useEditorExtensions({
    language,
    isDarkTheme,
    enableDefinitions,
    enableInlineEdit,
    filePath,
    basePath,
    readOnly,
    onSelectionChange,
    definitionHandlers,
    inlineEditHandlers: editHandlers,
    handleAddToContext: inlineEditHandlers.handleAddToContext,
  });

  // Inline edit store for diff preview
  const { getSession } = useInlineEditStore();

  // Calculate actual container height for proper scrolling
  useEffect(() => {
    if (!containerRef.current) return;

    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setHeight(rect.height);
      }
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Navigate to line and highlight text when editorPosition changes
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !editorPosition?.lineNumber) return;

    const { lineNumber, column = 0, matchLength = 0 } = editorPosition;

    setTimeout(() => {
      if (!editorViewRef.current) return;

      const line = editorViewRef.current.state.doc.line(lineNumber);
      const startPos = line.from + (column || 0);
      const endPos = matchLength > 0 ? startPos + matchLength : line.to;

      editorViewRef.current.dispatch({
        effects: EditorView.scrollIntoView(startPos, { y: 'center', x: 'center' }),
      });

      editorViewRef.current.dispatch({
        selection: { anchor: startPos, head: endPos },
      });

      if (focusOnNavigate) {
        editorViewRef.current.focus();
      }
    }, 100);
  }, [editorPosition, focusOnNavigate]);

  // Update diff preview when session changes
  const session = filePath ? getSession(filePath) : null;
  const sessionStatus = session?.status;
  const sessionDiff = session?.diff;
  const sessionGeneratedCode = session?.generatedCode;
  const sessionSelection = session?.selection;
  const sessionOriginalCode = session?.originalCode;

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    if (sessionStatus === 'preview' && sessionDiff && sessionSelection && sessionOriginalCode) {
      const diffState: InlineEditDiffState = {
        selection: sessionSelection,
        originalCode: sessionOriginalCode,
        generatedCode: sessionGeneratedCode || '',
        diff: sessionDiff,
        status: 'preview',
      };
      dispatchInlineDiff(view, diffState);
    }
  }, [sessionStatus, sessionDiff, sessionGeneratedCode, sessionSelection, sessionOriginalCode]);

  const handleCreateEditor = useCallback((view: EditorView) => {
    editorViewRef.current = view;
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className || ''}`} style={{ height: className ? undefined : '100%' }}>
      <CodeMirror
        value={value}
        height={`${height}px`}
        theme="none"
        extensions={extensions}
        onChange={onChange}
        readOnly={readOnly}
        onCreateEditor={handleCreateEditor}
        basicSetup={BASIC_SETUP_OPTIONS}
      />

      <CodeEditorInlineEditOverlay
        filePath={filePath}
        containerRef={containerRef}
        editorViewRef={editorViewRef}
        inlineEdit={inlineEdit}
        definitionPopup={definitionHandler.definitionPopup}
        onHidePreview={definitionHandler.handleHidePreview}
      />
    </div>
  );
}
