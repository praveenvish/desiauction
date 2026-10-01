"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useState } from "react";

import { SAMPLE_RATE } from "../lib/web-vitals-report";

/**
 * Real visitors' Core Web Vitals, sampled (SEO-1 Phase 8). One page load in
 * ten reports; the decision is made once per load so a sampled page reports
 * every metric and an unsampled one none. Sent with `sendBeacon`, which
 * survives the tab closing and never delays it. Renders nothing.
 */
/** The three fields reported — all of them, and nothing about the visitor. */
interface ReportedMetric {
  readonly name: string;
  readonly value: number;
  readonly rating: string;
}

export function WebVitalsReporter(): null {
  const [sampled] = useState(() => Math.random() < SAMPLE_RATE);
  useReportWebVitals((metric: ReportedMetric) => {
    if (!sampled || typeof navigator.sendBeacon !== "function") return;
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      path: window.location.pathname,
    });
    navigator.sendBeacon("/api/vitals", new Blob([body], { type: "application/json" }));
  });
  return null;
}
