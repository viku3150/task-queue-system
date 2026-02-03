import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import dotenv from "dotenv";
import apiRoutes from "./api/routes";
import { WorkerService } from "./services/workerService";
import { DashboardSocketServer } from "./dashboard/socketServer";
import { logger } from "./utils/logger";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// API routes
app.use("/api/v1", apiRoutes);

// Health check
app.get("/health", (req, res) => {
	res.json({ status: "healthy", timestamp: new Date() });
});

// Create HTTP server
const httpServer = http.createServer(app);

// Initialize WebSocket server for dashboard
const dashboardServer = new DashboardSocketServer(httpServer);

// Start worker
const worker = new WorkerService();
worker.start().catch((err) => {
	logger.error("Worker failed to start", { error: err });
	process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
	logger.info("SIGTERM received, shutting down gracefully");
	await worker.stop();
	process.exit(0);
});

process.on("SIGINT", async () => {
	logger.info("SIGINT received, shutting down gracefully");
	await worker.stop();
	process.exit(0);
});

// Start server
httpServer.listen(PORT, () => {
	logger.info(`🚀 Server running on http://localhost:${PORT}`);
	logger.info(
		`📊 Dashboard available at http://localhost:${PORT}/dashboard.html`,
	);
});
