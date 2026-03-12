'use client';

/**
 * Dialog for creating a new git branch from a specific commit hash.
 * Calls POST /api/git/branch and optionally checks out the new branch.
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface CommitDetailsCreateBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  startPoint: string;
  onSuccess?: () => void;
}

export function CommitDetailsCreateBranchDialog({
  open,
  onOpenChange,
  projectPath,
  startPoint,
  onSuccess,
}: CommitDetailsCreateBranchDialogProps) {
  const [branchName, setBranchName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim() || !startPoint) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/git/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          branchName: branchName.trim(),
          startPoint,
          checkout: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create branch');

      window.dispatchEvent(new CustomEvent('git-status-refresh'));
      onSuccess?.();
      onOpenChange(false);
      setBranchName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Create New Branch</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="branch-name" className="text-sm font-medium">
              Branch Name
            </label>
            <input
              id="branch-name"
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="feature/my-new-feature"
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
              disabled={loading}
            />
            {startPoint && (
              <p className="text-xs text-muted-foreground">
                From commit: {startPoint.slice(0, 7)}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!branchName.trim() || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  Creating...
                </>
              ) : (
                'Create & Checkout'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
