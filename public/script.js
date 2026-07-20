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
 *  PEER OPTIONS - với đầy đủ TURN servers để xuyên NAT
 * ================================================================ */
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
        {
          urls: "turns:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    },
  };
}

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
      video: { frameRate: { ideal: 30 } },
      audio: true,
    });
    hostScreen.srcObject = screenStream;
    hostScreen.play().catch(() => {});
    screenStream.getVideoTracks()[0].onended = () => stopHost();

    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: true, audio: false,
      });
      hostCam.srcObject = camStream;
      hostCam.play().catch(() => {});
    } catch (e) {
      console.warn("Camera unavailable:", e.message);
    }

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

/* Tạo combined stream để gửi cho viewer */
function buildHostStream() {
  const out = new MediaStream();
  if (screenStream) screenStream.getTracks().forEach((t) => out.addTrack(t));
  if (camStream) camStream.getTracks().forEach((t) => out.addTrack(t));
  if (micStream) micStream.getTracks().forEach((t) => out.addTrack(t));
  return out;
}

/* HOST calls VIEWER - đây là pattern đúng để push stream */
function callViewer(viewerPeerId) {
  console.log("[Host] Calling viewer:", viewerPeerId);
  const out = buildHostStream();
  const call = peer.call(viewerPeerId, out);
  if (!call) {
    console.error("[Host] peer.call returned null for", viewerPeerId);
    return;
  }
  viewerCalls[viewerPeerId] = call;
  call.on("close", () => {
    delete viewerCalls[viewerPeerId];
    console.log("[Host] Call closed with", viewerPeerId);
  });
  call.on("error", (e) => {
    console.error("[Host] Call error with", viewerPeerId, e);
    delete viewerCalls[viewerPeerId];
  });
}

function startPeer(id) {
  peer = new Peer(id, peerOptions());

  peer.on("open", () => {
    console.log("[Host] Peer open, ID:", id);
    const link = window.location.origin + "?join=" + id;
    navigator.clipboard.writeText(link).then(() => {
      $("btn-copy-link").textContent = "Copied!";
      setTimeout(() => ($("btn-copy-link").textContent = "Copy Link"), 3000);
    }).catch(() => {});
  });

  peer.on("connection", (conn) => {
    const vid = conn.peer;
    viewerConns[vid] = conn;
    updateViewerCount();
    console.log("[Host] Viewer connected:", vid);

    // Gửi chat history cho viewer mới
    conn.on("open", () => {
      conn.send({ type: "chat-history", messages: chatHistory });
      // HOST chủ động gọi viewer ngay sau khi data channel mở
      callViewer(vid);
    });

    conn.on("data", (data) => {
      if (data.type === "request-stream") {
        // Viewer yêu cầu stream lại (ví dụ sau khi stream bị gián đoạn)
        callViewer(vid);
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
      console.log("[Host] Viewer disconnected:", vid);
    });

    conn.on("error", (e) => {
      console.error("[Host] Connection error with viewer:", vid, e);
    });
  });

  peer.on("error", (err) => {
    console.error("[Host] Peer error:", err.type, err);
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
    try { c.send({ type: "chat", msg }); } catch (e) {}
  }
  addChatMessage(msg);
}

function stopHost() {
  stopTracks(screenStream);
  stopTracks(camStream);
  stopTracks(micStream);
  screenStream = camStream = micStream = null;
  Object.values(viewerCalls).forEach((c) => { try { c.close(); } catch (e) {} });
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
  navigator.clipboard.writeText(link).catch(() => {});
};
$("btn-leave-host").onclick = stopHost;
$("btn-chat-toggle").onclick = () => $("chat-panel").classList.toggle("hidden");

// ---- Switch screen source ----
$("btn-switch-screen").onclick = async function () {
  if (!screenStream) return;
  try {
    const newStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      audio: true,
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
    hostScreen.play().catch(() => {});
    newVideo.onended = () => stopHost();

    // Re-call tất cả viewers với stream mới
    Object.values(viewerCalls).forEach((c) => { try { c.close(); } catch (e) {} });
    for (const k in viewerCalls) delete viewerCalls[k];
    for (const vid of Object.keys(viewerConns)) {
      setTimeout(() => callViewer(vid), 500);
    }
  } catch (e) {
    console.error("Switch screen error:", e);
  }
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
    try { c.send({ type: "keylog", log }); } catch (e) {}
  }
}

/* ================================================================
 *  VIEWER
 * ================================================================ */

/* Xử lý stream nhận được từ host - cẩn thận với track timing */
function onViewerStream(remoteStream) {
  console.log("[Viewer] Got stream, tracks:", remoteStream.getTracks().map(t => t.kind + ":" + t.readyState));
  viewerStatus.textContent = "";

  // Gán trực tiếp toàn bộ stream cho screen (đơn giản nhất, tránh track splitting bugs)
  viewerScreen.srcObject = remoteStream;
  viewerScreen.play().catch((e) => {
    console.warn("[Viewer] Autoplay blocked, user interaction needed:", e);
    viewerStatus.textContent = "Click anywhere to start stream";
    const resume = () => {
      viewerScreen.play().catch(() => {});
      document.removeEventListener("click", resume);
      viewerStatus.textContent = "";
    };
    document.addEventListener("click", resume, { once: true });
  });

  // Lắng nghe tracks thêm vào sau (WebRTC có thể add track theo từng đợt)
  remoteStream.addEventListener("addtrack", (evt) => {
    console.log("[Viewer] New track added:", evt.track.kind);
    // Nếu là video track thứ 2 (webcam), assign cho viewerCam
    const videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length > 1 && evt.track.kind === "video") {
      viewerCam.srcObject = new MediaStream([videoTracks[1]]);
      viewerCam.play().catch(() => {});
    }
  });

  // Tách cam nếu có sẵn 2 video tracks
  const videoTracks = remoteStream.getVideoTracks();
  if (videoTracks.length > 1) {
    viewerCam.srcObject = new MediaStream([videoTracks[1]]);
    viewerCam.play().catch(() => {});
  }
}

