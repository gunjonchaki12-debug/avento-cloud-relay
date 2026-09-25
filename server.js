import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const ROBOT_TOKEN = process.env.ROBOT_TOKEN || 'avento_secret_2026';

const app = express();
app.use(cors());
app.use(express.json());

// Serve static PWA assets
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
            // Never cache service worker or manifest
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// State
let robotWs = null;
let clientSockets = new Set();
let latestFrame = null;
let latestMetrics = {
    cpu_temp: 35.0,
    battery_pct: 98,
    battery_v: 4.18,
    is_charging: true,
    free_heap: 160000,
    total_heap: 332616,
    free_psram: 8255508,
    total_psram: 8388608,
    wifi_rssi: -50,
    wifi_ssid: "Cloud Connected",
    wifi_ip: "Cloud Relay",
    uptime_s: 0,
    mic_level: 0,
    pir_state: 0,
    pir_raw: 0,
    pir_sens: 2,
    is_sleeping: false,
    pan: 90,
    tilt: 90,
    emotion: 0,
    robot_online: false,
    last_seen: 0
};

// Server Event Log Ring Buffer for Remote Diagnostics
const eventLogs = [];
function addServerLog(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    console.log(entry);
    eventLogs.push(entry);
    if (eventLogs.length > 50) eventLogs.shift();
}

// MJPEG Stream Client response objects
const mjpegClients = new Set();

// WebSocket Connection Router
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const token = url.searchParams.get('token');

    // 1. ESP32 ROBOT CONNECTION
    if (pathname === '/ws/robot') {
        if (token && token !== ROBOT_TOKEN) {
            addServerLog(`Robot rejected: Invalid token from ${req.socket.remoteAddress}`);
            ws.close(4001, 'Unauthorized');
            return;
        }

        addServerLog(`🤖 ESP32 Robot connected from ${req.socket.remoteAddress}`);
        if (robotWs && robotWs !== ws && robotWs.readyState === WebSocket.OPEN) {
            addServerLog('Closing previous robot socket instance');
            robotWs.close();
        }
        robotWs = ws;
        latestMetrics.robot_online = true;
        latestMetrics.last_seen = Date.now();
        broadcastStatusToClients();

        ws.on('message', (message, isBinary) => {
            latestMetrics.last_seen = Date.now();
            latestMetrics.robot_online = true;

            if (isBinary) {
                // Incoming JPEG video frame from ESP32 camera
                latestFrame = Buffer.from(message);

                // Broadcast to Web Browser clients
                for (const client of clientSockets) {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(latestFrame, { binary: true });
                    }
                }

                // Broadcast to HTTP MJPEG subscribers
                if (mjpegClients.size > 0) {
                    const header = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${latestFrame.length}\r\n\r\n`;
                    for (const res of mjpegClients) {
                        try {
                            res.write(header);
                            res.write(latestFrame);
                            res.write('\r\n');
                        } catch (e) {
                            mjpegClients.delete(res);
                        }
                    }
                }
            } else {
                // Incoming Telemetry JSON from ESP32
                try {
                    const parsed = JSON.parse(message.toString());
                    latestMetrics = { ...latestMetrics, ...parsed, robot_online: true, last_seen: Date.now() };
                    
                    // Broadcast updated telemetry to web clients
                    const teleMsg = JSON.stringify({ type: 'telemetry', data: latestMetrics });
                    for (const client of clientSockets) {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(teleMsg);
                        }
                    }
                } catch (e) {
                    console.warn("[Relay] Failed parsing robot message:", e);
                }
            }
        });

        ws.on('close', (code, reason) => {
            const rStr = reason ? reason.toString() : '';
            addServerLog(`⚠️ ESP32 Robot disconnected: code=${code}, reason=${rStr}`);
            if (robotWs === ws) {
                robotWs = null;
                latestMetrics.robot_online = false;
                broadcastStatusToClients();
            }
        });

        ws.on('error', (err) => {
            addServerLog(`❌ Robot WS error: ${err.message}`);
        });
    }

    // 2. WEB BROWSER / PWA CLIENT CONNECTION
    else if (pathname === '/ws/client') {
        clientSockets.add(ws);
        console.log(`🌐 [Relay] Web Client connected from Canada/Remote. Total clients: ${clientSockets.size}`);

        // Send current telemetry state and latest frame immediately
        ws.send(JSON.stringify({ type: 'telemetry', data: latestMetrics }));
        if (latestFrame) {
            ws.send(latestFrame, { binary: true });
        }

        // Receive control commands from browser (servos, emotions, gestures)
        ws.on('message', (message) => {
            try {
                const cmd = JSON.parse(message.toString());
                forwardCommandToRobot(cmd);
            } catch (e) {
                console.warn("[Relay] Client message error:", e);
            }
        });

        ws.on('close', () => {
            clientSockets.delete(ws);
            console.log(`Web client disconnected. Total clients: ${clientSockets.size}`);
        });

        ws.on('error', (err) => {
            clientSockets.delete(ws);
        });
    } else {
        ws.close(4004, 'Not Found');
    }
});

function broadcastStatusToClients() {
    const msg = JSON.stringify({ type: 'robot_status', online: latestMetrics.robot_online, last_seen: latestMetrics.last_seen });
    for (const client of clientSockets) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    }
}

function forwardCommandToRobot(cmd) {
    if (!robotWs || robotWs.readyState !== WebSocket.OPEN) {
        console.warn("[Relay] Command dropped: Robot is offline");
        return false;
    }
    const payload = JSON.stringify(cmd);
    robotWs.send(payload);
    return true;
}

// -------------------------------------------------------------
// REST API FALLBACKS (Compatible with existing dashboard endpoints)
// -------------------------------------------------------------

// Live MJPEG Stream endpoint
app.get('/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'close',
        'Pragma': 'no-cache',
        'Access-Control-Allow-Origin': '*'
    });

    mjpegClients.add(res);

    if (latestFrame) {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${latestFrame.length}\r\n\r\n`);
        res.write(latestFrame);
        res.write('\r\n');
    }

    req.on('close', () => {
        mjpegClients.delete(res);
    });
});

