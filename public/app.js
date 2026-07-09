const socket = io();

const statusWhatsapp = document.getElementById('status-whatsapp');
const statusSms = document.getElementById('status-sms');
const qrContainer = document.getElementById('qr-container');
const logContainer = document.getElementById('log-container');
const testBtn = document.getElementById('btn-test');
const configGrid = document.getElementById('config-grid');

function setStatus(el, state, text) {
  const dot = el.querySelector('.status-dot');
  const txt = el.querySelector('.status-text');
  dot.className = 'status-dot ' + state;
  txt.textContent = text;
}

socket.on('status', ({ whatsapp, sms }) => {
  setStatus(statusWhatsapp, whatsapp, whatsapp.replace(/_/g, ' '));
  setStatus(statusSms, sms, sms === 'ready' ? 'Connected' : 'Not configured');
  document.getElementById('qr-panel').style.display =
    whatsapp === 'connected' ? 'none' : 'block';
});

socket.on('qr', (dataUrl) => {
  qrContainer.innerHTML = `<img src="${dataUrl}" alt="QR Code">`;
});

socket.on('message', (entry) => {
  appendLog(entry);
});

socket.on('messages', (entries) => {
  logContainer.innerHTML = '';
  if (!entries.length) {
    logContainer.innerHTML = '<div class="log-empty">No messages yet</div>';
    return;
  }
  entries.forEach(appendLog);
});

socket.on('log', (entry) => {
  appendLog(entry);
});

function timeStr(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function appendLog(entry) {
  const empty = logContainer.querySelector('.log-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = 'log-entry';

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = timeStr(entry.timestamp);
  div.appendChild(time);

  if (entry.type === 'whatsapp') {
    const badge = document.createElement('span');
    badge.className = 'badge badge-whatsapp';
    badge.textContent = 'WA';
    div.appendChild(badge);

    const from = document.createElement('span');
    from.className = 'from';
    from.textContent = entry.from + ': ';
    div.appendChild(from);

    if (entry.groupName) {
      const group = document.createElement('span');
      group.className = 'group-name';
      group.textContent = '(' + entry.groupName + ') ';
      div.appendChild(group);
    }

    if (entry.mediaUrl) {
      const img = document.createElement('img');
      img.className = 'media-thumb';
      img.src = entry.mediaUrl;
      img.alt = 'media';
      img.addEventListener('click', () => window.open(entry.mediaUrl, '_blank'));
      div.appendChild(img);
    }

    const body = document.createElement('span');
    body.className = 'body';
    body.textContent = entry.body;
    div.appendChild(body);
  } else if (entry.type === 'sms') {
    const badge = document.createElement('span');
    badge.className = `badge badge-${entry.status}`;
    badge.textContent = entry.status === 'sent' ? 'SMS' : entry.status;
    div.appendChild(badge);

    const to = document.createElement('span');
    to.className = 'from';
    to.textContent = '→ ' + entry.to + ': ';
    div.appendChild(to);

    const body = document.createElement('span');
    body.className = 'body';
    body.textContent = entry.body;
    div.appendChild(body);

    if (entry.sid) {
      const sid = document.createElement('span');
      sid.className = 'sid';
      sid.textContent = 'SID: ' + entry.sid;
      div.appendChild(sid);
    }
  } else if (entry.type === 'system' || entry.type === 'success' || entry.type === 'error') {
    const badge = document.createElement('span');
    badge.className = `badge badge-${entry.type}`;
    badge.textContent = entry.type;
    div.appendChild(badge);

    const body = document.createElement('span');
    body.className = 'body';
    body.textContent = entry.text;
    div.appendChild(body);
  }

  logContainer.appendChild(div);
  logContainer.scrollTop = logContainer.scrollHeight;
}

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  testBtn.textContent = 'Sending...';
  try {
    const res = await fetch('/api/send-test', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
  } catch (err) {
    appendLog({ type: 'error', text: 'Test failed: ' + err.message, timestamp: new Date().toISOString() });
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test SMS';
  }
});

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    setStatus(statusWhatsapp, s.whatsapp, s.whatsapp.replace(/_/g, ' '));
    setStatus(statusSms, s.sms, s.sms === 'ready' ? 'Connected' : 'Not configured');
  });

fetch('/api/messages')
  .then((r) => r.json())
  .then((msgs) => {
    if (msgs.length) {
      logContainer.innerHTML = '';
      msgs.forEach(appendLog);
    }
  });

fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    configGrid.innerHTML = '';
    for (const [key, val] of Object.entries(cfg)) {
      const item = document.createElement('div');
      item.className = 'config-item';
      item.innerHTML = `<strong>${key}</strong>${val || '(not set)'}`;
      configGrid.appendChild(item);
    }
  });
