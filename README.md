# WhatsApp → SMS Relay

Forward WhatsApp messages to SMS via a web dashboard using [Textbee](https://app.textbee.dev).

## Features

- **QR Code pairing** — Connect WhatsApp by scanning a QR code
- **Real-time dashboard** — Dark-themed web UI with live message log via WebSocket
- **Group chat support** — Shows group name with individual sender
- **Media relay** — Images and media are saved and viewable in the dashboard
- **Number filtering** — Optionally relay only from specific contacts
- **SMS via Textbee** — Uses Textbee API (app.textbee.dev)
- **Docker ready** — Includes Dockerfile and docker-compose for easy deployment
- **Persistent sessions** — WhatsApp auth survives container restarts

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm
- [Chromium](https://www.chromium.org/) (for whatsapp-web.js)
- An SMS provider account (optional — runs in dry-run mode without one)

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

Edit `.env` with your credentials. At minimum, set `SMS_TO_NUMBER` to your phone number and one SMS provider.

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

This pulls the image from `ghcr.io/lancetm714/whatsapp-sms-relay:latest`, maps port 5215, and uses a named volume for persistent WhatsApp auth sessions.

> **Note for Portainer/Synology:** If `.env` isn't picked up, use the `environment:` block in `docker-compose.yml` to set variables inline.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Web server port (default: `3000`) |
| `TEXTBEE_API_KEY` | Yes | Textbee API key from app.textbee.dev |
| `TEXTBEE_DEVICE_ID` | Yes | Textbee device ID |
| `SMS_TO_NUMBER` | Yes | Target phone number(s) for SMS, comma-separated |
| `RELAY_WHATSAPP_FROM` | No | Comma-separated WhatsApp numbers to relay from (leave empty for all) |
| `CHROMIUM_PATH` | No | Custom Chromium executable path (auto-detected in Docker) |

If `TEXTBEE_API_KEY` or `TEXTBEE_DEVICE_ID` is not set, the app runs in dry-run mode (logs messages without sending SMS).

## How It Works

1. The server starts a WhatsApp Web session via [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
2. You scan a QR code to authenticate — your WhatsApp account is now linked
3. Incoming WhatsApp messages are received by the server
4. Each message is displayed in the web dashboard in real time
5. The message is also sent as SMS to your configured phone number via Textbee
6. Group messages are formatted as `(Group Name) Sender: message`

## SMS Provider Setup

### Textbee

1. Sign up at [app.textbee.dev](https://app.textbee.dev)
2. Create a device and note your device ID
3. Generate an API key from the Textbee dashboard
4. Add `TEXTBEE_API_KEY=your_key` and `TEXTBEE_DEVICE_ID=your_device_id` to `.env`

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/status` | GET | WhatsApp and SMS connection status |
| `/api/messages` | GET | Last 200 messages |
| `/api/config` | GET | Current configuration |
| `/api/send-test` | POST | Send a test SMS |

## License

[MIT](https://opensource.org/licenses/MIT)
