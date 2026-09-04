import { z } from "zod";

/**
 * The /healthz shape every app serves (IP-0_DESIGN §29). Fail-closed: any
 * failing DEPENDENCY check makes the overall status "fail" and the endpoint
 * returns 503. A check may also be a POSTURE signal (e.g. readyz's
 * `insecure_local_production`) that reads as non-ok for visibility without
 * flipping the overall status — the endpoint owns which checks gate rotation.
 */
export const healthCheckStatusSchema = z.enum(["ok", "fail"]);

export const healthResponseSchema = z.object({
  status: healthCheckStatusSchema,
  version: z.string().min(1),
  checks: z.record(z.string(), healthCheckStatusSchema),
});

export type HealthCheckStatus = z.infer<typeof healthCheckStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
