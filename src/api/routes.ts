import express, { Request, Response } from "express";
import { JobService } from "../services/jobService";
import { RateLimiter } from "../services/rateLimiter";
import { logger } from "../utils/logger";

const router = express.Router();
const jobService = new JobService();
const rateLimiter = new RateLimiter();

// Initialize rate limiter
rateLimiter.connect();

// POST /api/v1/jobs - Submit a new job
router.post("/jobs", async (req: Request, res: Response) => {
	const { tenantId, payload, idempotencyKey } = req.body;

	if (!tenantId || !payload) {
		return res.status(400).json({ error: "tenantId and payload are required" });
	}

	try {
		// Check rate limit (10 jobs/minute)
		const rateLimitOk = await rateLimiter.checkRateLimit(tenantId);
		if (!rateLimitOk) {
			return res.status(429).json({
				error: "Rate limit exceeded",
				message: "Maximum 10 jobs per minute allowed",
			});
		}

		// Check concurrent job limit (max 5 running)
		const runningCount = await jobService.getRunningJobCount(tenantId);
		const concurrentOk = await rateLimiter.checkConcurrentLimit(
			tenantId,
			runningCount,
		);

		if (!concurrentOk) {
			return res.status(429).json({
				error: "Concurrent job limit exceeded",
				message: "Maximum 5 concurrent jobs allowed",
			});
		}

		// Submit job
		const job = await jobService.submitJob(tenantId, payload, idempotencyKey);

		res.status(201).json({
			jobId: job.id,
			status: job.status,
			traceId: job.traceId,
		});
	} catch (error) {
		logger.error("Job submission failed", { tenantId, error });
		res.status(500).json({ error: "Internal server error" });
	}
});

// GET /api/v1/jobs/:jobId - Get job status
router.get("/jobs/:jobId", async (req: Request, res: Response) => {
	const { jobId } = req.params;

	if (typeof jobId !== "string") {
		return res.status(400).json({ error: "jobId must be a string" });
	}

	try {
		const job = await jobService.getJobStatus(jobId);

		if (!job) {
			return res.status(404).json({ error: "Job not found" });
		}

		res.json({
			jobId: job.id,
			status: job.status,
			traceId: job.traceId,
			createdAt: job.createdAt,
			startedAt: job.startedAt,
			completedAt: job.completedAt,
			retryCount: job.retryCount,
			errorMessage: job.errorMessage,
		});
	} catch (error) {
		logger.error("Job status fetch failed", { jobId, error });
		res.status(500).json({ error: "Internal server error" });
	}
});

// GET /api/v1/jobs - List jobs
router.get("/jobs", async (req: Request, res: Response) => {
	const { tenantId, status } = req.query;

	if (!tenantId) {
		return res.status(400).json({ error: "tenantId query parameter required" });
	}

	try {
		const jobs = await jobService.listJobs(tenantId as string, status as any);

		res.json({ jobs });
	} catch (error) {
		logger.error("Job list fetch failed", { tenantId, error });
		res.status(500).json({ error: "Internal server error" });
	}
});

// GET /api/v1/metrics - Get system metrics
router.get("/metrics", async (req: Request, res: Response) => {
	const { tenantId } = req.query;

	try {
		const metrics = await jobService.getMetrics(tenantId as string);
		res.json(metrics);
	} catch (error) {
		logger.error("Metrics fetch failed", { error });
		res.status(500).json({ error: "Internal server error" });
	}
});

export default router;