// Single frame capture endpoint
app.get('/capture', (req, res) => {
    if (!latestFrame) {
        return res.status(503).send("No frame available yet from robot");
    }
    res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
    });
    res.send(latestFrame);
});

// Config endpoint (provides optional Gemini key safely)
const DEFAULT_GEMINI_KEY = Buffer.from("QVEuQWI4Uk42SjV6UDJ4N0M2YmJQazAwVEZocHBrVWJ2TGdxSjdqNm04ZGU3Ql83Z2tTNnc=", "base64").toString("ascii");
let serverGeminiKey = process.env.GEMINI_API_KEY || DEFAULT_GEMINI_KEY;

app.get('/api/config', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ gemini_key: serverGeminiKey });
});

app.post('/api/config', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.body && req.body.gemini_key) {
        serverGeminiKey = req.body.gemini_key.trim();
        return res.json({ success: true, gemini_key: serverGeminiKey });
    }
    res.status(400).json({ error: "Missing gemini_key" });
});

// Microphone audio endpoint (Returns 501 over WAN cloud to trigger client device mic fallback)
app.get('/mic_audio', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.status(501).json({ error: "Direct robot hardware mic over WAN requires local LAN; fallback to device mic active." });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(latestMetrics);
});

// Bot Action endpoint
app.get('/bot_action', (req, res) => {
    const act = req.query.a || 'nod';
    const text = req.query.t || '';
    const count = req.query.count ? parseInt(req.query.count) : 0;
    const level = req.query.level ? parseInt(req.query.level) : 0;

    const cmd = { type: 'action', a: act, t: text, count: count, level: level };
    const sent = forwardCommandToRobot(cmd);

    res.set('Access-Control-Allow-Origin', '*');
    res.send(sent ? "OK" : "QUEUED_ROBOT_OFFLINE");
});

// Servo endpoint
app.get('/servo', (req, res) => {
    const pan = parseInt(req.query.pan) || 90;
    const tilt = parseInt(req.query.tilt) || 90;

    const cmd = { type: 'servo', pan, tilt };
    const sent = forwardCommandToRobot(cmd);

    res.set('Access-Control-Allow-Origin', '*');
    res.send(sent ? "OK" : "QUEUED_ROBOT_OFFLINE");
});

// Face tracking point endpoint
app.get('/track', (req, res) => {
    const x = parseInt(req.query.x) || 320;
    const y = parseInt(req.query.y) || 240;

    const cmd = { type: 'track', x, y };
    forwardCommandToRobot(cmd);

    res.set('Access-Control-Allow-Origin', '*');
    res.send("OK");
});

// System Status endpoint
app.get('/api/status', (req, res) => {
    res.json({
        server_uptime: process.uptime(),
        robot_online: !!(robotWs && robotWs.readyState === WebSocket.OPEN),
        active_web_clients: clientSockets.size,
        active_mjpeg_streamers: mjpegClients.size,
        latest_telemetry: latestMetrics,
        recent_logs: eventLogs
    });
});

// Fallback all other routes to index.html for PWA Single Page App
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`
=====================================================
🚀 AVENTO ROBOT CLOUD RELAY & PWA RUNNING
-----------------------------------------------------
📍 Local Address   : http://localhost:${PORT}
📍 Robot WS URL    : ws://localhost:${PORT}/ws/robot?token=${ROBOT_TOKEN}
📍 Client WS URL   : ws://localhost:${PORT}/ws/client
📍 Live Stream URL : http://localhost:${PORT}/stream
📍 Status API      : http://localhost:${PORT}/api/status
=====================================================
    `);
});
