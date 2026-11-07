'use client';

// Main screen (canvas Main.dc.html): session sidebar, conversation, composer.
// The agent only drafts plans; approval happens on the review screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Role } from '@prisma/client';
import { can } from '@/lib/auth/rbac';
import { useAuthStore } from '@/stores/auth-store';
import { LogoMark, StatusChip, planChipStatus } from '@/components/shell/lontar';
import { SessionSidebar } from './session-sidebar';
import { PlanCard, InjectionNote, OpenItemsLine, groupQuestions } from './plan-card';
import { Composer } from './composer';
import type { ChatMessageView, ChatSession, PlanCardData } from './types';

const PLAN_LINK = /\/dashboard\/meetings\/([A-Za-z0-9_-]+)/;

function notifyPendingChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('pending-changed'));
}

/** Minimal formatting for assistant text: paragraphs, **bold**, review links */
function RichText({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="m-0 whitespace-pre-line break-words">
          {p.split(/(\*\*[^*]+\*\*|https?:\/\/\S+\/dashboard\/meetings\/[A-Za-z0-9_-]+|\/dashboard\/meetings\/[A-Za-z0-9_-]+)/g).map((part, j) => {
            if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={j}>{part.slice(2, -2)}</strong>;
            const m = PLAN_LINK.exec(part);
            if (m && part.includes('/dashboard/meetings/')) {
              return (
                <Link key={j} href={`/dashboard/meetings/${m[1]}`}>
                  layar review
                </Link>
              );
            }
            return <span key={j}>{part}</span>;
          })}
        </p>
      ))}
    </>
  );
}

/** Lead sentence like the canvas when the model wrote nothing besides the plan */
function planLead(plan: PlanCardData) {
  const n = plan.counts?.actions ?? plan.candidates.length;
  const q = groupQuestions(plan.questions || []).length;
  const ask = q > 0 ? ` Ada ${q === 1 ? 'satu hal' : `${q} hal`} yang perlu Anda pastikan dulu.` : '';
  return `Saya menemukan **${n} aksi** dan menyusunnya sebagai rencana. **Belum ada yang dikirim.**${ask}`;
}

function UserBubble({ content }: { content: string }) {
  const lines = content.split('\n').filter((l) => l.trim()).length;
  return (
    <div className="max-w-[80%] self-end rounded-[18px_18px_4px_18px] bg-lontar-muted px-4 py-3.5 text-sm leading-[1.55]">
      {lines > 1 && <div className="mb-1.5 text-xs text-lontar-mute">Teks rapat ditempel · {lines} baris</div>}
      <div className={`whitespace-pre-line break-words ${lines > 14 ? 'max-h-[320px] overflow-y-auto pr-1' : ''}`}>{content}</div>
    </div>
  );
}

function AssistantMessage({ m }: { m: ChatMessageView }) {
  const plan = m.plan;
  const legacyLink = !plan ? PLAN_LINK.exec(m.content) : null;
  // With a card, the canvas lead sentence replaces the model's prose and the server's text summary
  const text = plan ? planLead(plan) : m.content;
  return (
    <div className="flex items-start gap-3">
      <LogoMark size={28} />
      <div className="flex min-w-0 flex-1 flex-col gap-3.5 text-sm leading-[1.6]">
        {text ? (
          <div className={`flex flex-col gap-2 ${m.error ? 'text-destructive' : ''}`}>
            <RichText text={text} />
          </div>
        ) : m.streaming ? (
          <span className="flex items-center gap-1 py-1.5" aria-label="Agent sedang menyusun jawaban">
            {[0, 150, 300].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-lontar-mute" style={{ animationDelay: `${d}ms` }} />
            ))}
          </span>
        ) : null}

        {plan && (plan.quarantined || []).map((q, i) => <InjectionNote key={`${q.segmentId}-${i}`} segmentId={q.segmentId} text={q.text} />)}
        {plan && <PlanCard plan={plan} />}
        {plan && <OpenItemsLine items={plan.openItems || []} />}

        {legacyLink && !m.streaming && (
          <Link
            href={`/dashboard/meetings/${legacyLink[1]}`}
            className="inline-flex min-h-[40px] items-center self-start rounded-lg bg-primary px-4 text-sm font-semibold text-white no-underline hover:bg-nila-700 hover:text-white"
          >
            Buka review &amp; approval
          </Link>
        )}
      </div>
    </div>
  );
}

