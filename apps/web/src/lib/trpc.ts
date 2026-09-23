// Creates the typed tRPC React client used by the web application.

import type { AppRouter } from "@cartoptix/api/router";
import { createTRPCReact } from "@trpc/react-query";

export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>();
