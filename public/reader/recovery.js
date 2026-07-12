export function pulseJobRecovery(job) {
  if (!job?.id) {
    return { kind: "none" };
  }

  if (job.status === "running") {
    return { kind: "follow", job };
  }

  if (job.status === "completed" && job.run) {
    return { kind: "render", run: job.run };
  }

  if (job.status === "failed") {
    return {
      kind: "error",
      message: job.error ?? job.progress?.detail ?? "Pulse failed.",
    };
  }

  return { kind: "none" };
}

export function shouldApplyLatestRun(requestedGeneration, currentGeneration) {
  return requestedGeneration === currentGeneration;
}
