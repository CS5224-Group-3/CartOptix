import type { ReadinessResponse } from "@cartoptix/contracts";
import { useEffect, useState } from "react";

/**
 * Placeholder screen proving the browser can reach the API and its database.
 * Product screens belong to the Web UI workstream (#14 onwards).
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; readiness: ReadinessResponse }
  | { kind: "failed"; detail: string };

export function App(): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      try {
        const response = await fetch("/health/ready", { signal: controller.signal });
        const readiness = (await response.json()) as ReadinessResponse;
        setState({ kind: "loaded", readiness });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          kind: "failed",
          detail: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main>
      <h1>CartOptix</h1>
      <p>Workspace foundation. No product functionality is implemented yet.</p>
      <h2>API readiness</h2>
      {state.kind === "loading" && <p>Checking the API…</p>}
      {state.kind === "failed" && <p>Could not reach the API: {state.detail}</p>}
      {state.kind === "loaded" && (
        <dl>
          <dt>API</dt>
          <dd>{state.readiness.status}</dd>
          <dt>Database</dt>
          <dd>
            {state.readiness.checks.database.status}
            {state.readiness.checks.database.detail !== undefined &&
              ` — ${state.readiness.checks.database.detail}`}
          </dd>
        </dl>
      )}
    </main>
  );
}
