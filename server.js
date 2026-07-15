require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const TEXTBEE_API_KEY = process.env.TEXTBEE_API_KEY;
const TEXTBEE_DEVICE_ID = process.env.TEXTBEE_DEVICE_ID;
const SMS_TO_NUMBER = process.env.SMS_TO_NUMBER;
const RELAY_WHATSAPP_FROM = process.env.RELAY_WHATSAPP_FROM || '';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use('/media', express.static(path.join(__dirname, 'media')));

const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

let smsProvider = TEXTBEE_API_KEY && TEXTBEE_DEVICE_ID ? 'textbee' : 'stub';

const whatsapp = new Client({
  authStrategy: new LocalAuth({ clientId: 'relay' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    executablePath: process.env.CHROMIUM_PATH || undefined,
  },
});

let qrCodeData = null;
let whatsappStatus = 'initializing';
let smsStatus = smsProvider === 'stub' ? 'unconfigured' : 'ready';
const maxMessages = 200;
const messages = [];
const seenMessageIds = new Set();

function addMessage(entry) {
  messages.push(entry);
  if (messages.length > maxMessages) messages.shift();
  io.emit('message', entry);
}

async function sendSms(body, from) {
  const messageBody = from ? `${from}: ${body}` : body;

  const targets = (SMS_TO_NUMBER || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (smsProvider === 'stub' || !targets.length) {
    addMessage({
      type: 'sms', to: targets.join(', ') || '(not configured)',
      body: messageBody, status: 'stub', sid: 'dry-run', timestamp: new Date().toISOString(),
    });
    return;
  }

  for (const to of targets) {
    const smsEntry = {
      type: 'sms', to, body: messageBody, status: 'sending', timestamp: new Date().toISOString(),
    };
    try {
      const res = await fetch(`https://api.textbee.dev/api/v1/gateway/devices/${TEXTBEE_DEVICE_ID}/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': TEXTBEE_API_KEY },
        body: JSON.stringify({ recipients: [to], message: messageBody }),
      });
      const data = await res.json();
      io.emit('log', { type: 'debug', text: `Textbee: ${res.status} ${JSON.stringify(data)}`, timestamp: new Date().toISOString() });
      if (res.ok) {
        smsEntry.status = 'sent';
        smsEntry.sid = data.id || 'ok';
      } else {
        smsEntry.status = 'failed';
        smsEntry.error = data.message || data.error || `HTTP ${res.status}`;
      }
    } catch (err) {
      smsEntry.status = 'failed';
      smsEntry.error = err.message;
    }
    addMessage(smsEntry);
  }
}

whatsapp.on('qr', async (qr) => {
  qrCodeData = await qrcode.toDataURL(qr);
  whatsappStatus = 'awaiting_scan';
  io.emit('status', { whatsapp: whatsappStatus, sms: smsStatus });
  io.emit('qr', qrCodeData);
});

whatsapp.on('ready', () => {
  whatsappStatus = 'connected';
  io.emit('status', { whatsapp: whatsappStatus, sms: smsStatus });
  addMessage({ type: 'system', text: 'WhatsApp connected', timestamp: new Date().toISOString() });
});

whatsapp.on('disconnected', (reason) => {
  whatsappStatus = 'disconnected';
  io.emit('status', { whatsapp: whatsappStatus, sms: smsStatus });
  addMessage({ type: 'system', text: `WhatsApp disconnected: ${reason}`, timestamp: new Date().toISOString() });
});

whatsapp.on('message', async (msg) => {
  try {
    if (msg.fromMe) return;

    const from = msg.from;
    const body = msg.body;
    const hasMedia = msg.hasMedia;

    if (!body && !hasMedia) return;

    if (seenMessageIds.has(msg.id.id)) return;
    seenMessageIds.add(msg.id.id);
    if (seenMessageIds.size > 10000) seenMessageIds.clear();

    const isGroup = from.endsWith('@g.us');
    let senderName;
    let groupName = null;

    if (isGroup) {
      try {
        const chat = await msg.getChat();
        groupName = chat.name;
      } catch {
        groupName = '(unknown group)';
      }
      if (msg.author) {
        try {
          const authorContact = await msg.getContact();
          senderName = authorContact.pushname || authorContact.name || authorContact.number || msg.author.split('@')[0];
        } catch {
          senderName = msg.author.split('@')[0];
        }
      } else {
        senderName = groupName;
      }
    } else {
      const contact = await msg.getContact();
      senderName = contact.pushname || contact.name || contact.number || from.split('@')[0];
    }

    if (RELAY_WHATSAPP_FROM) {
      const allowed = RELAY_WHATSAPP_FROM.split(',').map((s) => s.trim());
      const bareNumber = from.split('@')[0];
      const authorBare = msg.author ? msg.author.split('@')[0] : null;
      if (!allowed.includes(from) && !allowed.includes(bareNumber) && !allowed.includes(authorBare)) {
        return;
      }
    }

    let mediaUrl = null;
    if (hasMedia) {
      try {
        const media = await msg.downloadMedia();
        const ext = media.mimetype.split('/')[1] || 'bin';
        const filename = `${msg.id.id}.${ext}`;
        fs.writeFileSync(path.join(mediaDir, filename), media.data, 'base64');
        mediaUrl = `/media/${filename}`;
      } catch (err) {
        console.error('Media download failed:', err.message);
      }
    }

    addMessage({
      type: 'whatsapp',
      from: senderName,
      raw: from,
      body: body || (mediaUrl ? '[Media]' : ''),
      mediaUrl,
      groupName,
      timestamp: new Date().toISOString(),
    });

    try {
      const smsText = hasMedia ? (body || '(Image received)') : body;
      if (smsText) {
        const smsFrom = groupName ? `${senderName} (${groupName})` : senderName;
        await sendSms(smsText, smsFrom);
      }
    } catch (err) {
      io.emit('log', { type: 'error', text: `SMS failed: ${err.message}`, timestamp: new Date().toISOString() });
    }
  } catch (err) {
    console.error('Message handler error:', err);
    addMessage({ type: 'error', text: `Handler: ${err.stack || err.message}`, timestamp: new Date().toISOString() });
  }
});

whatsapp.initialize();

app.get('/api/status', (req, res) => {
  res.json({ whatsapp: whatsappStatus, sms: smsStatus });
});

app.get('/api/messages', (req, res) => {
  res.json(messages);
});

app.get('/api/config', (req, res) => {
  res.json({
    'SMS Provider': smsProvider === 'textbee' ? 'Textbee' : 'Dry-run (no SMS)',
    'SMS To': SMS_TO_NUMBER || '(not set)',
    'WhatsApp From Filter': RELAY_WHATSAPP_FROM || 'All numbers',
    'WhatsApp Status': whatsappStatus,
  });
});

app.post('/api/send-test', async (req, res) => {
  try {
    await sendSms('Test from WhatsApp-SMS Relay', 'test');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

io.on('connection', (socket) => {
  if (qrCodeData) socket.emit('qr', qrCodeData);
  socket.emit('status', { whatsapp: whatsappStatus, sms: smsStatus });
  socket.emit('messages', messages);
});

server.listen(PORT, () => {
  console.log(`WhatsApp-SMS Relay running at http://0.0.0.0:${PORT}`);
});
