'use client';

/**
 * Single commit row in the git graph view.
 * Renders the SVG connecting lines and commit dot on the left,
 * and the GitCommitItem text summary on the right.
 */

import { cn } from '@/lib/utils';
import { GitCommitItem } from './git-commit-item';
import { GRAPH_CONSTANTS } from '@/lib/git/path-generator';

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

interface LaneData {
  lane: number;
  color: string;
  commitHash: string;
}

interface PathData {
  d: string;
  color: string;
}

interface GitGraphCommitRowProps {
  commit: GitCommit;
  index: number;
  lane: LaneData;
  allCommits: GitCommit[];
  allLanes: LaneData[];
  paths: PathData[];
  head: string;
  hoveredCommit: string | null;
  onHover: (hash: string | null) => void;
  onSelect: (hash: string) => void;
}

/** Translate SVG path coordinates: offset X right and shift Y relative to current row */
function translatePath(d: string, offsetX: number, baseY: number): string {
  return d
    .replace(/M ([\d.]+) ([\d.]+)/g, (_, x, y) =>
      `M ${parseFloat(x) + offsetX} ${parseFloat(y) - baseY}`
    )
    .replace(/L ([\d.]+) ([\d.]+)/g, (_, x, y) =>
      `L ${parseFloat(x) + offsetX} ${parseFloat(y) - baseY}`
    )
    .replace(
      /C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)/g,
      (_, x1, y1, x2, y2, x3, y3) =>
        `C ${parseFloat(x1) + offsetX} ${parseFloat(y1) - baseY}, ` +
        `${parseFloat(x2) + offsetX} ${parseFloat(y2) - baseY}, ` +
        `${parseFloat(x3) + offsetX} ${parseFloat(y3) - baseY}`
    );
}

export function GitGraphCommitRow({
  commit,
  index,
  lane,
  allCommits,
  allLanes,
  paths,
  head,
  hoveredCommit,
  onHover,
  onSelect,
}: GitGraphCommitRowProps) {
  const OFFSET_X = 6;
  const rowY = index * GRAPH_CONSTANTS.ROW_HEIGHT + GRAPH_CONSTANTS.ROW_HEIGHT / 2;

  // Find the rightmost lane visible in this row (commit dot + all passing lines)
  let maxLaneInRow = lane.lane;
  allCommits.forEach((c, idx) => {
    c.parents.forEach((parentHash) => {
      const parentIndex = allCommits.findIndex((p) => p.hash === parentHash);
      if (parentIndex === -1) return;
      const minIdx = Math.min(idx, parentIndex);
      const maxIdx = Math.max(idx, parentIndex);
      if (index >= minIdx && index <= maxIdx) {
        const cLane = allLanes[idx].lane;
        const pLane = allLanes[parentIndex].lane;
        if (cLane > maxLaneInRow) maxLaneInRow = cLane;
        if (pLane > maxLaneInRow) maxLaneInRow = pLane;
      }
    });
  });

  const svgWidth =
    maxLaneInRow * GRAPH_CONSTANTS.LANE_WIDTH + OFFSET_X + GRAPH_CONSTANTS.DOT_RADIUS + 4;
  const baseY = index * GRAPH_CONSTANTS.ROW_HEIGHT;
  const dotX = lane.lane * GRAPH_CONSTANTS.LANE_WIDTH + OFFSET_X;
  const dotY = GRAPH_CONSTANTS.ROW_HEIGHT / 2;
  const isHighlighted = lane.commitHash === hoveredCommit;

  // Only paths that pass through this row
  const rowPaths = paths.filter(
    (path) => path.d.includes(` ${rowY}`) || path.d.includes(`,${rowY}`)
  );

  return (
    <div
      className={cn(
        'flex items-center transition-colors cursor-pointer',
        hoveredCommit === commit.hash && 'bg-accent/50'
      )}
      style={{ minHeight: `${GRAPH_CONSTANTS.ROW_HEIGHT}px` }}
      onMouseEnter={() => onHover(commit.hash)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(commit.hash)}
    >
      {/* Graph SVG — left side, dynamic width */}
      <div className="shrink-0 mr-0.5">
        <svg
          width={svgWidth}
          height={GRAPH_CONSTANTS.ROW_HEIGHT}
          className="overflow-visible"
        >
          {/* Connecting lines */}
          {rowPaths.map((path, pathIdx) => (
            <path
              key={`path-${pathIdx}`}
              d={translatePath(path.d, OFFSET_X, baseY)}
              stroke={path.color}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Commit dot */}
          <g>
            {isHighlighted && (
              <circle
                cx={dotX}
                cy={dotY}
                r={GRAPH_CONSTANTS.DOT_RADIUS + 3}
                fill={lane.color}
                fillOpacity={0.3}
                className="animate-pulse"
              />
            )}
            <circle
              cx={dotX}
              cy={dotY}
              r={GRAPH_CONSTANTS.DOT_RADIUS}
              fill={lane.color}
              stroke={isHighlighted ? '#fff' : 'rgba(0,0,0,0.15)'}
              strokeWidth={isHighlighted ? 1.5 : 1}
              className="cursor-pointer transition-all"
              onClick={() => onSelect(commit.hash)}
            />
          </g>
        </svg>
      </div>

      {/* Commit text — right side, takes remaining space */}
      <div className="flex-1 min-w-0">
        <GitCommitItem
          commit={commit}
          isHead={commit.hash === head}
          color={lane.color}
          isMerge={commit.parents.length > 1}
          showLine={false}
          onClick={() => onSelect(commit.hash)}
        />
      </div>
    </div>
  );
}
