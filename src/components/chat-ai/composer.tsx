'use client';

// Composer at the bottom of the chat (canvas Main.dc.html <footer>)
import { useEffect, useRef, useState } from 'react';

export function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Grow with the content up to ~10 lines, then scroll
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  function submit() {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText('');
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFileError(null);
    if (f.size > 200_000) {
      setFileError('File terlalu besar (maks. 200 KB teks).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      setText((prev) => (prev.trim() ? `${prev}\n${content}` : content));
      ref.current?.focus();
    };
    reader.onerror = () => setFileError('File tidak bisa dibaca.');
    reader.readAsText(f);
  }

  return (
    <footer className="mx-auto w-full max-w-[840px] px-8 pb-6 pt-3 max-sm:px-4">
      <div className="flex flex-col gap-2 rounded-[18px] border border-lontar-input bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.06)] focus-within:border-lontar-sep">
        <label htmlFor="chat-composer" className="sr-only">
          Pesan
        </label>
        <textarea
          id="chat-composer"
          ref={ref}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Tempel notulen / chat rapat, atau ketik permintaan…"
          className="resize-none border-0 bg-transparent text-sm leading-[1.55] text-lontar-text outline-none placeholder:text-lontar-mute"
        />
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={onFile} />
          <button
            type="button"
            aria-label="Lampirkan file teks"
            title="Lampirkan file teks (.txt)"
            onClick={() => fileRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-lontar-border bg-white hover:bg-lontar-head"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A453E" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M20 11.5l-8.5 8.5a5 5 0 01-7-7L13 4.5a3.5 3.5 0 015 5L9.5 18a2 2 0 01-3-3l7.5-7.5" />
            </svg>
          </button>
          <span className="text-xs text-lontar-mute">
            {fileError ? <span className="text-destructive">{fileError}</span> : 'Agent hanya menyusun rencana. Aksi dijalankan setelah Anda approve.'}
          </span>
          <button
            type="button"
            aria-label="Kirim"
            onClick={submit}
            disabled={disabled || !text.trim()}
            className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lontar-text disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
}
