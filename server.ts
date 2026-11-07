import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { config as dotenvConfig } from 'dotenv';
import jwt from 'jsonwebtoken';
import prismaPkg from '@prisma/client';

dotenvConfig();

// Plain `node` cannot resolve `@/`: load the shared access rules by path (erasable TS only)
const channelAccess: Promise<any> = import(['.', 'src', 'lib', 'chat', 'channel-access.ts'].join('/'));
// Same cookie and secret as src/lib/auth/jwt.ts
const COOKIE_NAME = 'aim_session';
const verifyJwt = (token: string) => jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-dev-only');
let socketDb: any = null;
const getSocketDb = () => (socketDb ??= new prismaPkg.PrismaClient());

const dev = process.env.NODE_ENV !== 'production';
const port = process.env.PORT || 3000;
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Socket.io server for realtime chat
  const io = new SocketIOServer(server, {
    cors: {
      origin: process.env.NEXT_PUBLIC_SOCKET_URL || `http://localhost:${port}`,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Store online users: socketId -> { userId, name, role }
  const onlineUsers = new Map<string, { userId: string; name: string; role: string }>();

  // Identity comes from the session cookie, never from what the client claims
  io.use(async (socket, nextFn) => {
    const { socketUserFromCookie } = await channelAccess;
    const user = socketUserFromCookie(socket.handshake.headers.cookie, COOKIE_NAME, verifyJwt);
    if (!user) return nextFn(new Error('unauthorized'));
    socket.data.user = user;
    nextFn();
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Connected: ${socket.id}`);
    const me = socket.data.user as { userId: string; name: string; role: string };

    // Auth on socket connect (payload ignored: kept for older clients)
    socket.on('auth', () => {
      const payload = me;
      onlineUsers.set(socket.id, payload);
      // Broadcast online status
      io.emit('user_online', { userId: payload.userId, name: payload.name });
      // Send current online list
      const onlineList = Array.from(onlineUsers.values()).map((u) => ({
        userId: u.userId,
        name: u.name,
      }));
      io.emit('online_users', onlineList);
    });

    // Join a channel room: members of a group/DM channel only, never an AI session
    socket.on('join_channel', async (channelId: string) => {
      try {
        const { findMemberChannel } = await channelAccess;
        const channel = await findMemberChannel(getSocketDb(), me.userId, channelId);
        if (!channel) {
          socket.emit('join_denied', { channelId });
          return;
        }
        socket.join(`channel:${channel.id}`);
        console.log(`[Socket.io] ${socket.id} joined channel:${channel.id}`);
      } catch (err) {
        console.error('[Socket.io] join_channel check failed:', err);
        socket.emit('join_denied', { channelId });
      }
    });

    // Leave a channel room
    socket.on('leave_channel', (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // Send message to channel
    socket.on('send_message', (data: {
      channelId: string;
      message: { id: string; content: string; userId: string; userName: string; createdAt: string };
    }) => {
      // Only into a room this socket joined (membership checked there); sender is the verified user
      const room = `channel:${data?.channelId}`;
      if (!socket.rooms.has(room)) return;
      io.to(room).emit('message_received', {
        channelId: data.channelId,
        message: { ...data.message, channelId: data.channelId, userId: me.userId, userName: me.name, senderName: me.name, senderRole: me.role },
      });
    });

    // Typing indicator
    socket.on('typing', (data: { channelId: string; userId: string; userName: string; isTyping: boolean }) => {
      const room = `channel:${data?.channelId}`;
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit('user_typing', { channelId: data.channelId, isTyping: !!data.isTyping, userId: me.userId, userName: me.name });
    });

    // Direct message
    socket.on('send_dm', (data: {
      recipientId: string;
      message: { id: string; content: string; userId: string; userName: string; createdAt: string };
    }) => {
      // Find recipient's socket
      for (const [socketId, user] of onlineUsers.entries()) {
        if (user.userId === data.recipientId) {
          io.to(socketId).emit('dm_received', {
            recipientId: data.recipientId,
            message: { ...data.message, userId: me.userId, userName: me.name },
          });
          break;
        }
      }
    });

    // AI chat request (streaming placeholder - handled via REST API with SSE)
    socket.on('ai_chat_request', (data: { channelId: string; prompt: string }) => {
      // AI chat handled via /api/chat/ai for streaming
      socket.emit('ai_chat_ack', { channelId: data.channelId });
    });

    // Disconnect
    socket.on('disconnect', () => {
      const user = onlineUsers.get(socket.id);
      if (user) {
        io.emit('user_offline', { userId: user.userId, name: user.name });
      }
      onlineUsers.delete(socket.id);
      console.log(`[Socket.io] Disconnected: ${socket.id}`);
    });
  });

  // Attach io to app for access in API routes
  (app as any).io = io;

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port} (dev: ${dev})`);
    console.log(`> Socket.io server attached`);
  });
});
