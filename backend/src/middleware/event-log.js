import { logApiEvent } from "../services/event-log.js";

const SKIP_PATHS = ["/api/events/stream", "/health"];
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function eventLogMiddleware(req, res, next) {
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) return next();

  const startMs = Date.now();
  const origJson = res.json.bind(res);

  res.json = function (body) {
    const status = res.statusCode;
    const isWrite = WRITE_METHODS.has(req.method);
    const isError = status >= 400;

    if (isWrite || isError) {
      const ms = Date.now() - startMs;
      const errorMsg =
        isError && body && typeof body === "object" && body.error
          ? String(body.error).slice(0, 500)
          : null;

      setImmediate(() =>
        logApiEvent({
          userId: req.user?.sub ?? null,
          userName: req.user?.fullName ?? null,
          method: req.method,
          path: req.path,
          statusCode: status,
          responseMs: ms,
          inventoryId: req.inventoryId ?? null,
          errorMsg,
        }),
      );
    }

    return origJson(body);
  };

  next();
}
