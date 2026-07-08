require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const twilio = require('twilio');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const SMS_TO_NUMBER = process.env.SMS_TO_NUMBER;
const RELAY_WHATSAPP_FROM = process.env.RELAY_WHATSAPP_FROM || '';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
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
let smsStatus = twilioClient ? 'ready' : 'unconfigured';
const maxMessages = 200;
const messages = [];

function addMessage(entry) {
  messages.push(entry);
  if (messages.length > maxMessages) messages.shift();
  io.emit('message', entry);
}

async function sendSms(body, from) {
  const senderInfo = from ? `From WhatsApp (${from})` : '';
  const messageBody = senderInfo ? `${senderInfo}: ${body}` : body;

  const smsEntry = {
    type: 'sms',
    to: SMS_TO_NUMBER || '(not configured)',
    body: messageBody,
    status: 'sending',
    timestamp: new Date().toISOString(),
  };

  if (!twilioClient || !SMS_TO_NUMBER) {
    smsEntry.status = 'stub';
    smsEntry.sid = 'dry-run';
    addMessage(smsEntry);
    return smsEntry;
  }

  try {
    const result = await twilioClient.messages.create({
      body: messageBody,
      from: TWILIO_FROM_NUMBER,
      to: SMS_TO_NUMBER,
    });
    smsEntry.status = 'sent';
    smsEntry.sid = result.sid;
    addMessage(smsEntry);
    return smsEntry;
  } catch (err) {
    smsEntry.status = 'failed';
    smsEntry.error = err.message;
    addMessage(smsEntry);
    throw err;
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

  if (RELAY_WHATSAPP_FROM) {
    const allowed = RELAY_WHATSAPP_FROM.split(',').map((s) => s.trim());
    const bareNumber = from.split('@')[0];
    if (!allowed.includes(from) && !allowed.includes(bareNumber)) {
      return;
    }
  }

  addMessage({
    type: 'whatsapp',
    from,
    body,
    timestamp: new Date().toISOString(),
  });

  try {
    await sendSms(body, from);
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
    'SMS Provider': twilioClient ? 'Twilio' : 'Dry-run (no SMS)',
    'SMS To': SMS_TO_NUMBER || '(not set)',
    'WhatsApp From Filter': RELAY_WHATSAPP_FROM || 'All numbers',
    'WhatsApp Status': whatsappStatus,
  });
});

app.post('/api/send-test', async (req, res) => {
  try {
    const result = await sendSms('Test from WhatsApp-SMS Relay', 'test');
    res.json({ success: result.status !== 'failed', sid: result.sid });
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
