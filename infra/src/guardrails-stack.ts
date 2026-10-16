import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import type { Construct } from "constructs";

/**
 * The spending alert (#21, technical E5).
 *
 * Deliberately a separate stack from the presentation deployment, because the
 * two have opposite lifetimes. The presentation stack is destroyed at the end
 * of every working session; a spending alert inside it would be destroyed
 * too, and would be missing during exactly the periods it is most needed —
 * when a stack was left up by mistake, or when something outside the stack
 * (the development host, ECR storage, an orphaned volume) is quietly billing.
 * This stack is deployed once and left alone.
 *
 * The budget is filtered to `Project=cartoptix` because the AWS account also
 * holds unrelated workloads, so an account-wide budget would alert on other
 * people's spending and say nothing useful about this project's SGD 84.
 *
 * That filter depends on `Project` being activated as a cost allocation tag
 * in the Billing console; until it is, AWS reports no cost against the filter
 * and the budget reads zero. The runbook covers this, because a budget that
 * silently reports zero is worse than none.
 */

export interface GuardrailsStackProps extends StackProps {
  /** Where the alert goes. AWS emails this address directly; no subscription confirmation. */
  readonly alertEmail: string;
  /** Monthly ceiling, in the currency the budget is denominated in. */
  readonly monthlyLimit: number;
  /** Currency for the limit, matching the account's billing currency. */
  readonly currency: string;
}

export class GuardrailsStack extends Stack {
  constructor(scope: Construct, id: string, props: GuardrailsStackProps) {
    super(scope, id, props);

    const subscribers: budgets.CfnBudget.SubscriberProperty[] = [
      { subscriptionType: "EMAIL", address: props.alertEmail },
    ];

    new budgets.CfnBudget(this, "ProjectBudget", {
      budget: {
        budgetName: "cartoptix-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: props.monthlyLimit, unit: props.currency },
        // Only spending tagged as this project's. Resources are tagged at the
        // app level in bin/presentation.ts.
        costFilters: { TagKeyValue: ["user:Project$cartoptix"] },
      },
      notificationsWithSubscribers: [
        {
          // Something is already running that should not be, or a session was
          // left up. Actual spend, so this is money already committed.
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 80,
            thresholdType: "PERCENTAGE",
          },
          subscribers,
        },
        {
          // Forecast, so it can arrive while there is still time to destroy
          // the stack rather than after the month's money is spent. AWS needs
          // several weeks of history before it forecasts at all, so this one
          // is silent early on and the 80% actual alert above is the only
          // cover during the project's first weeks.
          notification: {
            notificationType: "FORECASTED",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers,
        },
      ],
    });

    new CfnOutput(this, "BudgetLimit", {
      value: `${props.monthlyLimit} ${props.currency} per month, alerting ${props.alertEmail}`,
    });
  }
}
