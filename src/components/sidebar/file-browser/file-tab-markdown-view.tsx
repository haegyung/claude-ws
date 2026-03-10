'use client';

import { useCallback } from 'react';
import { MarkdownFileViewer } from '@/components/editor/markdown-file-viewer';
import { useSidebarStore } from '@/stores/sidebar-store';
import { waitForElement } from '@/lib/utils';

interface FileTabMarkdownViewProps {
  editedContent: string;
  filePath: string;
  basePath: string | null;
}

/**
 * Navigates the file explorer sidebar to a given folder path.
 * Opens sidebar, switches to files tab, expands parent folders, and scrolls to target.
 */
async function navigateToFolder(folderPath: string) {
  const store = useSidebarStore.getState();

  if (!store.isOpen) {
    store.setIsOpen(true);
  }

  store.setActiveTab('files');

  const pathParts = folderPath.replace(/\/$/, '').split('/').filter(Boolean);
  let currentPath = '';
  for (const part of pathParts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    store.expandFolder(currentPath);
  }

  const normalizedPath = folderPath.replace(/\/$/, '');
  store.setSelectedFile(normalizedPath);

  const element = await waitForElement(`[data-path="${normalizedPath}"]`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function FileTabMarkdownView({ editedContent, filePath, basePath }: FileTabMarkdownViewProps) {
  const handleLocalFileClick = useCallback(async (resolvedPath: string) => {
    const store = useSidebarStore.getState();
    const hasExtension = resolvedPath.includes('.') && !resolvedPath.endsWith('/');
    const looksLikeFolder = resolvedPath.endsWith('/') || !hasExtension;

    if (looksLikeFolder) {
      navigateToFolder(resolvedPath);
      return;
    }

    try {
      const res = await fetch(
        `/api/files/content?basePath=${encodeURIComponent(basePath || '')}&path=${encodeURIComponent(resolvedPath)}`
      );

      if (res.ok) {
        store.openTab(resolvedPath);
      } else {
        const data = await res.json();
        if (data.error === 'Path is not a file' || res.status === 400) {
          navigateToFolder(resolvedPath);
        } else {
          store.openTab(resolvedPath);
        }
      }
    } catch {
      store.openTab(resolvedPath);
    }
  }, [basePath]);

  return (
    <MarkdownFileViewer
      content={editedContent}
      className="h-full"
      currentFilePath={filePath}
      basePath={basePath}
      onLocalFileClick={handleLocalFileClick}
    />
  );
}
