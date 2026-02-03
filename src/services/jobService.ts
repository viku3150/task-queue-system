import { PrismaClient, Job, JobStatus } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";

export class JobService {
	private prisma: PrismaClient;

	constructor() {
		this.prisma = new PrismaClient();
	}

	// Submit a new job with idempotency support
	async submitJob(
		tenantId: string,
		payload: any,
		idempotencyKey?: string,
	): Promise<Job> {
		const traceId = uuidv4();

		try {
			// Check for duplicate using idempotency key
			if (idempotencyKey) {
				const existing = await this.prisma.job.findUnique({
					where: { idempotencyKey },
				});

				if (existing) {
					logger.info("Duplicate job detected, returning existing", {
						traceId,
						jobId: existing.id,
						idempotencyKey,
					});
					return existing;
				}
			}

			// Create new job
			const job = await this.prisma.job.create({
				data: {
					tenantId,
					payload,
					idempotencyKey,
					traceId,
					status: "pending",
				},
			});

			logger.info("Job submitted", {
				traceId,
				jobId: job.id,
				tenantId,
				event: "job.submitted",
			});

			return job;
		} catch (error) {
			logger.error("Job submission failed", { traceId, tenantId, error });
			throw error;
		}
	}

	// Get job status
	async getJobStatus(jobId: string): Promise<Job | null> {
		return this.prisma.job.findUnique({
			where: { id: jobId },
		});
	}

	// List jobs with filtering
	async listJobs(
		tenantId: string,
		status?: JobStatus,
		limit = 50,
	): Promise<Job[]> {
		return this.prisma.job.findMany({
			where: {
				tenantId,
				...(status && { status }),
			},
			orderBy: { createdAt: "desc" },
			take: limit,
		});
	}

	// Get running job count for concurrent limit check
	async getRunningJobCount(tenantId: string): Promise<number> {
		return this.prisma.job.count({
			where: {
				tenantId,
				status: "running",
			},
		});
	}

	// Get metrics for dashboard
	async getMetrics(tenantId?: string) {
		const whereJob = tenantId ? { tenantId } : {};

		const [total, byStatus, dlqCount] = await Promise.all([
			this.prisma.job.count({ where: whereJob }),
			this.prisma.job.groupBy({
				by: ["status"],
				where: whereJob,
				_count: { _all: true },
			}),
			tenantId
				? this.prisma.dLQ.count({ where: { job: { tenantId } } })
				: this.prisma.dLQ.count(),
		]);

		const jobsByStatus: Record<string, number> = {
			pending: 0,
			running: 0,
			completed: 0,
			failed: 0,
		};

		for (const row of byStatus) {
			const count =
				typeof row._count === "number" ? row._count : row._count._all;
			jobsByStatus[row.status] = count;
		}

		return {
			jobs_total: total,
			jobs_by_status: jobsByStatus,
			dlq_size: dlqCount,
		};
	}
}
