# Capacity and resilience findings

Measured results from the presentation stack on 18 October 2026, for #21 and #22. This
document records observations only; assessment against the product contract is left
to the evaluation report.

## Test setup

| Item | Value |
| --- | --- |
| Stack | `CartOptixPresentation`: CloudFront → internal ALB → `t4g.micro` app instances (standard CPU credits, max 3) → one `db.t4g.micro` RDS PostgreSQL, Single-AZ |
| Releases | `d2bc862` for the calibration ramp and run A; `14536c6` (adds 120 s ALB slow start, scaling target 3300, 5xx logging) for runs B–D |
| Data | committed seed, `data/seed/seed.json` |
| Load generator | k6 on an engineer's laptop, through the CloudFront URL; open-model arrival rate |
| Mixed traffic | catalogue : products search : offers : basket comparison = 1 : 5 : 5 : 1, the ratio of the workload contract; 20-line basket of products listed at all three retailers |
| Measurements | k6 summaries (client side) and CloudWatch ALB, EC2, RDS and Auto Scaling data (server side) |

The workload contract's rates, for reference: normal 2.4 RPS (144 RPM), surge 12 RPS
(720 RPM).

## Single-instance ramp (release `d2bc862`)

One instance; alarm-driven scaling suspended for the ramp. Steps of 4 minutes each.
The instance had been running for about 12 hours and held 128–133 CPU credits.

| Offered RPM | Requests | k6 p99, all endpoints | k6 p99, basket | Failures |
| ---: | ---: | ---: | ---: | ---: |
| 120 | 484 | 70 ms | 90 ms | 0 |
| 300 | 1,204 | 73 ms | 70 ms | 0 |
| 600 | 2,402 | 168 ms | 178 ms | 0 |
| 900 | 3,603 | 46 ms | 41 ms | 0 |
| 1,200 | 4,804 | 51 ms | 55 ms | 0 |
| 1,800 | 7,203 | 46 ms | 59 ms | 0 |
| 2,400 | 9,604 | 47 ms | 62 ms | 0 |
| 3,600 | 14,403 | 48 ms | 53 ms | 0 |
| 4,800 | 19,203 | 61 ms | 57 ms | 0 |

- Instance CPU (5-minute average) rose with load to 9.8% at 4,800 RPM. The `t4g.micro`
  CPU baseline is 10%.
- The instance's CPU credit balance rose from 128.0 to 133.0 during the ramp and was
  flat (133.0 → 133.0) in the 4,800 RPM interval.
- RDS CPU (5-minute average) rose from 4% to 15.6%. The RDS credit balance began to
  fall in the interval covering 2,400–3,600 RPM (75.28 → 75.01).
- Database connections: 4.

The scaling target was set to 3,300 RPM per instance, about 70% of 4,800, following
`infra/RUNBOOK.md`.

## Instance launch credits

New app instances start with a CPU credit balance of 0 (standard credit mode has no
launch credits). The two instances checked (`i-0925686e307a16826`, run A, and
`i-0a38f5dd76b23ebe2`, run B) both reported 0 when they joined.

## Run A: 7,200 RPM for 25 minutes, from one credited instance (`d2bc862`, no slow start)

| Measure | Value |
| --- | --- |
| Requests | 179,865; 139 iterations dropped |
| Failures | 0.27% (483); all target 5xx, 202 at 01:41 and 281 at 01:48 UTC, the two minutes a new instance became healthy |
| k6 p99 | basket 1.36 s, all endpoints 1.43 s |
| ALB p99 by minute | 0.02–0.41 s, except 4.14 s (01:41) and 4.87 s (01:48) |

| Event (UTC) | Time |
| --- | --- |
| Load start | 01:33:16 |
| 1st instance launch → healthy | 01:33:54 → 01:41 |
| 2nd instance launch → healthy | 01:39:55 → 01:48 |
| Load end | 01:58:16 |
| Scale-in alarm (15 datapoints below target) | 02:15:33 |
| Instances terminated (3 → 1) | 02:15:46 to 02:17:49 |

