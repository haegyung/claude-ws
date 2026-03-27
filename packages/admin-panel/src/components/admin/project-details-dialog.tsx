"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Container, Clock, FileText, FolderOpen, Loader2 } from "lucide-react";

interface ProjectDetails {
  id: string;
  name: string;
  description?: string | null;
  containerId?: string;
  containerPort?: number;
  dataPath?: string;
  data_path?: string;
  gatewayPath?: string;
  gateway_path?: string;
  status: string;
  createdAt?: string;
  created_at?: string;
  lastActivityAt?: string;
  last_activity_at?: string;
  stoppedAt?: string;
  stopped_at?: string;
}

interface ContainerInfo {
  containerId: string;
  status: string;
  containerPort: number;
  healthStatus: string;
  createdAt: string;
}

interface ProjectDetailsDialogProps {
  project: ProjectDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectUpdate?: () => void;
}

export function ProjectDetailsDialog({
  project,
  open,
  onOpenChange,
  onProjectUpdate,
}: ProjectDetailsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [containerInfo, setContainerInfo] = useState<ContainerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project?.containerId && open) {
      fetchContainerInfo(project.containerId);
    }
  }, [project?.containerId, open]);

  const fetchContainerInfo = async (containerId: string) => {
    try {
      const response = await fetch(`/api/admin/containers`);
      if (response.ok) {
        const data = await response.json();
        const container = data.containers.find((c: ContainerInfo) => c.id === containerId);
        setContainerInfo(container || null);
      }
    } catch (err) {
      console.error('Failed to fetch container info:', err);
    }
  };

  const handleStart = async () => {
    if (!project) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/projects/${project.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        onProjectUpdate?.();
        onOpenChange(false);
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to start project');
      }
    } catch (err) {
      setError('Failed to start project');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    const gatewayPath = project?.gateway_path || project?.gatewayPath;
    if (gatewayPath) {
      window.open(gatewayPath, '_blank');
    }
  };

  if (!project) return null;

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'allocated':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'idle':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'stopping':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'stopped':
        return 'bg-gray-100 text-gray-800 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const canStart = project.status === 'idle' || project.status === 'stopped';
  const canOpen = project.status === 'allocated';
  const isStopping = project.status === 'stopping';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-white/90 border border-white/20 shadow-xl sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-semibold">
              {project.name.charAt(0).toUpperCase()}
            </div>
            {project.name}
          </DialogTitle>
          <DialogDescription className="text-base">
            Project details and container information
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Status Badge */}
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={getStatusBadgeClass(project.status)}>
              {project.status.toUpperCase()}
            </Badge>
            {isStopping && (
              <span className="text-sm text-orange-600 flex items-center gap-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                Stopping...
              </span>
            )}
          </div>

          {/* Project Details */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-600" />
              Project Information
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Project ID:</span>
                <span className="font-mono text-gray-900">{project.id}</span>
              </div>
              {project.description && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Description:</span>
                  <span className="text-gray-900 max-w-xs truncate">{project.description}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Created:</span>
                <span className="text-gray-900">{formatDate(project.created_at || project.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Last Activity:</span>
                <span className="text-gray-900">{formatLastActivity(project.last_activity_at || project.lastActivityAt)}</span>
              </div>
            </div>
          </div>

          {/* Container Details */}
          {project.containerId && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Container className="w-5 h-5 text-blue-600" />
                Container Information
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Container ID:</span>
                  <span className="font-mono text-gray-900 text-xs">{project.containerId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Port:</span>
                  <span className="text-gray-900">{project.containerPort || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Health Status:</span>
                  <span className={`font-medium ${
                    containerInfo?.healthStatus === 'healthy'
                      ? 'text-green-600'
                      : 'text-red-600'
                  }`}>
                    {containerInfo?.healthStatus || 'Unknown'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Gateway:</span>
                  <span className="text-purple-600 font-mono text-xs">{project.gateway_path || project.gatewayPath}</span>
                </div>
              </div>
            </div>
          )}

          {/* Data Path */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-green-600" />
              Data Storage
            </h3>
            <div className="text-sm">
              <span className="text-gray-600">Path:</span>
              <span className="ml-2 font-mono text-xs text-gray-900">{project.data_path || project.dataPath || 'N/A'}</span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            {canOpen && (
              <Button
                onClick={handleOpen}
                className="bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white shadow-lg"
              >
                Open Project
              </Button>
            )}
            {canStart && (
              <Button
                onClick={handleStart}
                disabled={loading}
                className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4 mr-2" />
                    Start Project
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatLastActivity(dateString?: string): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}