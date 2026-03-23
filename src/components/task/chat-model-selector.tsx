'use client';

import { useEffect, useMemo } from 'react';
import { ChevronDown, Check, Cpu, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useModelStore } from '@/stores/model-store';
import { cn } from '@/lib/utils';

interface ChatModelSelectorProps {
  disabled?: boolean;
  taskId?: string;
  taskLastModel?: string | null;
  taskLastProvider?: string | null;
}

export function ChatModelSelector({ disabled = false, taskId, taskLastModel, taskLastProvider }: ChatModelSelectorProps) {
  const { availableModels, isLoading, loadModels, setModel, getTaskModel, getShortName, defaultModel } =
    useModelStore();

  // Load models on mount
  useEffect(() => {
    if (availableModels.length === 0) {
      loadModels();
    }
  }, [availableModels.length, loadModels]);

  // Get current model for this specific task
  const currentModel = taskId ? getTaskModel(taskId, taskLastModel) : defaultModel;
  const shortName = getShortName(taskId, taskLastModel);

  const handleSelectModel = (modelId: string) => {
    setModel(modelId, taskId);
  };

  // Split models by provider for two-section dropdown
  const { cliModels, sdkModels, hasCliModels } = useMemo(() => {
    const cliModels = availableModels.filter(m => m.provider === 'claude-cli' || !m.provider);
    const sdkModels = availableModels.filter(m => m.provider === 'claude-sdk');
    return { cliModels, sdkModels, hasCliModels: cliModels.length > 0 };
  }, [availableModels]);

  const renderModelItem = (model: typeof availableModels[number]) => (
    <DropdownMenuItem
      key={model.id}
      onClick={() => handleSelectModel(model.id)}
      disabled={isLoading}
      className={cn(
        'flex items-center gap-2 cursor-pointer',
        currentModel === model.id && 'bg-primary/10'
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{model.name}</span>
        </div>
        {model.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {model.description}
          </p>
        )}
      </div>
      {model.id === currentModel && (
        <Check className="size-4 text-primary shrink-0" />
      )}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || isLoading}
          className="h-8 px-2 text-muted-foreground hover:text-foreground gap-1"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Cpu className="size-4" />
              <span className="text-xs">{shortName}</span>
              <ChevronDown className="size-3" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-64 z-[9999]"
        sideOffset={8}
      >
        {/* Section 1: Claude Code CLI - only show if CLI models are available */}
        {hasCliModels && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Claude Code CLI
            </DropdownMenuLabel>
            {cliModels.map(renderModelItem)}
            <DropdownMenuSeparator />
          </>
        )}

        {/* Section 2: Custom Models */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Custom Models
        </DropdownMenuLabel>
        {sdkModels.length > 0 ? (
          sdkModels.map(renderModelItem)
        ) : (
          <div className="px-2 py-1.5 text-xs text-muted-foreground/60 italic">
            Configure in Settings
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
