# Hasil test final — Chitragupta (tantangan B1: Meeting-to-Action)

| | |
|---|---|
| Tanggal/jam | Sabtu, 7 November 2026, pagi WIB |
| Commit dasar | `f7087181543ad673ba657be5f85a02165f2ff450` (branch `claude/ai-meeting-note-tasks-718f1e`) |
| Lingkungan | Node v26.12.1, `tsx`, Next.js 14 + Prisma |
| LLM | Mock (demo mode) — deterministik, tanpa Ollama/cloud. (DeepSeek/Ollama tidak tersedia di lingkungan eksekusi ini; lihat §5 "Keterbatasan".) |
| DB | Postgres 15 (docker, terisolasi dari checkout lain — lihat §4) |

Dokumen ini menggantikan `tests/baseline.md` (snapshot 3 November, working tree belum bersih saat itu) sebagai catatan hasil test **final** sebelum submission. `tests/baseline.md` tetap disimpan sebagai riwayat.

## Ringkasan empat lapis test

| Lapis | Perintah | Yang diuji | Hasil |
|---|---|---|---|
| 1. Pipeline (tanpa DB) | `npm run test:b1` | `runPipeline()`/`runPipelineWithCandidates()` langsung, Prisma stub dari `data/datapack/` | **48/48 kasus (100%), 186/186 variasi (100%)** |
| 2. Pipeline + Postgres | `npm run test:b1:db` | Jalur sama lewat Postgres sungguhan (transaksi, FK, isolasi) | **32/32 kasus (100%)** |
| 3. E2E browser | `npm run test:e2e` | Aplikasi nyata lewat Playwright: login, form, klarifikasi, approve/reject, API gate, RBAC — lihat `tests/e2e/README.md` | **33/33 kasus (100%)**, diulang 2× berturut-turut (49.5s, 47.6s) — tidak flaky |
| 4. Chitragupta CLI (manual) | `npm run b1 -- segments\|plan\|status\|log` | Jalur CLI terpisah dari (1)-(3): `scripts/b1.ts`, AGENTS.md | **Lulus** — lihat §3 |

Tidak ada *critical failure* (eksekusi tanpa approval, bocor informasi) di semua lapis.

## 1. Lapis 1 — `npm run test:b1` (50 kasus, Mock LLM)

```
Kasus     : 50 (PASS 48, FAIL 0, SKIP 2, WARN 0 non-blocking)
Pass rate : 100.0% kasus (48/48), 100.0% variasi (186/186)
Latency   : per kasus p50 508 ms, p95 2122 ms | per variasi p50 2 ms, p95 527 ms
Critical  : 0 critical failure (eksekusi tanpa approval / bocor info; target 0)
Metrik    : clarifier_ask_accuracy 16/16 (100%)
Metrik    : injection_detection 4/4 (100%)
Metrik    : injection_false_positive_free 1/1 (100%)
Metrik    : evidence_false_positive_free 3/3 (100%)
Metrik    : friday_buffer_after_prayer 3/3 (100%)
```

2 SKIP: #23/#24 (transkripsi suara & diarization) — di luar scope (lihat §5). Daftar lengkap 50 kasus (01–22, H1, P1, R1–R8, T1–T8, C1–C8) ada di `scripts/run-tests.ts` / `tests/cases.json`; ini naik dari 24 kasus di `tests/baseline.md` (3 Nov) karena regresi R1–R8/T1–T8/C1–C8 ditambahkan seiring fitur (reject, AI chat, Tugas/Pending, permission per-penerima) selesai.

## 2. Lapis 2 — `npm run test:b1:db` (32 kasus, Postgres)

```
32/32 lulus (provider: Mock (demo mode)). Ringkasan: tests/db-last-run.md
```

Mencakup jalur yang tidak bisa diuji dengan stub: transaksi Postgres (klarifikasi ditolak = tidak ada yang tersimpan), isolasi sesi AI chat antar-user lewat FK sungguhan, idempotency key di tabel nyata. Rincian per kasus (TC01–TC32) di [`tests/db-last-run.md`](db-last-run.md) (dibuat ulang otomatis setiap run).

## 3. Lapis 3 — `npm run test:e2e` (33 kasus, browser sungguhan)

Baru ditambahkan sesi ini — bukan pipeline langsung seperti lapis 1–2, tapi benar-benar lewat HTTP + cookie + RBAC + UI React, persis seperti yang dipakai pengguna/juri. Lihat [`tests/e2e/README.md`](e2e/README.md) untuk cara jalan, dan [`tests/e2e_test_prompts.md`](../tests/e2e_test_prompts.md) untuk teks kasus yang sama dalam bentuk siap-tempel (manual/demo/juri).

