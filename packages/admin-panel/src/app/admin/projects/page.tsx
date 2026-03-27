"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen, Search, Activity, Container, Clock, FileText } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { CreateProjectModal } from "@/components/admin/create-project-modal";
import { ProjectDetailsDialog } from "@/components/admin/project-details-dialog";

interface Project {
  id: string;
  name: string;
  description?: string | null;
  containerId?: string;
  container_id?: string;
  containerPort?: number;
  container_port?: number;
  dataPath?: string;
  data_path?: string;
  gatewayPath?: string;
  gateway_path?: string;
  status: string;
  createdAt?: string;
  created_at?: string;
  lastActivityAt?: string;
  last_activity_at?: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (statusFilter !== "all") {
        params.set('status', statusFilter);
      }

      const response = await fetch(`/api/admin/projects?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchProjects();
    const interval = setInterval(fetchProjects, 10000);
    return () => clearInterval(interval);
  }, [fetchProjects]);

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              Projects
            </h1>
            <p className="text-gray-600 mt-2">Manage your isolated project environments</p>
          </div>
          <CreateProjectModal onProjectCreated={fetchProjects} />
        </div>

        {/* Filters */}
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Label htmlFor="search">Search Projects</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="search"
                    type="text"
                    placeholder="Search by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 glass-input"
                  />
                </div>
              </div>
              <div className="w-48">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg backdrop-blur-sm bg-white/50 border border-white/30 hover:bg-white/70 transition-all text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="allocated">Allocated</option>
                  <option value="stopped">Stopped</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Projects Grid */}
        <div className="space-y-4">
          {filteredProjects.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="pt-6">
                <div className="text-center text-gray-500 py-8">
                  <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No projects found</p>
                  <p className="text-sm mt-2">Create a new project to get started</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            filteredProjects.map((project) => {
              const containerId = project.container_id || project.containerId || 'N/A';
              const containerPort = project.container_port ?? project.containerPort ?? 'N/A';
              const folderPath = project.data_path || project.dataPath || 'N/A';
              const gatewayPath = project.gateway_path || project.gatewayPath || `/api/gateway/${project.id}`;
              const lastActivity = project.last_activity_at || project.lastActivityAt || '';

              return (
                <Card
                  key={project.id}
                  className="glass-card hover:scale-[1.01] transition-transform duration-300 cursor-pointer"
                  onClick={() => {
                    setSelectedProject(project);
                    setDialogOpen(true);
                  }}
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-semibold text-xl">
                            {project.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1">
                            <h3 className="font-bold text-xl text-gray-900">{project.name}</h3>
                            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-600">
                              <span className="flex items-center gap-1">
                                <Activity className="w-4 h-4" />
                                ID: {project.id}
                              </span>
                              <span className="flex items-center gap-1">
                                <Container className="w-4 h-4" />
                                {containerId}
                              </span>
                              <span className="flex items-center gap-1">
                                <FileText className="w-4 h-4" />
                                Port: {containerPort}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {formatLastActivity(lastActivity)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                project.status === 'allocated'
                                  ? 'bg-green-100 text-green-800 border-green-300'
                                  : project.status === 'idle'
                                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                                  : 'bg-gray-100 text-gray-800 border-gray-300'
                              }
                            >
                              {project.status}
                            </Badge>
                            <span className="text-sm text-gray-600">Gateway: {gatewayPath}</span>
                          </div>
                          <p className="text-sm text-gray-600">Folder: {folderPath}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <ProjectDetailsDialog
          project={selectedProject}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onProjectUpdate={fetchProjects}
        />
      </div>
    </div>
  );
}

function formatLastActivity(dateString: string): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'N/A';
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