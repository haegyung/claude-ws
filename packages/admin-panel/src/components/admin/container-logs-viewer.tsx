"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Loader2, RefreshCw, Clock, Container } from "lucide-react";

interface Container {
  id: string;
  port: number;
  status: string;
  projectId?: string;
  projectName?: string;
  healthStatus: string;
}

interface LogsData {
  container_id: string;
  logs: string;
  fetched_at: string;
}

export function ContainerLogsViewer() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Fetch containers list
  useEffect(() => {
    fetchContainers();
    const interval = setInterval(fetchContainers, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Fetch logs whenever container selection changes
  useEffect(() => {
    if (!selectedContainerId) return;
    fetchLogs(selectedContainerId);
  }, [selectedContainerId]);

  // Auto-refresh logs
  useEffect(() => {
    if (!autoRefresh || !selectedContainerId) return;

    const interval = setInterval(() => {
      fetchLogs(selectedContainerId, false);
    }, 5000); // Refresh every 5s

    return () => clearInterval(interval);
  }, [autoRefresh, selectedContainerId]);

  // Auto-scroll to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const fetchContainers = async () => {
    try {
      const response = await fetch('/api/admin/containers?status=allocated');
      if (response.ok) {
        const data = await response.json();
        const nextContainers = data.containers || [];
        setContainers(nextContainers);

        // Auto-select first container only when there is no current selection
        setSelectedContainerId((current) => current ?? (nextContainers[0]?.id ?? null));
      }
    } catch (err) {
      console.error('Failed to fetch containers:', err);
    }
  };

  const fetchLogs = async (containerId: string, showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/containers/${containerId}/logs?tail=200&timestamps=true`);

      if (response.ok) {
        const data: LogsData = await response.json();
        setLogs(data.logs || '');
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to fetch logs');
        setLogs('');
      }
    } catch (err) {
      setError('Failed to fetch logs');
      console.error(err);
      setLogs('');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleContainerChange = (containerId: string) => {
    setSelectedContainerId(containerId);
    setLogs('');
    setError(null);
  };

  const handleRefresh = () => {
    if (selectedContainerId) {
      fetchLogs(selectedContainerId);
    }
  };

  const selectedContainer = containers.find(c => c.id === selectedContainerId);

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-purple-600" />
            Container Logs
            {selectedContainer && (
              <Badge variant="outline" className="ml-2 bg-blue-100 text-blue-800 border-blue-300">
                {selectedContainer.projectName || selectedContainer.projectId || 'Unknown'}
              </Badge>
            )}
          </CardTitle>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Container Selector */}
            <Select
              value={selectedContainerId || ""}
              onValueChange={handleContainerChange}
              disabled={containers.length === 0}
            >
              <SelectTrigger className="w-[250px] backdrop-blur-sm bg-white/50 border-white/30">
                <SelectValue placeholder="Select container" />
              </SelectTrigger>
              <SelectContent>
                {containers.map(container => (
                  <SelectItem key={container.id} value={container.id}>
                    <div className="flex items-center gap-2">
                      <Container className="w-4 h-4" />
                      {container.projectName || container.projectId || container.id}
                      <Badge variant="outline" className="text-xs ml-2 bg-green-100 text-green-800 border-green-300">
                        {container.port}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Auto-refresh Toggle */}
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
              disabled={!selectedContainerId}
              className={autoRefresh ? "bg-green-500 hover:bg-green-600" : "hover:bg-purple-50"}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {autoRefresh ? 'Auto: On' : 'Auto: Off'}
            </Button>

            {/* Manual Refresh */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={!selectedContainerId || loading}
              className="hover:bg-purple-50"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {!selectedContainerId ? (
          <div className="text-center text-gray-500 py-12">
            <Container className="w-16 h-16 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No Container Selected</p>
            <p className="text-sm mt-2">
              {containers.length === 0
                ? "No active containers found. Start a project first."
                : "Select a container from the dropdown to view its logs."}
            </p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
            <div className="flex items-center gap-2">
              <Container className="w-5 h-5" />
              <div>
                <p className="font-medium">Error fetching logs</p>
                <p className="text-sm mt-1">{error}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative">
            {loading && (
              <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-purple-600" />
                  <span className="text-sm text-gray-600">Loading logs...</span>
                </div>
              </div>
            )}

            <div className="bg-gray-900 rounded-lg p-4 h-[500px] overflow-y-auto font-mono text-sm">
              {logs ? (
                <pre className="whitespace-pre-wrap break-words text-gray-100">
                  {logs.split('\n').map((line, i) => (
                    <div key={i} className="hover:bg-gray-800 px-2 py-0.5 -mx-2">
                      {formatLogLine(line)}
                    </div>
                  ))}
                </pre>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center">
                    <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No log lines yet</p>
                  </div>
                </div>
              )}
              <div ref={logsEndRef} />
            </div>

            {/* Logs Footer */}
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span>Last updated: {new Date().toLocaleTimeString()}</span>
              </div>
              <div>
                Lines: {logs ? logs.split('\n').length : 0}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatLogLine(line: string): React.ReactNode {
  if (!line) return '\n';

  // Highlight log levels
  if (line.includes('ERROR') || line.includes('error')) {
    return <span className="text-red-400">{line}</span>;
  }
  if (line.includes('WARN') || line.includes('warn')) {
    return <span className="text-yellow-400">{line}</span>;
  }
  if (line.includes('INFO') || line.includes('info')) {
    return <span className="text-green-400">{line}</span>;
  }

  return <span className="text-gray-100">{line}</span>;
}
