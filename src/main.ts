import { io, type Socket } from 'socket.io-client';
import './style.css';

type Presence = { userId: string; online: boolean };
type IncomingCall = { from: string };
type SignalMsg = { from: string; data: any };

type CallState = 'idle' | 'calling' | 'ringing' | 'in_call';
type NoiseMode = 'off' | 'normal' | 'strong';

type State = {
  serverUrl: string;
  myId: string;
  friendId: string;
  connected: boolean;
  friendOnline: boolean;
  callState: CallState;
  micMuted: boolean;
  log: string;
  autoConnect: boolean;
  micGain: number; // 0.1..2.0
  noiseMode: NoiseMode;
};

const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;

function createToxicWave(event: MouseEvent) {
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  // Create multiple waves for better effect
  for (let i = 0; i < 2; i++) {
    setTimeout(() => {
      const wave = document.createElement('span');
      const size = Math.max(rect.width, rect.height) * (1.5 + i * 0.3);
      wave.style.width = wave.style.height = size + 'px';
      wave.style.left = (x - size / 2) + 'px';
      wave.style.top = (y - size / 2) + 'px';
      wave.classList.add('toxic-wave');
      
      button.appendChild(wave);
      
      setTimeout(() => {
        wave.remove();
      }, 1200 + i * 200);
    }, i * 100);
  }
}

const state: State = {
  serverUrl: 'https://newds-server.onrender.com',
  myId: 'me',
  friendId: 'friend',
  connected: false,
  friendOnline: false,
  callState: 'idle',
  micMuted: false,
  log: '',
  autoConnect: true,
  micGain: 1.0,
  noiseMode: 'normal'
};

let socket: Socket | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;
let processedStream: MediaStream | null = null;
let micSender: RTCRtpSender | null = null;
let gateTimer: number | null = null;

const LS_KEY = 'newds_lite_settings_v1';

