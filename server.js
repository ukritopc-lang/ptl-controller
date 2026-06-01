import cors from "cors";
import express from "express";
import http from "http";
import net from "net";
import { WebSocketServer } from "ws";

class PTLConnection {
  constructor(host = "192.168.1.254", port = 5003) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.seq = 0;
    this.isConnected = false;
    this.reconnectFlag = false;
    this.pendingCommand = null;
    this.responseQueue = [];
    this.wsClients = new Set();
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.socket) this.disconnect();

      const socket = new net.Socket();
      this.socket = socket;

      socket.connect(this.port, this.host, () => {
        console.log(`Connected to PTL at ${this.host}:${this.port}`);
        this.isConnected = true;
        this.startReceiver();
        resolve(true);
      });

      socket.on("error", (err) => {
        console.error("PTL socket error:", err);
        this.isConnected = false;
        reject(err);
      });

      socket.on("close", () => {
        console.log("PTL connection closed");
        this.isConnected = false;
        this.reconnect();
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
  }

  reconnect() {
    if (this.reconnectFlag) return;
    this.reconnectFlag = true;

    setTimeout(() => {
      console.log("Attempting to reconnect to PTL...");
      this.connect().catch(() => {
        setTimeout(() => {
          this.reconnectFlag = false;
          this.reconnect();
        }, 5000);
      });
    }, 3000);
  }

  startReceiver() {
    if (!this.socket) return;
    this.socket.on("data", (data) => this.processIncomingData(data));
  }

  processIncomingData(data) {
    if (data.length < 9) return;

    try {
      const seqNo = data.subarray(1, 4).toString();
      const dataPart = data.subarray(8, -1).toString("ascii").replace(/\x00/g, "");

      if (dataPart.includes("t")) {
        const tIndex = dataPart.indexOf("t");
        const address = dataPart.substring(tIndex + 1, tIndex + 5);
        const numbers = dataPart.match(/\d+/g)?.join("") ?? "";

        this.broadcast({
          type: "interrupt",
          address,
          seq: seqNo,
          numbers,
          raw: data.toString("hex"),
          timestamp: new Date().toISOString(),
        });

        this.sendAck(seqNo);
        return;
      }

      if (this.pendingCommand === seqNo) {
        this.responseQueue.push(data);
      }
    } catch (err) {
      console.error("Process error:", err);
    }
  }

  sendAck(seq) {
    const ackFrame = Buffer.from(`\x02${seq}0001O\x03`);
    if (this.socket && this.isConnected) {
      this.socket.write(ackFrame);
      console.log(`ACK sent for seq=${seq}`);
    }
  }

  buildFrame(command) {
    this.seq = (this.seq + 1) % 1000;
    const seqStr = String(this.seq).padStart(3, "0");
    const lenStr = String(command.length).padStart(4, "0");
    return Buffer.from(`\x02${seqStr}${lenStr}${command}\x03`);
  }

  async sendCommand(command, timeout = 10000, retry = 2) {
    if (!this.isConnected) {
      await this.connect();
    }

    for (let attempt = 0; attempt <= retry; attempt += 1) {
      const frame = this.buildFrame(command);
      const cmdSeq = frame.subarray(1, 4).toString();
      this.pendingCommand = cmdSeq;
      this.responseQueue = [];

      if (!this.socket) return { success: false, error: "no_socket" };

      this.socket.write(frame);
      console.log(`Sent: ${command} (seq=${cmdSeq})`);

      const response = await this.waitForResponse(timeout);
      if (response) {
        const dataPart = response.subarray(8, -1).toString("ascii");
        if (dataPart.includes("n")) {
          if (attempt < retry) {
            await this.sleep(1000);
            continue;
          }
          return { success: false, seq: cmdSeq, response: dataPart };
        }
        return { success: true, seq: cmdSeq, response: dataPart };
      }

      if (attempt < retry) await this.sleep(1000);
    }

    return { success: false, error: "timeout" };
  }

  waitForResponse(timeout) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (this.responseQueue.length > 0) {
          clearInterval(checkInterval);
          resolve(this.responseQueue.shift());
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          resolve(null);
        }
      }, 100);
    });
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  broadcast(payload) {
    for (const client of this.wsClients) {
      if (client.readyState === 1) {
        client.send(JSON.stringify(payload));
      }
    }
  }

  addWsClient(ws) {
    this.wsClients.add(ws);
    ws.on("close", () => this.wsClients.delete(ws));
  }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const ptl = new PTLConnection(
  process.env.PTL_HOST ?? "192.168.1.254",
  Number(process.env.PTL_PORT ?? 5003),
);

ptl.connect().catch((err) => console.error("Initial PTL connect failed:", err));

app.get("/api/ptl/status", (req, res) => {
  res.json({
    connected: ptl.isConnected,
    host: ptl.host,
    port: ptl.port,
  });
});

app.post("/api/ptl/send", async (req, res) => {
  const { command, timeout = 10, retry = 2 } = req.body ?? {};
  if (!command) {
    res.status(400).json({ error: "command is required" });
    return;
  }
  try {
    const result = await ptl.sendCommand(command, timeout * 1000, retry);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.post("/api/ptl/display", async (req, res) => {
  const { address, value, mode = "auto", effect = "none" } = req.body ?? {};
  if (!address) {
    res.status(400).json({ error: "address is required" });
    return;
  }

  const modeCode =
    mode === "auto"
      ? effect === "none"
        ? "m140"
        : "m110"
      : effect === "none"
        ? "m141"
        : "m111";

  const addr = String(address).padStart(4, "0");
  const val = String(value ?? "").padStart(3, " ");
  const command = `PP5050000${modeCode}#${addr}  ${val}`;

  try {
    const result = await ptl.sendCommand(command);
    res.json({ ...result, command });
  } catch (err) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.post("/api/ptl/clear", async (req, res) => {
  const { address } = req.body ?? {};
  if (!address) {
    res.status(400).json({ error: "address is required" });
    return;
  }
  const addr = String(address).padStart(4, "0");
  const command = `PP5050000m140#${addr}     `;

  try {
    const result = await ptl.sendCommand(command);
    res.json({ ...result, command });
  } catch (err) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

wss.on("connection", (ws) => {
  ptl.addWsClient(ws);
  ws.send(JSON.stringify({ type: "connected", message: "PTL WebSocket ready" }));
});

const PORT = Number(process.env.PORT ?? 3001);
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
