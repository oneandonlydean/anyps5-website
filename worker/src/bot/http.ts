const MAX_RETRIES = 2;
const MAX_WAIT_MS = 5000;

/** Thrown when an invocation would exceed its subrequest budget. */
export class BudgetError extends Error {
  constructor() {
    super("subrequest budget exhausted");
  }
}

/** Non-2xx response. Carries only a label and status so it is safe to log. */
export class HttpError extends Error {
  constructor(
    readonly label: string,
    readonly status: number,
  ) {
    super(`${label} failed with ${status}`);
  }
}

/**
 * fetch with 429/5xx retry and a hard cap on subrequests, retries included.
 * `label` names the call in errors and logs; URLs are never logged because
 * the webhook URL is a secret.
 */
export class Http {
  used = 0;

  constructor(private readonly limit = Infinity) {}

  get remaining(): number {
    return this.limit - this.used;
  }

  async send(label: string, url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (this.used >= this.limit) throw new BudgetError();
      this.used++;

      let res: Response | undefined;
      try {
        res = await fetch(url, init);
      } catch {
        if (attempt >= MAX_RETRIES) throw new HttpError(label, 0);
      }
      if (res && res.status !== 429 && res.status < 500) return res;
      if (res && attempt >= MAX_RETRIES) return res;

      const wait = retryDelay(res, attempt);
      if (res && wait > MAX_WAIT_MS) return res;
      await res?.body?.cancel();
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  /** Sends and parses JSON, throwing HttpError on a non-2xx status. */
  async json<T>(label: string, url: string, init?: RequestInit): Promise<T> {
    const res = await this.send(label, url, init);
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(label, res.status);
    }
    return res.json<T>();
  }
}

function retryDelay(res: Response | undefined, attempt: number): number {
  const header = Number(res?.headers.get("retry-after"));
  if (res?.headers.has("retry-after") && Number.isFinite(header)) return header * 1000;
  return 500 * 3 ** attempt;
}
