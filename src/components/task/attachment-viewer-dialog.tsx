'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Download, X, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { isImageMimeType } from './conversation-view-utils';
import { cn } from '@/lib/utils';
import type { AttemptFile } from '@/types';

interface AttachmentViewerDialogProps {
  files: AttemptFile[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Fullscreen overlay for viewing attached files with pinch-to-zoom on images.
 * No toolbar — just the image, nav arrows, and a close button.
 */
export function AttachmentViewerDialog({
  files,
  initialIndex,
  open,
  onOpenChange,
}: AttachmentViewerDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const lastPinchDist = useRef<number | null>(null);
  const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const file = files[currentIndex];
  const isImage = file ? isImageMimeType(file.mimeType) : false;
  const isPdf = file?.mimeType === 'application/pdf';
  const hasMultiple = files.length > 1;
  const fileUrl = file ? `/api/uploads/${file.id}` : '';

  const resetTransform = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const goTo = useCallback((index: number) => {
    setCurrentIndex(index);
    resetTransform();
  }, [resetTransform]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
      if (e.key === 'ArrowLeft' && currentIndex > 0) goTo(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < files.length - 1) goTo(currentIndex + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, currentIndex, files.length, goTo, onOpenChange]);

  // Pinch-to-zoom + pan via touch
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
      lastTouchCenter.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    } else if (e.touches.length === 1 && scale > 1) {
      isDragging.current = true;
      dragStart.current = { x: e.touches[0].clientX - translate.x, y: e.touches[0].clientY - translate.y };
    }
  }, [scale, translate]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDist.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / lastPinchDist.current;
      lastPinchDist.current = dist;
      setScale(s => Math.max(0.5, Math.min(5, s * ratio)));
    } else if (e.touches.length === 1 && isDragging.current) {
      setTranslate({
        x: e.touches[0].clientX - dragStart.current.x,
        y: e.touches[0].clientY - dragStart.current.y,
      });
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = null;
    lastTouchCenter.current = null;
    isDragging.current = false;
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!isImage) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(s => Math.max(0.5, Math.min(5, s * delta)));
  }, [isImage]);

  // Mouse drag when zoomed
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1 || !isImage) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX - translate.x, y: e.clientY - translate.y };
    e.preventDefault();
  }, [scale, translate, isImage]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setTranslate({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Double-tap to reset / zoom
  const lastTapRef = useRef(0);
  const handleDoubleAction = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (scale > 1) resetTransform();
      else { setScale(2); setTranslate({ x: 0, y: 0 }); }
    }
    lastTapRef.current = now;
  }, [scale, resetTransform]);

  // Close on backdrop click (only if not dragging/zoomed)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current && scale <= 1) {
      onOpenChange(false);
    }
  }, [scale, onOpenChange]);

  if (!open || !file) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center">
      {/* Close button */}
      <button
        onClick={() => onOpenChange(false)}
        className="absolute top-3 right-3 z-10 size-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
      >
        <X className="size-5 text-white" />
      </button>

      {/* Download button */}
      <a
        href={fileUrl}
        download={file.originalName}
        className="absolute top-3 right-14 z-10 size-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        title="Download"
      >
        <Download className="size-5 text-white" />
      </a>

      {/* File counter */}
      {hasMultiple && (
        <span className="absolute top-3 left-3 z-10 text-white/70 text-sm px-2 py-1 bg-white/10 rounded">
          {currentIndex + 1} / {files.length}
        </span>
      )}

      {/* Navigation arrows */}
      {hasMultiple && currentIndex > 0 && (
        <button
          onClick={() => goTo(currentIndex - 1)}
          className="absolute left-3 z-10 size-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="size-6 text-white" />
        </button>
      )}
      {hasMultiple && currentIndex < files.length - 1 && (
        <button
          onClick={() => goTo(currentIndex + 1)}
          className="absolute right-3 z-10 size-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        >
          <ChevronRight className="size-6 text-white" />
        </button>
      )}

      {/* Content */}
      <div
        ref={containerRef}
        className={cn(
          'w-full h-full flex items-center justify-center overflow-hidden',
          scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        )}
        onClick={handleBackdropClick}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {isImage ? (
          <img
            src={fileUrl}
            alt={file.originalName}
            className="select-none"
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transition: isDragging.current ? 'none' : 'transform 0.15s ease-out',
              touchAction: 'none',
            }}
            draggable={false}
            onClick={handleDoubleAction}
          />
        ) : isPdf ? (
          <iframe
            src={fileUrl}
            className="w-[90vw] h-[90vh] border-0 rounded"
            title={file.originalName}
          />
        ) : (
          <div className="text-center text-white/70">
            <FileText className="size-12 mx-auto mb-3 text-white/40" />
            <p className="text-sm mb-1">{file.originalName}</p>
            <p className="text-xs mb-4">{file.mimeType}</p>
            <a
              href={fileUrl}
              download={file.originalName}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
            >
              <Download className="size-4" />
              Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
