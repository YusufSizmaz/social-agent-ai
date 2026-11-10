/** Error carrying the HTTP status of a failed platform API call, so retry logic can tell 4xx from 5xx */
export class PlatformHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PlatformHttpError';
  }
}

/** Builds a PlatformHttpError from a non-ok fetch response, including the (truncated) body */
export async function httpError(prefix: string, res: Response): Promise<PlatformHttpError> {
  const body = await res.text().catch(() => '');
  return new PlatformHttpError(`${prefix} (${res.status}): ${body.slice(0, 500)}`, res.status);
}
