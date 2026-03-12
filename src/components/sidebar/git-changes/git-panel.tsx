'use client';

import { useState, useCallback } from 'react';
import { Loader2, RefreshCw, GitBranch, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Plus, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GitGraph } from './git-graph';
import { GitCommitForm } from './git-commit-form';
import { BranchCheckoutModal } from './branch-checkout-modal';
import { GitPanelStagedUnstagedFileLists } from './git-panel-staged-unstaged-file-lists';
import { useGitActions } from './use-git-actions';
import { useActiveProject } from '@/hooks/use-active-project';
import { useSidebarStore } from '@/stores/sidebar-store';
import { cn } from '@/lib/utils';

export function GitPanel() {
  const t = useTranslations('git');
  const tCommon = useTranslations('common');
  const activeProject = useActiveProject();
  const { openDiffTab } = useSidebarStore();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(true);
  const [branchModalOpen, setBranchModalOpen] = useState(false);

  const {
    status, loading, error, changes, syncing,
    fetchStatus, stageFile, unstageFile, discardFile,
    stageAll, unstageAll, discardAll, addToGitignore,
    handleSync, handleBranchCheckout,
  } = useGitActions({ projectPath: activeProject?.path, t });

  const handleFileClick = useCallback(
    (path: string, staged: boolean) => {
      setSelectedFile(path);
      openDiffTab(path, staged);
    },
    [openDiffTab]
  );

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
        <p className="text-sm text-destructive text-center">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchStatus(true)}>
          {tCommon('retry')}
        </Button>
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {tCommon('noProjectsConfigured')}
      </div>
    );
  }

  const totalChanges = (status?.staged.length || 0) + changes.length;
  const hasUnpushedCommits = (status?.ahead || 0) > 0 && totalChanges === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header with branch info */}
      <div className="px-2 py-1.5 border-b">
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-1.5 min-w-0 hover:bg-accent/50 rounded-md px-1.5 py-0.5 transition-colors cursor-pointer"
            onClick={() => setBranchModalOpen(true)}
            title={t('clickToSwitchBranches')}
          >
            <GitBranch className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium truncate">
              {status?.branch || t('noBranch')}
            </span>
            {status && (status.ahead > 0 || status.behind > 0) && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {status.ahead > 0 && (
                  <span className="flex items-center">
                    <ArrowUp className="size-3" />
                    {status.ahead}
                  </span>
                )}
                {status.behind > 0 && (
                  <span className="flex items-center">
                    <ArrowDown className="size-3" />
                    {status.behind}
                  </span>
                )}
              </div>
            )}
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => fetchStatus(true)}
            disabled={loading}
            title={tCommon('refresh')}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* File sections */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          <div className="mb-1">
            {/* Changes section header */}
            <div
              className={cn(
                'group flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide',
                'hover:bg-accent/30 transition-colors rounded-sm cursor-pointer'
              )}
              onClick={() => setChangesExpanded(!changesExpanded)}
            >
              {changesExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <span className="flex-1">{t('changes')}</span>
              <div className="flex items-center gap-0.5">
                <button
                  className="p-0.5 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); discardAll(); }}
                  title={t('discardAllChanges')}
                >
                  <Undo2 className="size-3.5" />
                </button>
                <button
                  className="p-0.5 hover:bg-accent rounded"
                  onClick={(e) => { e.stopPropagation(); stageAll(); }}
                  title={t('stageAllChanges')}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              <span className="px-1.5 py-0.5 bg-muted/80 rounded text-[10px] font-semibold ml-1">
                {totalChanges}
              </span>
            </div>

            {/* Changes content - commit form + file lists */}
            {changesExpanded && (
              <div className="mt-0.5">
                <GitCommitForm
                  projectPath={activeProject.path}
                  totalChanges={totalChanges}
                  hasUnpushedCommits={hasUnpushedCommits}
                  syncing={syncing}
                  onSync={handleSync}
                  onCommitComplete={() => fetchStatus(true)}
                />

                {totalChanges === 0 ? (
                  <div className="flex flex-col items-center justify-center py-4 text-muted-foreground text-sm">
                    <p>{t('noChanges')}</p>
                    <p className="text-xs mt-1">{t('workingTreeClean')}</p>
                  </div>
                ) : (
                  <GitPanelStagedUnstagedFileLists
                    status={status}
                    changes={changes}
                    selectedFile={selectedFile}
                    onFileClick={handleFileClick}
                    onStage={stageFile}
                    onUnstage={unstageFile}
                    onDiscard={discardFile}
                    onUnstageAll={unstageAll}
                    onAddToGitignore={addToGitignore}
                  />
                )}
              </div>
            )}
          </div>

          {/* Commit Graph */}
          <GitGraph />
        </div>
      </ScrollArea>

      {/* Branch checkout modal */}
      {activeProject && status && (
        <BranchCheckoutModal
          open={branchModalOpen}
          onOpenChange={setBranchModalOpen}
          projectPath={activeProject.path}
          currentBranch={status.branch || t('noBranch')}
          onCheckout={handleBranchCheckout}
        />
      )}
    </div>
  );
}