The first launch came 38 s after load start, following the calibration ramp's high
datapoints.

At three instances: database connections peaked at 12. RDS CPU (5-minute average)
was 21–25%, and the RDS credit balance fell from 74.3 to 68.1 over the run.

## Run B: 7,200 RPM for 25 minutes, from one new instance (`14536c6`)

The redeploy had replaced the instance, so the run started on an instance with
0 CPU credits.

| Measure | Value |
| --- | --- |
| Requests | 179,776; 227 iterations dropped |
| Failures | 27.1%; target 5xx of about 4,000 a minute from 02:49 to 03:00, then 1,904 (03:01), 171 (03:02), 2 (03:03), 0 after |
| Logged cause | `Error: timeout exceeded when trying to connect` from the pg pool, on all four endpoints |
| Instance CPU | 9.7–9.8% (5-minute average) while serving alone |
| k6 p99 | basket 2.38 s, all endpoints 2.34 s |

Two instances launched at 02:53:58 and were healthy by 03:00 and 03:03.

## Run C: 4,000 RPM for 20 minutes, from one new instance (`14536c6`)

| Measure | Value |
| --- | --- |
| Requests | 80,003; 0 dropped |
| Failures | 0; target 5xx 0 |
| k6 p99 | basket 58 ms, all endpoints 52 ms |
| Scale-out | load start 03:15:51; launch 03:21:55; healthy 03:29 |
| ALB p99 in the minute the instance joined | 0.15 s |

A third instance launched at 03:31:01, while the second was still in its warm-up period.

## Run D: surge load with one instance terminated (`14536c6`)

`MIN_INSTANCES=2`. The workload-contract surge profile (1/5/5/1 RPS, mixed, 20-line
basket) for 15 minutes, using `load_test/cartoptix-load.js`. One instance was
terminated with `aws ec2 terminate-instances` at minute 4.

| Event (UTC) | Time |
| --- | --- |
| Load start, 2 healthy instances | 03:37:31 |
| Instance terminated | 03:41:31 |
| ASG takes it out of service (EC2 health check) | 03:42:03 |
| Replacement launched | 03:42:05 |
| Replacement healthy, 2 instances | about 03:49 |
| Load end | 03:52:31 |

| Measure | Value |
| --- | --- |
| Requests | 10,773 at 11.97 RPS achieved; 30 iterations dropped |
| Failures | 136 (1.26%): ELB 502 × 42 (03:41), ELB 504 × 51 (03:41) and × 43 (03:42). Target 5xx: 0 |
| k6 p99 | basket 82.8 ms, products search 156.9 ms, catalogue 10.01 s |
| k6 p95 | basket 31.1 ms, products search 30.6 ms, catalogue 25.9 ms |
| Maximum | 10.02 s on catalogue, products search and basket |

The offers endpoint's p99 was not captured: the script's summary reports p99 only for
endpoints with a threshold, and offers has none.

The technical specification measures one-instance termination separately from the
SC-05/SC-06 acceptance runs (section 7).

## Configuration relevant to these results

| Setting | Value |
| --- | --- |
| ALB health check | `/health/live`, 15 s interval, 2 healthy / 3 unhealthy |
| Deregistration delay | 30 s |
| Slow start | 120 s (from `14536c6`) |
| ASG health checks | EC2 and ELB, 15-minute grace period |
| Scaling policy | target tracking on ALB requests per target, 3,300 RPM |
| Instance warm-up | about 8 minutes from launch to healthy, observed |
| App DB pool | 4 connections per instance, 2 s connection timeout |

## Not measured

- Isolated-endpoint and normal-profile runs, and 50-line basket runs on AWS (#22, F2).
- Comparison latency under concurrent outbound-click load (#22, F2).
- Database failure or failover.
- Runs longer than 25 minutes.
