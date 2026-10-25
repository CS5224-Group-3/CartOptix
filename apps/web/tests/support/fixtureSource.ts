import {
  ComparisonFailure,
  type ComparisonSource,
} from "../../src/features/basket-comparison/model";
import { comparisonFixtures, fixtureForBasket } from "./fixtures";

type FixtureScenario = {
  label: string;
  fixture: string;
  behavior: "success" | "fail-once" | "retryable-failure" | "non-retryable-failure";
};

export const fixtureScenarios: Record<string, FixtureScenario> = {
  ...Object.fromEntries(
    Object.entries(comparisonFixtures).map(([id, fixture]) => [
      id,
      {
        label: fixture.fixtureLabel ?? "Synthetic comparison",
        fixture: id,
        behavior: "success" as const,
      },
    ]),
  ),
  "retry-success": {
    label: "Temporary failure, then success",
    fixture: "complete",
    behavior: "fail-once",
  },
  "retry-failure": {
    label: "Repeated service failure",
    fixture: "complete",
    behavior: "retryable-failure",
  },
  "non-retryable": {
    label: "Non-retryable service failure",
    fixture: "complete",
    behavior: "non-retryable-failure",
  },
};

/** Delays and attempt counts belong to this source instance, not global application state.
 * Tests can supply a controlled wait promise without timers or HTTP mocks.
 */
export function createFixtureSource({
  scenario: selectedScenario = "complete",
  wait = () => new Promise<void>((resolve) => setTimeout(resolve, 350)),
}: {
  scenario?: string | (() => string);
  wait?: () => Promise<void>;
} = {}): ComparisonSource {
  const failedOnce = new Set<string>();
  return async (submission) => {
    const submitted = structuredClone(submission);
    const scenarioId =
      typeof selectedScenario === "function" ? selectedScenario() : selectedScenario;
    await wait();
    const scenario = fixtureScenarios[scenarioId];
    const result =
      scenario &&
      fixtureForBasket(scenario.fixture, submitted.basket.products, submitted.basket.revision);
    if (!result) {
      throw new ComparisonFailure(
        "This demonstration cannot compare that basket. Return to basket editing and load an exact synthetic scenario.",
        false,
      );
    }
    const attemptKey = JSON.stringify([
      scenarioId,
      submitted.basket.revision,
      submitted.basket.products.map(({ productId, quantity }) => [productId, quantity]).sort(),
    ]);
    if (scenario.behavior === "non-retryable-failure") {
      throw new ComparisonFailure(
        "The demonstration comparison service cannot process this scenario. Return to basket editing and choose another scenario.",
        false,
      );
    }
    if (
      scenario.behavior === "retryable-failure" ||
      (scenario.behavior === "fail-once" && !failedOnce.has(attemptKey))
    ) {
      failedOnce.add(attemptKey);
      throw new ComparisonFailure(
        "The demonstration comparison service is temporarily unavailable. Your basket has been kept.",
        true,
      );
    }
    return result;
  };
}
