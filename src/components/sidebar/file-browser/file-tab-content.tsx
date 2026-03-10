'use client';

import { Loader2, AlertCircle, File } from 'lucide-react';
import { CodeEditorWithInlineEdit } from '@/components/editor/code-editor-with-inline-edit';
import { FileDiffResolverModal } from '@/components/editor/file-diff-resolver-modal';
import { useFileTabState } from '@/components/sidebar/file-browser/use-file-tab-state';
import { FileTabToolbar, FileTabSearchBar } from '@/components/sidebar/file-browser/file-tab-toolbar';
import { FileTabMarkdownView } from '@/components/sidebar/file-browser/file-tab-markdown-view';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileTabContentProps {
  tabId: string;
  filePath: string;
}

export function FileTabContent({ tabId, filePath }: FileTabContentProps) {
  const state = useFileTabState({ tabId, filePath });

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <FileTabToolbar
        fileName={state.fileName}
        content={state.content}
        isMarkdownFile={state.isMarkdownFile}
        isDirty={state.isDirty}
        saveStatus={state.saveStatus}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        handleUndo={state.handleUndo}
        handleRedo={state.handleRedo}
        handleSave={state.handleSave}
        viewMode={state.viewMode}
        toggleViewMode={state.toggleViewMode}
        searchVisible={state.searchVisible}
        setSearchVisible={state.setSearchVisible}
        selection={state.selection}
        selectedTask={state.selectedTask}
        handleAttachToChat={state.handleAttachToChat}
        copied={state.copied}
        exportOpen={state.exportOpen}
        setExportOpen={state.setExportOpen}
        handleCopy={state.handleCopy}
        handleDownload={state.handleDownload}
        fileSync={state.fileSync}
        setShowDiffResolver={state.setShowDiffResolver}
        t={state.t}
        tCommon={state.tCommon}
      />

      {/* Search bar */}
      {state.searchVisible && (
        <FileTabSearchBar
          searchInputRef={state.searchInputRef}
          searchQuery={state.searchQuery}
          currentMatch={state.currentMatch}
          totalMatches={state.totalMatches}
          handleSearch={state.handleSearch}
          handleNextMatch={state.handleNextMatch}
          handlePrevMatch={state.handlePrevMatch}
          closeSearch={state.closeSearch}
          t={state.t}
          tCommon={state.tCommon}
        />
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {state.loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {state.error && (
          <div className="flex flex-col items-center justify-center py-20 text-destructive">
            <AlertCircle className="size-10 mb-3" />
            <span className="text-sm">{state.error}</span>
          </div>
        )}

        {state.content && !state.loading && !state.error && (
          <>
            {state.content.isBinary ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <File className="size-16 mb-3" />
                <span className="text-base">Binary file</span>
                <span className="text-sm">{state.content.mimeType}</span>
                <span className="text-xs mt-1">{formatFileSize(state.content.size)}</span>
              </div>
            ) : state.isMarkdownFile && state.viewMode === 'preview' ? (
              <FileTabMarkdownView
                editedContent={state.editedContent}
                filePath={filePath}
                basePath={state.activeProject?.path ?? null}
              />
            ) : (
              <CodeEditorWithInlineEdit
                value={state.editedContent}
                onChange={state.handleContentChange}
                language={state.content.language}
                className="h-full"
                editorPosition={state.editorPosition}
                focusOnNavigate={!state.searchVisible}
                filePath={filePath}
                basePath={state.activeProject?.path}
                enableDefinitions={true}
                enableInlineEdit={true}
                onSelectionChange={state.setSelection}
              />
            )}
          </>
        )}
      </div>

      {/* File Diff Resolver Modal */}
      {state.showDiffResolver && state.fileSync.remoteContent !== null && (
        <FileDiffResolverModal
          open={state.showDiffResolver}
          onClose={() => state.setShowDiffResolver(false)}
          filePath={filePath}
          localContent={state.editedContent}
          remoteContent={state.fileSync.remoteContent}
          onAcceptRemote={state.handleAcceptRemote}
          onKeepLocal={state.handleKeepLocal}
          onMerge={state.handleMerge}
        />
      )}
    </div>
  );
}