function render() {
  const root = el('#app');
  if (!root) return;

  const canCall =
    state.connected &&
    state.friendOnline &&
    (state.callState === 'idle');
  const canHangup =
    state.callState === 'calling' || state.callState === 'ringing' || state.callState === 'in_call';

  const callBtnText =
    state.callState === 'idle'
      ? 'Позвонить'
      : state.callState === 'calling'
        ? 'Звоним…'
        : state.callState === 'ringing'
          ? 'Соединяем…'
          : 'В звонке';

  root.innerHTML = `
    <div class="card">
      <div class="header">
        <div>
          <div class="title">Nevax</div>
          <div class="sub">Voice calls made simple. One friend, one button.</div>
        </div>
        <div class="pill ${state.connected ? 'on' : 'off'}">${state.connected ? 'online' : 'offline'}</div>
      </div>

      <div class="miniRow">
        <div class="kv">
          <div class="k">Друг</div>
          <div class="v">${escapeHtml(state.friendId || '—')}</div>
        </div>
        <div class="pill ${state.friendOnline ? 'on' : 'off'}">${state.friendOnline ? 'online' : 'offline'}</div>
      </div>

      <button id="btnCall" class="bigBtn ${canHangup ? 'hangup' : 'call'}" ${(!canCall && !canHangup) ? 'disabled' : ''}>
        ${escapeHtml(canHangup ? 'Сбросить' : callBtnText)}
      </button>

      <div class="row">
        <button id="btnMute" ${state.callState !== 'in_call' ? 'disabled' : ''}>${state.micMuted ? 'Вкл микрофон' : 'Выключить микрофон'}</button>
      </div>

      <details class="settings" ${state.connected ? '' : 'open'}>
        <summary>Настройки</summary>
        <div class="grid">
          <label>My ID
            <input id="myId" value="${escapeHtml(state.myId)}" />
          </label>
          <label>Friend ID
            <input id="friendId" value="${escapeHtml(state.friendId)}" />
          </label>
          <div class="seg" style="grid-column:1 / -1;">
            <div class="segTitle">
              <div>Шумоподавление</div>
              <div>${escapeHtml(state.noiseMode === 'off' ? 'выкл' : state.noiseMode === 'normal' ? 'обычное' : 'сильное')}</div>
            </div>
            <div class="segOptions">
              <label class="chip">
                <input type="radio" name="noiseMode" value="off" ${state.noiseMode === 'off' ? 'checked' : ''} />
                Выкл
              </label>
              <label class="chip">
                <input type="radio" name="noiseMode" value="normal" ${state.noiseMode === 'normal' ? 'checked' : ''} />
                Обычное
              </label>
              <label class="chip">
                <input type="radio" name="noiseMode" value="strong" ${state.noiseMode === 'strong' ? 'checked' : ''} />
                Сильное
              </label>
            </div>
            <div class="muted">“Сильное” добавляет обработку (фильтр/компрессия/гейт). Может слегка “резать” тихий голос.</div>
          </div>
          <div class="sliderRow" style="grid-column:1 / -1;">
            <div class="sliderMeta">
              <div>Громкость микрофона</div>
              <div>${Math.round(state.micGain * 100)}%</div>
            </div>
            <input id="micGain" class="slider" type="range" min="10" max="200" step="1" value="${Math.round(state.micGain * 100)}" />
            <div class="muted">100% = как есть. Больше — усиление, меньше — тише.</div>
          </div>
          <label style="grid-column:1 / -1;">
            <span class="muted">Автоподключение</span>
            <input id="autoConnect" type="checkbox" ${state.autoConnect ? 'checked' : ''} />
          </label>
        </div>
        <div class="row" style="margin-top:10px;">
          <button id="btnConnect" class="primary" ${state.connected ? 'disabled' : ''}>Подключиться</button>
          <button id="btnDisconnect" class="danger" ${!state.connected ? 'disabled' : ''}>Отключиться</button>
        </div>
      </details>

      <div class="muted" id="log">${escapeHtml(state.log)}</div>
      <audio id="remote" autoplay></audio>
    </div>
  `;

    (el('#myId') as HTMLInputElement).onchange = (e) => {
    state.myId = (e.target as HTMLInputElement).value.trim();
    persist();
  };
  (el('#friendId') as HTMLInputElement).onchange = (e) => {
    state.friendId = (e.target as HTMLInputElement).value.trim();
    persist();
  };
  (el('#autoConnect') as HTMLInputElement).onchange = (e) => {
    state.autoConnect = (e.target as HTMLInputElement).checked;
    persist();
  };
  (el('#micGain') as HTMLInputElement).oninput = (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    state.micGain = clamp(v / 100, 0.1, 2.0);
    applyMicGain();
    persist();
    render();
  };

  const radios = Array.from(document.querySelectorAll('input[name="noiseMode"]')) as HTMLInputElement[];
  for (const r of radios) {
    r.onchange = async () => {
      const v = r.value as NoiseMode;
      if (v !== 'off' && v !== 'normal' && v !== 'strong') return;
      state.noiseMode = v;
      persist();
      render();
      if (state.callState === 'in_call' || state.callState === 'calling' || state.callState === 'ringing') {
        try {
          await rebuildMicPipeline();
          log(`Шумоподавление: ${v === 'off' ? 'выкл' : v === 'normal' ? 'обычное' : 'сильное'}`);
        } catch (e: any) {
          log(`Не удалось применить шумоподавление: ${e?.message ?? String(e)}`);
        }
      }
    };
  }

  (el('#btnConnect') as HTMLButtonElement).onclick = (e) => {
    createToxicWave(e);
    void connect();
  };
  (el('#btnDisconnect') as HTMLButtonElement).onclick = (e) => {
    createToxicWave(e);
    void disconnect();
  };
  (el('#btnCall') as HTMLButtonElement).onclick = (e) => {
    createToxicWave(e);
    if (canHangup) void hangup();
    else void startCall();
  };
  (el('#btnMute') as HTMLButtonElement).onclick = (e) => {
    createToxicWave(e);
    toggleMute();
  };

  remoteAudio = el('#remote') as HTMLAudioElement;
}

function log(s: string) {
  state.log = s;
  render();
}

