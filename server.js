require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { Vonage } = require('@vonage/server-sdk');
const path = require('path');

const PORT = process.env.PORT || 3000;
const VONAGE_API_KEY = process.env.VONAGE_API_KEY;
const VONAGE_API_SECRET = process.env.VONAGE_API_SECRET;
const VONAGE_FROM_NUMBER = process.env.VONAGE_FROM_NUMBER;
const SMS_TO_NUMBER = process.env.SMS_TO_NUMBER;
const RELAY_WHATSAPP_FROM = process.env.RELAY_WHATSAPP_FROM || '';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let vonageClient = null;
if (VONAGE_API_KEY && VONAGE_API_SECRET && VONAGE_FROM_NUMBER) {
  vonageClient = new Vonage({ apiKey: VONAGE_API_KEY, apiSecret: VONAGE_API_SECRET });
}

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
let smsStatus = vonageClient ? 'ready' : 'unconfigured';
const maxMessages = 200;
const messages = [];
const seenMessageIds = new Set();

function addMessage(entry) {
  messages.push(entry);
  if (messages.length > maxMessages) messages.shift();
  io.emit('message', entry);
}

async function sendSms(body, _from) {
  const messageBody = body;

  const targets = (SMS_TO_NUMBER || '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!vonageClient || !targets.length) {
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
      const result = await vonageClient.sms.send({ to, from: VONAGE_FROM_NUMBER, text: messageBody });
      const msgInfo = result.messages[0];
      smsEntry.status = msgInfo.status === '0' ? 'sent' : 'failed';
      smsEntry.sid = msgInfo['message-id'];
      if (msgInfo.status !== '0') smsEntry.error = msgInfo['error-text'];
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
  if (msg.fromMe) return;

  const from = msg.from;
  const body = msg.body;

  if (!body) return;

  if (seenMessageIds.has(msg.id.id)) return;
  seenMessageIds.add(msg.id.id);
  if (seenMessageIds.size > 10000) seenMessageIds.clear();

  const contact = await msg.getContact();
  const senderName = contact.pushname || contact.name || contact.number || from.split('@')[0];

  if (RELAY_WHATSAPP_FROM) {
    const allowed = RELAY_WHATSAPP_FROM.split(',').map((s) => s.trim());
    const bareNumber = from.split('@')[0];
    if (!allowed.includes(from) && !allowed.includes(bareNumber)) {
      return;
    }
  }

  addMessage({
    type: 'whatsapp',
    from: senderName,
    raw: from,
    body,
    timestamp: new Date().toISOString(),
  });

  try {
    await sendSms(body, senderName);
  } catch (err) {
    io.emit('log', { type: 'error', text: `SMS failed: ${err.message}`, timestamp: new Date().toISOString() });
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
    'SMS Provider': vonageClient ? 'Vonage' : 'Dry-run (no SMS)',
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