| Spec | Kasus | Yang dibuktikan |
|---|---|---|
| `auth.spec.ts` | 7 | Login 5 akun demo, kata sandi salah ditolak, menu per role (`meeting:create`), API tanpa sesi ditolak |
| `instruction-following.spec.ts` | 4 | Ekstraksi tepat sesuai teks (AGENTS.md §4): tidak mengarang, tidak menebak nama ambigu, saran tetap `open_items`, lintas zona bertanya |
| `approval-gate.spec.ts` | 7 | Approve tereksekusi + undo window; 403 saat klarifikasi belum dijawab; 409 dampak tinggi; 409 plan-hash berubah; 409 setelah ditolak; MANAGER approve rencana sendiri; STAFF tidak bisa approve |
| `prompt-injection.spec.ts` | 4 | Instruksi tertanam ID & EN dikarantina (dicampur dengan permintaan sah), audit `INJECTION_DETECTED` tercatat, teks isi-injeksi-saja → 0 aksi |
| `hackathon-judging.spec.ts` | 5 | Satu skenario hidup per dimensi: bertanya hanya bila ambigu, tidak eksekusi walau diminta "langsung", `contactRule` per kontak, redaksi PII, blok salat Jumat |
| `tasks-and-pending.spec.ts` | 4 | Halaman Pending menandai "Perlu klarifikasi", menu Tugas tampil untuk STAFF (regresi bug Notion), view List/Table/Board, Audit admin-only |

**Setiap** test approval memanggil `/api/agent/approve` langsung lewat `page.request` (bukan hanya cek tombol UI nonaktif), karena tombol nonaktif tidak membuktikan apa-apa soal gerbang server.

## 4. Catatan lingkungan: database terisolasi

Checkout lain mungkin memakai container `aim-note-db` (docker-compose bawaan, port 5432) untuk dev/demo mereka sendiri. Agar run test ini tidak mengganggu sesi lain yang sedang berjalan, semua test di atas (lapis 2 & 3) memakai Postgres **terpisah**: container `aim-note-db-e2e`, port 5433 (`docker run ... -p 5433:5432 postgres:15-alpine`), di-push+seed dari `data/datapack/` yang sama. `.env` lokal menunjuk ke port ini dan **tidak di-commit** (sudah di `.gitignore`).

## 5. Keterbatasan (ditulis jujur, bukan disembunyikan)

- **DeepSeek/Ollama tidak dites di sesi ini.** Lingkungan eksekusi tidak punya akses ke LLM eksternal; semua 4 lapis di atas memakai Mock LLM (`LLM_PROVIDER=mock`), yang deterministik tapi berbasis aturan Bahasa Indonesia sederhana (lihat `src/lib/llm/mock.ts`) — bukan pemahaman bahasa alami penuh. Sebelum submit, jalankan ulang minimal lapis 1 (`npm run test:b1`) dengan `LLM_PROVIDER=ollama` atau `openai` bila model sungguhan tersedia, dan catat hasilnya di sini.
- **Voice (#23/#24) di luar scope** — belum diimplementasikan, tetap SKIP seperti baseline sebelumnya.
- **Teks uji E2E ditulis mengikuti pola ekstraksi Mock LLM** (lihat komentar di `tests/e2e/fixtures/prompts.ts`): alamat "Nama, tolong ..." (satu kata) untuk tugas/task, dan awalan hormat "Pak/Bu ..." untuk penerima email/kalender/WhatsApp. Ini bukan batasan aplikasi untuk pengguna sungguhan dengan LLM asli (yang memahami "Dewi Lestari, tolong..." atau "ke Joko Susilo" tanpa awalan) — ini murni supaya 33 kasus E2E tetap deterministik terhadap Mock LLM yang dipakai untuk menjalankannya.
- **Undo 60 detik in-memory** (`src/lib/agent/execution/undo-window.ts`) — hilang bila server restart; sudah dicatat sebagai keputusan KISS di task Notion ("[DIPOTONG – KISS] Undo sejati").

## Perintah untuk mengulang

```bash
# Lapis 1 — tanpa database
npm run test:b1

# Lapis 2 — Postgres (pakai docker-compose.yml bawaan atau port lain via DATABASE_URL)
docker compose up -d && npm run db:push && npm run db:seed
npm run test:b1:db

# Lapis 3 — browser sungguhan (server harus sudah jalan)
npx playwright install chromium   # sekali saja
npm run dev &                     # atau: PORT=3100 npx tsx server.ts
E2E_BASE_URL=http://localhost:3100 npm run test:e2e
```
