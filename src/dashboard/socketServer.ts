import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

export class DashboardSocketServer {
	private io: SocketIOServer;
	private prisma: PrismaClient;

	constructor(httpServer: HTTPServer) {
		this.io = new SocketIOServer(httpServer, {
			cors: {
				origin: "*",
				methods: ["GET", "POST"],
			},
		});

		this.prisma = new PrismaClient();
		this.setupHandlers();
	}

	private setupHandlers() {
		this.io.on("connection", (socket) => {
			logger.info("Dashboard client connected", { socketId: socket.id });

			// Client subscribes to tenant-specific updates
			socket.on("subscribe", (tenantId: string) => {
				socket.join(`tenant:${tenantId}`);
				logger.info("Client subscribed to tenant", {
					socketId: socket.id,
					tenantId,
				});

				// Send initial data
				this.sendInitialData(socket, tenantId);
			});

			socket.on("disconnect", () => {
				logger.info("Dashboard client disconnected", { socketId: socket.id });
			});
		});

		// Start polling for job updates
		this.startPolling();
	}

	// Send initial dashboard data when client connects
	private async sendInitialData(socket: any, tenantId: string) {
		try {
			const [jobs, dlqItems, metrics] = await Promise.all([
				this.prisma.job.findMany({
					where: { tenantId },
					orderBy: { createdAt: "desc" },
					take: 100,
				}),
				this.prisma.dLQ.findMany({
					include: { job: true },
					orderBy: { failedAt: "desc" },
					take: 50,
				}),
				this.getMetrics(tenantId),
			]);

			socket.emit("initial_data", {
				jobs,
				dlqItems,
				metrics,
			});
		} catch (error) {
			logger.error("Failed to send initial data", { tenantId, error });
		}
	}

	// Poll database for changes and push to clients
	private startPolling() {
		setInterval(async () => {
			try {
				// Get recently updated jobs (last 5 seconds)
				const recentJobs = await this.prisma.job.findMany({
					where: {
						OR: [
							{ startedAt: { gte: new Date(Date.now() - 5000) } },
							{ completedAt: { gte: new Date(Date.now() - 5000) } },
						],
					},
				});

				// Emit updates to relevant tenant rooms
				for (const job of recentJobs) {
					this.io.to(`tenant:${job.tenantId}`).emit("job_update", {
						jobId: job.id,
						status: job.status,
						traceId: job.traceId,
						timestamp: new Date(),
					});
				}
			} catch (error) {
				logger.error("Polling error", { error });
			}
		}, 2000); // Poll every 2 seconds
	}

	// Emit job update to specific tenant
	public emitJobUpdate(tenantId: string, job: any) {
		this.io.to(`tenant:${tenantId}`).emit("job_update", {
			jobId: job.id,
			status: job.status,
			traceId: job.traceId,
			timestamp: new Date(),
		});
	}

	private async getMetrics(tenantId: string) {
		const jobCounts = await this.prisma.job.groupBy({
			by: ["status"],
			where: { tenantId },
			_count: true,
		});

		return {
			pending: jobCounts.find((j) => j.status === "pending")?._count || 0,
			running: jobCounts.find((j) => j.status === "running")?._count || 0,
			completed: jobCounts.find((j) => j.status === "completed")?._count || 0,
			failed: jobCounts.find((j) => j.status === "failed")?._count || 0,
		};
	}
}
