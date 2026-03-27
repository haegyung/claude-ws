"use client";

import { ContainerLogsViewer } from "@/components/admin/container-logs-viewer";

export default function LogsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
            Container Logs
          </h1>
          <p className="text-gray-600 mt-2">View real-time logs from active containers</p>
        </div>

        {/* Logs Viewer */}
        <ContainerLogsViewer />
      </div>
    </div>
  );
}