function startViewer(code) {
  role = "viewer";
  roomId = code;
  hide(lobby);
  show(roomViewer);
  viewerRoomId.textContent = code;
  viewerStatus.textContent = "Connecting...";

  peer = new Peer(undefined, peerOptions());

  peer.on("open", (myId) => {
    console.log("[Viewer] Peer open, ID:", myId);
    viewerStatus.textContent = "Connected to server, joining room...";

    // Kết nối data channel đến host
    hostConn = peer.connect(code, { reliable: true });

    hostConn.on("open", () => {
      console.log("[Viewer] Data channel open to host");
      viewerStatus.textContent = "Waiting for stream from host...";
      // Thông báo cho host biết ta đã sẵn sàng nhận stream
      hostConn.send({ type: "request-stream" });
    });

    hostConn.on("data", (data) => {
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

    hostConn.on("error", (e) => {
      console.error("[Viewer] Data channel error:", e);
      viewerStatus.textContent = "Connection error.";
    });
  });

  // HOST sẽ gọi viewer - lắng nghe incoming calls
  peer.on("call", (call) => {
    console.log("[Viewer] Incoming call from host");
    viewerStatus.textContent = "Receiving stream...";
    // Answer không cần stream (viewer chỉ nhận)
    call.answer();

    call.on("stream", (remoteStream) => {
      console.log("[Viewer] Stream received from host");
      onViewerStream(remoteStream);
    });

    call.on("close", () => {
      console.log("[Viewer] Call closed");
      viewerStatus.textContent = "Stream ended. Waiting for host to re-stream...";
      viewerScreen.srcObject = null;
    });

    call.on("error", (e) => {
      console.error("[Viewer] Call error:", e);
      viewerStatus.textContent = "Stream error: " + (e.message || e);
    });
  });

  peer.on("error", (err) => {
    console.error("[Viewer] Peer error:", err.type, err);
    if (err.type === "peer-unavailable") {
      viewerStatus.textContent = "Room not found. Check the room code.";
    } else {
      viewerStatus.textContent = "Connection error: " + err.type;
    }
  });
}

function stopViewer() {
  if (hostConn) { try { hostConn.close(); } catch (e) {} }
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
    try { hostConn.send({ type: "chat", text }); } catch (e) {}
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
