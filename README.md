# Chitragupta (tantangan B1: Meeting-to-Action)

Rapat jadi rencana aksi — bukan rapat jadi aksi. Tempel notulen atau export chat WhatsApp berbahasa Indonesia, dan agent menyusun kandidat email, undangan kalender, task, dan WhatsApp lengkap dengan kutipan bukti, penerima persis dari kontak, dan peringatan aturan kantor Indonesia (libur nasional, cuti bersama, blok salat Jumat, zona WIB/WITA/WIT). **Tidak ada yang terkirim sampai seseorang menekan approve di web app ini** — AI chat dan **Chitragupta** (CLI) hanya boleh mengusulkan rencana, tidak pernah mengeksekusinya.

> Blurb (<10 kata): **"Rapat jadi rencana; approve manusia, bukan AI, yang mengeksekusi."**

## Fitur inti

| | |
|---|---|
| **Ekstraksi** | LLM (Ollama/OpenAI-compatible, atau Mock deterministik untuk demo tanpa model) memecah teks rapat jadi kandidat aksi dengan kutipan verbatim per segmen. |
| **Gerbang input** | Data pribadi (NIK, telepon, email, kartu) diredaksi sebelum masuk LLM/DB/audit; instruksi tertanam di dalam teks rapat ("abaikan instruksi sebelumnya...", `system:`, Bahasa Indonesia maupun Inggris) dikarantina per segmen, tidak pernah jadi aksi. |
| **Gerbang output** | Evidence gate menolak kandidat tanpa kutipan nyata, owner tak dikenal, tanggal tidak valid, atau duplikat. Saran ("mungkin sebaiknya...") masuk *open items*, bukan aksi yang menunggu approve/reject. |
| **Clarifier** | Bertanya **hanya** bila perlu: nama owner cocok >1 kontak ("Budi yang mana?"), jam tanpa zona dengan peserta lintas zona, tanggal relatif ambigu. Satu kecocokan → tidak bertanya. |
| **Aturan Indonesia** | Blok salat Jumat 11:30–13:00 WIB + jeda 30 menit, libur nasional + cuti bersama (SKB, Nov 2026–Des 2027), jam kerja per zona (WIB/WITA/WIT), akhir pekan → digeser ke hari kerja berikutnya. |
| **Approval** | Satu-satunya jalur ke tool mock adalah `POST /api/agent/approve`, terikat **plan hash** dari detail yang ditampilkan (edit setelah tampil → 409 `planChanged`). Penerima eksternal atau >1 penerima butuh konfirmasi dampak tinggi terpisah (409 `highImpactRequired`). |
| **Izin** | Tabel permission per role dan per kontak (`data/datapack/permissions.json`) dicek untuk **setiap** penerima saat approve; tabel tak terbaca → ditolak (fail-closed), bukan diizinkan diam-diam. |
| **Undo** | 60 detik setelah eksekusi, dengan hitung mundur di UI. |
| **Audit** | Setiap langkah (`INPUT_RECEIVED` → ... → `EXECUTION_SUCCESS`/`EXECUTION_UNDONE`) tercatat dua kali: tabel `AuditLog` dan `audit-logs/*.jsonl`, bisa ditelusuri tanpa DB lewat `npm run b1 -- log <meetingId>`. |
| **Chitragupta** | Agent utama proyek ini (lihat [`AGENTS.md`](AGENTS.md)): membaca teks rapat, menulis kandidat JSON, menyerahkan ke CLI deterministik (`npm run b1`). CLI menolak `approve`/`execute` dengan exit code 2 — approval hanya manusia, hanya di web app. |

Rincian pembeda dari ide awal panitia dan kompetitor umum (dengan bukti kode per klaim): [`docs/evaluation/uniqueness.md`](docs/evaluation/uniqueness.md). Skor diri 10 dimensi Handbook: [`docs/evaluation/self-score.md`](docs/evaluation/self-score.md) (ditulis 3 Nov; lihat catatan "diperbarui sejak" di awal berkas itu untuk apa yang sudah berubah).

## Prasyarat

- **Node.js 20 atau lebih baru** (dikembangkan dan diuji dengan Node 22) beserta npm.
- **Docker Desktop** (atau mesin Docker lain yang mendukung `docker compose`) — untuk menjalankan PostgreSQL lewat `docker-compose.yml`. Sudah punya PostgreSQL 15 sendiri? Lewati `docker compose up -d` dan sesuaikan `DATABASE_URL` di `.env`.
- Tidak wajib: Ollama / LM Studio / kunci API OpenAI — hanya diperlukan bila ingin memakai LLM sungguhan, bukan Mock LLM (lihat di bawah).

## Jalankan lokal

```bash
cp .env.example .env               # edit DATABASE_URL/JWT_SECRET bila perlu
docker compose up -d               # Postgres
npm install                        # juga menjalankan `prisma generate` lewat postinstall
npm run db:push
npm run db:seed                    # 5 user demo + 15 kontak + 24 libur dari data/datapack/
npm run dev                        # http://localhost:3000
```

Tanpa Ollama/OpenAI terpasang, aplikasi otomatis jatuh ke **Mock LLM** (deterministik, cukup untuk demo dan untuk seluruh test suite di bawah). Set `LLM_PROVIDER=mock` eksplisit di `.env` untuk memaksanya.

