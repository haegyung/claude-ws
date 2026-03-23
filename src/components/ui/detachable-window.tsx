'use client';

import { useEffect, useRef, useState } from 'react';
import { X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobileViewport } from '@/hooks/use-mobile-viewport';
import { loadWindowData, saveWindowData, MIN_WIDTH, MIN_HEIGHT } from '@/components/ui/detachable-window-storage';
import { DetachableWindowResizeHandles, type ResizeDirection } from '@/components/ui/detachable-window-resize-handles';

interface DetachableWindowProps {
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  initialSize?: { width: number; height: number };
  footer?: React.ReactNode;
  storageKey?: string;
  title?: React.ReactNode;
  titleCenter?: React.ReactNode;
  headerEnd?: React.ReactNode;
  key?: string;
  /** Dynamic z-index for window layering (default: 60) */
  zIndex?: number;
  /** Callback when window is clicked/focused to bring to front */
  onFocus?: () => void;
}

const DEFAULT_SIZE = { width: 500, height: 800 };
const HEADER_HEIGHT = 48;

export function DetachableWindow({
  isOpen,
  onClose,
  children,
  className,
  initialSize = DEFAULT_SIZE,
  footer,
  storageKey = 'chat',
  title,
  titleCenter,
  headerEnd,
  key,
  zIndex = 60,
  onFocus,
}: DetachableWindowProps) {
  const isMobile = useIsMobileViewport();
  const [{ position, size }, setWindowState] = useState(() =>
    loadWindowData(storageKey, initialSize)
  );
  const [isDragging, setIsDragging] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<ResizeDirection>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragStartSize = useRef({ width: 0, height: 0 });
  const dragStartPosition = useRef({ x: 0, y: 0 });
  const windowRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const [isOpenState, setIsOpenState] = useState(isOpen);

  // Sync isOpen prop with internal state
  useEffect(() => {
    setIsOpenState(isOpen);
    // Reload saved position/size when reopening (desktop only)
    if (isOpen && !isMobile) {
      const saved = loadWindowData(storageKey, initialSize);
      setWindowState({ position: saved.position, size: saved.size });
    }
  }, [isOpen, storageKey, initialSize, isMobile]);

  // Reset isOpenState when the component re-renders while in detached mode
  useEffect(() => {
    if (isOpen && !isOpenState) {
      setIsOpenState(true);
    }
  }, [isOpen, isOpenState]);

  const handleClose = () => {
    setIsOpenState(false);
    onClose?.();
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if (isMobile) return;
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;

    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragStartPosition.current = { ...position };
    e.preventDefault();
  };

  const handleResizeStart = (direction: ResizeDirection, e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setResizeDirection(direction);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragStartSize.current = { ...size };
    dragStartPosition.current = { ...position };
  };

  // Handle dragging (desktop only)
  useEffect(() => {
    if (!isDragging || isMobile) return;

    const startPos = dragStartPosition.current;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      setWindowState((prev) => ({
        ...prev,
        position: { x: startPos.x + dx, y: startPos.y + dy },
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setWindowState((current) => {
        saveWindowData(storageKey, current.position, current.size);
        return current;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, storageKey, isMobile]);

  // Handle resizing from all sides/corners (desktop only)
  useEffect(() => {
    if (!resizeDirection || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;

      let newSize = { ...size };
      let newPos = { ...position };
      const startSize = dragStartSize.current;
      const startPos = dragStartPosition.current;

      if (resizeDirection.includes('e')) {
        newSize.width = Math.max(MIN_WIDTH, startSize.width + dx);
      }
      if (resizeDirection.includes('w')) {
        const newWidth = Math.max(MIN_WIDTH, startSize.width - dx);
        newSize.width = newWidth;
        newPos.x = startPos.x + (startSize.width - newWidth);
      }
      if (resizeDirection.includes('s')) {
        newSize.height = Math.max(MIN_HEIGHT, startSize.height + dy);
      }
      if (resizeDirection.includes('n')) {
        const newHeight = Math.max(MIN_HEIGHT, startSize.height - dy);
        newSize.height = newHeight;
        newPos.y = startPos.y + (startSize.height - newHeight);
      }

      setWindowState({ position: newPos, size: newSize });
    };

    const handleMouseUp = () => {
      setResizeDirection(null);
      setWindowState((current) => {
        saveWindowData(storageKey, current.position, current.size);
        return current;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizeDirection, storageKey, isMobile]);

  // Ensure window stays within viewport (desktop only)
  useEffect(() => {
    if (!windowRef.current || isMobile) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let needsUpdate = false;
    let newPos = { ...position };
    let newSize = { ...size };

    if (size.width > viewportWidth) {
      newSize.width = viewportWidth;
      needsUpdate = true;
    }
    if (size.height > viewportHeight) {
      newSize.height = viewportHeight;
      needsUpdate = true;
    }
    if (position.x < 0) {
      newPos.x = 0;
      needsUpdate = true;
    }
    if (position.y < 0) {
      newPos.y =  0;
      needsUpdate = true;
    }
    if (position.x + newSize.width > viewportWidth) {
      newPos.x = Math.max(0, viewportWidth - newSize.width);
      needsUpdate = true;
    }
    if (position.y + newSize.height > viewportHeight) {
      newPos.y = Math.max(0, viewportHeight - newSize.height);
      needsUpdate = true;
    }

    if (needsUpdate) {
      setWindowState({ position: newPos, size: newSize });
      saveWindowData(storageKey, newPos, newSize);
    }
  }, [position, size, storageKey, isMobile]);

  if (!isOpenState) return null;

  const handleWindowFocus = () => {
    onFocus?.();
  };

  // Mobile: simple flex container that fills its parent
  if (isMobile) {
    return (
      <div
        ref={windowRef}
        className={cn(
          'flex flex-col flex-1 min-h-0 bg-background',
          className
        )}
      >
        <div
          className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 select-none gap-2 relative"
          style={{ height: `${HEADER_HEIGHT}px` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {title || (
              <span className="text-sm font-medium">Chat</span>
            )}
          </div>
          {titleCenter && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm text-muted-foreground text-center line-clamp-2 max-w-[50%] leading-tight font-medium">
              {titleCenter}
            </div>
          )}
          <div className="flex items-center gap-1 min-w-0" data-no-drag>
            {headerEnd}
            <button
              onClick={handleClose}
              className="p-1 hover:bg-accent rounded transition-colors shrink-0"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col flex-1 overflow-hidden">
          <div ref={contentScrollRef} className="flex-1 overflow-auto" data-detached-scroll-container>
            {children}
          </div>
          {footer && (
            <div className="flex-shrink-0 bg-background">
              {footer}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop: fixed positioned, draggable, resizable window
  return (
    <div
      ref={windowRef}
      onMouseDown={handleWindowFocus}
      className={cn(
        'fixed flex flex-col',
        isDragging && 'cursor-grabbing',
        className
      )}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        zIndex: zIndex,
      }}
    >
      {/* Inner container clips content to rounded corners */}
      <div className="flex flex-col flex-1 min-h-0 bg-background border-2 shadow-lg rounded-lg overflow-hidden">
        {/* Draggable Header */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 cursor-grab hover:bg-muted/50 transition-colors select-none gap-2 relative"
          onMouseDown={handleDragStart}
          style={{ height: `${HEADER_HEIGHT}px` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {title || (
              <>
                <GripVertical className="size-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Chat</span>
              </>
            )}
          </div>
          {titleCenter && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm text-muted-foreground text-center line-clamp-2 max-w-[50%] leading-tight font-medium">
                  {titleCenter}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="break-words whitespace-pre-wrap">{String(titleCenter)}</p>
              </TooltipContent>
            </Tooltip>
          )}
          <div className="flex items-center gap-1 min-w-0" data-no-drag>
            {headerEnd}
            <button
              onClick={handleClose}
              className="p-1 hover:bg-accent rounded transition-colors shrink-0"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div ref={contentScrollRef} className="flex-1 overflow-auto" data-detached-scroll-container>
            {children}
          </div>
          {footer && (
            <div className="flex-shrink-0 bg-background">
              {footer}
            </div>
          )}
        </div>
      </div>

      <DetachableWindowResizeHandles onResizeStart={handleResizeStart} />
    </div>
  );
}
