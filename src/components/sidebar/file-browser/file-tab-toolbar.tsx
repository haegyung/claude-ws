'use client';

import { RefObject } from 'react';
import { Loader2, AlertCircle, Copy, Check, Save, Undo, Redo, Search, X, AtSign, Download, Eye, Code, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslations } from 'next-intl';
import type { FileContent } from '@/components/sidebar/file-browser/use-file-tab-state';
import type { FileSyncState } from '@/hooks/use-file-sync';

type TranslationFn = ReturnType<typeof useTranslations>;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileTabToolbarProps {
  // File info
  fileName: string;
  content: FileContent | null;
  isMarkdownFile: boolean;
  isDirty: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  // Undo/Redo
  canUndo: boolean;
  canRedo: boolean;
  handleUndo: () => void;
  handleRedo: () => void;
  // Save
  handleSave: () => void;
  // View mode
  viewMode: 'preview' | 'code';
  toggleViewMode: () => void;
  // Search
  searchVisible: boolean;
  setSearchVisible: (visible: boolean) => void;
  // Selection & attach
  selection: { startLine: number; endLine: number } | null;
  selectedTask: { id: string } | null;
  handleAttachToChat: (createNew?: boolean) => void;
  // Export
  copied: boolean;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
  handleCopy: () => void;
  handleDownload: () => void;
  // File sync
  fileSync: Pick<FileSyncState, 'isPolling' | 'hasConflict'>;
  setShowDiffResolver: (show: boolean) => void;
  // Translations
  t: TranslationFn;
  tCommon: TranslationFn;
}

export function FileTabToolbar({
  fileName,
  content,
  isMarkdownFile,
  isDirty,
  saveStatus,
  canUndo,
  canRedo,
  handleUndo,
  handleRedo,
  handleSave,
  viewMode,
  toggleViewMode,
  searchVisible,
  setSearchVisible,
  selection,
  selectedTask,
  handleAttachToChat,
  copied,
  exportOpen,
  setExportOpen,
  handleCopy,
  handleDownload,
  fileSync,
  setShowDiffResolver,
  t,
  tCommon,
}: FileTabToolbarProps) {
  const isEditable = !content?.isBinary && content?.content !== null;

  return (
    <div className="flex items-center justify-between px-2 sm:px-3 py-2 border-b shrink-0 gap-1 overflow-x-auto overflow-y-hidden">
      <div className="flex items-center gap-0.5 sm:gap-1.5 shrink-0 relative min-w-0">
        {/* Save status indicator */}
        {saveStatus === 'saving' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {saveStatus === 'saved' && <Check className="size-4 text-green-500" />}
        {saveStatus === 'error' && <AlertCircle className="size-4 text-destructive" />}

        {isEditable && (
          <>
            {/* Search toggle */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSearchVisible(!searchVisible)}
              title={t('searchPlaceholder') + ' (⌘F)'}
              className={searchVisible ? 'bg-accent' : ''}
            >
              <Search className="size-4" />
            </Button>

            {/* Undo/Redo */}
            <Button variant="ghost" size="icon-sm" onClick={handleUndo} disabled={!canUndo} title={t('undo') + ' (⌘Z)'}>
              <Undo className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleRedo} disabled={!canRedo} title={t('redo') + ' (⌘⇧Z)'}>
              <Redo className="size-4" />
            </Button>

            {/* Save */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || saveStatus === 'saving'}
              title={tCommon('save') + ' (⌘S)'}
              className="text-xs gap-1"
            >
              <Save className="size-3" />
              <span className="hidden sm:inline">Save</span>
            </Button>

            {/* Markdown view/code toggle */}
            {isMarkdownFile && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleViewMode}
                title={viewMode === 'preview' ? t('showSourceCode') : t('showPreview')}
                className={viewMode === 'preview' ? 'bg-accent' : ''}
              >
                {viewMode === 'preview' ? <Code className="size-4" /> : <Eye className="size-4" />}
              </Button>
            )}

            {/* Attach to chat (@) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={selection ? t('addLinesToChat', { startLine: selection.startLine, endLine: selection.endLine }) : t('addFileToChat')}
                  className="relative"
                >
                  <AtSign className="size-4" />
                  {selection && (
                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-primary text-[8px] text-primary-foreground items-center justify-center">
                        {selection.endLine - selection.startLine + 1}
                      </span>
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {selectedTask ? (
                  <>
                    <DropdownMenuItem onClick={() => handleAttachToChat(false)}>
                      <span className="text-sm">
                        {selection
                          ? `Add lines L${selection.startLine}-${selection.endLine} to current chat`
                          : 'Add file to current chat'}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleAttachToChat(true)}>
                      <span className="text-sm">Create new chat</span>
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={() => handleAttachToChat(true)}>
                    <span className="text-sm">
                      {selection
                        ? `Create chat with lines L${selection.startLine}-${selection.endLine}`
                        : 'Create new chat'}
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        {/* File size */}
        {content && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {formatFileSize(content.size)}
          </span>
        )}

        {/* Export dropdown */}
        {content?.content && (
          <DropdownMenu open={exportOpen} onOpenChange={setExportOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title={t('export')}>
                <Download className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopy}>
                {copied ? <Check className="size-4 mr-2 text-green-500" /> : <Copy className="size-4 mr-2" />}
                <span className="text-sm">{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="size-4 mr-2" />
                <span className="text-sm">Download</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
        {/* Sync indicator */}
        {fileSync.isPolling && (
          <span title={t('checkingForChanges')}>
            <RefreshCw className="size-3 animate-spin text-muted-foreground" />
          </span>
        )}
        {fileSync.hasConflict && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDiffResolver(true)}
            className="text-xs gap-1 text-amber-600 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-400"
            title={t('externalChangesDetected')}
          >
            <AlertCircle className="size-3" />
            <span className="hidden sm:inline">Conflict</span>
          </Button>
        )}
        <span className="text-sm font-medium truncate">{fileName}</span>
        {isDirty && (
          <span className="text-xs bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded hidden sm:inline-block">
            Modified
          </span>
        )}
      </div>
    </div>
  );
}

