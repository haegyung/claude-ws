'use client';

/**
 * Single file row in the commit details changed-files list.
 * Shows file status icon (added/modified/deleted/renamed/copied), path, and +/- stats.
 */

import { FileIcon, FilePlus, FileMinus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommitFile } from '@/types';

const FILE_STATUS_CONFIG = {
  A: { icon: FilePlus, color: 'text-green-500' },
  M: { icon: FileIcon, color: 'text-yellow-500' },
  D: { icon: FileMinus, color: 'text-red-500' },
  R: { icon: FileIcon, color: 'text-blue-500' },
  C: { icon: FileIcon, color: 'text-purple-500' },
} as const;

interface CommitDetailsFileListItemProps {
  file: CommitFile;
  onClick: () => void;
}

export function CommitDetailsFileListItem({ file, onClick }: CommitDetailsFileListItemProps) {
  const config = FILE_STATUS_CONFIG[file.status];
  const Icon = config.icon;

  return (
    <div
      className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent/50 transition-colors cursor-pointer group"
      onClick={onClick}
      title={`Click to view diff for ${file.path}`}
    >
      <Icon className={cn('size-3.5 shrink-0', config.color)} />
      <span className="text-xs font-mono flex-1 truncate" title={file.path}>
        {file.path}
      </span>
      {file.status !== 'D' && (
        <div className="flex items-center gap-1.5 text-[10px] shrink-0">
          {file.additions > 0 && (
            <span className="text-green-500">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-500">-{file.deletions}</span>
          )}
        </div>
      )}
    </div>
  );
}
