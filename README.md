# discourse-timed-groups

Discourse-Plugin fuer zeitlich begrenzte Gruppenmitgliedschaften. Vergibt Zugang zu Gruppen fuer eine bestimmte Dauer und entfernt User automatisch nach Ablauf.

Entwickelt fuer [campus.outoftheb-ox.de](https://campus.outoftheb-ox.de) (Out Of The Box Science).

## Features

- **Zeitlich begrenzte Mitgliedschaften** — User bekommen Zugang fuer X Tage, das Plugin raeumt automatisch auf
- **Zwei Lizenzmodelle:**
  - **Individuell** — jeder User bekommt eigene X Tage ab Beitritt (z.B. Kurs-Zugang)
  - **Gruppenlizenz** — festes Ablaufdatum fuer alle, Nachzuegler bekommen Restlaufzeit (z.B. Firmen-Lizenzen)
- **Auto-Track** — neue Gruppenmitglieder bekommen automatisch eine zeitlich begrenzte Mitgliedschaft
- **Bulk Import** — alle bestehenden Mitglieder einer Gruppe auf einen Schlag importieren
- **Bulk Extend** — alle aktiven Mitgliedschaften einer Gruppe verlaengern
- **Benachrichtigungen** — PM an User 7 Tage vor Ablauf + bei Ablauf
- **Admin-Panel** unter Admin > Plugins > Zeitlich begrenzte Gruppen

## Installation

Plugin in `app.yml` eintragen:

```yaml
hooks:
  after_code:
    - exec:
        cd: $home/plugins
        cmd:
          - git clone https://github.com/oxscience/discourse-timed-groups.git
```

Dann Discourse neu aufbauen:

```bash
cd /var/discourse && ./launcher rebuild app
```

## Admin-Panel

Nach der Installation unter **Admin > Plugins > Zeitlich begrenzte Gruppen** erreichbar.

### Mitgliedschaft anlegen
User suchen, Gruppe waehlen, Laufzeit (Tage oder Datum) setzen, optional Notiz hinzufuegen.

### Gruppe importieren
Alle bestehenden Mitglieder einer Gruppe als zeitlich begrenzte Mitgliedschaften anlegen. Bereits vorhandene Eintraege werden uebersprungen.

### Auto-Track
Pro Gruppe konfigurierbar:

| Modus | Beschreibung | Beispiel |
|-------|-------------|----------|
| **Aus** | Kein Auto-Track | — |
| **Individuell** | Jeder User bekommt eigene X Tage ab Beitritt | Kurs mit 365 Tagen Zugang |
| **Gruppenlizenz** | Festes Ablaufdatum, Nachzuegler bekommen Restlaufzeit | Firmen-Lizenz bis 31.12.2026 |

### Alle verlaengern
Alle aktiven Mitgliedschaften einer Gruppe um X Tage verlaengern.

## Einstellungen

Unter Admin > Einstellungen nach "timed" suchen:

| Einstellung | Standard | Beschreibung |
|-------------|----------|-------------|
| `timed_groups_enabled` | true | Plugin aktivieren/deaktivieren |
| `timed_groups_notify_before_expiry` | true | Benachrichtigung vor Ablauf |
| `timed_groups_notify_on_expiry` | true | Benachrichtigung bei Ablauf |
| `timed_groups_days_before_expiry_notification` | 7 | Tage vor Ablauf fuer Warnung |

## API Endpoints

Alle Endpoints erfordern Admin-Rechte.

| Methode | Endpoint | Beschreibung |
|---------|----------|-------------|
| GET | `/timed-groups/admin/memberships` | Alle Mitgliedschaften (Filter: `group_id`, `status`) |
| POST | `/timed-groups/admin/memberships` | Mitgliedschaft anlegen |
| PUT | `/timed-groups/admin/memberships/:id` | Mitgliedschaft bearbeiten |
| DELETE | `/timed-groups/admin/memberships/:id` | Mitgliedschaft entfernen |
| POST | `/timed-groups/admin/memberships/bulk_extend` | Alle aktiven verlaengern |
| POST | `/timed-groups/admin/memberships/bulk_import` | Gruppe importieren |
| GET | `/timed-groups/admin/auto_track` | Auto-Track Einstellungen |
| PUT | `/timed-groups/admin/auto_track` | Auto-Track konfigurieren |
| GET | `/timed-groups/admin/groups` | Verfuegbare Gruppen |

## Technische Details

- **Datenbank:** Eigene Tabelle `timed_group_memberships` (user_id, group_id, starts_at, expires_at, note, etc.)
- **Background Job:** Sidekiq Scheduled Job prueft stuendlich auf abgelaufene Mitgliedschaften
- **Auto-Track Konfiguration:** Gespeichert via PluginStore
- **Frontend:** Vanilla JS Admin-Panel (kein Ember)
- **Hooks:** `user_added_to_group` (Auto-Track), `user_removed_from_group` (Cleanup)

## Lizenz

MIT
