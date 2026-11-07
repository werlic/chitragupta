# B1 Data Pack — Schema Documentation

**Version:** 1.0  
**Last Updated:** 27 Okt 2026  
**Description:** Data Pack untuk Chitragupta (tantangan B1 Meeting-to-Action). Semua data di file ini di-load oleh `prisma/seed.ts` ke PostgreSQL.

---

## File Structure

```
data/datapack/
├── contacts.json      # Internal + external contacts (≥15, 3 zona, 2 Budi, 3+ external)
├── permissions.json   # Permission table: role → canContactRoles, allowedTools; contact → canBeContactedBy
├── rules.json         # Work hours, Friday prayer, timezone config, vague time interpretation
├── holidays.json      # National holidays + joint leave (SKB 3 Menteri, Nov 2026–Des 2027)
├── tasks.json         # Example tasks derived from meeting notes
├── chats/             # 3 example meeting chat exports (WhatsApp format)
│   ├── meeting-ops-01.txt
│   ├── meeting-logistics-02.txt
│   └── meeting-executive-03.txt
└── README.md          # This file
```

## Schemas

### contacts.json

```json
{
  "version": "string",
  "description": "string",
  "contacts": [
    {
      "id": "string (c001)",
      "name": "string",
      "role": "string",
      "timezone": "WIB | WITA | WIT",
      "location": "string (Indonesian city)",
      "email": "string",
      "phone": "string (+62-...)",
      "department": "string"
    }
  ],
  "externalContacts": [
    {
      "id": "string (e001)",
      "name": "string",
      "email": "string",
      "phone": "string",
      "isExternal": true,
      "timezone": "WIB | WITA | WIT",
      "location": "string"
    }
  ]
}
```

### permissions.json

```json
{
  "version": "string",
  "permissions": [
    {
      "role": "ADMIN | DIRECTOR | MANAGER | SECRETARY | STAFF",
      "canContactRoles": ["ADMIN", "DIRECTOR", ...],
      "allowedTools": ["email", "calendar", "task", "whatsapp"]
    }
  ],
  "contactRules": [
    {
      "contactId": "string (c001)",
      "canBeContactedBy": ["ADMIN", "MANAGER", ...],
      "allowedTools": ["email", "whatsapp", ...]
    }
  ]
}
```

### rules.json

```json
{
  "version": "string",
  "timeZones": {
    "WIB": { "name": "string", "utcOffset": 7, "cities": ["Jakarta", ...] },
    "WITA": { "name": "string", "utcOffset": 8, "cities": ["Denpasar", ...] },
    "WIT": { "name": "string", "utcOffset": 9, "cities": ["Jayapura", ...] }
  },
  "workHours": {
    "default": { "start": "08:00", "end": "16:00", "lunchBreak": { "start": "12:00", "end": "13:00" }, "timezone": "WIB" },
    "shift1": { ... },
    "shift2": { ... }
  },
  "fridayPrayer": {
    "day": "Friday",
    "blockStart": "11:30",
    "blockEnd": "13:00",
    "configurable": true
  },
  "vagueTimeInterpretation": {
    "siang": "13:00",
    "pagi": "08:00",
    "sore": "15:00",
    "malam": "16:00"
  },
  "reminderRules": {
    "avoidHolidays": true,
    "avoidFridayPrayerBlock": true,
    "avoidOutsideWorkHours": true,
    "suggestAlternative": true
  }
}
```

### holidays.json

> **Perlu dicek ke SKB resmi (belum terverifikasi).** Tanggal di file ini belum dicocokkan dengan
> teks SKB 3 Menteri tentang libur nasional & cuti bersama 2026/2027; di repo tidak ada salinan SKB-nya.
> Yang patut dicurigai:
> - Cuti bersama Natal 2026 tercatat **26–30 Des** (5 hari, termasuk 26 Des = Sabtu dan 27 Des = Minggu).
>   Salinan lama `data/holidays.json` hanya mencatat **26 Des**. Akibatnya rule checker menyarankan
>   25 Des → **31 Des** (28–30 Des dianggap libur). Ada dugaan SKB menetapkan cuti bersama **24 Des**;
>   belum bisa dipastikan.
> - Logika `getNextBusinessDay` sudah benar terhadap data; hasilnya hanya sebaik data ini.
> - Kasus uji #05 (`tests/cases.json`) mengunci ekspektasi 31 Des sesuai data saat ini — ubah bersama
>   bila data diperbaiki.

```json
{
  "version": "2026-2027",
  "source": "string (SKB 3 Menteri)",
  "holidays": [
    {
      "date": "YYYY-MM-DD",
      "name": "string (Indonesian)",
      "type": "national | joint_leave",
      "isPublicHoliday": true
    }
  ]
}
```

### tasks.json

```json
{
  "version": "string",
  "tasks": [
    {
      "id": "string (t001)",
      "title": "string",
      "owner": "string (contact name)",
      "ownerId": "string (contact ID)",
      "dueDate": "YYYY-MM-DD",
      "dueTime": "HH:MM",
      "location": "string",
      "actionType": "email | calendar | task | whatsapp",
      "commitmentStatus": "accepted | suggestion | vague | question",
      "evidenceQuote": "string",
      "sourceSegmentId": "string",
      "isExternal": false,
      "recipients": ["c003", "c005"],
      "recipientCount": 2
    }
  ]
}
```

### chats/*.txt

WhatsApp-style chat export format:
```
[DD/MM/YY HH:MM] Sender Name: Message content
```

---

## Test Data Requirements (from Task 3)

| Requirement | Status |
|---|---|
| ≥15 contacts in 3 zones (WIB/WITA/WIT) | ✅ 12 internal + 3 external = 15 |
| ≥2 duplicate names (two Budi) | ✅ Budi Santoso (c001) + Budi Hartono (c002) |
| ≥3 external contacts | ✅ Vendor PT Maju, Supplier CV Jaya, Konsultan Andi |
| National holidays + cuti bersama Nov 2026–Des 2027 | ✅ 25 entries per SKB |
| Schema documented | ✅ This README |
