# Deploying the multiplayer server (LAN test / Ubuntu Studio laptop)

Everything below applies to a fresh Ubuntu install — Ubuntu Studio is plain Ubuntu underneath,
so this is unmodified from a stock Ubuntu Server setup.

## 1. Install Node.js and PostgreSQL

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql
```

## 2. Create the database and role

```sh
sudo -u postgres psql -c "CREATE ROLE prospector WITH LOGIN PASSWORD 'change-me';"
sudo -u postgres psql -c "CREATE DATABASE prospector OWNER prospector;"
```
Postgres only needs to listen on `localhost` for this setup — the app connects to it, nothing
else does.

## 3. Get the app onto the box and build the client

```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin prospector
sudo mkdir -p /opt/prospector
sudo chown prospector:prospector /opt/prospector
sudo -u prospector git clone <repo-url> /opt/prospector
cd /opt/prospector
sudo -u prospector npm ci
sudo -u prospector npm run build:web:selfhost
```
Use `build:web:selfhost`, not the plain `build:web` — that one bakes in the `/prospector/`
sub-path GitHub Pages needs, which breaks asset loading when this server serves the build from
its own root instead.

## 4. Configure

```sh
sudo -u prospector cp .env.example .env
sudo -u prospector nano .env
```
Set `DATABASE_URL` to match step 2's role/password, e.g.
`postgres://prospector:change-me@localhost:5432/prospector`. Leave `PORT` at 8787 unless
something else on the box already uses it.

## 5. Install and start the systemd service

```sh
sudo cp server/deploy/prospector.service /etc/systemd/system/prospector.service
sudo systemctl daemon-reload
sudo systemctl enable --now prospector
sudo systemctl status prospector   # should show "active (running)"
```

## 6. Open it to the LAN

```sh
sudo ufw allow from 192.168.0.0/16 to any port 8787 proto tcp
```
(adjust the CIDR to match your actual LAN subnet — `ip addr` shows it). Find the laptop's LAN
IP with `hostname -I`, then from another device on the same network open
`http://<laptop-ip>:8787/`. No TLS, no domain — that's expected for a LAN-only test; both get
added later only if/when this moves to a publicly reachable server (a reverse proxy in front of
this same port, no application changes needed).

## Updating after a code change

```sh
cd /opt/prospector
sudo -u prospector git pull
sudo -u prospector npm ci
sudo -u prospector npm run build:web:selfhost
sudo systemctl restart prospector
```
Games in progress survive the restart — state is persisted to Postgres on every move, and
`server/main.ts` reloads every game from the database at boot.

## Database retention

Games are never deleted automatically — every one ever created stays in the `games` table
(and gets reloaded into memory on every server start) forever. `server/deploy/dbcleanup.sh`
is a manual maintenance script for this:

```sh
server/deploy/dbcleanup.sh --status              # finished / active / total counts
server/deploy/dbcleanup.sh --keep 30             # delete FINISHED games untouched 30+ days
server/deploy/dbcleanup.sh --keep 90 --force     # ALSO delete abandoned/active games 90+ days old
```

It reads `DATABASE_URL` from `.env` (same file the app uses) by default, previews what it's
about to delete, and asks for confirmation unless run with `-y`/`--yes`. Not on a timer —
run it by hand whenever the table's grown enough to care.
