import { AuthProvider } from '@/components/dashboard/auth-provider';

// No app-wide sidebar/topbar (canvas R1): /dashboard is the chat screen with its own sidebar,
// every other screen carries a "‹ Chat / …" header (components/shell/lontar.tsx).
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-lontar-bg text-lontar-text">{children}</div>
    </AuthProvider>
  );
}
