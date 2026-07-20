const $ = (id) => document.getElementById(id);
const lobby = $("lobby");
const roomHost = $("room-host");
const roomViewer = $("room-viewer");
const hostScreen = $("host-screen");
const hostCam = $("host-cam");
const hostRoomId = $("host-room-id");
const viewerRoomId = $("viewer-room-id");
const viewerScreen = $("viewer-screen");
const viewerCam = $("viewer-cam");
const viewerStatus = $("viewer-status");
const viewerCountEl = $("viewer-count");
const lobbyError = $("lobby-error");
const keylogHost = $("keylog-host");
const keylogViewer = $("keylog-viewer");

let role = null;
let roomId = null;
let peer = null;
let hostConn = null;
const viewerCalls = {};

let screenStream = null;
let camStream = null;
let micStream = null;

const viewerConns = {};
const chatHistory = [];

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

/* ---- Lobby ---- */
$("btn-create").onclick = () => {
  lobbyError.textContent = "";
  const id = genId();
  startHost(id);
};

$("btn-join").onclick = () => {
  const code = $("input-room-id").value.trim();
  if (!code) return;
  lobbyError.textContent = "";
  startViewer(code);
};

/* ================================================================
 *  HOST
 * ================================================================ */
async function startHost(id) {
  role = "host";
  roomId = id;
  hide(lobby);
  show(roomHost);
  hostRoomId.textContent = id;

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: true,
    });
    hostScreen.srcObject = screenStream;
    screenStream.getVideoTracks()[0].onended = () => stopHost();

    camStream = await navigator.mediaDevices.getUserMedia({
      video: true, audio: false,
    });
    hostCam.srcObject = camStream;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) { console.warn("Mic unavailable:", e.message); }

    startPeer(id);
  } catch (err) {
    console.error(err);
    alert("Could not access screen or camera: " + err.message);
    stopHost();
  }
}

function peerOptions() {
  const isHttps = window.location.protocol === "https:";
  const port = isHttps ? 443 : (parseInt(window.location.port) || 80);
  return {
    debug: 2,
    host: window.location.hostname,
    port: port,
    path: "/peerjs",
    secure: isHttps,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    },
  };
}

function startPeer(id) {
  peer = new Peer(id, peerOptions());

  peer.on("open", () => {
    const link = window.location.origin + "?join=" + id;
    navigator.clipboard.writeText(link).then(() => {
      $("btn-copy-link").textContent = "Copied!";
      setTimeout(() => ($("btn-copy-link").textContent = "Copy Link"), 3000);
    });
  });

  peer.on("connection", (conn) => {
    const vid = conn.peer;
    viewerConns[vid] = conn;
    updateViewerCount();

    conn.send({ type: "chat-history", messages: chatHistory });

    conn.on("data", (data) => {
      if (data.type === "request-stream") {
        // Viewer will initiate the call - just tell them we're ready
        conn.send({ type: "stream-ready" });
      }
      if (data.type === "chat") {
        broadcastChat({
          id: genId().slice(0, 6),
          from: "Viewer",
          text: data.text,
          time: Date.now(),
        });
      }
    });

    conn.on("close", () => {
      delete viewerConns[vid];
      updateViewerCount();
    });
  });

  // Viewer initiated a call -> answer with our combined stream
  peer.on("call", (call) => {
    const out = new MediaStream();
    screenStream.getTracks().forEach((t) => out.addTrack(t));
    if (camStream) camStream.getTracks().forEach((t) => out.addTrack(t));
    if (micStream) micStream.getTracks().forEach((t) => out.addTrack(t));
    call.answer(out);
    const vid = call.peer;
    viewerCalls[vid] = call;
    call.on("close", () => { delete viewerCalls[vid]; });
    call.on("error", () => { delete viewerCalls[vid]; });
  });

  peer.on("error", (err) => {
    if (err.type === "unavailable-id") {
      lobbyError.textContent = "Room name taken, try again.";
      stopHost();
    }
  });
}

function broadcastChat(msg) {
  chatHistory.push(msg);
  if (chatHistory.length > 100) chatHistory.shift();
  for (const c of Object.values(viewerConns)) {
    c.send({ type: "chat", msg });
  }
  addChatMessage(msg);
}

