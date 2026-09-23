// Moved to packages/messaging so the finops runner delivers through the same
// gate and adapters as the web tier. This path stays so imports do not churn.
export * from "@desiauction/messaging/consent";
