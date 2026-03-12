'use client';

/**
 * Renders the staged and unstaged file lists within the git panel changes section.
 * Handles expand/collapse of staged subsection and delegates file actions to parent.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GitFileItem } from './git-file-item';
import { cn } from '@/lib/utils';
import type { GitStatus, GitFileStatus } from '@/types';

interface GitPanelStagedUnstagedFileListsProps {
  status: GitStatus | null;
  changes: GitFileStatus[];
  selectedFile: string | null;
  onFileClick: (path: string, staged: boolean) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onDiscard: (path: string) => void;
  onUnstageAll: () => void;
  onAddToGitignore: (path: string) => void;
}

export function GitPanelStagedUnstagedFileLists({
  status,
  changes,
  selectedFile,
  onFileClick,
  onStage,
  onUnstage,
  onDiscard,
  onUnstageAll,
  onAddToGitignore,
}: GitPanelStagedUnstagedFileListsProps) {
  const t = useTranslations('git');
  const [stagedExpanded, setStagedExpanded] = useState(true);

  return (
    <>
      {/* Staged changes subsection */}
      {(status?.staged.length || 0) > 0 && (
        <div className="mb-1">
          <div
            className={cn(
              'group flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-muted-foreground',
              'hover:bg-accent/30 transition-colors rounded-sm cursor-pointer'
            )}
            onClick={() => setStagedExpanded(!stagedExpanded)}
          >
            {stagedExpanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            <span className="flex-1">{t('staged')}</span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                className="p-0.5 hover:bg-accent rounded"
                onClick={(e) => { e.stopPropagation(); onUnstageAll(); }}
                title={t('unstageAll')}
              >
                <Minus className="size-3" />
              </button>
            </div>
            <span className="px-1 py-0.5 bg-muted/80 rounded text-[9px] font-semibold">
              {t('stagedCount', { count: status?.staged.length || 0 })}
            </span>
          </div>

          {stagedExpanded && (
            <div>
              {status?.staged.map((file) => (
                <GitFileItem
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  staged={true}
                  onClick={() => onFileClick(file.path, true)}
                  onUnstage={() => onUnstage(file.path)}
                  onAddToGitignore={() => onAddToGitignore(file.path)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unstaged changes */}
      {changes.length > 0 && (
        <div>
          {changes.map((file) => (
            <GitFileItem
              key={file.path}
              file={file}
              isSelected={selectedFile === file.path}
              staged={false}
              onClick={() => onFileClick(file.path, false)}
              onStage={() => onStage(file.path)}
              onDiscard={() => onDiscard(file.path)}
              onAddToGitignore={() => onAddToGitignore(file.path)}
            />
          ))}
        </div>
      )}
    </>
  );
}
