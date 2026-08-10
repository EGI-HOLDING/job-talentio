'use client';

import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getToken } from '@/lib/api';

export type PresenceStatus = { isOnline: boolean; lastSeenAt: string | null };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const HEARTBEAT_MS = 25_000;
const REFRESH_MS = 60_000;
const BATCH_LIMIT = 50;

/**
 * Module-level presence store: one Socket.IO connection per tab (keeps the
 * signed-in user visible as online anywhere in the app) plus a shared
 * userId -> status cache hydrated by batch GET /presence and updated live by
 * `presence:update` events from conversation peers.
 */
let socket: Socket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const cache = new Map<string, PresenceStatus>();
const pendingFetch = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Seed the cache from server-embedded payloads (search items, DTOs). */
export function seedPresence(userId: string, status: PresenceStatus | null | undefined) {
  if (!userId || !status) return;
  if (!cache.has(userId)) {
    cache.set(userId, status);
    notify();
  }
}

async function fetchStatuses(ids: string[]) {
  const missing = ids.filter((id) => id && !pendingFetch.has(id));
  if (!missing.length) return;
  for (const id of missing) pendingFetch.add(id);
  try {
    for (let i = 0; i < missing.length; i += BATCH_LIMIT) {
      const chunk = missing.slice(i, i + BATCH_LIMIT);
      const map = await api<Record<string, PresenceStatus>>(
        `/presence?ids=${encodeURIComponent(chunk.join(','))}`,
      );
      for (const [id, status] of Object.entries(map)) cache.set(id, status);
    }
    notify();
  } catch {
    /* presence is best-effort */
  } finally {
    for (const id of missing) pendingFetch.delete(id);
  }
}

/** Connect the presence socket for the signed-in user (idempotent). */
export function connectPresence() {
  if (socket || typeof window === 'undefined') return;
  const token = getToken();
  if (!token) return;
  socket = io(`${API_URL}/chat`, {
    // Function form: reconnect handshakes always read the freshest JWT.
    auth: (cb) => cb({ token: getToken() ?? '' }),
    transports: ['websocket', 'polling'],
  });
  socket.on(
    'presence:update',
    (update: { userId: string; isOnline: boolean; lastSeenAt: string | null }) => {
      cache.set(update.userId, {
        isOnline: update.isOnline,
        lastSeenAt: update.lastSeenAt,
      });
      notify();
    },
  );
  heartbeatTimer = setInterval(() => {
    socket?.emit('presence:ping');
  }, HEARTBEAT_MS);
}

export function disconnectPresence() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  socket?.disconnect();
  socket = null;
}

/**
 * Mount once (site shell): keeps the user online while the app is open.
 * Safe when logged out - it simply does nothing.
 */
export function PresenceConnection() {
  useEffect(() => {
    connectPresence();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'jt_token') {
        disconnectPresence();
        connectPresence();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return null;
}

/**
 * Subscribe to live presence for a set of user ids. Missing ids are fetched
 * in batch and refreshed every minute while mounted.
 */
export function usePresence(userIds: Array<string | null | undefined>): Record<string, PresenceStatus> {
  const ids = useMemo(
    () => [...new Set(userIds.filter((id): id is string => Boolean(id)))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userIds.filter(Boolean).sort().join(',')],
  );
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick(version);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!ids.length || !getToken()) return;
    const missing = ids.filter((id) => !cache.has(id));
    if (missing.length) void fetchStatuses(missing);
    const timer = setInterval(() => void fetchStatuses(ids), REFRESH_MS);
    return () => clearInterval(timer);
  }, [ids]);

  const result: Record<string, PresenceStatus> = {};
  for (const id of ids) {
    const status = cache.get(id);
    if (status) result[id] = status;
  }
  return result;
}

/** Short localized relative label for "last seen" timestamps (ASCII only). */
export function lastSeenLabel(lastSeenAt: string | null | undefined): string | null {
  if (!lastSeenAt) return null;
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return null; // treat as "just now"
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d`;
  const weeks = Math.floor(days / 7);
  return `${weeks} w`;
}
