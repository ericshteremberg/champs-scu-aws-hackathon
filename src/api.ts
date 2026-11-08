export class ApiFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiFailure(
      body.error || `Request failed (${response.status}). Please try again.`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export async function downloadPacket(
  caseId: string,
  runId: string,
  format: "markdown" | "json",
) {
  const response = await fetch(
    `/api/cases/${encodeURIComponent(caseId)}/export?format=${format}&runId=${encodeURIComponent(runId)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiFailure(
      body.error || "The export could not be prepared. Please try again.",
      response.status,
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `casework-${caseId}.${format === "markdown" ? "md" : "json"}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
