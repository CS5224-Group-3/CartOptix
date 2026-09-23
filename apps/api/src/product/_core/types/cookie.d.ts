// Extends cookie-related TypeScript declarations used by the API.
declare module "cookie" {
  export function parse(
    str: string,
    options?: Record<string, unknown>
  ): Record<string, string>;
}
