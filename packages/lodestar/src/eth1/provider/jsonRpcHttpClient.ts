// Uses cross-fetch for browser + NodeJS cross compatibility
// Note: isomorphic-fetch is not well mantained and does not support abort signals
import fetch from "cross-fetch";
import {AbortController, AbortSignal} from "@chainsafe/abort-controller";
import {IRpcPayload, ReqOpts} from "../interface";
import {toJson, toString} from "@chainsafe/lodestar-utils";
import {Json} from "@chainsafe/ssz";

/**
 * Limits the amount of response text printed with RPC or parsing errors
 */
const maxStringLengthToPrint = 500;
const REQUEST_TIMEOUT = 30 * 1000;

interface IRpcResponse<R> extends IRpcResponseError {
  result?: R;
}

interface IRpcResponseError {
  jsonrpc: "2.0";
  id: number;
  error?: {
    code: number; // -32601;
    message: string; // "The method eth_none does not exist/is not available"
  };
}

export class JsonRpcHttpClient {
  constructor(
    private readonly urls: string[],
    private readonly opts: {
      signal: AbortSignal;
      /** If returns true, do not fallback to other urls and throw early */
      shouldNotFallback?: (error: Error) => boolean;
    }
  ) {
    // Sanity check for all URLs to be properly defined. Otherwise it will error in loop on fetch
    if (urls.length === 0) {
      throw Error("No urls provided to JsonRpcHttpClient");
    }
    for (const [i, url] of urls.entries()) {
      if (!url) {
        throw Error(`JsonRpcHttpClient.urls[${i}] is empty or undefined: ${url}`);
      }
    }
  }

  /**
   * Perform RPC request
   */
  async fetch<R>(payload: IRpcPayload, opts?: ReqOpts): Promise<R> {
    const res: IRpcResponse<R> = await this.fetchJson({jsonrpc: "2.0", id: 1, ...payload}, opts);
    return parseRpcResponse(res, payload);
  }

  /**
   * Perform RPC batched request
   * Type-wise assumes all requests results have the same type
   */
  async fetchBatch<R>(rpcPayloadArr: IRpcPayload[], opts?: ReqOpts): Promise<R[]> {
    if (rpcPayloadArr.length === 0) return [];

    const resArr: IRpcResponse<R>[] = await this.fetchJson(
      rpcPayloadArr.map(({method, params}, i) => ({jsonrpc: "2.0", method, params, id: i})),
      opts
    );
    return resArr.map((res, i) => parseRpcResponse(res, rpcPayloadArr[i]));
  }

  private async fetchJson<R, T = unknown>(json: T, opts?: ReqOpts): Promise<R> {
    let lastError: Error | null = null;

    for (const url of this.urls) {
      try {
        return await this.fetchJsonOneUrl(url, json, opts);
      } catch (e) {
        if (this.opts.shouldNotFallback?.(e)) {
          throw e;
        }

        lastError = e as Error;
      }
    }

    if (lastError !== null) {
      throw lastError;
    } else if (this.urls.length === 0) {
      throw Error("No url provided");
    } else {
      throw Error("Unknown error");
    }
  }

  /**
   * Fetches JSON and throws detailed errors in case the HTTP request is not ok
   */
  private async fetchJsonOneUrl<R, T = unknown>(url: string, json: T, opts?: ReqOpts): Promise<R> {
    // If url is undefined node-fetch throws with `TypeError: Only absolute URLs are supported`
    // Throw a better error instead
    if (!url) throw Error(`Empty or undefined JSON RPC HTTP client url: ${url}`);

    // fetch() throws for network errors:
    // - request to http://missing-url.com/ failed, reason: getaddrinfo ENOTFOUND missing-url.com

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, opts?.timeout ?? REQUEST_TIMEOUT);

    const onParentSignalAbort = (): void => controller.abort();

    if (this.opts.signal) {
      this.opts.signal.addEventListener("abort", onParentSignalAbort, {once: true});
    }

    const res = await fetch(url, {
      method: "post",
      body: JSON.stringify(json),
      headers: {"Content-Type": "application/json"},
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
      this.opts.signal?.removeEventListener("abort", onParentSignalAbort);
    });

    const body = await res.text();
    if (!res.ok) {
      // Infura errors:
      // - No project ID: Forbidden: {"jsonrpc":"2.0","id":0,"error":{"code":-32600,"message":"project ID is required","data":{"reason":"project ID not provided","see":"https://infura.io/dashboard"}}}
      throw new HttpRpcError(res.status, `${res.statusText}: ${body.slice(0, maxStringLengthToPrint)}`);
    }

    return parseJson(body);
  }
}

function parseRpcResponse<R>(res: IRpcResponse<R>, payload: IRpcPayload): R {
  if (res.result !== undefined) return res.result;
  throw new ErrorJsonRpcResponse(res, payload);
}

/**
 * Util: Parse JSON but display the original source string in case of error
 * Helps debug instances where an API returns a plain text instead of JSON,
 * such as getting an HTML page due to a wrong API URL
 */
function parseJson<T>(json: string): T {
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    throw new ErrorParseJson(json, e);
  }
}

export class ErrorParseJson extends Error {
  constructor(json: string, e: Error) {
    super(`Error parsing JSON: ${e.message}\n${json.slice(0, maxStringLengthToPrint)}`);
  }
}

export class ErrorJsonRpcResponse extends Error {
  response: IRpcResponseError;
  payload: IRpcPayload;
  constructor(res: IRpcResponseError, payload: IRpcPayload) {
    const errorMessage = res.error
      ? typeof res.error.message === "string"
        ? res.error.message
        : typeof res.error.code === "number"
        ? parseJsonRpcErrorCode(res.error.code)
        : toString(toJson(res.error))
      : "no result";

    super(`JSON RPC error: ${errorMessage}, ${toString(toJson((payload as unknown) as Json))}`);

    this.response = res;
    this.payload = payload;
  }
}

export class HttpRpcError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * JSON RPC spec errors https://www.jsonrpc.org/specification#response_object
 */
function parseJsonRpcErrorCode(code: number): string {
  if (code === -32700) return "Parse request error";
  if (code === -32600) return "Invalid request object";
  if (code === -32601) return "Method not found";
  if (code === -32602) return "Invalid params";
  if (code === -32603) return "Internal error";
  if (code >= -32000 && code <= -32099) return "Server error";
  return `Unknown error code ${code}`;
}
