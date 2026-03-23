'use client';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;

/** Visual triangle size in px */
const CORNER_VISUAL_SIZE = 12;
/** Hit area size for corner handles - larger for easier targeting */
const CORNER_HIT_SIZE = 24;
/** How far the hit area extends outside the window border */
const CORNER_OUTSET = 8;

interface ResizeHandlesProps {
  onResizeStart: (direction: ResizeDirection, e: React.MouseEvent) => void;
}

interface CornerHandleConfig {
  direction: ResizeDirection;
  cursor: string;
  /** CSS to anchor the hit area flush to the corner */
  hitStyle: React.CSSProperties;
  /** CSS to position the visual triangle inside the hit area */
  visualStyle: React.CSSProperties;
  gradient: string;
}

const CORNER_HANDLES: CornerHandleConfig[] = [
  {
    direction: 'nw',
    cursor: 'cursor-nwse-resize',
    hitStyle: { top: -CORNER_OUTSET, left: -CORNER_OUTSET },
    visualStyle: { top: CORNER_OUTSET, left: CORNER_OUTSET },
    gradient: 'linear-gradient(135deg, hsl(var(--border)) 50%, transparent 50%)',
  },
  {
    direction: 'ne',
    cursor: 'cursor-nesw-resize',
    hitStyle: { top: -CORNER_OUTSET, right: -CORNER_OUTSET },
    visualStyle: { top: CORNER_OUTSET, right: CORNER_OUTSET },
    gradient: 'linear-gradient(-135deg, hsl(var(--border)) 50%, transparent 50%)',
  },
  {
    direction: 'sw',
    cursor: 'cursor-nesw-resize',
    hitStyle: { bottom: -CORNER_OUTSET, left: -CORNER_OUTSET },
    visualStyle: { bottom: CORNER_OUTSET, left: CORNER_OUTSET },
    gradient: 'linear-gradient(45deg, hsl(var(--border)) 50%, transparent 50%)',
  },
  {
    direction: 'se',
    cursor: 'cursor-nwse-resize',
    hitStyle: { bottom: -CORNER_OUTSET, right: -CORNER_OUTSET },
    visualStyle: { bottom: CORNER_OUTSET, right: CORNER_OUTSET },
    gradient: 'linear-gradient(-45deg, hsl(var(--border)) 50%, transparent 50%)',
  },
];

interface EdgeHandleConfig {
  direction: ResizeDirection;
  position: string;
  cursor: string;
  style: React.CSSProperties;
}

const EDGE_HANDLES: EdgeHandleConfig[] = [
  {
    direction: 'n',
    position: 'top-0 left-0 right-0',
    cursor: 'cursor-ns-resize',
    style: { height: '8px', marginTop: '-4px', background: 'transparent' },
  },
  {
    direction: 's',
    position: 'bottom-0 left-0 right-0',
    cursor: 'cursor-ns-resize',
    style: { height: '8px', marginBottom: '-4px', background: 'transparent' },
  },
  {
    direction: 'w',
    position: 'top-0 bottom-0 left-0',
    cursor: 'cursor-ew-resize',
    style: { width: '8px', marginLeft: '-4px', background: 'transparent' },
  },
  {
    direction: 'e',
    position: 'top-0 bottom-0 right-0',
    cursor: 'cursor-ew-resize',
    style: { width: '8px', marginRight: '-4px', background: 'transparent' },
  },
];

/** Resize handles for all 4 corners and 4 edges of a detachable window */
export function DetachableWindowResizeHandles({ onResizeStart }: ResizeHandlesProps) {
  return (
    <>
      {/* Corner handles: large invisible hit area + small visual triangle */}
      {CORNER_HANDLES.map(({ direction, cursor, hitStyle, visualStyle, gradient }) => (
        <div
          key={direction}
          className={`absolute ${cursor} group/corner`}
          style={{
            ...hitStyle,
            width: `${CORNER_HIT_SIZE}px`,
            height: `${CORNER_HIT_SIZE}px`,
            zIndex: 1,
          }}
          onMouseDown={(e) => onResizeStart(direction, e)}
        >
          {/* Visual triangle indicator - opacity controlled by parent hover */}
          <div
            className="absolute opacity-50 group-hover/corner:opacity-100 transition-opacity pointer-events-none"
            style={{
              ...visualStyle,
              width: `${CORNER_VISUAL_SIZE}px`,
              height: `${CORNER_VISUAL_SIZE}px`,
              background: gradient,
            }}
          />
        </div>
      ))}
      {/* Edge handles */}
      {EDGE_HANDLES.map(({ direction, position, cursor, style }) => (
        <div
          key={direction}
          className={`absolute ${position} ${cursor} hover:opacity-100 opacity-0 transition-opacity`}
          style={style}
          onMouseDown={(e) => onResizeStart(direction, e)}
        />
      ))}
    </>
  );
}
