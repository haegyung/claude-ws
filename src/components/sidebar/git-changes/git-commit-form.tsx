'use client';

import { useState, useCallback } from 'react';
import { Loader2, ArrowUp, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Button } from '@/components/ui/button';

interface GitCommitFormProps {
  projectPath: string;
  totalChanges: number;
  hasUnpushedCommits: boolean;
  syncing: boolean;
  onSync: () => Promise<void>;
  onCommitComplete: () => void;
}

export function GitCommitForm({
  projectPath,
  totalChanges,
  hasUnpushedCommits,
  syncing,
  onSync,
  onCommitComplete,
}: GitCommitFormProps) {
  const t = useTranslations('git');
  const [commitTitle, setCommitTitle] = useState('');
  const [commitDescription, setCommitDescription] = useState('');
  const [committing, setCommitting] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);

  const canCommit = totalChanges > 0 && commitTitle.trim().length > 0;

  const handleCommit = useCallback(async () => {
    if (!commitTitle.trim()) return;
    setCommitting(true);
    try {
      // Auto-stage all changes before commit
      await fetch('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, all: true }),
      });

      const res = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath,
          title: commitTitle,
          description: commitDescription,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('failedToCommit'));
      }
      setCommitTitle('');
      setCommitDescription('');
      onCommitComplete();
    } catch (err) {
      alert(err instanceof Error ? err.message : t('failedToCommit'));
    } finally {
      setCommitting(false);
    }
  }, [projectPath, commitTitle, commitDescription, onCommitComplete, t]);

  const handleGenerateMessage = useCallback(async () => {
    setGeneratingMessage(true);
    try {
      const res = await fetch('/api/git/generate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });

      if (!res.ok) {
        let errorMsg = t('failedToGenerateCommit');
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
        } catch {
          // Response was not JSON (e.g. HTML error page)
        }
        throw new Error(errorMsg);
      }

      const { title, description } = await res.json();
      setCommitTitle(title || '');
      setCommitDescription(description || '');
    } catch (err) {
      console.error('AI generation error:', err);
      alert(err instanceof Error ? err.message : t('failedToGenerateCommit'));
    } finally {
      setGeneratingMessage(false);
    }
  }, [projectPath, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) {
        handleCommit();
      }
    },
    [canCommit, handleCommit]
  );

  return (
    <div className="px-2 pb-2 space-y-1.5">
      <input
        type="text"
        className="w-full px-2 py-1.5 text-sm bg-muted/50 border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder={t('commitTitle')}
        value={commitTitle}
        onChange={(e) => setCommitTitle(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <textarea
        className="w-full min-h-[60px] px-2 py-1.5 text-sm bg-muted/50 border rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-y"
        placeholder={t('descriptionOptional')}
        value={commitDescription}
        onChange={(e) => setCommitDescription(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex gap-1.5 mt-1.5">
        <Button
          className="flex-1"
          size="sm"
          disabled={(!canCommit && !hasUnpushedCommits) || committing || syncing}
          onClick={hasUnpushedCommits ? onSync : handleCommit}
        >
          {committing || syncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : hasUnpushedCommits ? (
            <>
              <ArrowUp className="size-4 mr-1" />
              {t('syncChanges')}
            </>
          ) : (
            <>
              <Check className="size-4 mr-1" />
              {t('commitChanges')}
            </>
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="px-2"
          title={
            totalChanges === 0
              ? t('noChangesToGenerate')
              : generatingMessage
              ? t('generatingCommit')
              : t('generateCommitMessage')
          }
          onClick={handleGenerateMessage}
          disabled={generatingMessage || totalChanges === 0}
        >
          <Image
            src="/logo.svg"
            alt="Generate"
            width={20}
            height={20}
            className={`opacity-80${generatingMessage ? ' animate-spin' : ''}`}
            unoptimized
          />
        </Button>
      </div>
    </div>
  );
}
