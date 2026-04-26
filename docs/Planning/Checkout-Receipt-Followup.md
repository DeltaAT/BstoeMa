# Checkout & Receipt – Follow-up Entscheidung

> Automatisch erstellt am 2026-04-26 als Follow-up zum API-Plan.

---

## Entscheidung

**→ Backlog (bewusst aus MVP herausgelassen)**

Checkout und Receipt werden **nicht** im aktuellen MVP implementiert.  
Das Thema ist hiermit als bewusste Backlog-Entscheidung dokumentiert, nicht als vergessenes To-do.

---

## Analyse: Aktueller Stand

### Was vorhanden ist

| Bereich | Stand |
|---|---|
| `POST /orders` | ✅ Implementiert |
| `GET /orders` | ✅ Implementiert |
| `GET /orders/{orderId}` | ✅ Implementiert |
| `POST /orders/{orderId}/checkout` | ❌ Nicht vorhanden |
| `GET /orders/{orderId}/receipt` | ❌ Nicht vorhanden |
| `GET /orders/{orderId}/receipt.pdf` | ❌ Nicht vorhanden |

### Kritische Schema-Lücken

Die aktuelle `Orders`-Tabelle in der SQLite-Datenbank hat **keine** Checkout-relevanten Spalten:

```sql
CREATE TABLE Orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  table_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL
  -- fehlt: checkedOut_at, paymentMethod, totalAmount
);
```

Die `OrderItems`-Tabelle speichert **keinen Preissnapshot** zum Bestellzeitpunkt:

```sql
CREATE TABLE OrderItems (
  order_id INTEGER NOT NULL,
  menuItem_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  specialRequests TEXT NOT NULL DEFAULT ''
  -- fehlt: priceSnapshot REAL
);
```

Das ist das größte Problem: Wenn `MenuItems.price` sich nach einer Bestellung ändert, lässt sich der Rechnungsbetrag nicht mehr korrekt rekonstruieren. **Ohne `priceSnapshot` ist ein korrektes Receipt fachlich unmöglich.**

---

## Was für eine Implementierung nötig wäre

### 1. DB-Schema-Änderungen

```sql
-- Orders-Tabelle erweitern
ALTER TABLE Orders ADD COLUMN checkedOut_at TEXT;        -- nullable ISO datetime
ALTER TABLE Orders ADD COLUMN paymentMethod TEXT;         -- 'cash'|'card'|'mixed'|null
ALTER TABLE Orders ADD COLUMN totalAmount REAL;           -- computed at checkout

-- OrderItems-Tabelle erweitern (Breaking Change!)
ALTER TABLE OrderItems ADD COLUMN priceSnapshot REAL NOT NULL DEFAULT 0;
-- Hinweis: bestehende Bestellungen haben priceSnapshot=0, da Preis nicht mehr abrufbar
```

Alternativ eine separate `Receipts`-Tabelle anlegen (sauberer, aber mehr Aufwand).

### 2. Optionale Tabelle für Split-Billing

```sql
CREATE TABLE OrderSplits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL
);
```

### 3. Endpoint-Implementierung

**`POST /orders/{orderId}/checkout`**
- Prüfen, ob `checkedOut_at IS NULL` → sonst `409 ALREADY_CHECKED_OUT`
- Total aus `OrderItems.priceSnapshot * quantity` summieren
- Split-Beträge validieren (Summe muss ≈ Total sein, falls angegeben)
- `checkedOut_at`, `paymentMethod`, `totalAmount` setzen

**`GET /orders/{orderId}/receipt`** (JSON)
- Nur abrufbar wenn `checkedOut_at IS NOT NULL` → sonst `409 NOT_CHECKED_OUT`
- Gibt Order-Details, Items mit Preissnapshot, Total, Zahlungsart, Split zurück

**`GET /orders/{orderId}/receipt.pdf`**
- HTML-Template → PDF (z.B. via `puppeteer` oder `@react-pdf/renderer`)
- Neue Abhängigkeit im API-Package nötig
- Aufwand: hoch (ca. ½–1 Tag alleine für PDF-Rendering)

### 4. Shared-Types Ergänzungen

```ts
// Neue Schemas notwendig:
OrderCheckoutRequestSchema   // split[], paymentMethod
OrderCheckoutResponseSchema  // ReceiptDto
ReceiptDtoSchema             // orderId, timestamp, total, items, paymentMethod, split?
OrderParamsSchema            // bereits vorhanden ✅
```

---

## Abwägung: Warum Backlog?

| Argument | Gewicht |
|---|---|
| API-Plan markiert es selbst als "Wird noch nicht implementiert" | Hoch |
| `priceSnapshot`-Lücke ist ein Breaking Change für `OrderItems` | Hoch |
| PDF-Rendering braucht neue Abhängigkeit + Implementierungsaufwand | Mittel |
| Der MVP-Kern (Bestellen, Drucken, Tischverwaltung) funktioniert ohne Checkout | Hoch |
| Wechselgeld-Rechner & Pro-Person-Billing im Mindmap als "?" markiert | Mittel |

Die kritischste Entscheidung beim späteren Einbauen ist die `priceSnapshot`-Frage: entweder werden **alle zukünftigen** Bestellungen ab einem Migrations-Datum korrekt abgebildet, oder man akzeptiert, dass ältere Bestellungen keinen verlässlichen Receipt haben.

---

## Empfehlung für die spätere Implementierung

**Reihenfolge:**

1. `priceSnapshot`-Migration zuerst — noch vor dem ersten produktiven Event aktivieren, damit alle Bestellungen korrekte Preise haben
2. Dann `checkedOut_at` + `paymentMethod` + `totalAmount` zu `Orders` hinzufügen
3. Checkout-Endpoint implementieren (ohne PDF zuerst)
4. Receipt-JSON-Endpoint implementieren
5. Receipt-PDF als separates Ticket — eigener Aufwand

**Scope-Empfehlung für Checkout-MVP:**
- Einfaches Checkout ohne Split (Split ist Nice-to-have)
- Zahlungsart `cash|card|mixed` speichern (kein Wechselgeld-Rechner im Backend nötig, das ist Frontend)
- Receipt als JSON reicht für den Start; PDF ist ein eigenes Feature

---

## Status

- [x] Fachlicher Umfang analysiert
- [x] Schema-Lücken identifiziert
- [x] Implementierungsaufwand abgeschätzt
- [x] **Bewusst als Backlog markiert** — nicht Teil des MVP

