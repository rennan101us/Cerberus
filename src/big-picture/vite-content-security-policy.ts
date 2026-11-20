import type { Plugin } from "vite";
import { MONACO_VS_URL } from "../shared/monaco";

const EXTERNAL_RESOURCES_SCRIPT_ORIGINS: string[] = [];

export const contentSecurityPolicy = (
  externalResourcesUrl: string | undefined
): Plugin => ({
  name: "cerberus:content-security-policy",
  transformIndexHtml: (_html, context) => {
    const scriptSources = [
      "'self'",
      ...(externalResourcesUrl ? [new URL(externalResourcesUrl).origin] : []),
      ...EXTERNAL_RESOURCES_SCRIPT_ORIGINS,
      `${MONACO_VS_URL}/`,
      // React Refresh injects an inline preamble that only exists on the dev server.
      ...(context.server ? ["'unsafe-inline'"] : []),
    ];

    return [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: [
            "default-src 'self' 'unsafe-inline' * data: local: blob:",
            `script-src ${scriptSources.join(" ")}`,
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "media-src 'self' 'unsafe-inline' * data: local: blob:",
          ].join("; "),
        },
        injectTo: "head-prepend",
      },
    ];
  },
});
