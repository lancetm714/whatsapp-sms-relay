# WhatsApp → SMS Relay

Forward WhatsApp messages to SMS via a web dashboard. Receive WhatsApp messages on your phone as SMS using the Vonage API.

## Features

- **QR Code pairing** — Connect WhatsApp by scanning a QR code
- **Real-time dashboard** — Dark-themed web UI with live message log via WebSocket
- **Group chat support** — Shows group name and individual sender for group messages
- **Media relay** — Images and media are saved and viewable in the dashboard
- **Number filtering** — Optionally relay only from specific contacts
- **Vonage SMS** — Sends SMS via Vonage API, or runs in dry-run/stub mode without credentials
- **Docker ready** — Includes Dockerfile and docker-compose for easy deployment
- **Persistent sessions** — WhatsApp auth survives container restarts

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Chromium](https://www.chromium.org/) (for whatsapp-web.js)
- A [Vonage](https://www.vonage.com/) account (optional — runs in dry-run mode without one)

### Install

```bash
git clone https://github.com/lancetm714/whatsapp-sms-relay.git
cd whatsapp-sms-relay
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials. At minimum, set `SMS_TO_NUMBER` to your phone number.

### Run

```bash
npm start
```

Open `http://localhost:3000`, scan the QR code with WhatsApp on your phone, and you're live.

For development with auto-reload:

```bash
npm run dev
```

## Docker

```bash
docker compose up -d
```

This pulls the image from `ghcr.io/lancetm714/whatsapp-sms-relay:latest`, maps port 5215, and mounts a volume for persistent WhatsApp auth sessions.

Make sure your `.env` file is configured before running.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Web server port (default: `3000`) |
| `VONAGE_API_KEY` | No | Vonage API key (leave empty for dry-run mode) |
| `VONAGE_API_SECRET` | No | Vonage API secret |
| `VONAGE_FROM_NUMBER` | No | Vonage sender phone number |
| `SMS_TO_NUMBER` | Yes | Target phone number(s) for SMS, comma-separated |
| `RELAY_WHATSAPP_FROM` | No | Comma-separated WhatsApp numbers to relay from (leave empty for all) |
| `CHROMIUM_PATH` | No | Custom Chromium executable path (auto-detected in Docker) |

## How It Works

1. The server starts a WhatsApp Web session via [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
2. You scan a QR code to authenticate — your WhatsApp account is now linked
3. Incoming WhatsApp messages are received by the server
4. Each message is displayed in the web dashboard in real time
5. The message is also sent as SMS to your configured phone number via Vonage
6. Group messages include both the sender's name and the group name

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | WhatsApp and SMS connection status |
| `/api/messages` | GET | Last 200 messages |
| `/api/config` | GET | Current configuration |
| `/api/send-test` | POST | Send a test SMS |

## License

[MIT](https://opensource.org/licenses/MIT)
