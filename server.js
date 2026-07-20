const express = require("express");
const http = require("http");
const { ExpressPeerServer } = require("peer");

const app = express();
const server = http.createServer(app);

app.use(express.static("public"));

const peerServer = ExpressPeerServer(server, { path: "/" });
app.use("/peerjs", peerServer);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CodeCaster running at http://localhost:${PORT}`);
});
