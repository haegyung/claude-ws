'use client';

/**
 * Hook that builds the CodeMirror extensions array for the code editor.
 *
 * Assembles language, theme, go-to-definition, inline edit,
 * context mention, and selection listener extensions.
 */

import { useMemo } from 'react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { languages } from './languages';
import { gotoDefinitionExtension } from './extensions/goto-definition';
import type { ExtractedSymbol, DefinitionInfo } from './extensions/goto-definition';
import { markerLineHighlightExtension } from './extensions/marker-line-highlight';
import { pierreDark, pierreLight } from './extensions/pierre-theme';
import { inlineEditExtension, type InlineEditSelection } from './extensions/inline-edit';
import { addToContextExtension, type ContextSelection } from './extensions/add-to-context';

interface UseEditorExtensionsOptions {
  language?: string | null;
  isDarkTheme: boolean;
  enableDefinitions: boolean;
  enableInlineEdit: boolean;
  filePath?: string;
  basePath?: string;
  readOnly: boolean;
  onSelectionChange?: ((selection: { startLine: number; endLine: number } | null) => void);
  definitionHandlers: {
    handleDefinitionRequest: (symbol: ExtractedSymbol) => Promise<DefinitionInfo | null>;
    handleNavigate: (definition: DefinitionInfo) => void;
    handleShowPreview: (definition: DefinitionInfo, position: { x: number; y: number }) => void;
    handleHidePreview: () => void;
  };
  inlineEditHandlers: {
    handleEditRequest: (selection: InlineEditSelection) => void;
    handleAccept: () => void;
    handleReject: () => void;
  };
  handleAddToContext: (selection: ContextSelection) => void;
}


export const BASIC_SETUP_OPTIONS = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  foldGutter: true,
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  rectangularSelection: true,
  crosshairCursor: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: true,
  searchKeymap: false,
  foldKeymap: true,
  completionKeymap: true,
  lintKeymap: true,
} as const;

function buildSelectionListenerExtension(
  onSelectionChange: (selection: { startLine: number; endLine: number } | null) => void
): Extension {
  return EditorView.updateListener.of((update) => {
    if (update.selectionSet) {
      const selection = update.state.selection.main;

      if (selection.empty) {
        onSelectionChange(null);
        return;
      }

      const doc = update.state.doc;
      const startLine = doc.lineAt(selection.from).number;
      const endLine = doc.lineAt(selection.to).number;

      onSelectionChange({ startLine, endLine });
    }
  });
}

export function useEditorExtensions({
  language,
  isDarkTheme,
  enableDefinitions,
  enableInlineEdit,
  filePath,
  basePath,
  readOnly,
  onSelectionChange,
  definitionHandlers,
  inlineEditHandlers,
  handleAddToContext,
}: UseEditorExtensionsOptions) {
  return useMemo(() => {
    const langExtension = language ? languages[language] : null;

    const exts: Extension[] = [
      EditorView.lineWrapping,
      ...(isDarkTheme ? pierreDark : pierreLight),
      ...markerLineHighlightExtension,
      ...(langExtension ? [langExtension()] : []),
    ];

    if (enableDefinitions && filePath && basePath) {
      exts.push(
        gotoDefinitionExtension({
          onDefinitionRequest: definitionHandlers.handleDefinitionRequest,
          onNavigate: definitionHandlers.handleNavigate,
          onShowPreview: definitionHandlers.handleShowPreview,
          onHidePreview: definitionHandlers.handleHidePreview,
          enabled: true,
        })
      );
    }

    if (enableInlineEdit && filePath && basePath && !readOnly) {
      exts.push(
        inlineEditExtension({
          onEditRequest: inlineEditHandlers.handleEditRequest,
          onAccept: inlineEditHandlers.handleAccept,
          onReject: inlineEditHandlers.handleReject,
          enabled: true,
        })
      );
    }

    if (filePath) {
      exts.push(
        addToContextExtension({
          onAddToContext: handleAddToContext,
          filePath,
          enabled: true,
        })
      );
    }

    if (onSelectionChange) {
      exts.push(buildSelectionListenerExtension(onSelectionChange));
    }

    return exts;
  }, [
    language,
    isDarkTheme,
    enableDefinitions,
    enableInlineEdit,
    filePath,
    basePath,
    readOnly,
    onSelectionChange,
    definitionHandlers,
    inlineEditHandlers,
    handleAddToContext,
  ]);
}
