export class ApiError extends Error {
  status: number;
  existingId?: string;
  constructor(message: string, status: number, existingId?: string) {
    super(message);
    this.status = status;
    this.existingId = existingId;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(25_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      "Could not reach Margin. Check your connection and try again.",
      0,
    );
  }
  if (!response.ok) {
    if (
      response.status === 401 &&
      !["/login", "/setup", "/session"].includes(path)
    )
      window.dispatchEvent(new Event("margin-session-expired"));
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error ||
        `Something went wrong (${response.status}). Please try again.`,
      response.status,
      body.existing_id,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const send = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
