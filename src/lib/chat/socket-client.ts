'use client';

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth-store';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function useSocket() {
  const { user } = useAuthStore();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) return;

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;
    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socket.on('connect', () => {
      setConnected(true);
      socket?.emit('auth', {
        userId: user.id,
        name: user.name,
        role: user.role,
      });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [user]);

  return { socket, connected };
}
