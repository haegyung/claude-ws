'use client';

import { useEffect, useState, useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { CommitDetails } from '@/types';
import { CommitFileDiffViewer } from './commit-file-diff-viewer';
import { CommitDetailsCreateBranchDialog } from './commit-details-create-branch-dialog';
import { CommitDetailsMetadataAndFilesPanel } from './commit-details-metadata-and-files-panel';

interface CommitDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commitHash: string | null;
  projectPath: string;
}

export function CommitDetailsModal({
  open,
  onOpenChange,
  commitHash,
  projectPath,
}: CommitDetailsModalProps) {
  const t = useTranslations('git');
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const fetchDetails = useCallback(async () => {
    if (!commitHash) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/git/show?path=${encodeURIComponent(projectPath)}&hash=${commitHash}`,
        { signal: controller.signal }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch commit details');
      }
      const data = await res.json();
      setDetails(data);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }

    return () => controller.abort();
  }, [commitHash, projectPath]);

  useEffect(() => {
    if (!open || !commitHash) {
      setDetails(null);
      setError(null);
      setLoading(false);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(null);
    fetchDetails();
  }, [open, commitHash, projectPath, fetchDetails]);

  async function copyHash() {
    if (!details?.hash) return;

    try {
      await navigator.clipboard.writeText(details.hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy hash:', err);
    }
  }

  async function handleCheckout() {
    if (!commitHash) return;

    setCheckoutLoading(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          commitish: commitHash,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');

      setActionMessage({ type: 'success', text: data.message });

      // Trigger a git status refresh by dispatching a custom event
      window.dispatchEvent(new CustomEvent('git-status-refresh'));

      // Auto-dismiss success message after 3 seconds
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to checkout'
      });
    } finally {
      setCheckoutLoading(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0">
        {selectedFile ? (
          // Show diff viewer
          <div className="flex flex-col h-full">
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setSelectedFile(null)}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <DialogTitle className="text-base">File Diff</DialogTitle>
            </div>
            <CommitFileDiffViewer
              filePath={selectedFile}
              commitHash={commitHash!}
              projectPath={projectPath}
              onClose={() => setSelectedFile(null)}
            />
          </div>
        ) : (
          // Show commit details
          <>
            <DialogHeader className="px-6 pt-6 pb-4">
              <DialogTitle className="text-base">Commit Details</DialogTitle>
            </DialogHeader>
            <CommitDetailsMetadataAndFilesPanel
              details={details}
              loading={loading}
              error={error}
              copied={copied}
              checkoutLoading={checkoutLoading}
              actionMessage={actionMessage}
              onCopyHash={copyHash}
              onCheckout={handleCheckout}
              onNewBranch={() => setShowBranchDialog(true)}
              onRetry={fetchDetails}
              onFileClick={setSelectedFile}
            />
          </>
        )}
      </DialogContent>
    </Dialog>

    {/* Create Branch Dialog */}
    <CommitDetailsCreateBranchDialog
      open={showBranchDialog}
      onOpenChange={setShowBranchDialog}
      projectPath={projectPath}
      startPoint={commitHash!}
      onSuccess={() => {
        setActionMessage({
          type: 'success',
          text: 'Branch created and checked out successfully'
        });
        setTimeout(() => setActionMessage(null), 3000);
      }}
    />
    </>
  );
}
