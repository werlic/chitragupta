'use client';

// Login (canvas Login.dc.html) plus a demo-account picker dialog for the hackathon demo.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogoMark } from '@/components/shell/lontar';

// Seed accounts (prisma/seed.ts). The demo password is filled in for the user, never shown.
const DEMO_PASSWORD = 'password123';
const demoAccounts = [
  { email: 'admin@company.id', name: 'System Admin', role: 'Admin', note: 'Kelola user & data master', chip: 'bg-destructive-soft text-destructive' },
  { email: 'hendra@company.id', name: 'Pak Hendra', role: 'Direktur', note: 'Approver semua rencana', chip: 'bg-[#FEF3C7] text-[#B45309]' },
  { email: 'budi.santoso@company.id', name: 'Budi Santoso', role: 'Manager', note: 'Operations · WIB Jakarta', chip: 'bg-[#E0F2FE] text-[#0369A1]' },
  { email: 'sari.wijaya@company.id', name: 'Sari Wijaya', role: 'Sekretaris', note: 'Menyusun rencana dari rapat', chip: 'bg-[#DCFCE7] text-[#15803D]' },
  { email: 'budi.hartono@company.id', name: 'Budi Hartono', role: 'Staff', note: 'Finance · WITA Denpasar', chip: 'bg-[#ECECFB] text-[#3B3FB6]' },
];

const field =
  'min-h-[44px] rounded-lg border border-lontar-input bg-white px-3 text-sm text-lontar-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (demoOpen && !d.open) d.showModal();
    if (!demoOpen && d.open) d.close();
  }, [demoOpen]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    await login(email, password);
  }

  async function pickDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setDemoOpen(false);
    await login(demoEmail, DEMO_PASSWORD);
  }

  async function login(loginEmail: string, loginPassword: string) {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push('/dashboard');
        router.refresh();
        return;
      }
      setError(res.status === 401 ? 'Email atau kata sandi salah.' : data.error || 'Gagal masuk. Coba lagi.');
    } catch {
      setError('Koneksi terputus. Coba lagi.');
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-lontar-bg px-4 py-8 text-lontar-text">
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark size={44} />
          <h1 className="m-0 text-2xl font-bold tracking-[-0.01em]">Masuk ke Chitragupta</h1>
          <p className="m-0 text-sm text-lontar-mute">Rapat jadi rencana aksi. Tidak ada yang dikirim tanpa persetujuan Anda.</p>
        </div>
        <form onSubmit={handleLogin} className="flex flex-col gap-4 rounded-2xl border border-lontar-border bg-white p-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[13px] font-semibold">
              Email kantor
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="nama@company.id"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={field}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-[13px] font-semibold">
              Kata sandi
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={field}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="min-h-[44px] rounded-lg bg-primary text-sm font-semibold text-white hover:bg-nila-700 disabled:opacity-70"
          >
            {loading ? 'Memproses…' : 'Masuk'}
          </button>
          {error && (
            <p role="alert" className="m-0 rounded-md bg-destructive-soft px-2.5 py-2 text-[13px] text-destructive">
              {error}
            </p>
          )}
        </form>
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setDemoOpen(true)}
            aria-haspopup="dialog"
            className="min-h-[44px] w-full rounded-lg border border-lontar-border bg-white px-4 text-sm font-semibold text-primary hover:bg-[#ECECFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Pilih akun demo
          </button>
          <p className="m-0 text-center text-xs text-lontar-mute">Admin, Direktur, Manager, Sekretaris, Staff — kata sandi diisi otomatis.</p>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby="demo-title"
        onClose={() => setDemoOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setDemoOpen(false);
        }}
        className="w-[min(440px,calc(100vw-32px))] rounded-2xl border border-lontar-border bg-white p-0 text-lontar-text shadow-xl backdrop:bg-black/40"
      >
        <div className="flex items-start justify-between gap-3 border-b border-lontar-border px-5 py-4">
          <div>
            <h2 id="demo-title" className="m-0 text-base font-semibold">
              Pilih akun demo
            </h2>
            <p className="m-0 mt-0.5 text-[13px] text-lontar-mute">Masuk sebagai salah satu peran untuk mencoba alur approval.</p>
          </div>
          <button
            type="button"
            onClick={() => setDemoOpen(false)}
            aria-label="Tutup"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lontar-mute hover:bg-lontar-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-4">
          {demoAccounts.map((acc) => (
            <li key={acc.email}>
              <button
                type="button"
                disabled={loading}
                onClick={() => pickDemo(acc.email)}
                className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border border-lontar-border px-4 py-2.5 text-left hover:border-primary hover:bg-[#ECECFB]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">{acc.name}</span>
                  <span className="truncate text-xs text-lontar-mute">
                    {acc.email} · {acc.note}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${acc.chip}`}>{acc.role}</span>
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </div>
  );
}
