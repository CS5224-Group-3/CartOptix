# CartOptix load harness

This harness uses k6's open-model `constant-arrival-rate` executor, so offered
traffic continues as latency rises instead of silently becoming a lower load.

From the repository root, after installing k6:

```powershell
k6 run load_test/cartoptix-load.js -e BASE_URL=https://example.cloudfront.net -e PROFILE=normal -e MODE=mixed -e BASKET_SIZE=20
k6 run load_test/cartoptix-load.js -e BASE_URL=https://example.cloudfront.net -e PROFILE=surge -e MODE=mixed -e BASKET_SIZE=50
```

For an isolated endpoint, set `MODE=isolated` and `TARGET` to `catalogue`,
`products`, `offers`, or `basket`. Set `DURATION` to choose the run length.

For scaling calibration, run the stepwise ramp against one endpoint. The
default is basket comparison at 60, 120, 180 and 240 requests per minute,
with two minutes per step:

```powershell
k6 run load_test/cartoptix-load.js -e BASE_URL=http://localhost:3001 -e MODE=ramp -e TARGET=basket -e BASKET_SIZE=20 -e RAMP_STEP_RPM=60 -e RAMP_STAGE_DURATION=2m
```

For the AWS calibration session, replace `BASE_URL` with the CloudFront URL
provided after deployment:

```powershell
k6 run load_test/cartoptix-load.js `
  -e BASE_URL=https://your-cloudfront-url `
  -e MODE=ramp `
  -e TARGET=basket `
  -e BASKET_SIZE=20 `
  -e RAMP_STEP_RPM=60 `
  -e RAMP_STAGE_DURATION=2m
```

Use `TARGET=catalogue`, `products`, `offers`, or `basket` as required. Record
the rate at which ALB p99 reaches 2 seconds or CPU credits begin falling, then
choose the configured target at about 70% of that measured rate. This ramp is
intended for the one-instance calibration deployment.

The script reports endpoint latency, HTTP failures, unexpected failures, and
separate basket duration trends for 20- and 50-line runs. Record the URL,
commit, seed, profile, mode, duration, sample counts, offered/achieved rates,
timeouts, and infrastructure metrics with each run. Local runs are rehearsal
only and do not satisfy the AWS acceptance criteria.
