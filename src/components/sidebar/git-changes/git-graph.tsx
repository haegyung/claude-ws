'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { CommitDetailsModal } from './commit-details-modal';
import { GitGraphCommitRow } from './git-graph-commit-row';
import { GitGraphToolbarHeader } from './git-graph-toolbar-header';
import { useActiveProject } from '@/hooks/use-active-project';
import { calculateLanes } from '@/lib/git/lane-calculator';
import { generatePaths } from '@/lib/git/path-generator';

interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
  refs: string[];
  isLocal?: boolean;
  isMerge?: boolean;
}

export function GitGraph() {
  const activeProject = useActiveProject();
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [head, setHead] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [hoveredCommit, setHoveredCommit] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState<'current' | 'all'>('current');

  const fetchLog = useCallback(async () => {
    if (!activeProject?.path) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/git/log?path=${encodeURIComponent(activeProject.path)}&limit=30&filter=${filter}`
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fetch git log');
      }
      const data = await res.json();
      setCommits(data.commits || []);
      setHead(data.head || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [activeProject?.path, filter]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  // Calculate graph data when commits change
  const graphData = useMemo(() => {
    if (commits.length === 0) return null;

    const laneData = calculateLanes(commits);
    const paths = generatePaths(laneData.lanes, commits);

    return {
      lanes: laneData.lanes,
      paths,
      maxLane: laneData.maxLane,
    };
  }, [commits]);

  // Git remote operations
  const gitAction = useCallback(async (action: 'fetch' | 'pull' | 'push') => {
    if (!activeProject?.path) return;
    setActionLoading(action);
    try {
      const res = await fetch(`/api/git/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: activeProject.path }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${action}`);
      }
      fetchLog(); // Refresh after action
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  }, [activeProject?.path, fetchLog]);

  if (!activeProject) return null;

  return (
    <div className="mb-1">
      <GitGraphToolbarHeader
        isExpanded={isExpanded}
        filter={filter}
        loading={loading}
        actionLoading={actionLoading}
        onToggleExpand={() => setIsExpanded(!isExpanded)}
        onToggleFilter={() => setFilter(filter === 'current' ? 'all' : 'current')}
        onFetch={() => gitAction('fetch')}
        onPull={() => gitAction('pull')}
        onPush={() => gitAction('push')}
        onRefresh={fetchLog}
      />

      {/* Commit list */}
      {isExpanded && (
        <div className="mt-0.5">
          {loading && commits.length === 0 ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="px-2 py-2 text-xs text-destructive">{error}</div>
          ) : commits.length === 0 ? (
            <div className="px-2 py-4 text-xs text-muted-foreground text-center">
              No commits yet
            </div>
          ) : graphData ? (
            <div className="space-y-0">
              {commits.map((commit, index) => (
                <GitGraphCommitRow
                  key={commit.hash}
                  commit={commit}
                  index={index}
                  lane={graphData.lanes[index]}
                  allCommits={commits}
                  allLanes={graphData.lanes}
                  paths={graphData.paths}
                  head={head}
                  hoveredCommit={hoveredCommit}
                  onHover={setHoveredCommit}
                  onSelect={(hash) => {
                    setSelectedCommit(hash);
                    setModalOpen(true);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Commit Details Modal */}
      <CommitDetailsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        commitHash={selectedCommit}
        projectPath={activeProject.path}
      />
    </div>
  );
}
