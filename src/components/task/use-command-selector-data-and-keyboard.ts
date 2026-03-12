'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useProjectStore } from '@/stores/project-store';

export interface CommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
  isBuiltIn?: boolean;
  isInteractive?: boolean;
}

interface UseCommandSelectorOptions {
  isOpen: boolean;
  filter: string;
  explicitProjectPath?: string;
  onSelect: (command: string, isInteractive?: boolean) => void;
  onClose: () => void;
}

// Fetches available commands (built-in + project-level), filters/sorts them
// by the current input, and wires up keyboard navigation (↑↓ Tab Enter Esc).
export function useCommandSelectorDataAndKeyboard({
  isOpen,
  filter,
  explicitProjectPath,
  onSelect,
  onClose,
}: UseCommandSelectorOptions) {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { getActiveProject } = useProjectStore();

  // Fetch commands whenever the selector opens
  useEffect(() => {
    async function fetchCommands() {
      try {
        const projectPath = explicitProjectPath || getActiveProject()?.path;
        const params = new URLSearchParams();
        if (projectPath) params.set('projectPath', projectPath);
        const url = `/api/commands${params.toString() ? `?${params.toString()}` : ''}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setCommands(data);
        }
      } catch (error) {
        console.error('Failed to fetch commands:', error);
      } finally {
        setLoading(false);
      }
    }

    if (isOpen) {
      setLoading(true);
      fetchCommands();
    }
  }, [isOpen, explicitProjectPath, getActiveProject]);

  // Filter + sort: start-matches first, then alphabetical
  const filteredCommands = useMemo(() => {
    const lowerFilter = filter.toLowerCase();
    return commands
      .filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(lowerFilter) ||
          cmd.description.toLowerCase().includes(lowerFilter)
      )
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(lowerFilter);
        const bStarts = b.name.toLowerCase().startsWith(lowerFilter);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [commands, filter]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const selected = filteredCommands[selectedIndex];
        if (selected) onSelect(selected.name, selected.isInteractive);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, filteredCommands, onSelect, onClose]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selectedEl = list.children[selectedIndex] as HTMLElement;
    if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return { loading, filteredCommands, selectedIndex, setSelectedIndex, listRef };
}
