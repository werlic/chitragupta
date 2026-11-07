# Hasil test:b1:db

- Waktu: 2026-11-07T03:21:42.085Z
- Provider LLM: Mock (demo mode)
- Lulus: **32/32**

| ID | Kasus | Aturan | Hasil | ms | Catatan |
|---|---|---|---|---|---|
| TC01 | Dekomposisi: dua aksi tetap terpisah | Tunjukkan sumber | PASS | 48 |  |
| TC02 | Dua Budi di kontak -> tanya Budi yang mana | Akui batas | PASS | 19 |  |
| TC03 | Satu Sari di kontak -> tidak bertanya | Akui batas | PASS | 30 |  |
| TC04 | Jumat 12:00 jatuh di blok salat Jumat | Patuhi izin | PASS | 19 |  |
| TC05 | 'Jumat siang' tanpa jam -> usul 13:30 (salat + jeda 30 menit) | Patuhi izin | PASS | 14 |  |
| TC06 | Libur Natal + cuti bersama -> geser ke hari kerja | Patuhi izin | PASS | 19 |  |
| TC07 | Sabtu -> geser ke Senin | Patuhi izin | PASS | 13 |  |
| TC08 | Jam tanpa zona, peserta WIB + WITA -> tanya zona acuan | Akui batas | PASS | 14 |  |
| TC09 | Zona disebut eksplisit (WITA) -> tidak bertanya | Akui batas | PASS | 16 |  |
| TC10 | Belum di-approve -> tidak ada eksekusi tool | Approval sebelum bertindak | PASS | 18 |  |
| TC11 | Rencana diubah setelah ditampilkan -> approval lama tidak berlaku | Approval sebelum bertindak | PASS | 1 |  |
| TC12 | Injeksi bahasa Inggris -> dikarantina, aksinya ditolak | Patuhi izin | PASS | 16 |  |
| TC13 | Injeksi Bahasa Indonesia -> dikarantina, aksinya ditolak | Patuhi izin | PASS | 13 |  |
| TC14 | Penerima eksternal / >1 penerima -> butuh konfirmasi tambahan | Approval sebelum bertindak | PASS | 0 |  |
| TC15 | Tabel izin: STAFF tidak boleh menghubungi Manager / pakai WA | Patuhi izin | PASS | 2 |  |
| TC16 | Kutipan bukti tidak ada di teks -> kandidat ditolak | Tunjukkan sumber | PASS | 12 |  |
| TC17 | Tanpa kutipan bukti -> kandidat ditolak | Tunjukkan sumber | PASS | 10 |  |
| TC18 | Pemilik tidak ada di teks -> ditandai owner_unknown | Tunjukkan sumber | PASS | 11 |  |
| TC19 | Kandidat duplikat -> hanya satu yang disimpan | Tunjukkan sumber | PASS | 13 |  |
| TC20 | Saran ('mungkin perlu') -> open item, bukan aksi | Akui batas | PASS | 9 |  |
| TC21 | Komitmen samar -> open item, bukan aksi | Akui batas | PASS | 9 |  |
| TC22 | Data pribadi (NIK, nomor HP) diredaksi | Patuhi izin | PASS | 15 |  |
| TC23 | Aksi yang sudah dieksekusi tidak bisa dieksekusi ulang | Approval sebelum bertindak | PASS | 6 |  |
| TC24 | Setiap langkah tercatat di audit log | Simpan catatan | PASS | 520 |  |
| TC25 | Parser LLM gagal -> meeting REJECTED + PARSER_FAILED (Postgres) | Akui batas | PASS | 527 |  |
| TC26 | Opsi "Budi yang mana" memuat role/departemen/zona/kota di JSON tersimpan | Akui batas | PASS | 13 |  |
| TC27 | Route pending/tasks/reject/approve di Postgres: kandidat ditolak tidak bisa di-approve | Approval sebelum bertindak | PASS | 117 |  |
| TC28 | Tahap plan gagal setelah meeting dibuat -> REJECTED + PIPELINE_FAILED (Postgres) | Akui batas | PASS | 528 |  |
| TC29 | Klarifikasi: tanggal ditolak -> tidak ada yang tersimpan (transaksi Postgres); meeting REJECTED -> 409 | Approval sebelum bertindak | PASS | 66 |  |
| TC30 | Owner terpetakan ke user -> assigneeId terisi (unik saat plan, ambigu setelah klarifikasi) | Patuhi izin | PASS | 30 |  |
| TC31 | Sesi AI chat di Postgres: event plan + kartu tersimpan, isolasi antar-user 404, hapus sesi tidak menghapus meeting | Approval sebelum bertindak | PASS | 646 |  |
| TC32 | Satu pertanyaan Budi per nama: candidateIds, satu jawaban diterapkan ke semua aksi dalam transaksi Postgres | Akui batas | PASS | 38 |  |
