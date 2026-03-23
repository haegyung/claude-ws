'use client';

import { cn } from '@/lib/utils';
import { MultiFileDiff } from '@pierre/diffs/react';
import { usePierreTheme } from '@/lib/pierre-theme-config';

interface DiffViewProps {
  oldText: string;
  newText: string;
  filePath?: string;
  className?: string;
}

export function DiffView({ oldText, newText, filePath, className }: DiffViewProps) {
  const pierreTheme = usePierreTheme();
  const fileName = filePath || 'changes';

  return (
    <div className={cn('rounded-md border border-border overflow-hidden text-xs font-mono w-full max-w-full', className)}>
      <div className="overflow-x-auto max-h-64 w-full max-w-full">
        <MultiFileDiff
          oldFile={{ name: fileName, contents: oldText }}
          newFile={{ name: fileName, contents: newText }}
          options={{
            ...pierreTheme,
            diffStyle: 'unified',
            lineDiffType: 'word-alt',
            overflow: 'scroll',
            diffIndicators: 'bars',
          }}
        />
      </div>
    </div>
  );
}
