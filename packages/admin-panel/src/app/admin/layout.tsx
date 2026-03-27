"use client";

import './globals.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === '/admin') {
      return pathname === '/admin' || pathname === '/admin/';
    }
    return pathname === path;
  };

  const getButtonClass = (path: string) => {
    const baseClass = "px-4 py-2 rounded-lg transition-all text-sm font-medium";
    const activeClass = "backdrop-blur-sm bg-white/90 border-2 border-purple-300 shadow-md text-purple-700";
    const inactiveClass = "backdrop-blur-sm bg-white/50 border border-white/30 hover:bg-white/70 text-gray-700";

    return isActive(path) ? `${baseClass} ${activeClass}` : `${baseClass} ${inactiveClass}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50 to-blue-50">
      {/* Navigation */}
      <nav className="backdrop-blur-xl bg-white/70 border-b border-white/20 shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold shadow-lg">
                C
              </div>
              <div>
                <h1 className="font-bold text-gray-900">Claude WS Admin</h1>
                <p className="text-xs text-gray-600">Multi-Project Management</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Link href="/admin" className={getButtonClass('/admin')}>
                Dashboard
              </Link>
              <Link href="/admin/projects" className={getButtonClass('/admin/projects')}>
                Projects
              </Link>
              <Link href="/admin/logs" className={getButtonClass('/admin/logs')}>
                Logs
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="container mx-auto py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="backdrop-blur-xl bg-white/30 border-t border-white/20 mt-12">
        <div className="container mx-auto px-8 py-6 text-center text-sm text-gray-600">
          <p>Claude Workspace Admin Dashboard • Pool Management System</p>
          <p className="mt-1 text-xs">Container isolation for secure project execution</p>
        </div>
      </footer>
    </div>
  );
}