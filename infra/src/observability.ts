import { Duration } from "aws-cdk-lib";
import type * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";

/**
 * Observability for the presentation deployment (#21, technical E5).
 *
 * Three things have to be visible, and they come from different places.
 *
 * *Operational failures and latency* come from the load balancer. It counts
 * every request, its status and its time, which is what SC-05 and SC-06 are
 * measured against, and it keeps counting when an instance is too busy to log.
 *
 * *Comparison outcomes* cannot come from the load balancer: a basket with no
 * feasible plan is a 200 like any other. They come from the application's own
 * event line (`apps/api/src/telemetry.ts`), turned into metrics here.
 *
 * *Capacity and resource pressure* come from the ASG, EC2 and RDS: instance
 * count for watching a scaling experiment, and CPU credits and database
 * connections for the two limits a burstable micro deployment actually hits.
 *
 * Alarms here have no notification action. The stack lives for a working
 * session with an engineer watching, and the one thing that must reach someone
 * who is not watching is money, which the budget in `guardrails-stack.ts`
 * handles. These alarms are on-screen state and evidence for #22.
 */

/** Application metrics are published under this namespace by the metric filters. */
const NAMESPACE = "CartOptix";

/** The SC-05 bound on end-to-end basket comparison. */
const COMPARISON_P99_TARGET = Duration.seconds(2);

export interface ObservabilityProps {
  /** Log group the API containers write to. */
  readonly logGroup: logs.ILogGroup;
  readonly loadBalancer: elbv2.IApplicationLoadBalancer;
  readonly targetGroup: elbv2.IApplicationTargetGroup;
  readonly autoScalingGroup: autoscaling.IAutoScalingGroup;
  readonly database: rds.IDatabaseInstance;
  /** Costed ceiling on application instances. */
  readonly maxInstances: number;
  /** `max_connections` pinned on the database parameter group. */
  readonly maxConnections: number;
  /** Connections one application instance can hold across all its pools. */
  readonly connectionsPerInstance: number;
}

