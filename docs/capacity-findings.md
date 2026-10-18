# Capacity and resilience findings

Measured results from the presentation stack on 18 October 2026, for #21 and #22 (runs A–G). This
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

## Run E: surge, mixed, 20- and 50-line baskets (`14536c6`)

Two instances. `load_test/cartoptix-load.js` from #65 with `PROFILE=surge
BASKET_SIZE=both DURATION=15m` (basket requests alternate 20 and 50 lines).
05:41:29–05:56:30 UTC.

## Run F: run E plus outbound clicks (`14536c6`)

Identical to run E with `CLICK_RPM=60` added. 05:56:30–06:11:30 UTC.

| Series | Expected samples (E / F) | p95 E | p99 E | max E | p95 F | p99 F | max F |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Catalogue | 900 / 900 | 30.4 ms | 70.9 ms | 235 ms | 35.7 ms | 91.1 ms | 424 ms |
| Products search | 4,500 / 4,500 | 29.9 ms | 50.3 ms | 545 ms | 31.9 ms | 82.1 ms | 842 ms |
| Offers | 4,500 / 4,500 | 22.0 ms | 36.8 ms | 548 ms | 24.0 ms | 65.1 ms | 806 ms |
| Basket, all | 900 / 900 | 48.8 ms | 91.6 ms | 401 ms | 52.4 ms | 100.6 ms | 592 ms |
| Basket, 20-line | 450 / 450 | 33.6 ms | 79.5 ms | 166 ms | 31.0 ms | 81.0 ms | 101 ms |
| Basket, 50-line | 450 / 450 | 60.6 ms | 118.6 ms | 401 ms | 84.5 ms | 111.4 ms | 592 ms |
| Outbound click | – / 900 | – | – | – | 23.5 ms | 85.6 ms | 334 ms |

Expected samples are the configured rate × duration; k6's summary export does not
give a count per series.

| Measure | Run E | Run F |
| --- | --- | --- |
| Requests (k6) | 10,803 at 12.00 RPS | 11,705 at 13.00 RPS |
| Failed requests | 0 | 0 |
| ALB target 5xx / ELB 5xx | 0 / 0 | 0 / 0 |
| Clicks logged as not recorded | – | 0 |
| App CPU, group average (5 min) | 1.4–1.6% | 1.4–1.6% |
| RDS CPU (5 min) | 6.3% | 6.3–6.9% |
| RDS credit balance | rising, 80.4 → 81.5 | rising, 81.5 → 82.5 |

## Run G: stepped mixed load at three instances (`14536c6`)

Group pinned at three instances with `AlarmNotification` suspended. Same mixed
traffic as the calibration ramp (`calib.js`, 1:5:5:1, 20-line basket), 4 minutes per
step, 06:14:22–06:30:22 UTC. The third instance was launched at 06:11:40 and became
healthy in the ALB at 06:17, so the 7,200 RPM step ran on two instances for its
first 3 minutes.

| Offered RPM (RPS) | Requests | Failures | Dropped iterations | k6 p99, all | k6 p99 catalogue / products / offers / basket |
| ---: | ---: | ---: | ---: | ---: | --- |
| 7,200 (120) | 28,799 | 0 | 5 | 101 ms | 99 / 124 / 79 / 111 ms |
| 9,600 (160) | 38,402 | 0 | 2 | 73 ms | 61 / 85 / 64 / 79 ms |
| 12,000 (200) | 47,989 | 0 | 15 | 86 ms | 74 / 106 / 70 / 85 ms |
| 14,400 (240) | 57,553 | 0 | 51 | 154 ms | 175 / 180 / 128 / 162 ms |

- ALB target 5xx and ELB 5xx: 0 throughout. ALB p99 by minute: 0.03–0.14 s.
- k6 used at most 107 of its 400 allowed VUs.
- App CPU, group average (5 min): 8.7% (7,200) rising to 11.6% (14,400).
- App CPU credit balances (5 min): the two older instances flat at 31.1 → 31.0 and
  27.3 → 27.4 during the run; the new instance 0.0 → 0.2.
- RDS CPU (1-minute average) per step: about 24–25% at 7,200, 29–32% at 9,600,
  36–37% at 12,000 and 41–44% at 14,400 RPM. The `db.t4g.micro` CPU baseline is 10%.
- RDS CPU credit balance (5 min): 82.5 (06:15) → 80.7 (06:20) → 78.2 (06:25).
- Database connections (5-minute maximum): 10–13.
- One outbound click, not from k6 (run G sent none), was logged at 06:30:00 as
  `Outbound click not recorded: Connection terminated due to connection timeout`.

For comparison with the single-instance ramp: RDS CPU was 9% at 1,800 RPM and 11.8% at
2,400 RPM there, and its credit balance began falling between 2,400 and 3,600 RPM.

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

- Isolated-endpoint and normal-profile runs on AWS.
- Mixed load above 14,400 RPM, and how long the database sustains loads that drain
  its CPU credits.
- Database failure or failover.
- Runs longer than 25 minutes.
