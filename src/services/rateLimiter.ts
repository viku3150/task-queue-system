import { createClient, RedisClientType } from "redis";
import { logger } from "../utils/logger";

export class RateLimiter {
	private redis: RedisClientType;

	constructor() {
		this.redis = createClient({
			url: process.env.REDIS_URL || "redis://localhost:6379",
		});

		this.redis.on("error", (err) => logger.error("Redis error:", err));
	}

	async connect() {
		await this.redis.connect();
		logger.info("Rate limiter connected to Redis");
	}

	// Sliding window rate limiting - 10 jobs per minute per tenant
	async checkRateLimit(tenantId: string): Promise<boolean> {
		const key = `rate:${tenantId}`;
		const now = Date.now();
		const windowMs = 60000; // 1 minute window

		try {
			// Remove old entries outside the window
			await this.redis.zRemRangeByScore(key, 0, now - windowMs);

			// Count entries in current window
			const count = await this.redis.zCard(key);

			if (count >= 10) {
				logger.warn("Rate limit exceeded", { tenantId, count });
				return false;
			}

			// Add current request
			await this.redis.zAdd(key, {
				score: now,
				value: `${now}-${Math.random()}`,
			});
			await this.redis.expire(key, 60);

			return true;
		} catch (error) {
			logger.error("Rate limit check failed", { tenantId, error });
			return true; // Fail open - don't block on Redis errors
		}
	}

	// Check concurrent job limit - max 5 running jobs per tenant
	async checkConcurrentLimit(
		tenantId: string,
		runningCount: number,
	): Promise<boolean> {
		const limit = 5;

		if (runningCount >= limit) {
			logger.warn("Concurrent job limit exceeded", {
				tenantId,
				runningCount,
				limit,
			});
			return false;
		}

		return true;
	}

	async disconnect() {
		await this.redis.quit();
	}
}