export class Observability extends Construct {
  readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityProps) {
    super(scope, id);

    const comparisons = this.comparisonMetrics(props.logGroup);
    const clicksLost = this.lostClickMetric(props.logGroup);

    this.dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "CartOptix-Presentation",
      // The stack is created and destroyed per session; a fixed window keeps
      // the dashboard useful the moment it is opened.
      defaultInterval: Duration.hours(3),
    });

    this.dashboard.addWidgets(
      this.requestWidget(props),
      this.latencyWidget(props, comparisons.durationMs),
    );
    this.dashboard.addWidgets(
      this.outcomeWidget(comparisons, clicksLost),
      this.capacityWidget(props),
    );
    this.dashboard.addWidgets(this.creditWidget(props), this.databaseWidget(props));

    this.addAlarms(props, comparisons);
  }

  /**
   * Turns the application's comparison event into metrics.
   *
   * One filter per outcome rather than a dimension, because a metric filter
   * cannot read a dimension out of the log line; the field names match
   * `ComparisonEvent` in `apps/api/src/telemetry.ts`.
   */
  private comparisonMetrics(logGroup: logs.ILogGroup) {
    const isComparison = logs.FilterPattern.stringValue("$.event", "=", "comparison");

    const counter = (id: string, metricName: string, status: string) =>
      new logs.MetricFilter(this, id, {
        logGroup,
        filterPattern: logs.FilterPattern.all(
          isComparison,
          logs.FilterPattern.stringValue("$.status", "=", status),
        ),
        metricNamespace: NAMESPACE,
        metricName,
        metricValue: "1",
        // An absent metric is zero, so a quiet period reads as no comparisons
        // rather than a gap the p99 silently skips.
        defaultValue: 0,
      }).metric({ statistic: "Sum", period: Duration.minutes(1) });

    new logs.MetricFilter(this, "ComparisonDurationFilter", {
      logGroup,
      filterPattern: isComparison,
      metricNamespace: NAMESPACE,
      metricName: "ComparisonDurationMs",
      metricValue: "$.durationMs",
    });

    return {
      recommended: counter("RecommendedFilter", "ComparisonsRecommended", "recommended"),
      noFeasiblePlan: counter(
        "NoFeasiblePlanFilter",
        "ComparisonsNoFeasiblePlan",
        "no_feasible_plan",
      ),
      durationMs: new cloudwatch.Metric({
        namespace: NAMESPACE,
        metricName: "ComparisonDurationMs",
        statistic: "p99",
        period: Duration.minutes(1),
        label: "Comparison p99 (application)",
      }),
    };
  }

  /**
   * Counts click events that never reached storage.
   *
   * The endpoint answers 204 whatever happened (#41), so the load balancer
   * cannot distinguish a stored click from a lost one; this log line is the
   * only evidence, and #22 reports from it.
   */
  private lostClickMetric(logGroup: logs.ILogGroup): cloudwatch.Metric {
    new logs.MetricFilter(this, "LostClickFilter", {
      logGroup,
      filterPattern: logs.FilterPattern.literal('"Outbound click not recorded"'),
      metricNamespace: NAMESPACE,
      metricName: "OutboundClicksNotRecorded",
      metricValue: "1",
      defaultValue: 0,
    });

    return new cloudwatch.Metric({
      namespace: NAMESPACE,
      metricName: "OutboundClicksNotRecorded",
      statistic: "Sum",
      period: Duration.minutes(1),
      label: "Clicks not recorded",
    });
  }

  private requestWidget(props: ObservabilityProps): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: "Requests and failures (ALB)",
      width: 12,
      left: [props.loadBalancer.metrics.requestCount({ label: "Requests" })],
      right: [
        // 5xx from the application itself.
        props.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
          label: "Target 5xx",
        }),
        // 5xx the load balancer produced, for example no healthy target.
        props.loadBalancer.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
          label: "ALB 5xx",
        }),
      ],
    });
  }

  private latencyWidget(
    props: ObservabilityProps,
    comparisonP99: cloudwatch.IMetric,
  ): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: `Latency against the SC-05 bound (${COMPARISON_P99_TARGET.toSeconds()}s)`,
      width: 12,
      left: [
        props.targetGroup.metrics.targetResponseTime({ statistic: "p99", label: "ALB p99" }),
        props.targetGroup.metrics.targetResponseTime({ statistic: "p50", label: "ALB p50" }),
      ],
      // Seconds at the edge, milliseconds in the application: separate axes
      // rather than a shared one that would flatten both.
      right: [comparisonP99],
      leftAnnotations: [
        {
          value: COMPARISON_P99_TARGET.toSeconds(),
          label: "SC-05 p99",
          color: cloudwatch.Color.RED,
        },
      ],
    });
  }

  private outcomeWidget(
    comparisons: { recommended: cloudwatch.IMetric; noFeasiblePlan: cloudwatch.IMetric },
    clicksLost: cloudwatch.IMetric,
  ): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: "Comparison outcomes and lost clicks (application logs)",
      width: 12,
      stacked: true,
      left: [comparisons.recommended, comparisons.noFeasiblePlan],
      right: [clicksLost],
    });
  }

  /** Capacity over time: what a scaling or failure experiment in #22 is read from. */
  private capacityWidget(props: ObservabilityProps): cloudwatch.GraphWidget {
    const groupMetric = (metricName: string, label: string) =>
      new cloudwatch.Metric({
        namespace: "AWS/AutoScaling",
        metricName,
        dimensionsMap: { AutoScalingGroupName: props.autoScalingGroup.autoScalingGroupName },
        statistic: "Maximum",
        period: Duration.minutes(1),
        label,
      });

    return new cloudwatch.GraphWidget({
      title: `Capacity and target health (max ${props.maxInstances})`,
      width: 12,
      left: [
        groupMetric("GroupDesiredCapacity", "Desired"),
        groupMetric("GroupInServiceInstances", "In service"),
        props.targetGroup.metrics.healthyHostCount({ label: "Healthy targets" }),
        props.targetGroup.metrics.unhealthyHostCount({ label: "Unhealthy targets" }),
      ],
      leftAnnotations: [
        { value: props.maxInstances, label: "Costed maximum", color: cloudwatch.Color.ORANGE },
      ],
    });
  }

  /**
   * CPU credits on both burstable tiers.
   *
   * Instances run on standard credits, so exhaustion throttles rather than
   * billing a surplus; a throttled instance looks like latency, not an error,
   * which is exactly the confusion this widget exists to prevent.
   */
  private creditWidget(props: ObservabilityProps): cloudwatch.GraphWidget {
    return new cloudwatch.GraphWidget({
      title: "CPU and burst credits (t4g.micro)",
      width: 12,
      left: [
        new cloudwatch.Metric({
          namespace: "AWS/EC2",
          metricName: "CPUUtilization",
          dimensionsMap: { AutoScalingGroupName: props.autoScalingGroup.autoScalingGroupName },
          statistic: "Average",
          // Five minutes because the launch template does not enable detailed
          // monitoring: EC2 publishes at this granularity, and asking for one
          // minute would draw a line with four gaps in every five points.
          // Detailed monitoring would close them, at a cost the SGD 84 budget
          // does not need to carry for a widget read by eye.
          period: Duration.minutes(5),
          label: "App CPU %",
        }),
        props.database.metricCPUUtilization({ label: "Database CPU %" }),
      ],
      right: [
        new cloudwatch.Metric({
          namespace: "AWS/EC2",
          metricName: "CPUCreditBalance",
          dimensionsMap: { AutoScalingGroupName: props.autoScalingGroup.autoScalingGroupName },
          statistic: "Minimum",
          period: Duration.minutes(5),
          label: "App credit balance",
        }),
        props.database.metric("CPUCreditBalance", {
          statistic: "Minimum",
          period: Duration.minutes(5),
          label: "Database credit balance",
        }),
      ],
    });
  }

  /** Connections against the ceiling the maximum instance count can demand. */
  private databaseWidget(props: ObservabilityProps): cloudwatch.GraphWidget {
    const demand = props.maxInstances * props.connectionsPerInstance;

    return new cloudwatch.GraphWidget({
      title: `Database connections (${demand} at ${props.maxInstances} instances, limit ${props.maxConnections})`,
      width: 12,
      left: [props.database.metricDatabaseConnections({ label: "Connections" })],
      right: [props.database.metricFreeableMemory({ label: "Freeable memory" })],
      leftAnnotations: [
        { value: demand, label: "Demand at max instances", color: cloudwatch.Color.ORANGE },
        { value: props.maxConnections, label: "max_connections", color: cloudwatch.Color.RED },
      ],
    });
  }

  private addAlarms(
    props: ObservabilityProps,
    comparisons: { durationMs: cloudwatch.IMetric },
  ): void {
    new cloudwatch.Alarm(this, "TargetFailures", {
      alarmDescription: "The application returned 5xx responses (SC-06 operational failures).",
      metric: props.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, "ComparisonLatency", {
      alarmDescription: `Comparison p99 exceeded the SC-05 bound of ${COMPARISON_P99_TARGET.toSeconds()}s.`,
      metric: comparisons.durationMs,
      threshold: COMPARISON_P99_TARGET.toMilliseconds(),
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, "UnhealthyTargets", {
      alarmDescription: "An application instance is failing its load balancer health check.",
      metric: props.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Fires well before exhaustion: the point is to catch a connection leak
    // during a scaling experiment, not to report an outage after one.
    new cloudwatch.Alarm(this, "DatabaseConnections", {
      alarmDescription: `Connections exceeded twice the ${props.maxInstances}-instance demand; suspect a leak rather than load.`,
      metric: props.database.metricDatabaseConnections({ period: Duration.minutes(1) }),
      threshold: props.maxInstances * props.connectionsPerInstance * 2,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new cloudwatch.Alarm(this, "DatabaseCpuCredits", {
      alarmDescription: "The database is close to exhausting CPU credits; latency will degrade.",
      metric: props.database.metric("CPUCreditBalance", {
        statistic: "Minimum",
        period: Duration.minutes(5),
      }),
      threshold: 30,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