function persist() {
  const payload = {
    serverUrl: state.serverUrl,
    myId: state.myId,
    friendId: state.friendId,
    autoConnect: state.autoConnect,
    micGain: state.micGain,
    noiseMode: state.noiseMode
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {}
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const v = JSON.parse(raw);
    if (typeof v?.serverUrl === 'string') state.serverUrl = v.serverUrl;
    if (typeof v?.myId === 'string') state.myId = v.myId;
    if (typeof v?.friendId === 'string') state.friendId = v.friendId;
    if (typeof v?.autoConnect === 'boolean') state.autoConnect = v.autoConnect;
    if (typeof v?.micGain === 'number' && Number.isFinite(v.micGain)) {
      state.micGain = clamp(v.micGain, 0.1, 2.0);
    }
    if (v?.noiseMode === 'off' || v?.noiseMode === 'normal' || v?.noiseMode === 'strong') {
      state.noiseMode = v.noiseMode;
    }
  } catch {}
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function escapeHtml(str: string) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function connect() {
  if (state.connected) return;
  const serverUrl = state.serverUrl.trim();
  if (!serverUrl) return;
  if (!state.myId.trim() || !state.friendId.trim()) return;

  log('Подключаюсь…');
  socket = io(serverUrl, { transports: ['websocket'] });

  socket.on('connect', async () => {
    const res = await emitAck(socket!, 'hello', { userId: state.myId.trim() });
    if (!res.ok) {
      log(`Ошибка регистрации: ${res.error ?? 'unknown'}`);
      return;
    }
    state.connected = true;
    log('Подключено. Жду друга…');
    render();
  });

  socket.on('disconnect', () => {
    state.connected = false;
    state.friendOnline = false;
    if (state.callState !== 'idle') void hangup();
    log('Отключено.');
  });

  socket.on('presence', (p: Presence) => {
    if (p.userId === state.friendId.trim()) {
      state.friendOnline = p.online;
      render();
    }
  });

  socket.on('incomingCall', async (p: IncomingCall) => {
    if (p.from !== state.friendId.trim()) return;
    // авто-ответ: без лишних кнопок
    log('Входящий звонок. Авто-ответ…');
    if (state.callState === 'idle') state.callState = 'ringing';
    render();
    await ensurePeerConnection();
  });

  socket.on('signal', async (m: SignalMsg) => {
    if (m.from !== state.friendId.trim()) return;
    await onSignal(m.data);
  });
}

async function disconnect() {
  await hangup();
  socket?.disconnect();
  socket = null;
  state.connected = false;
  state.friendOnline = false;
  render();
}

async function startCall() {
  if (!socket || !state.connected) return;
  if (!state.friendOnline) return;

  state.callState = 'calling';
  render();
  await ensurePeerConnection();
  const res = await emitAck(socket, 'call', { to: state.friendId.trim() });
  if (!res.ok) log(`Не удалось позвонить: ${res.error ?? 'unknown'}`);
}

async function ensurePeerConnection() {
  if (!socket) throw new Error('no socket');
  if (pc) return;

  state.callState = state.callState === 'calling' ? 'calling' : 'ringing';
  state.micMuted = false;
  render();

  pc = new RTCPeerConnection({
    iceServers: [
      // публичные STUN (можно заменить на свой)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  });

  pc.onicecandidate = (ev) => {
    if (!ev.candidate) return;
    void emitAck(socket!, 'signal', { to: state.friendId.trim(), data: { type: 'ice', candidate: ev.candidate } });
  };

  pc.ontrack = (ev) => {
    if (!remoteAudio) return;
    const [stream] = ev.streams;
    if (stream) remoteAudio.srcObject = stream;
    else remoteAudio.srcObject = new MediaStream([ev.track]);
  };

  await rebuildMicPipeline(true);

  // если мы инициатор — создадим offer сразу при нажатии "Позвонить"
  // (но peer может авто-ответить и сам прислать offer; поэтому проверяем stable)
  if (pc.signalingState === 'stable') {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await emitAck(socket!, 'signal', { to: state.friendId.trim(), data: { type: 'offer', sdp: offer.sdp } });
    log('Звонок: отправил offer…');
  }
}

function applyMicGain() {
  if (!gainNode) return;
  gainNode.gain.value = clamp(state.micGain, 0.1, 2.0);
}

async function rebuildMicPipeline(initialAddTrack = false) {
  if (!pc) throw new Error('no pc');

  // cleanup previous
  if (gateTimer !== null) {
    window.clearInterval(gateTimer);
    gateTimer = null;
  }
  for (const t of localStream?.getTracks?.() ?? []) t.stop();
  localStream = null;
  for (const t of processedStream?.getTracks?.() ?? []) t.stop();
  processedStream = null;
  try {
    await audioCtx?.close();
  } catch {}
  audioCtx = null;
  gainNode = null;

  const baseOn = state.noiseMode !== 'off';
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: baseOn,
      noiseSuppression: baseOn,
      autoGainControl: baseOn
    }
  });

  // WebAudio chain: mic -> (filters/comp) -> gain -> destination
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(localStream);

  let node: AudioNode = src;

  if (state.noiseMode === 'strong') {
    // Cut rumble + tame peaks (helps perceived noise)
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 120;

    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;

    node.connect(hp);
    hp.connect(comp);
    node = comp;
  }

  gainNode = audioCtx.createGain();
  gainNode.gain.value = clamp(state.micGain, 0.1, 2.0);
  node.connect(gainNode);

  const dest = audioCtx.createMediaStreamDestination();
  gainNode.connect(dest);
  processedStream = dest.stream;
  const processedTrack = processedStream.getAudioTracks()[0];
  if (!processedTrack) throw new Error('no processed mic track');

  // Simple noise gate for "strong" (very lightweight).
  if (state.noiseMode === 'strong') {
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let openUntil = 0;
    gateTimer = window.setInterval(() => {
      if (!analyser || !gainNode) return;
      analyser.getByteTimeDomainData(data);
      // RMS estimate
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      const threshold = 0.018; // tuned by feel
      const holdMs = 220;
      if (rms > threshold) openUntil = now + holdMs;
      const target = now < openUntil ? clamp(state.micGain, 0.1, 2.0) : 0.0001;
      // smooth changes to avoid clicks
      const cur = gainNode.gain.value;
      gainNode.gain.value = cur + (target - cur) * 0.25;
    }, 40);
  }

  if (initialAddTrack) {
    micSender = pc.addTrack(processedTrack, processedStream);
  } else {
    if (!micSender) {
      micSender = pc.addTrack(processedTrack, processedStream);
    } else {
      await micSender.replaceTrack(processedTrack);
    }
  }

  // Respect mute state
  const enabled = !state.micMuted;
  for (const t of processedStream.getAudioTracks()) t.enabled = enabled;
}

async function onSignal(data: any) {
  if (!socket) return;
  await ensurePeerConnection();
  if (!pc) return;

  if (data?.type === 'offer') {
    await pc.setRemoteDescription({ type: 'offer', sdp: String(data.sdp ?? '') });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await emitAck(socket, 'signal', { to: state.friendId.trim(), data: { type: 'answer', sdp: answer.sdp } });
    log('Звонок: принял offer, отправил answer.');
    state.callState = 'in_call';
    render();
  } else if (data?.type === 'answer') {
    await pc.setRemoteDescription({ type: 'answer', sdp: String(data.sdp ?? '') });
    log('Звонок: принял answer. Соединяемся…');
    state.callState = 'in_call';
    render();
  } else if (data?.type === 'ice' && data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate);
    } catch {
      // ignore
    }
  } else if (data?.type === 'hangup') {
    await hangup(false);
    log('Друг сбросил звонок.');
  }
}

