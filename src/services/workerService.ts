import { PrismaClient, Job, Prisma } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

export class WorkerService {
	private prisma: PrismaClient;
	private workerId: string;
	private isRunning: boolean = false;
	private pollInterval: number = 2000;

	constructor() {
		this.prisma = new PrismaClient();
		this.workerId = `worker-${uuidv4()}`;
	}

	// Main worker loop
	async start() {
		this.isRunning = true;
		logger.info("Worker started", { workerId: this.workerId });

		while (this.isRunning) {
			try {
				const job = await this.acquireLease();

				if (job) {
					await this.processJob(job);
				} else {
					// No jobs available, wait before polling again
					await this.sleep(this.pollInterval);
				}
			} catch (error) {
				logger.error("Worker loop error", { workerId: this.workerId, error });
				await this.sleep(this.pollInterval);
			}
		}
	}

	// LEASE: Acquire a job from the queue
	private async acquireLease(): Promise<Job | null> {
		try {
			// Use transaction to atomically fetch and lock a job
			const job = await this.prisma.$transaction(async (tx) => {
				// Find a pending job OR a running job with expired lease
				const availableJob = await tx.job.findFirst({
					where: {
						OR: [
							{ status: "pending" },
							{
								status: "running",
								leaseExpiresAt: { lt: new Date() }, // Lease expired
							},
						],
					},
					orderBy: { createdAt: "asc" }, // FIFO order
				});

				if (!availableJob) return null;

				// Mark as running and set lease expiry (5 minutes from now)
				const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

				const updatedJob = await tx.job.update({
					where: { id: availableJob.id },
					data: {
						status: "running",
						workerId: this.workerId,
						leaseExpiresAt,
						startedAt:
							availableJob.status === "pending"
								? new Date()
								: availableJob.startedAt,
					},
				});

				logger.info("Job lease acquired", {
					traceId: updatedJob.traceId,
					jobId: updatedJob.id,
					workerId: this.workerId,
					event: "job.leased",
				});

				return updatedJob;
			});

			return job;
		} catch (error) {
			logger.error("Lease acquisition failed", {
				workerId: this.workerId,
				error,
			});
			return null;
		}
	}

	// Process the actual job (simulate work)
	private async processJob(job: Job) {
		logger.info("Processing job", {
			traceId: job.traceId,
			jobId: job.id,
			workerId: this.workerId,
			event: "job.processing",
		});

		try {
			// Simulate work with random success/failure
			await this.simulateWork(job.payload);

			// ACK: Mark job as completed
			await this.acknowledgeJob(job.id);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("Job processing failed", {
				traceId: job.traceId,
				jobId: job.id,
				workerId: this.workerId,
				error: message,
				event: "job.failed",
			});

			// RETRY: Handle failure with retry logic
			await this.retryJob(
				job,
				error instanceof Error ? error : new Error(message),
			);
		}
	}

	// ACK: Mark job as successfully completed
	private async acknowledgeJob(jobId: string) {
		await this.prisma.job.update({
			where: { id: jobId },
			data: {
				status: "completed",
				completedAt: new Date(),
			},
		});

		const job = await this.prisma.job.findUnique({ where: { id: jobId } });
		logger.info("Job completed", {
			traceId: job?.traceId,
			jobId,
			workerId: this.workerId,
			event: "job.completed",
		});
	}

	// RETRY: Handle job failure with exponential backoff
	private async retryJob(job: Job, error: Error) {
		if (job.retryCount >= job.maxRetries) {
			// Max retries exceeded - move to DLQ
			await this.moveToDeadLetterQueue(job, error);
		} else {
			// Calculate exponential backoff: min(30s * 2^retry, 10min)
			const backoffMs = Math.min(30000 * Math.pow(2, job.retryCount), 600000);

			await this.prisma.job.update({
				where: { id: job.id },
				data: {
					status: "pending",
					retryCount: job.retryCount + 1,
					workerId: null,
					leaseExpiresAt: null,
					errorMessage: error.message,
					// Schedule retry by updating createdAt
					createdAt: new Date(Date.now() + backoffMs),
				},
			});

			logger.info("Job scheduled for retry", {
				traceId: job.traceId,
				jobId: job.id,
				retryCount: job.retryCount + 1,
				backoffMs,
				event: "job.retry",
			});
		}
	}

	// Move failed job to Dead Letter Queue
	private async moveToDeadLetterQueue(job: Job, error: Error) {
		await this.prisma.$transaction([
			this.prisma.dLQ.create({
				data: {
					jobId: job.id,
					payload: job.payload === null ? Prisma.JsonNull : job.payload,
					finalError: error.message,
					traceId: job.traceId,
				},
			}),
			this.prisma.job.update({
				where: { id: job.id },
				data: {
					status: "failed",
					errorMessage: error.message,
				},
			}),
		]);

		logger.warn("Job moved to DLQ", {
			traceId: job.traceId,
			jobId: job.id,
			retryCount: job.retryCount,
			event: "job.dlq",
		});
	}

	// Simulate job work
	private async simulateWork(payload: any): Promise<void> {
		const processingTime = Math.random() * 3000 + 1000; // 1-4 seconds
		await this.sleep(processingTime);

		// Simulate 20% failure rate for testing
		if (Math.random() < 0.2) {
			throw new Error("Simulated processing error");
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async stop() {
		this.isRunning = false;
		logger.info("Worker stopping", { workerId: this.workerId });
	}
}
