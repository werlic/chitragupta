import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  channelId: string;
  userId?: string;
  senderName: string;
  senderRole?: string;
  content: string;
  isAI: boolean;
  createdAt: string;
}

export interface ChatChannel {
  id: string;
  name: string;
  type: 'GROUP' | 'DM' | 'AI';
  description?: string;
}

interface ChatState {
  channels: ChatChannel[];
  activeChannel: ChatChannel | null;
  messages: ChatMessage[];
  typingUsers: Array<{ userId: string; userName: string }>;
  onlineUsers: Array<{ userId: string; name: string }>;
  setChannels: (channels: ChatChannel[]) => void;
  setActiveChannel: (channel: ChatChannel | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setTypingUsers: (users: Array<{ userId: string; userName: string }>) => void;
  setOnlineUsers: (users: Array<{ userId: string; name: string }>) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  channels: [],
  activeChannel: null,
  messages: [],
  typingUsers: [],
  onlineUsers: [],
  setChannels: (channels) => set({ channels }),
  setActiveChannel: (activeChannel) => set({ activeChannel, messages: [], typingUsers: [] }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setTypingUsers: (typingUsers) => set({ typingUsers }),
  setOnlineUsers: (onlineUsers) => set({ onlineUsers }),
}));
