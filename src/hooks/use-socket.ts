import { useGlobalSocket } from '@/components/providers/socket-provider';

/**
 * Access the global Socket.IO instance.
 * Thin wrapper around useGlobalSocket for backward compatibility.
 */
export function useSocket() {
  return useGlobalSocket();
}
