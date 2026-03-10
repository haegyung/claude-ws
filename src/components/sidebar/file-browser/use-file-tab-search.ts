'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSidebarStore } from '@/stores/sidebar-store';

interface MatchPosition {
  lineNumber: number;
  column: number;
  matchLength: number;
}

interface UseFileTabSearchOptions {
  editedContent: string;
}

export function useFileTabSearch({ editedContent }: UseFileTabSearchOptions) {
  const { setEditorPosition } = useSidebarStore();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [matchPositions, setMatchPositions] = useState<MatchPosition[]>([]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query) {
      setTotalMatches(0);
      setCurrentMatch(0);
      setMatchPositions([]);
      setEditorPosition(null);
      return;
    }

    const positions: MatchPosition[] = [];
    const lines = editedContent.split('\n');
    const lowerQuery = query.toLowerCase();

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const lowerLine = lines[lineNum].toLowerCase();
      let col = 0;
      while (true) {
        const index = lowerLine.indexOf(lowerQuery, col);
        if (index === -1) break;
        positions.push({ lineNumber: lineNum + 1, column: index, matchLength: query.length });
        col = index + 1;
      }
    }

    setMatchPositions(positions);
    setTotalMatches(positions.length);
    setCurrentMatch(positions.length > 0 ? 1 : 0);

    if (positions.length > 0) {
      setEditorPosition(positions[0]);
    }
  }, [editedContent, setEditorPosition]);

  const handleNextMatch = useCallback(() => {
    if (!searchQuery || totalMatches === 0) return;
    const nextMatch = currentMatch >= totalMatches ? 1 : currentMatch + 1;
    setCurrentMatch(nextMatch);
    if (matchPositions[nextMatch - 1]) {
      setEditorPosition(matchPositions[nextMatch - 1]);
    }
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchQuery, totalMatches, currentMatch, matchPositions, setEditorPosition]);

  const handlePrevMatch = useCallback(() => {
    if (!searchQuery || totalMatches === 0) return;
    const prevMatch = currentMatch <= 1 ? totalMatches : currentMatch - 1;
    setCurrentMatch(prevMatch);
    if (matchPositions[prevMatch - 1]) {
      setEditorPosition(matchPositions[prevMatch - 1]);
    }
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchQuery, totalMatches, currentMatch, matchPositions, setEditorPosition]);

  const closeSearch = useCallback(() => {
    setSearchVisible(false);
    setSearchQuery('');
    setTotalMatches(0);
    setCurrentMatch(0);
    setMatchPositions([]);
    setEditorPosition(null);
  }, [setEditorPosition]);

  // Focus search input when search becomes visible
  useEffect(() => {
    if (searchVisible && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchVisible]);

  // Keyboard shortcut for search (Ctrl+F / Cmd+F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (!searchVisible) {
          setSearchVisible(true);
        }
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchVisible]);

  return {
    searchQuery,
    searchVisible,
    setSearchVisible,
    currentMatch,
    totalMatches,
    searchInputRef,
    handleSearch,
    handleNextMatch,
    handlePrevMatch,
    closeSearch,
  };
}
