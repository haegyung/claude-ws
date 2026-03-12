'use client';

/**
 * Displays commit metadata (author, date, subject, body) and the changed-files list
 * with +/- stats. Used inside CommitDetailsModal when no file diff is selected.
 */

import { Loader2, Copy, Check, GitBranch, GitCommit, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CommitDetails } from '@/types';
import { CommitDetailsFileListItem } from './commit-details-file-list-item';

interface CommitDetailsMetadataAndFilesPanelProps {
  details: CommitDetails | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
  checkoutLoading: boolean;
  actionMessage: { type: 'success' | 'error'; text: string } | null;
  onCopyHash: () => void;
  onCheckout: () => void;
  onNewBranch: () => void;
  onRetry: () => void;
  onFileClick: (path: string) => void;
}

export function CommitDetailsMetadataAndFilesPanel({
  details,
  loading,
  error,
  copied,
  checkoutLoading,
  actionMessage,
  onCopyHash,
  onCheckout,
  onNewBranch,
  onRetry,
  onFileClick,
}: CommitDetailsMetadataAndFilesPanelProps) {
  const t = useTranslations('git');

  return (
    <>
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <div className="px-6 py-4">
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <button onClick={onRetry} className="mt-2 text-xs text-destructive hover:underline">
              Retry
            </button>
          </div>
        </div>
      )}

      {details && (
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {/* Action feedback message */}
          {actionMessage && (
            <div
              className={cn(
                'mb-4 p-3 rounded-lg flex items-start gap-2',
                actionMessage.type === 'success'
                  ? 'bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400'
                  : 'bg-destructive/10 border border-destructive/20 text-destructive'
              )}
            >
              {actionMessage.type === 'success' ? (
                <Check className="size-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
              )}
              <span className="text-sm">{actionMessage.text}</span>
            </div>
          )}

          {/* Hash + action buttons row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                {details.shortHash}
              </code>
              <button
                onClick={onCopyHash}
                className="p-1 hover:bg-accent rounded transition-colors"
                title={t('copyFullHash')}
              >
                {copied ? (
                  <Check className="size-3.5 text-green-500" />
                ) : (
                  <Copy className="size-3.5 text-muted-foreground" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onCheckout}
                disabled={checkoutLoading}
                title={t('checkoutCommit')}
              >
                {checkoutLoading ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : (
                  <GitCommit className="size-3.5 mr-1.5" />
                )}
                Checkout
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onNewBranch}
                title={t('createBranchFromCommit')}
              >
                <GitBranch className="size-3.5 mr-1.5" />
                New Branch
              </Button>
            </div>
          </div>

          {/* Author + date */}
          <div className="space-y-1 mb-4">
            <div className="text-sm">
              <span className="font-medium">{details.author}</span>
              <span className="text-muted-foreground text-xs ml-2">
                &lt;{details.authorEmail}&gt;
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {details.dateRelative} ({new Date(details.date).toLocaleString()})
            </div>
          </div>

          {/* Subject + body */}
          <div className="mb-6">
            <h3 className="font-semibold text-sm mb-2">{details.subject}</h3>
            {details.body && (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans">
                {details.body}
              </pre>
            )}
          </div>

          {/* Changed files */}
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">
                Files Changed ({details.stats.filesChanged})
              </h4>
              <div className="text-xs text-muted-foreground">
                <span className="text-green-500">+{details.stats.additions}</span>
                {' / '}
                <span className="text-red-500">-{details.stats.deletions}</span>
              </div>
            </div>

            <div className="space-y-1">
              {details.files.map((file, idx) => (
                <CommitDetailsFileListItem
                  key={idx}
                  file={file}
                  onClick={() => onFileClick(file.path)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