function stopHost() {
  stopTracks(screenStream);
  stopTracks(camStream);
  stopTracks(micStream);
  screenStream = camStream = micStream = null;
  Object.values(viewerCalls).forEach((c) => c.close());
  for (const k in viewerCalls) delete viewerCalls[k];
  if (peer) peer.destroy();
  peer = null;
  location.reload();
}

function updateViewerCount() {
  const count = Object.keys(viewerConns).length;
  viewerCountEl.textContent = count + " viewer" + (count !== 1 ? "s" : "");
}

$("btn-toggle-screen").onclick = function () {
  if (!screenStream) return;
  const en = !screenStream.getVideoTracks()[0].enabled;
  screenStream.getVideoTracks().forEach((t) => (t.enabled = en));
  this.classList.toggle("active");
};
$("btn-toggle-cam").onclick = function () {
  if (!camStream) return;
  const en = !camStream.getVideoTracks()[0].enabled;
  camStream.getVideoTracks().forEach((t) => (t.enabled = en));
  this.classList.toggle("active");
};
$("btn-toggle-mic").onclick = function () {
  if (!micStream) return;
  const en = !micStream.getAudioTracks()[0].enabled;
  micStream.getAudioTracks().forEach((t) => (t.enabled = en));
  this.classList.toggle("active");
};
$("btn-copy-link").onclick = () => {
  const link = window.location.origin + "?join=" + roomId;
  navigator.clipboard.writeText(link);
};
$("btn-leave-host").onclick = stopHost;
$("btn-chat-toggle").onclick = () => $("chat-panel").classList.toggle("hidden");

// ---- Switch screen source ----
$("btn-switch-screen").onclick = async function () {
  if (!screenStream) return;
  try {
    const newStream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: true,
    });
    const newVideo = newStream.getVideoTracks()[0];
    const newAudio = newStream.getAudioTracks()[0];
    const oldVideo = screenStream.getVideoTracks()[0];
    const oldAudio = screenStream.getAudioTracks()[0];

    screenStream.removeTrack(oldVideo);
    if (oldAudio) screenStream.removeTrack(oldAudio);
    screenStream.addTrack(newVideo);
    if (newAudio) screenStream.addTrack(newAudio);
    oldVideo.stop();
    if (oldAudio) oldAudio.stop();

    hostScreen.srcObject = screenStream;
    newVideo.onended = () => stopHost();

    // Close old calls, viewers will re-call
    Object.values(viewerCalls).forEach((c) => c.close());
    for (const k in viewerCalls) delete viewerCalls[k];
    for (const c of Object.values(viewerConns)) {
      c.send({ type: "stream-ready" });
    }
  } catch (e) {}
};

// ---- Keylogger ----
const keyLog = [];
const MAX_KEYLOG = 200;

document.addEventListener("keydown", (e) => {
  if (role !== "host" || !screenStream) return;

  if (e.ctrlKey || e.metaKey) return;
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;

  let ch;
  if (e.key.length === 1) {
    ch = e.key;
  } else if (e.key === "Enter") {
    ch = "\n";
  } else if (e.key === "Tab") {
    ch = "  ";
  } else if (e.key === "Backspace") {
    if (keyLog.length > 0) {
      keyLog.pop();
      updateKeylog();
      broadcastKeylog(keyLog);
    }
    return;
  } else if (e.key === " ") {
    ch = " ";
  } else if (e.key.startsWith("Arrow") || e.key === "Delete" || e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown") {
    return;
  } else {
    return;
  }

  keyLog.push(ch);
  if (keyLog.length > MAX_KEYLOG) keyLog.splice(0, keyLog.length - MAX_KEYLOG);
  updateKeylog();
  broadcastKeylog(keyLog);
});

function updateKeylog() {
  keylogHost.textContent = keyLog.join("");
}

function broadcastKeylog(log) {
  for (const c of Object.values(viewerConns)) {
    c.send({ type: "keylog", log });
  }
}

/* ================================================================
 *  VIEWER
 * ================================================================ */