**Setelah `git pull`, pindah branch, atau mengedit `prisma/schema.prisma`:** matikan dulu `npm run dev` yang sedang jalan, jalankan `npx prisma generate`, baru nyalakan lagi `npm run dev`. Prisma Client yang sudah digenerate tidak otomatis menyesuaikan diri ke skema baru, dan proses dev server lama yang masih jalan bisa menguncinya di Windows sehingga `prisma generate` gagal dengan `EPERM`. Ini **tidak akan terjadi pada instalasi baru** (`npm install` dari clone bersih menjalankan `prisma generate` otomatis lewat `postinstall`, dan belum ada proses lama yang mengunci apa pun) — hanya muncul kalau skema berubah sementara server lama masih hidup.

**Akun demo** (kata sandi `password123`, atau klik "Pilih akun demo" di halaman login):

| Role | Email | Bisa apa |
|---|---|---|
| Admin | `admin@company.id` | Semua izin, kelola user & data |
| Direktur | `hendra@company.id` | Approve rencana siapa pun |
| Manager | `budi.santoso@company.id` | Buat rencana, approve rencana sendiri |
| Sekretaris | `sari.wijaya@company.id` | Buat rencana, approve rencana sendiri |
| Staff | `budi.hartono@company.id` | Lihat tugas & rapat miliknya saja |

## Chitragupta (CLI)

```bash
npm run b1 -- segments --input input/example-test1-budi-jumat.txt   # tanpa DB
npm run b1 -- plan --candidates output/example-test1-candidates.json --dry-run
npm run b1 -- plan --candidates output/example-test1-candidates.json  # butuh DB
npm run b1 -- status <meetingId>
npm run b1 -- log <meetingId>
```

Instruksi lengkap untuk agent (format kandidat, aturan keamanan, cara membaca output) ada di [`AGENTS.md`](AGENTS.md).

### Asal-usul nama "Chitragupta"

Nama **Chitragupta** diambil dari mitologi Hindu. Dalam tradisi tersebut, Chitragupta adalah dewa pencatat yang bertugas mencatat setiap perbuatan makhluk hidup secara teliti dan tidak memihak — nama ini dipakai sebagai kiasan untuk tugas CLI: membaca teks rapat lalu mencatatnya menjadi kandidat aksi **persis seperti yang tertulis** (kutipan verbatim, tanpa mengarang nama/tanggal/penerima), lalu menyerahkannya ke gerbang persetujuan — bukan memutuskan atau mengeksekusi sendiri. Sifat "pencatat yang taat aturan dan tidak pernah bertindak sendiri" ini selaras dengan aturan keamanan di [`AGENTS.md`](AGENTS.md) §4 (teks rapat adalah data bukan perintah, kutipan harus verbatim, tidak pernah approve/execute).

## Testing

Empat lapis, dari cepat/sempit ke lambat/menyeluruh — ringkasan hasil terbaru dan cara mengulang masing-masing ada di [`tests/test_results.md`](tests/test_results.md):

```bash
npm run test:b1          # 48/48 kasus (186/186 variasi) — pipeline langsung, tanpa DB
npm run test:b1:db       # 32/32 kasus — pipeline + Postgres sungguhan
npm run test:e2e         # 33/33 kasus — browser sungguhan (Playwright): login, approve, klarifikasi, RBAC
```

[`tests/e2e_test_prompts.md`](tests/e2e_test_prompts.md) berisi teks siap-tempel untuk uji manual/demo/juri — satu set teks yang sama dipakai suite E2E di atas — dikelompokkan jadi empat kategori: **instruksi** (agent hanya mengekstrak yang diminta teks, tidak mengarang), **approval** (gerbang persetujuan manusia benar-benar menggerbang), **prompt injection** (Bahasa Indonesia & Inggris, dicampur permintaan sah), dan **dimensi penilaian hackathon** (satu skenario hidup per dimensi Handbook §10).

## Arsitektur singkat

```
Teks rapat ──▶ Input guard (redaksi PII, karantina injeksi)
           ──▶ Parser (LLM) ──▶ Evidence gate ──▶ Clarifier ──▶ Rule checker
           ──▶ Resolusi penerima (contacts) ──▶ Rencana PENDING (notulen tersimpan)
                                                        │
                                   (Chitragupta CLI: menolak approve/execute di sini)
                                                        │
                                    Manusia membuka web app, menjawab klarifikasi
                                                        ▼
                         POST /api/agent/approve (plan hash + tabel izin + dampak tinggi)
                                                        ▼
                              Tool mock (email/kalender/task/WhatsApp) + undo 60 detik
```

Rincian lengkap (trust boundary, siapa boleh memanggil apa, keputusan arsitektur dan trade-off): [`submission/02_architecture.md`](submission/02_architecture.md).

## Keterbatasan yang ditulis terus terang

- Tool email/kalender/task/WhatsApp **mock** (`mock: true`), sesuai yang diizinkan Handbook.
- Undo 60 detik disimpan in-memory — hilang bila server di-restart.
- Input suara belum diimplementasikan (hanya teks).
- Data pack (kontak, libur, aturan) adalah dataset buatan tim sendiri, bukan dataset kickoff panitia.

Daftar lengkap dan evidensi kode: [`submission/01_accountability_sheet.md`](submission/01_accountability_sheet.md) §Keterbatasan dan [`tests/test_results.md`](tests/test_results.md) §5.
