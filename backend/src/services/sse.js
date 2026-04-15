// Simple SSE service — tracks connected clients by inventoryId + spaceId
// and broadcasts events to them.

const clients = new Map(); // Map<clientId, { res, inventoryId, spaceId, heartbeat }>

function clientId(inventoryId, userId, connectionId) {
  return `${inventoryId}:${userId}:${connectionId}`;
}

function addClient(id, inventoryId, spaceId, res) {
  // If a duplicate connection id reconnects, close the old stream first.
  if (clients.has(id)) {
    removeClient(id);
  }

  const heartbeat = setInterval(() => {
    try {
      if (res.writableEnded || res.destroyed) {
        removeClient(id);
        return;
      }
      // Comment frame keeps intermediaries from timing out the stream.
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      removeClient(id);
    }
  }, 10000);

  clients.set(id, { res, inventoryId, spaceId, heartbeat });
}

function removeClient(id) {
  const client = clients.get(id);
  if (client) {
    clearInterval(client.heartbeat);
    try {
      if (!client.res.writableEnded && !client.res.destroyed) {
        client.res.end();
      }
    } catch {
      // Ignore socket close errors during cleanup.
    }
    clients.delete(id);
  }
}

function sendEvent(client, event, data) {
  try {
    if (client.res.writableEnded || client.res.destroyed) {
      return false;
    }
    // Single write to avoid buffer fragmentation in SSE stream
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Broadcast an event to all clients watching a given inventory/space.
 * Optionally excludes a specific client connection (by full clientId).
 * Cleans up disconnected clients on the fly.
 */
export function broadcast({ inventoryId, spaceId, action, excludeClientId, payload }) {
  const toRemove = [];
  let broadcastCount = 0;
  
  console.log(`[SSE Broadcast] Sending ${action} to inventory=${inventoryId}, spaceId=${spaceId}, excludeClientId=${excludeClientId}`);
  
  for (const [id, client] of clients) {
    if (client.inventoryId !== inventoryId) continue;
    if (spaceId && client.spaceId && client.spaceId !== spaceId) continue;
    // Skip the specific client that triggered the broadcast
    if (excludeClientId && id === excludeClientId) {
      console.log(`[SSE Broadcast] Skipping triggering client ${id}`);
      continue;
    }
    if (!sendEvent(client, action, payload)) {
      toRemove.push(id);
    } else {
      broadcastCount++;
    }
  }
  
  console.log(`[SSE Broadcast] Sent ${action} to ${broadcastCount} client(s), removed ${toRemove.length} dead connections`);
  
  // Clean up zombies
  for (const id of toRemove) {
    removeClient(id);
  }
}

export function sseMiddleware(req, res, next) {
  // This middleware is mounted on the /stream route, so just handle the SSE connection.
  const inventoryId = req.inventoryId;
  const spaceId = req.query.spaceId || null;
  const userId = req.user.sub;
  const connectionId = req.query.connectionId || "unknown";
  const id = clientId(inventoryId, userId, connectionId);

  console.log(`[SSE Middleware] Connection attempt:`, {
    url: req.originalUrl,
    inventoryId,
    spaceId,
    userId,
    connectionId,
    clientId: id,
    allClients: clients.size
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
  });

  // Flush headers ASAP to establish a stable stream through proxies.
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  // Keep socket alive for long-lived SSE stream.
  if (res.socket) {
    res.socket.setKeepAlive(true);
    res.socket.setNoDelay(true);
    res.socket.setTimeout(0);
  }

  // Advise client reconnection delay and send an initial comment frame.
  res.write("retry: 5000\n");
  res.write(": connected\n\n");

  // Send initial connection confirmation
  console.log(`[SSE Middleware] Sending connected event to client ${id}`);
  res.write(`event: connected\ndata: ${JSON.stringify({ inventoryId, spaceId, connectionId })}\n\n`);

  addClient(id, inventoryId, spaceId, res);
  console.log(`[SSE Middleware] Client registered. Total clients: ${clients.size}`);

  req.on("close", () => {
    console.log(`[SSE Connection] Client closed: ${id}, total clients before removal: ${clients.size}`);
    removeClient(id);
    console.log(`[SSE Connection] Total clients after removal: ${clients.size}`);
  });
  req.on("aborted", () => {
    console.log(`[SSE Connection] Client aborted: ${id}`);
    removeClient(id);
  });
  req.on("error", (err) => {
    console.log(`[SSE Connection] Client error: ${id}`, err.message);
    removeClient(id);
  });
  res.on("close", () => {
    removeClient(id);
  });
  res.on("finish", () => {
    removeClient(id);
  });
}