function onViewerStream(remoteStream) {
  const vids = remoteStream.getVideoTracks();
  const audios = remoteStream.getAudioTracks();

  if (vids.length > 0) {
    const screen = new MediaStream();
    screen.addTrack(vids[0]);
    audios.forEach((t) => screen.addTrack(t));
    viewerScreen.srcObject = screen;
  }
  if (vids.length > 1) {
    viewerCam.srcObject = new MediaStream([vids[1]]);
  }
  viewerStatus.textContent = vids.length > 0 ? "" : "No video tracks received.";
}

function startViewer(code) {
  role = "viewer";
  roomId = code;
  hide(lobby);
  show(roomViewer);
  viewerRoomId.textContent = code;

  peer = new Peer(undefined, peerOptions());

  peer.on("open", () => {
    hostConn = peer.connect(code);
    hostConn.on("open", () => {
      hostConn.send({ type: "request-stream" });
      viewerStatus.textContent = "Requesting stream...";
    });

    hostConn.on("data", (data) => {
      if (data.type === "stream-ready") {
        viewerStatus.textContent = "Connecting...";
        // Must pass a MediaStream to peer.call() for WebRTC negotiation to work
        const emptyStream = new MediaStream();
        const call = peer.call(roomId, emptyStream);
        if (call) {
          call.on("stream", (remoteStream) => {
            // Only process if we actually have tracks
            if (remoteStream && remoteStream.getTracks().length > 0) {
              onViewerStream(remoteStream);
            } else {
              viewerStatus.textContent = "Waiting for stream...";
            }
          });
          call.on("close", () => {
            viewerStatus.textContent = "Stream ended.";
          });
          call.on("error", (e) => {
            console.error("Call error:", e);
            viewerStatus.textContent = "Stream error: " + (e.message || e);
          });
        } else {
          viewerStatus.textContent = "Failed to initiate call. Please retry.";
        }
      }
      if (data.type === "chat-history") {
        $("chat-messages-vw").innerHTML = "";
        data.messages.forEach((m) => addChatMessage(m));
      }
      if (data.type === "chat") {
        addChatMessage(data.msg);
      }
      if (data.type === "keylog") {
        keylogViewer.textContent = (data.log || []).join("");
      }
    });

    hostConn.on("close", () => {
      viewerStatus.textContent = "Host disconnected.";
    });
  });

  peer.on("error", (err) => {
    viewerStatus.textContent = "Connection error. Room may not exist.";
  });
}

function stopViewer() {
  if (hostConn) hostConn.close();
  if (peer) peer.destroy();
  peer = null;
  hostConn = null;
  location.reload();
}

$("btn-leave-viewer").onclick = stopViewer;
$("btn-chat-toggle-vw").onclick = () => $("chat-panel-vw").classList.toggle("hidden");

/* ================================================================
 *  CHAT
 * ================================================================ */
function sendChat() {
  const input = role === "host" ? $("chat-input") : $("chat-input-vw");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  if (role === "host") {
    const msg = {
      id: genId().slice(0, 6),
      from: "Host",
      text,
      time: Date.now(),
    };
    broadcastChat(msg);
  } else {
    hostConn.send({ type: "chat", text });
  }
  input.focus();
}

function addChatMessage(msg) {
  const c = role === "host" ? $("chat-messages") : $("chat-messages-vw");
  const el = document.createElement("div");
  el.className = "chat-msg" + (msg.from === "Host" ? " own" : "");
  const t = new Date(msg.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  el.innerHTML = `<span class="msg-author">${esc(msg.from)}</span>${esc(msg.text)}<span class="msg-time">${t}</span>`;
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function setupChat(btnId, inputId) {
  $(btnId).onclick = sendChat;
  $(inputId).onkeydown = (e) => { if (e.key === "Enter") sendChat(); };
}
setupChat("btn-chat-send", "chat-input");
setupChat("btn-chat-send-vw", "chat-input-vw");

function stopTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}

const urlParams = new URLSearchParams(window.location.search);
const jc = urlParams.get("join");
if (jc) {
  $("input-room-id").value = jc;
  $("btn-join").click();
}