async function hangup(sendSignal = true) {
  if (sendSignal && socket && state.callState !== 'idle') {
    void emitAck(socket, 'signal', { to: state.friendId.trim(), data: { type: 'hangup' } });
  }

  state.callState = 'idle';
  state.micMuted = false;

  try {
    pc?.close();
  } catch {}
  pc = null;
  micSender = null;

  for (const t of localStream?.getTracks?.() ?? []) t.stop();
  localStream = null;
  for (const t of processedStream?.getTracks?.() ?? []) t.stop();
  processedStream = null;
  try {
    audioCtx?.close();
  } catch {}
  audioCtx = null;
  gainNode = null;
  if (gateTimer !== null) {
    window.clearInterval(gateTimer);
    gateTimer = null;
  }

  if (remoteAudio) remoteAudio.srcObject = null;
  render();
}

function toggleMute() {
  const tracks = processedStream?.getAudioTracks?.() ?? localStream?.getAudioTracks?.() ?? [];
  if (tracks.length === 0) return;
  const next = !state.micMuted;
  for (const t of tracks) t.enabled = !next;
  state.micMuted = next;
  render();
}

function emitAck<T = any>(s: Socket, event: string, payload: any) {
  return new Promise<T>((resolve) => {
    s.emit(event, payload, (resp: T) => resolve(resp));
  });
}

loadPersisted();
render();

// автоподключение при старте
setTimeout(() => {
  if (state.autoConnect) void connect();
}, 50);


