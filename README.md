# 🏆 WM 2026 Familien-Tippspiel

Selbst gehostetes Tippspiel für Familie & Freunde zur Fußball-WM 2026.
Keine Cloud, keine Tracker, alle Daten bleiben auf dem eigenen Server.

## Schnellstart (Node.js)

```bash
git clone <repo-url>
cd wm-tipp
npm install
npm run setup
npm start
```

`npm run setup` fragt interaktiv:
- wie viele Mitspieler mitmachen und wie sie heißen,
- welches Passwort die App haben soll (Enter = Standard `WM2026!`),
- auf welchem Port die App laufen soll (Enter = `3000`).

Danach im Browser öffnen: `http://localhost:3000`
Im selben WLAN auch vom Handy aus: `http://<server-ip>:3000`

## Schnellstart (Docker)

```bash
docker compose run --rm app node setup.js   # einmalige Einrichtung
docker compose up -d --build
```

Die App läuft danach auf `http://localhost:3000`.

## Passwort

Standard ist `WM2026!`, sofern beim Setup kein eigenes gewählt wurde.
Jederzeit änderbar in der App unter **Einstellungen → Passwort ändern**.

## Spielplan & Ergebnisse automatisch laden (optional)

1. Kostenlosen Account erstellen: https://www.football-data.org/client/register
2. API-Key kopieren
3. In der App → Einstellungen → API-Key eintragen → „Spielplan laden" tippen

Der kostenlose Plan reicht vollständig aus (WM-Daten inklusive).
Ohne API-Key lassen sich Ergebnisse auch manuell eintragen.

## Punkte-System

| Punkte | Bedingung |
|--------|-----------|
| 4P | Exaktes Ergebnis (z.B. 2:1 getippt → 2:1 gespielt) |
| 2P | Richtige Tendenz (Sieg / Niederlage / Unentschieden) |
| 0P | Falsch |
| x2 | Joker eingesetzt (einmal pro Turnier) |
| +10P | Weltmeister richtig getippt |

## Mitspieler & Namen später ändern

In der App → Einstellungen → Namen anpassen → Speichern.

## Produktiv-Betrieb mit eigener Domain + HTTPS (optional)

Für den Betrieb auf einem eigenen Server mit Let's-Encrypt-Zertifikat liegt
unter `nginx/nginx.conf` eine Beispiel-Konfiguration bereit. Domain darin
anpassen, Zertifikat per `certbot` ausstellen, danach:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```