function EmptyState({ name }: { name?: string }) {
  return (
    <div className="m-auto flex max-w-[520px] flex-col items-center gap-3 py-16 text-center">
      <LogoMark size={44} />
      <h2 className="m-0 text-xl font-bold tracking-[-0.01em]">Halo{name ? `, ${name.split(' ')[0]}` : ''}. Tempel teks rapat untuk mulai.</h2>
      <p className="m-0 text-sm text-lontar-mute">
        Agent membaca notulen atau export chat WA, lalu menyusun rencana aksi (email, undangan, tugas, WhatsApp). Belum ada yang dikirim
        sampai Anda menjawab klarifikasi dan approve di layar review.
      </p>
    </div>
  );
}

function asMessages(raw: any[]): ChatMessageView[] {
  return raw.map((m: any) => ({
    id: String(m.id),
    role: m.role === 'assistant' || m.isAI ? 'assistant' : 'user',
    content: String(m.content ?? ''),
    createdAt: m.createdAt,
    plan: (m.plan as PlanCardData) ?? null,
  }));
}

export function ChatScreen() {
  const { user } = useAuthStore();
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('session');

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsUnavailable, setSessionsUnavailable] = useState(false);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  // Session id this screen just created/received itself; its (empty) history must not wipe the live messages
  const ownSession = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(sessionId);

  const allowed = !!user && can(user.role as Role, 'chat:ai');
  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard/tasks');
  }, [user, allowed, router]);

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/ai/sessions');
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setSessions(Array.isArray(d?.sessions) ? d.sessions : []);
      if (d?.modeLabel || d?.mode) setMode(d.modeLabel || d.mode);
      setSessionsUnavailable(false);
    } catch {
      setSessions([]);
      setSessionsUnavailable(true);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) loadSessions();
  }, [allowed, loadSessions]);

  useEffect(() => {
    setMobileNav(false);
    if (!allowed) return;
    if (!sessionId) {
      activeIdRef.current = null;
      if (!streaming) {
        setMessages([]);
        setTitle(null);
      }
      setLoadError(null);
      return;
    }
    activeIdRef.current = sessionId;
    if (ownSession.current === sessionId) {
      ownSession.current = null;
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    setLoadError(null);
    fetch(`/api/chat/ai/sessions/${encodeURIComponent(sessionId)}/messages`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status === 404 ? 'Sesi chat tidak ditemukan atau sudah dihapus.' : d.error || 'Riwayat chat gagal dimuat.');
        if (cancelled) return;
        setMessages(asMessages(Array.isArray(d.messages) ? d.messages : []));
        setTitle(d.session?.title ?? null);
        setMode((prev) => d.modeLabel || d.mode || prev);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setMessages([]);
        setLoadError(e.message);
      })
      .finally(() => !cancelled && setLoadingMessages(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, allowed]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  function adoptSession(id: string, newTitle?: string) {
    if (newTitle) setTitle(newTitle);
    if (id && id !== activeIdRef.current) {
      activeIdRef.current = id;
      ownSession.current = id;
      router.replace(`/dashboard?session=${encodeURIComponent(id)}`);
    }
  }

  async function send(content: string) {
    if (!user || streaming) return;
    setStreaming(true);
    setLoadError(null);
    const now = new Date().toISOString();
    const aiId = `ai-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', content, createdAt: now, plan: null },
      { id: aiId, role: 'assistant', content: '', createdAt: now, plan: null, streaming: true },
    ]);
    const patch = (fn: (m: ChatMessageView) => ChatMessageView) => setMessages((prev) => prev.map((m) => (m.id === aiId ? fn(m) : m)));

    // New chat: create the session first so the reply lands in it (fallback: let the server pick)
    let channelId = sessionId;
    if (!channelId && !sessionsUnavailable) {
      try {
        const r = await fetch('/api/chat/ai/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (r.ok) {
          const d = await r.json();
          if (d?.session?.id) {
            channelId = d.session.id;
            adoptSession(d.session.id, d.session.title);
          }
        }
      } catch {
        // fall through without a session id
      }
    }

    let text = '';
    try {
      const res = await fetch('/api/chat/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content, ...(channelId ? { channelId } : {}) }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(res.status === 403 ? 'Peran Anda tidak boleh memakai chat AI.' : d.error || 'Agent tidak menjawab.');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const ev of events) {
          for (const line of ev.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            let data: any;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (data.type === 'session' && data.channelId) {
              adoptSession(data.channelId, data.title);
            } else if (data.type === 'chunk') {
              text += data.content ?? '';
              patch((m) => ({ ...m, content: text }));
            } else if (data.type === 'tool_result') {
              text = [text, data.content].filter(Boolean).join('\n\n');
              patch((m) => ({ ...m, content: text }));
            } else if (data.type === 'plan' && data.plan) {
              patch((m) => ({ ...m, plan: data.plan as PlanCardData }));
            } else if (data.type === 'done') {
              if (typeof data.content === 'string' && data.content) text = data.content;
              patch((m) => ({ ...m, content: text, streaming: false }));
              if (data.channelId) adoptSession(data.channelId);
            } else if (data.type === 'error') {
              patch((m) => ({ ...m, content: data.error || 'Maaf, terjadi kesalahan. Coba lagi.', streaming: false, error: true }));
            }
          }
        }
      }
      patch((m) => ({ ...m, streaming: false }));
    } catch (e) {
      patch((m) => ({
        ...m,
        content: `${(e as Error).message || 'Maaf, terjadi kesalahan.'} Belum ada rencana yang dibuat; coba kirim lagi.`,
        streaming: false,
        error: true,
      }));
    } finally {
      setStreaming(false);
      loadSessions();
      notifyPendingChanged();
    }
  }

  function newChat() {
    ownSession.current = null;
    activeIdRef.current = null;
    setMessages([]);
    setTitle(null);
    setLoadError(null);
    router.push('/dashboard');
  }

  async function renameSession(id: string, t: string) {
    try {
      const r = await fetch(`/api/chat/ai/sessions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t }),
      });
      if (!r.ok) return false;
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: t } : s)));
      if (id === sessionId) setTitle(t);
      return true;
    } catch {
      return false;
    }
  }

  async function deleteSession(id: string) {
    try {
      const r = await fetch(`/api/chat/ai/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) return false;
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (id === sessionId) newChat();
      return true;
    } catch {
      return false;
    }
  }

  if (!user || !allowed) return null;

  const activeSession = sessions.find((s) => s.id === sessionId);
  const headerTitle = title || activeSession?.title || (sessionId ? 'Chat' : 'Chat baru');
  const lastPlan = [...messages].reverse().find((m) => m.plan)?.plan;

  return (
    <div className="flex h-screen overflow-hidden bg-white text-lontar-text">
      <SessionSidebar
        user={user}
        sessions={sessions}
        loading={sessionsLoading}
        unavailable={sessionsUnavailable}
        activeId={sessionId}
        onNew={newChat}
        onRename={renameSession}
        onDelete={deleteSession}
        className={mobileNav ? 'fixed inset-y-0 left-0 z-40 shadow-xl' : 'max-md:hidden'}
      />
      {mobileNav && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMobileNav(false)} aria-hidden="true" />}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-lontar-border px-8 py-3.5 max-sm:px-4">
          <button
            type="button"
            aria-label="Buka daftar sesi"
            onClick={() => setMobileNav(true)}
            className="-ml-2 flex h-9 w-9 items-center justify-center rounded-md hover:bg-lontar-muted md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <h1 className="m-0 min-w-0 truncate text-base font-semibold">{headerTitle}</h1>
          {lastPlan && <StatusChip status={planChipStatus(lastPlan)} />}
          {mode && <span className="ml-auto text-xs text-lontar-mute">Mode: {mode}</span>}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section className="mx-auto flex min-h-full w-full max-w-[840px] flex-col gap-6 px-8 py-7 max-sm:px-4" aria-live="polite">
            {loadingMessages ? (
              <span className="m-auto text-sm text-lontar-mute">Memuat riwayat chat…</span>
            ) : loadError ? (
              <div role="alert" className="m-auto flex max-w-[420px] flex-col gap-1.5 rounded-[14px] border border-lontar-border bg-white p-4">
                <strong className="text-sm">{loadError}</strong>
                <button type="button" onClick={newChat} className="self-start text-[13px] text-primary hover:underline">
                  Mulai chat baru
                </button>
              </div>
            ) : messages.length === 0 ? (
              <EmptyState name={user.name} />
            ) : (
              messages.map((m) => (m.role === 'user' ? <UserBubble key={m.id} content={m.content} /> : <AssistantMessage key={m.id} m={m} />))
            )}
            <div ref={endRef} />
          </section>
        </div>

        <Composer onSend={send} disabled={streaming || loadingMessages} />
      </main>
    </div>
  );
}
