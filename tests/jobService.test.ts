jest.mock("uuid", () => ({ v4: () => "test-trace-id" }));

import { JobService } from "../src/services/jobService";
import { PrismaClient } from "@prisma/client";

describe("JobService", () => {
	let jobService: JobService;
	let prisma: PrismaClient;

	beforeAll(() => {
		jobService = new JobService();
		prisma = new PrismaClient();
	});

	afterAll(async () => {
		await prisma.$disconnect();
	});

	describe("submitJob", () => {
		it("should create a new job", async () => {
			const job = await jobService.submitJob("tenant-test", {
				task: "test-task",
			});

			expect(job).toBeDefined();
			expect(job.tenantId).toBe("tenant-test");
			expect(job.status).toBe("pending");
			expect(job.traceId).toBeDefined();
		});

		it("should enforce idempotency", async () => {
			const idempotencyKey = "test-key-" + Date.now();

			const job1 = await jobService.submitJob(
				"tenant-test",
				{ task: "test" },
				idempotencyKey,
			);

			const job2 = await jobService.submitJob(
				"tenant-test",
				{ task: "test" },
				idempotencyKey,
			);

			expect(job1.id).toBe(job2.id); // Same job returned
		});
	});

	describe("getRunningJobCount", () => {
		it("should count running jobs correctly", async () => {
			const count = await jobService.getRunningJobCount("tenant-test");
			expect(typeof count).toBe("number");
			expect(count).toBeGreaterThanOrEqual(0);
		});
	});
});
