import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { initializePermissions } from "@shared/permissions";
import { addressValidationService } from "./services/address-validation";
import { logger } from "./logger";

const PgSession = ConnectPgSimple(session);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session configuration
app.use(
  session({
    store: new PgSession({
      pool: pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const logMessage = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      const meta: Record<string, any> = {
        source: "express",
        method: req.method,
        path,
        statusCode: res.statusCode,
        duration,
        ip: req.ip,
      };

      if (capturedJsonResponse) {
        // Truncate response for display but keep full response in meta
        let responsePreview = JSON.stringify(capturedJsonResponse);
        if (responsePreview.length > 100) {
          responsePreview = responsePreview.slice(0, 99) + "…";
        }
        meta.response = capturedJsonResponse;
        meta.responsePreview = responsePreview;
      }

      // Log at appropriate level based on status code
      if (res.statusCode >= 500) {
        logger.error(logMessage, meta);
      } else if (res.statusCode >= 400) {
        logger.warn(logMessage, meta);
      } else {
        logger.http(logMessage, meta);
      }
    }
  });

  next();
});

(async () => {
  // Initialize the permission system
  initializePermissions();
  logger.info("Permission system initialized with core permissions", { source: "startup" });
  
  // Initialize address validation service (loads or creates config)
  await addressValidationService.getConfig();
  logger.info("Address validation service initialized", { source: "startup" });

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log the error with Winston
    logger.error(`Error: ${message}`, {
      source: "express",
      statusCode: status,
      error: err.stack || err.toString(),
      url: _req.url,
      method: _req.method,
    });

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
