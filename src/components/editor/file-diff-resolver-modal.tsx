'use client';

/**
 * File Diff Resolver Modal
 *
 * Shows a modal when file changes are detected on disk while the user
 * has unsaved local changes. Displays a side-by-side diff comparison
 * using @pierre/diffs with options to keep local, accept remote, or
 * accept remote and open in editor for manual merging.
 */

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Copy, ArrowLeft, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { MultiFileDiff } from '@pierre/diffs/react';
import { usePierreTheme } from '@/lib/pierre-theme-config';

interface FileDiffResolverModalProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  localContent: string;
  remoteContent: string;
  onAcceptRemote: () => void;
  onKeepLocal: () => void;
  onMerge: (mergedContent: string) => void;
}

export function FileDiffResolverModal({
  open,
  onClose,
  filePath,
  localContent,
  remoteContent,
  onAcceptRemote,
  onKeepLocal,
  onMerge,
}: FileDiffResolverModalProps) {
  const t = useTranslations('editor');
  const pierreTheme = usePierreTheme();
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (open) {
      setHasChanges(localContent !== remoteContent);
    }
  }, [open, localContent, remoteContent]);

  const handleKeepLocal = useCallback(() => {
    onKeepLocal();
    onClose();
    toast.success(t('keptLocalChanges'));
  }, [onKeepLocal, onClose, t]);

  const handleAcceptRemote = useCallback(() => {
    onAcceptRemote();
    onClose();
    toast.success(t('acceptedRemoteChanges'));
  }, [onAcceptRemote, onClose, t]);

  const handleAcceptRemoteAndEdit = useCallback(() => {
    onMerge(remoteContent);
    onClose();
    toast.success(t('acceptedRemoteChanges'));
  }, [remoteContent, onMerge, onClose, t]);

  const handleCopy = useCallback(async (content: string, label: string) => {
    await navigator.clipboard.writeText(content);
    toast.success(t('copiedToClipboard', { label }));
  }, [t]);

  const fileName = filePath.split('/').pop() || filePath;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            {t('fileChangedExternally')}
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{fileName}</span>
            {' '}{t('hasBeenModified')}
          </DialogDescription>
        </DialogHeader>

        {/* Diff view */}
        <div className="flex-1 min-h-0 overflow-auto rounded-md border">
          {hasChanges ? (
            <MultiFileDiff
              oldFile={{ name: `${fileName} (local)`, contents: localContent }}
              newFile={{ name: `${fileName} (remote)`, contents: remoteContent }}
              options={{
                ...pierreTheme,
                diffStyle: 'unified',
                lineDiffType: 'word-alt',
                overflow: 'scroll',
                diffIndicators: 'bars',
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-green-600 dark:text-green-400 text-sm p-8">
              {t('filesIdentical')}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCopy(localContent, 'local')}
            title={t('copyLocalContent')}
          >
            <Copy className="size-3.5 mr-1" />
            {t('local')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleCopy(remoteContent, 'remote')}
            title={t('copyRemoteContent')}
          >
            <Copy className="size-3.5 mr-1" />
            {t('remoteDisk')}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={handleKeepLocal} className="gap-2">
            <ArrowLeft className="size-4" />
            {t('keepLocalOnly')}
          </Button>
          <Button variant="outline" onClick={handleAcceptRemote} className="gap-2">
            {t('acceptRemoteOnly')}
          </Button>
          <Button variant="default" onClick={handleAcceptRemoteAndEdit} className="gap-2">
            <Check className="size-4" />
            {t('acceptRemoteOnly')} & Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