interface FileTabSearchBarProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  currentMatch: number;
  totalMatches: number;
  handleSearch: (query: string) => void;
  handleNextMatch: () => void;
  handlePrevMatch: () => void;
  closeSearch: () => void;
  t: TranslationFn;
  tCommon: TranslationFn;
}

export function FileTabSearchBar({
  searchInputRef,
  searchQuery,
  currentMatch,
  totalMatches,
  handleSearch,
  handleNextMatch,
  handlePrevMatch,
  closeSearch,
  t,
  tCommon,
}: FileTabSearchBarProps) {
  return (
    <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-2 border-b bg-accent/30 min-w-0">
      <Search className="size-4 text-muted-foreground shrink-0" />
      <input
        ref={searchInputRef}
        type="text"
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.shiftKey) {
              handlePrevMatch();
            } else {
              handleNextMatch();
            }
          } else if (e.key === 'Escape') {
            closeSearch();
          }
        }}
        placeholder={t('searchPlaceholder')}
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground"
      />
      {searchQuery && (
        <>
          <span className="text-xs text-muted-foreground shrink-0">
            {currentMatch}/{totalMatches}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={handlePrevMatch} disabled={totalMatches === 0} title={t('previousMatch') + ' (⇧Enter)'} className="shrink-0">
            <span className="text-xs">↑</span>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={handleNextMatch} disabled={totalMatches === 0} title={t('nextMatch') + ' (Enter)'} className="shrink-0">
            <span className="text-xs">↓</span>
          </Button>
        </>
      )}
      <Button variant="ghost" size="icon-sm" onClick={closeSearch} title={tCommon('close') + ' (Esc)'} className="shrink-0">
        <X className="size-4" />
      </Button>
    </div>
  );
}
