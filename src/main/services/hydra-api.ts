import axios, { AxiosInstance } from "axios";
import { networkLogger as logger } from "./logger";
import { UserNotLoggedInError } from "@shared";
import { appVersion } from "@main/constants";
import type { User } from "@types";
import type { HydraApiAuthContext } from "./hydra-auth-context";

declare module "axios" {
  interface AxiosRequestConfig {
    logResponseBody?: boolean;
  }
}

export interface HydraApiOptions {
  needsAuth?: boolean;
  needsSubscription?: boolean;
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  logResponseBody?: boolean;
  timeout?: number;
  authContext?: HydraApiAuthContext;
}

export class HydraApiWriteBlockedError extends Error {
  constructor(method: string, url: string) {
    super(`Hydra API is read-only in Cerberus: blocked ${method} ${url}`);
    this.name = "HydraApiWriteBlockedError";
  }
}

/**
 * Read-only Hydra API client (catalogue/metadata only).
 *
 * - Never sends an Authorization header and has no login/session.
 * - Only requests flagged `needsAuth: false` are performed; anything that
 *   would need a user identity is rejected locally with UserNotLoggedInError.
 * - Non-GET requests are rejected locally except an allowlist of pure
 *   query endpoints that carry no user identity or library data.
 */
const POST_ALLOWLIST = new Set<string>([
  // Pure catalogue lookups (send only query filters, ids, or titles being looked up)
  "/catalogue/search",
  "/games/shop-details",
  "/download-sources",
  "/download-sources/sync",
  // Hoster link availability & resolvers (send only the file link being downloaded)
  "/hosters/availability",
  "/hosters/datanodes/unlock",
  "/hosters/vikingfile/unlock",
]);

export class HydraApi {
  private static instance: AxiosInstance | undefined;

  public static getAuthContext(): HydraApiAuthContext | null {
    return null;
  }

  public static isAuthContextCurrent(_context: HydraApiAuthContext) {
    return false;
  }

  public static onAuthContextChanged(_listener: () => void) {
    return () => {};
  }

  public static isLoggedIn() {
    return false;
  }

  public static hasActiveSubscription() {
    return false;
  }

  public static updateUserSubscription(
    _subscription?: { expiresAt: Date | string | null } | null,
    _options?: { freshUserId?: string; triggerSouvenirSync?: boolean }
  ) {}

  public static async persistUserCache(
    _user: User,
    _context: HydraApiAuthContext
  ) {}

  public static async handleSignOut(cleanupUserData?: () => Promise<void>) {
    await cleanupUserData?.();
  }

  public static async refreshToken(): Promise<never> {
    throw new UserNotLoggedInError();
  }

  static async setupApi() {
    this.client();
  }

  private static client() {
    if (!this.instance) {
      this.instance = axios.create({
        baseURL: import.meta.env.MAIN_VITE_API_URL,
        headers: { "User-Agent": `Cerberus Launcher v${appVersion}` },
      });
    }
    return this.instance;
  }

  private static assertAnonymous(options?: HydraApiOptions) {
    if (options?.needsAuth !== false || options?.needsSubscription) {
      throw new UserNotLoggedInError();
    }
  }

  private static requestConfig(options?: HydraApiOptions) {
    return {
      signal: options?.signal,
      timeout: options?.timeout,
      logResponseBody: options?.logResponseBody,
      ...(options?.validateStatus
        ? { validateStatus: options.validateStatus }
        : {}),
    };
  }

  private static getConfig(params: any, options?: HydraApiOptions) {
    return {
      ...this.requestConfig(options),
      params,
      headers: {
        "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
        "If-None-Match": options?.ifNoneMatch,
      },
    };
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    this.assertAnonymous(options);
    const response = await this.client().get<T>(
      url,
      this.getConfig(params, options)
    );
    return response.data;
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    this.assertAnonymous(options);
    const response = await this.client().get<T>(
      url,
      this.getConfig(params, options)
    );
    return {
      status: response.status,
      data: response.data,
      headers: response.headers,
    };
  }

  private static assertPostAllowed(url: string, options?: HydraApiOptions) {
    this.assertAnonymous(options);
    if (!POST_ALLOWLIST.has(url)) {
      logger.warn(`Blocked non-read Hydra request: POST ${url}`);
      throw new HydraApiWriteBlockedError("POST", url);
    }
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ) {
    this.assertPostAllowed(url, options);
    const response = await this.client().post<T>(
      url,
      data,
      this.requestConfig(options)
    );
    return response.data;
  }

  static async postResponse<T = unknown>(
    url: string,
    data?: unknown,
    options?: HydraApiOptions
  ) {
    this.assertPostAllowed(url, options);
    const response = await this.client().post<T>(
      url,
      data,
      this.requestConfig(options)
    );
    return { status: response.status, data: response.data };
  }

  static async put<T = any>(
    url: string,
    _data?: any,
    _options?: HydraApiOptions
  ): Promise<T> {
    throw new HydraApiWriteBlockedError("PUT", url);
  }

  static async patch<T = any>(
    url: string,
    _data?: any,
    _options?: HydraApiOptions
  ): Promise<T> {
    throw new HydraApiWriteBlockedError("PATCH", url);
  }

  static async delete<T = any>(
    url: string,
    _options?: HydraApiOptions
  ): Promise<T> {
    throw new HydraApiWriteBlockedError("DELETE", url);
  }

  static async checkDownloadSourcesChanges(
    _downloadSourceIds: string[],
    _games: Array<{ shop: string; objectId: string }>,
    _since: string
  ): Promise<
    Array<{
      shop: string;
      objectId: string;
      newDownloadOptionsCount: number;
      downloadSourceIds: string[];
    }>
  > {
    // Would upload the user's library; disabled.
    return [];
  }
}
