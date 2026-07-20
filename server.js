const express = require("express");
const http = require("http");
const { ExpressPeerServer } = require("peer");

const app = express();
const server = http.createServer(app);

// Allow all origins for CORS (needed for WebRTC signaling)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(express.static("public"));

const peerServer = ExpressPeerServer(server, {
  path: "/",
  allow_discovery: true,
  // Increase timeouts for slow connections
  alive_timeout: 60000,
  expire_timeout: 60000,
});

app.use("/peerjs", peerServer);

peerServer.on("connection", (client) => {
  console.log(`[PeerJS] Client connected: ${client.getId()}`);
});

peerServer.on("disconnect", (client) => {
  console.log(`[PeerJS] Client disconnected: ${client.getId()}`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CodeCaster running at http://localhost:${PORT}`);
});
