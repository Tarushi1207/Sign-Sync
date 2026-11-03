
const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
        status: "online",
        message: "ISL Connect signaling server is running"
    }));
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();

console.log("ISL Connect signaling server starting...");

wss.on("connection", function (ws, req) {
    const requestUrl = new URL(req.url, "http://localhost");
    const roomId = requestUrl.searchParams.get("room") || "main";

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) {
        ws.send(JSON.stringify({ type: "invalid-room" }));
        ws.close();
        return;
    }

    if (!rooms.has(roomId)) {
        rooms.set(roomId, []);
    }

    const participants = rooms.get(roomId);

    if (participants.length >= 2) {
        ws.send(JSON.stringify({ type: "room-full" }));
        ws.close();
        return;
    }

    participants.push(ws);
    ws.roomId = roomId;
    ws.isMediaReady = false;

    console.log(
        `Participant joined room ${roomId}: ${participants.length}/2`
    );

    if (participants.length === 1) {
        ws.send(JSON.stringify({ type: "waiting" }));
        ws.send(JSON.stringify({
            type: "role",
            role: "offerer"
        }));
    }

    if (participants.length === 2) {

        // IMPORTANT:
        // Do not reset the first participant's ready status.
        // They may have already sent their ready message.

        participants[0].send(JSON.stringify({
            type: "role",
            role: "offerer"
        }));

        participants[1].send(JSON.stringify({
            type: "role",
            role: "answerer"
        }));

        console.log(`Both participants joined room ${roomId}.`);
    }

    ws.on("message", function (message) {
        let data;

        try {
            data = JSON.parse(message.toString());
        } catch (error) {
            console.log("Invalid message received.");
            return;
        }

        if (data.type === "ready") {
            ws.isMediaReady = true;

            const otherParticipant = participants.find(
                client => client !== ws &&
                    client.readyState === WebSocket.OPEN
            );

            if (otherParticipant && otherParticipant.isMediaReady) {

                otherParticipant.send(JSON.stringify({
                    type: "peer-ready"
                }));

                ws.send(JSON.stringify({
                    type: "peer-ready"
                }));

                console.log(`Media ready in room ${roomId}.`);
            }

            return;
        }

        participants.forEach(function (client) {
            if (
                client !== ws &&
                client.readyState === WebSocket.OPEN
            ) {
                client.send(JSON.stringify(data));
            }
        });
    });

    ws.on("close", function () {
        console.log(`Participant left room ${roomId}.`);

        const currentRoom = rooms.get(roomId);
        if (!currentRoom) return;

        const remainingParticipants = currentRoom.filter(
            client => client !== ws
        );

        if (remainingParticipants.length === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} closed.`);
            return;
        }

        rooms.set(roomId, remainingParticipants);

        remainingParticipants.forEach(function (client) {
            if (client.readyState === WebSocket.OPEN) {
                client.isMediaReady = false;

                client.send(JSON.stringify({
                    type: "peer-left"
                }));

                client.send(JSON.stringify({
                    type: "waiting"
                }));

                client.send(JSON.stringify({
                    type: "role",
                    role: "offerer"
                }));
            }
        });
    });

    ws.on("error", function (error) {
        console.error("WebSocket error:", error);
    });
});

server.listen(PORT, "0.0.0.0", function () {
    console.log(`ISL Connect server running on port ${PORT}`);
});
