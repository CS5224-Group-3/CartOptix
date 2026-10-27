# Issue #88: presentation release access proposal

**Review draft, 27 October 2026. Not deployment-ready. No AWS changes authorised by this document.**

Baseline: `b19eb29749726772d0ed62cd9bfb928223b3c38e` (merged #87), branch `chore/issue-88-ci-release-access`. Maps to technical-spec **E3** (separate, narrowly trusted publisher and release access; migrations before rollout; existing-stack application releases), with E4 lifecycle separation, E1 budget and E6 teardown constraints. Product requirements do not change.

## Recommendation and approval gates

Create four dedicated roles: GitHub presentation release, CDK deployment, CDK file publishing, and CloudFormation application execution. Keep the existing ECR publisher, legacy deployment role, and engineer bootstrap roles intact. Add only `ecr:DescribeImages` on `cartoptix-api` to the publisher, including its boundary if necessary.

Reuse the existing bootstrap qualifier and bucket, but place presentation assets under a dedicated prefix shared by manual and CI presentation synthesis. Engineers perform the prefix migration and explicitly transition the existing stack's service role before enabling CI. Use the **exact current stack ARN, including its UUID**, for mutation permissions; refresh that binding after each engineer-controlled recreation. Do not grant CI stack creation or deletion.

This is a least-privilege proposal for the current mechanism, not proof that arbitrary credentials can only change a release SHA. SSM shell execution, launch-template edits and custom-resource invocation retain substantial power over this application's instances, data and website. If the requirement is strict property-level enforcement against a compromised main workflow, this design alone is insufficient: a separately trusted release broker or CloudFormation hook and a constrained migration document require a further design. Team acceptance of the residual powers below is an activation gate.

No live AWS APIs, change sets, migrations, deployments, or GitHub configuration reads/writes were used for this proposal. Account facts supplied in the request are accepted inputs, not independently verified observations. Public documentation and installed package source were inspected.

## Evidence and current behaviour

| Evidence | Finding |
| --- | --- |
| `.github/workflows/release.yml` | `workflow_run` after successful push CI on main; checks current main SHA; ARM64 immutable ECR publication; a separate deployment job uses `AWS_DEPLOY_ROLE_ARN`; deployment concurrency does not cancel the previous run. |
| `infra/scripts/deploy-release.sh` | Reads stack outputs, ASG capacity and scaling settings; rejects infrastructure-source changes; builds web assets; prepares, inspects, executes and deletes change sets. API and web are separate stages. Reads current and proposed templates. Checks both new and rollback API image tags. |
| `infra/scripts/run-migrations.sh` | Lists outstanding commands, selects a healthy ASG instance, sends `AWS-RunShellScript`, polls invocation output/status, cancels on deadline/interruption. Remote ECR login/pull uses the **instance role**, not GitHub credentials. |
| `infra/scripts/check_release_change_set.py` | API allows release-output and SHA-only user-data changes; web allows source-object keys and web-release output. Allows dynamic ASG, scaling-policy and dashboard changes driven by the launch template. Rejects parameters changing, including a resolved new AMI. This is an error guard, not IAM enforcement. |
| `infra/bin/presentation.ts` | Account `<ACCOUNT_ID>`, region `ap-southeast-1`, no explicit synthesizer; constructs both presentation and guardrails stacks. Synthesis uses fixed configuration, not account lookups. |
| `infra/src/presentation-stack.ts` | EC2 launch template and ASG rolling updates with resource signals; internal ALB; RDS; private web bucket and CloudFront. `BucketDeployment` uses a Lambda-backed custom resource. No ECS deployment. |
| `infra/scripts/deploy.sh`, `destroy.sh`, `RUNBOOK.md` | Engineer-controlled infrastructure lifecycle. Manual deployment currently uses the default synthesizer. Release tooling must target presentation exclusively. |
| `infra/package.json` and installed CDK CLI | Library 2.273.0; CLI 2.1145.0. File asset handler checks existence using `ListObjectsV2` with `Prefix=objectKey`, reads bucket location/encryption, then uploads. It does not need object deletion to publish. |

The supplied account facts establish these risks: default deploy role has broad CloudFormation access; default execution role has AdministratorAccess and is associated with the presentation stack; default file publisher can modify/delete shared assets; both existing GitHub roles share `cartoptix-role-boundary`. A boundary on one role does not constrain credentials obtained by assuming another role. Removing a repository variable does not establish that an organisation variable is absent.

The runbook records an **immutable GitHub subject**, not the older name-only form:

`repo:<OWNER>@<OWNER_ID>/<REPOSITORY>@<REPOSITORY_ID>:ref:refs/heads/main`

The example is redacted: substitute the **verified actual subject**, including immutable IDs, and audience `sts.amazonaws.com` before policy review. Do not allow both subject forms or a wildcard to make a failed assumption succeed. Branch trust does not distinguish different workflows running on main. Adding a GitHub environment later changes subject semantics and needs deliberate trust review. [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)

Account IDs, physical resource IDs, full live ARNs and token claims belong in an access-controlled administrator evidence record, not proposed GitHub issue comments. Examples and JSON fragments use configuration placeholders; `<ACCOUNT_ID>` is not a usable AWS account. Never publish a JWT, credentials, migration output containing secrets, or the private evidence bundle. The repository's existing deployment configuration is unchanged.

## Roles, trust and boundaries

```text
GitHub OIDC, exact main subject
  -> cartoptix-github-presentation-release (R)
       -> cartoptix-presentation-cdk-deploy (D)
            -- PassRole --> cartoptix-presentation-cfn-exec (X)
                              <- assumed by CloudFormation
       -> cartoptix-presentation-file-publish (F)

X -> update existing launch template / ASG
  -> invoke existing web deployment Lambda
       -> existing provider role -> read staged web zip, sync web bucket, invalidate CloudFront

SSM command on approved API instance -> existing EC2 role -> ECR / app database credentials
Engineer -> existing manual roles, separately, while CI is disabled for infrastructure changes
```

R's identity policy and boundary allow assumption of **only D and F**. D/F trust only R's exact IAM role ARN; no account-root trust, OIDC trust or bootstrap role wildcard. X trusts only `cloudformation.amazonaws.com`; R/D/F cannot assume X. D may pass only X, with `iam:PassedToService=cloudformation.amazonaws.com`. X may need to pass only the existing API instance role, with `iam:PassedToService=ec2.amazonaws.com`, for ASG launch authorisation. Do not add SourceArn/SourceAccount to the CloudFormation trust without confirming the service supplies them on this path; an unsupported condition would prevent every deployment.

Propose separate administrator-owned boundaries for R, D, F and X, matching the corresponding approved action/resource ceilings below. None grants permissions by itself; every identity policy must also allow its operations. No CI role may edit IAM policies, trust, boundaries, tags used for authorisation, bucket policies, KMS policies or service-linked roles. R/D/F/X get `Project=cartoptix` tags. X does not assume downstream roles; the existing provider/instance roles have their own policies and must be reviewed as part of effective-access verification.

Do not broaden `cartoptix-role-boundary` to accommodate deployment. It is shared with the working publisher and legacy role. If account governance mandates it on new roles, review its complete document first and resolve any conflict with per-role ceilings; do not silently replace it. For the existing publisher, add the repository-scoped DescribeImages permission to that boundary only if absent, documenting that this also raises the ceiling for other attached roles (without granting it through their identity policies).

CDK may supply session tags in its role-assumption options. Inspect the generated assembly and pinned CLI path; grant `sts:TagSession` only on the same D/F ARNs and in their trusts if actually required, or explicitly configure empty additional options. Do not permit caller-controlled authorisation tags. Role-chained sessions are limited to one hour; retain the current 45-minute deployment-job ceiling and test credential renewal. [IAM role chaining](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_terms-and-concepts.html)

## Permission matrix

**Evidence labels:** **S** = call verified in repository/installed source; **D** = documented service requirement; **T** = exact runtime/provider call set still requires a controlled test. None is live-authorisation verified. T rows are investigation candidates, not permission grants to add pre-emptively.

Resource aliases below must be resolved by an engineer after review. No placeholder ARN is deployment-ready.

| Alias | Binding |
| --- | --- |
| STACK | `arn:aws:cloudformation:ap-southeast-1:<ACCOUNT_ID>:stack/CartOptixPresentation/<current-stack-uuid>`; read-only absence check may use `stack/CartOptixPresentation/*` |
| ASG / LT | Exact current ASG ARN and `arn:aws:ec2:ap-southeast-1:<ACCOUNT_ID>:launch-template/<id>` |
| BOOT | Expected `cdk-hnb659fds-assets-<ACCOUNT_ID>-ap-southeast-1`; confirm actual bucket and qualifier before binding |
| PREFIX | `cartoptix/presentation/` (no writes to bootstrap root or other projects) |
| VERSION | `arn:aws:ssm:ap-southeast-1:<ACCOUNT_ID>:parameter/cdk-bootstrap/hnb659fds/version` |
| AMI_PARAMETER | `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64`, verified in the local template; not all `/aws/service/*` |
| API_REPO | `arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/cartoptix-api` |
| WEB / DIST / PROVIDER | Exact web bucket, CloudFront distribution and existing BucketDeployment function ARNs |
| KEY | Actual key ARN backing `alias/aws/s3`; aliases are not substitutes for key ARNs in cryptographic-action resources |

### R: workflow and migration orchestration

| Actions | Resource scope / restriction supported? | Why / evidence |
| --- | --- | --- |
| `sts:AssumeRole` | Yes: exact D and F ARNs | CDK execution and asset publishing; S/D. No lookup, image publishing, manual or default bootstrap roles. |
| `cloudformation:DescribeStacks` | Yes: STACK; presentation-name wildcard only for absent-stack read | Read outputs/status; S. No `ListStacks`. |
| `cloudformation:GetTemplate`, `cloudformation:DescribeChangeSet` | Yes: STACK | Read current/proposed template and guard input; S. CloudFormation authorises these against stack resources, not invented change-set resource ARNs. |
| `cloudformation:DeleteChangeSet` | Yes: STACK, plus `cloudformation:ChangeSetName` matching `cartoptix-*-api` / `cartoptix-*-web` | Script cleanup; S. Names narrow namespace, not cryptographic ownership. |
| `autoscaling:DescribeAutoScalingGroups`, `autoscaling:DescribePolicies` | No: `Resource: "*"`, regional request condition | Preserve capacity/scaling settings; migration target selection; S/D. CLI group filters do not narrow IAM. |
| `ecr:DescribeImages` | Yes: API_REPO | New and rollback-image existence checks; S. No push/pull permissions on runner. |
| `ssm:SendCommand` | Yes: separate unconditional document statement for `arn:aws:ssm:ap-southeast-1::document/AWS-RunShellScript`; instance statement on account/region `instance/*` with `ssm:resourceTag/Project=cartoptix` AND verified stack/ASG-specific tag | Commands on replacing API instances; S/D. Project alone can also select legacy project instances. Verify propagated tags; otherwise an engineer must maintain exact eligible instance ARNs or add a dedicated tag before activation. Do not put instance-tag conditions on AWS's untagged document. |
| `ssm:GetCommandInvocation`, `ssm:ListCommands`, `ssm:CancelCommand` | **No resource-level restriction:** `*`, `aws:RequestedRegion=ap-southeast-1` | Output/polling, duplicate-run guard, timeout/interrupt cleanup; S/D. No command ARN or comment/tag restriction is supported. This exposes regional command output/listing and cancellation beyond this application's commands. |
| `ssm:GetParameter` | Yes: VERSION | Bootstrap compatibility reads if performed before role assumption; S/D, verify which credential provider reads it. |

SSM shell access is effectively administrator access **on the target instance**, including its instance-profile credentials and database environment file. IAM cannot constrain the `commands` parameter to the script in Git. No `StartSession`, seed-import permission or direct secret read is proposed for R, but shell access can achieve equivalent application-level effects. The regional cancellation exposure cannot be fixed with a fake command-resource ARN. Accept explicitly or redesign migration dispatch. [SSM action/resource table](https://docs.amazonaws.cn/en_us/service-authorization/latest/reference/list_awssystemsmanager.html)

### D: CDK control plane

| Actions | Resource scope / restriction supported? | Why / evidence |
| --- | --- | --- |
| `cloudformation:DescribeStacks`, `DescribeStackEvents`, `GetTemplate`, `DescribeChangeSet`, `DeleteChangeSet` (all with `cloudformation:` prefix) | Yes: STACK; name condition on cleanup where supported | CDK change-set preparation, execution monitoring and no-op cleanup; S/D. |
| `cloudformation:CreateChangeSet` | Yes: exact STACK; required `ArnEquals cloudformation:RoleArn=X`, **not IfExists**; approved change-set-name patterns | Prepare only against the current stack incarnation; S/D. Omitted or alternate execution role must fail. |
| `cloudformation:ExecuteChangeSet` | Yes: STACK + approved name patterns | Execute prepared release; S/D. **RoleArn is not an available condition for this action.** See service-role transition and stale change-set controls. |
| `iam:PassRole` | Yes: X only; passed-to CloudFormation | Attach intended service role; D. No pass of default administrator role. |
| `ssm:GetParameter` | Yes: VERSION | Bootstrap version check; S/D. |
| `s3:GetObject` | Yes: BOOT/PREFIX objects, narrower template-key scope if manifest supports it | Template access using CDK deployment credentials; D/T. No upload/delete. |
| `kms:Decrypt` | Yes: KEY; S3 ViaService + caller account, encryption-context restriction after bucket-key inspection | SSE-KMS template read; D/T. |
| `cloudformation:GetTemplateSummary`, `DescribeStackResources`, `ListStackResources`, `ListChangeSets` (each prefixed) | Stack scoping supported when stack specified; standalone template summary may need `*` | T: inspect pinned CLI call path; add individually only if observed, with justification. No blanket read wildcard. |
| `cloudformation:ValidateTemplate` | No resource restriction | T: not called by the repository scripts; do not grant unless pinned CLI requires it. |

No CreateStack, UpdateStack, DeleteStack, SetStackPolicy, UpdateTerminationProtection, RollbackStack or ContinueUpdateRollback to CI. An exact stack ARN prevents a CREATE change set for a new stack UUID; simply denying CreateStack while allowing CreateChangeSet on `stack/CartOptixPresentation/*` is insufficient. Test this explicitly. [CloudFormation authorisation table](https://docs.amazonaws.cn/en_us/service-authorization/latest/reference/list_awscloudformation.html)

### CloudFormation authorisation verification record

Rechecked against AWS's Service Authorization Reference on 27 October 2026 (the AWS China documentation mirror was readable; the corresponding global reference URL redirected to its index). These are documented action/resource/condition mappings, **not successful authorisation tests**. The matrix's S/D labels must not be read as live validation.

| Action(s), all `cloudformation:` | Documented resource | Conditions used by this proposal |
| --- | --- | --- |
| `CreateChangeSet` | `stack` required | `cloudformation:RoleArn` and `cloudformation:ChangeSetName` supported. Use `ArnEquals` on X and `StringLike` on reserved names in the same Allow. Both must be present; no `IfExists`. |
| `ExecuteChangeSet`, `DeleteChangeSet`, `DescribeChangeSet` | `stack` required | `cloudformation:ChangeSetName` supported; **RoleArn is not listed**. Keep these statements separate from creation. |
| `GetTemplate`, `DescribeStackEvents`, `DescribeStackResources`, `ListStackResources`, `ListChangeSets` | `stack` required | Neither proposed RoleArn nor ChangeSetName filter applies. Use exact STACK. GetTemplate for a change set still uses stack authorisation. |
| `DescribeStacks` | `stack` optional | Always supply StackName. A no-name account listing is a different request; do not solve it by adding ListStacks or global read access. Validate absent-stack name resolution separately. |
| `GetTemplateSummary` | optional `stack` / `stackset` | Stack-scoped request can use STACK; standalone template requests need separate review. Not granted until CLI use is established. |
| `ValidateTemplate` | no resource type | Requires `*` if needed; not currently proposed as an unconditional grant. |
| `UpdateStack`, `DeleteStack`, `ContinueUpdateRollback` | `stack` required | RoleArn supported; administrator operations only, never added to D. |

Use `ArnEquals` for the ARN-valued RoleArn key. A `changeset` resource type exists for other actions, but its existence does not make it the authorisation resource for ExecuteChangeSet. There is no documented `cloudformation:ChangeSetType` key to enforce UPDATE-only. ResourceTypes cannot express “only these properties changed” and concerns the submitted template, which includes unchanged infrastructure; do not add it as a misleading application-only guarantee. [AWS action and resource table](https://docs.amazonaws.cn/en_us/service-authorization/latest/reference/list_awscloudformation.html)

Required live tests remain: exact UUID enforcement when calling by stack name; denial of CREATE for an absent/new stack; missing/wrong RoleArn rejection; CDK's use of change-set **names versus ARNs** and the resulting ChangeSetName condition value; paginated template/description reads; no-op cleanup; and execute-time denial outside the reserved names. If the CLI uses a change-set ARN, inspect the actual condition context before proposing an exact-account/region ARN pattern; do not widen to `*` or assume a name pattern matches it. [ExecuteChangeSet request forms](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)

### F: staged asset publishing

| Actions | Resource scope / restriction supported? | Why / evidence |
| --- | --- | --- |
| `s3:GetBucketLocation` | Yes: BOOT bucket ARN | CDK ownership/access check; S. |
| `s3:GetEncryptionConfiguration` | Yes: BOOT bucket ARN | SDK `GetBucketEncryption` maps to this IAM action; S. |
| `s3:ListBucket` | Yes: BOOT, `StringLike s3:prefix=cartoptix/presentation/*` | `ListObjectsV2(Prefix=objectKey)` existence checks; S. Do not grant unprefixed list. |
| `s3:PutObject` | Yes: BOOT/PREFIX/* | Upload web archive, template and support assets in manifest; S. Includes multipart create/upload/complete permission mapping. |
| `s3:AbortMultipartUpload` | Yes: BOOT/PREFIX/* | Upload-library failed multipart cleanup; T. Test a large asset and failed upload before granting. |
| `kms:GenerateDataKey`, `kms:Decrypt` | Yes: KEY; `kms:ViaService=s3.ap-southeast-1.amazonaws.com`, `kms:CallerAccount=<ACCOUNT_ID>` | SSE-KMS write and multipart encryption; D/T. Boundary must permit needed cryptographic actions even where aws/s3 key policy provides access. |

No `s3:DeleteObject`, `DeleteObjectVersion`, bucket-policy/configuration writes, `PutObjectAcl`, or shared-root write. Installed file publishing uses listing, not GetObject; do not copy bootstrap's broad read/delete policy. No ListBucketMultipartUploads/ListMultipartUploadParts grant without evidence that the actual upload library calls them. Restrict F's boundary to this same scope.

The prefix does not provide immutability: PutObject can overwrite an earlier asset at an allowed key. This can affect presentation rollbacks and provider code if an engineer later consumes overwritten assets. Treat the presentation prefix as trusted release material, keep other stacks out of it, and retain independent known-good release artifacts. Object-lock/per-release write-once storage would require a separate workflow/storage design.

AWS-managed `aws/s3` is compatible with same-account use; do not try to edit its key policy or create a new KMS key merely to enable this release. Inspect whether S3 Bucket Keys are enabled: encryption context may be the bucket ARN rather than object ARN, so a prefix-only KMS context condition can fail. S3 permissions remain the prefix isolation even when KMS context is bucket-wide. Test R/D/F/X/provider effective policies, bucket policy, boundaries, SCPs and key policy together. [S3 SSE-KMS permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingKMSEncryption.html)

### X: CloudFormation application execution

No complete X JSON is supplied: the CloudFormation resource-provider and rolling-update call set has not been live-tested. A resource's schema can establish an upper bound but does not prove every listed permission is exercised by this update. Do not add whole-service policies to compensate for that uncertainty.

| Actions | Resource scope / restriction supported? | Why / evidence |
| --- | --- | --- |
| `ec2:CreateLaunchTemplateVersion` | Yes: LT | New API user-data version; S/D. |
| `ec2:DescribeLaunchTemplates`, `ec2:DescribeLaunchTemplateVersions` | No: `*`, region-limited | Provider read/stabilisation; D/T. |
| `ec2:DeleteLaunchTemplateVersions`, `ec2:ModifyLaunchTemplate` | Yes: LT | T: rollback/version cleanup or default-version update; grant only if provider trace requires. No CreateLaunchTemplate/DeleteLaunchTemplate. |
| `autoscaling:UpdateAutoScalingGroup` | Yes: ASG; test numeric-version condition and existing capacity constraints | Point ASG at new version; S/D. Explicit numeric version, never `$Latest`/`$Default`. |
| `autoscaling:DescribeAutoScalingGroups`, `DescribeScalingActivities`, `DescribeAutoScalingInstances`, `DescribePolicies` (all prefixed) | No: `*`, region-limited | T: read/stabilise group rolling update and rollback; first/last also source-verified for R. |
| `autoscaling:SuspendProcesses`, `ResumeProcesses`, `SetDesiredCapacity`, `TerminateInstanceInAutoScalingGroup` (all prefixed) | Yes: ASG | T: CloudFormation rolling-update engine, including failed rollout restoration. These are not ECS tasks or an explicit instance-refresh script. Validate exact subset and transient capacity before granting. |
| `ec2:RunInstances` | Supports multiple resource types: exact LT, approved resolved AMI, existing subnet(s)/SG; account/region instance, volume and network-interface creation patterns | D/T: Auto Scaling launch-template authorisation checks may require this on X despite launches being performed by its service-linked role. Validate numeric-version path. No blanket `Resource:*`; test type/IMDSv2, subnet and launch-template conditions. |
| `iam:PassRole` | Yes: existing API instance role only; `iam:PassedToService=ec2.amazonaws.com` | D/T: companion launch authorisation, never instance-profile ARN or arbitrary IAM role. |
| `ec2:CreateTags` | Yes: new instance/volume resource patterns, `ec2:CreateAction=RunInstances`; approved tag keys/values | T: only if launch authorisation checks require it. No retagging existing unrelated resources; multi-value conditions need Null guards. |
| `ec2:DescribeInstances`, `DescribeImages`, `DescribeSubnets`, `DescribeSecurityGroups` (all prefixed) | No: `*`, region-limited | T: provider/launch validation reads; determine subset from trace. |
| `ssm:GetParameters` | Yes: exact AMI_PARAMETER and VERSION if CloudFormation resolves it | D/T: template SSM parameters. Public-parameter ARN has AWS ownership syntax; bind from actual parameter, do not guess account-owned ARN. |
| `autoscaling:PutScalingPolicy` | Yes: ASG authorisation resource | T: guard permits dynamic policy update driven by group reference; does not prove a write occurs. No DeletePolicy by default. |
| `cloudwatch:GetDashboard`, `cloudwatch:PutDashboard` | Yes: exact dashboard ARN (`arn:aws:cloudwatch::<ACCOUNT_ID>:dashboard/<name>`) | T: dynamic reference update permitted by guard. No DeleteDashboards/PutMetricAlarm without a separately justified provider need. |
| `lambda:InvokeFunction` | Yes: existing PROVIDER function, exact qualifier if ServiceToken uses one | D/T: CloudFormation delivers custom-resource update/rollback. No UpdateFunctionCode/Configuration, CreateFunction, layer publishing or provider-role edits. |
| `s3:GetObject`, `kms:Decrypt` | Yes: approved staged template/source objects and KEY, S3 conditions as above | D/T: template retrieval when execution-role credentials are used. Identify actual calling principal; avoid duplicate speculative grants. |

Auto Scaling's existing service-linked role launches/replaces instances; do not recreate or change it. CloudFormation needs its own permissions for update-time validation and orchestration, so assuming the service-linked role makes all X EC2 permissions unnecessary is unsafe. [Launch-template authorisation](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-launch-template-permissions.html)

IAM resource scoping limits which LT/ASG X can change, not every field or application code executed. Enforce supported capacity and launch conditions where provider requests allow, and record the remaining gap. `minInstancesInService=1`, `maxBatchSize=1` can cause temporary replacement capacity above the baseline; preserve the stack's max-three budget intent and verify the rolling-update behaviour before imposing a bound that prevents recovery.

No X permissions for RDS changes, VPC/SG changes, ALB changes, CloudFront distribution changes, IAM policy updates, ECR writes, bootstrap updates, guardrails changes, or creation/deletion of the presentation stack are justified by an application release. No secret read is needed merely because the unchanged template contains a database secret. If a provider requires an unexpected read, record that exact denied call before amending the proposal.

### Existing web provider and instance role (separate from X)

| Actions | Resource scope / restriction supported? | Responsibility |
| --- | --- | --- |
| `s3:GetObject`, `s3:ListBucket` | Yes: staged web source objects; prefix-limited bucket list | BucketDeployment Lambda reads/extracts web archive. Engineer transition must update its source grant for PREFIX. |
| `kms:Decrypt` | Yes: KEY with S3 conditions | Provider must read SSE-KMS archive. Verify effective access with its existing boundary, if any. |
| `s3:ListBucket`, `GetBucketLocation` | Yes: WEB bucket | Provider synchronises destination. |
| `s3:GetObject`, `PutObject`, `DeleteObject` | Yes: WEB objects | Provider sync/pruning and rollback; DeleteObject is justified **here**, not for F on shared bootstrap assets. |
| `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` | Yes: DIST | Provider invalidates/waits after web publication. |
| `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` | Scoped log-group/log-stream patterns appropriate to each action | Existing provider logging; inspect generated policy before narrowing. |
| Existing ECR pull/token, Secrets Manager read, CloudWatch log write and SSM-agent permissions | Repository/secret/log resources where supported; token/agent calls may need `*` | Existing EC2 role performs these operations. No duplication onto R/D/F/X. |

Local synthesis confirmed that the generated provider policy is broader than this table: source reads cover the **whole bootstrap bucket**, destination grants include object retention/tagging actions, and `cloudfront:GetInvalidation`/`CreateInvalidation` use `Resource: "*"`. This is a concrete activation blocker, not merely a hypothetical inspection item. Its runtime executes with its own role, not X's boundary. A crafted custom-resource event could otherwise copy another project's staged object into the web bucket or invalidate an unrelated distribution.

Use the concrete boundary mechanism below, not a post-deployment manual attachment or a narrower Allow alongside the generated grants. Merely setting `bucketPrefix` does **not** narrow the generated bucket-wide grant. This provider-role change is justified because X can invoke the provider and otherwise escapes the intended resource boundary; it does not alter engineer deployment roles or the ECR publisher. X must not invoke auto-delete providers or arbitrary functions. [CDK BucketDeployment operation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment-readme.html)

### Durable BucketDeployment provider restriction

**Chosen design:** retain the generated provider role and existing construct IDs; add a customer-managed permissions boundary in PresentationStack, administered only through the engineer infrastructure deployment. Use a stable construct ID such as `WebDeploymentBoundary`, without a fixed physical policy name. Its resource references resolve to this stack's WEB and DIST on creation and replacement. R/D/F/X receive no IAM mutation rights, so they cannot change this ceiling even though its declaration lives in the application repository. The existing release guard rejects its template changes. An authorised engineer remains trusted to review infrastructure changes; this is not protection against that administrator.

In the future implementation, retain the BucketDeployment object, resolve `deployment.handlerRole.node.defaultChild`, require it to be an `iam.CfnRole`, then set its `permissionsBoundary` to the managed policy ARN. Fail synthesis if the role is imported, missing or structurally different; do not silently skip attachment. This explicit L1 property preserves the present generated role's logical ID and records the boundary in CloudFormation. Alternatively introducing a new `role` prop is **not** this proposal's default: it can change the provider/role identity and needs a separately reviewed migration. The pinned CDK exposes `handlerRole`; its API also supports `logGroup`. [BucketDeployment API](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_s3_deployment.BucketDeployment.html)

Create a dedicated log group in the same engineer change and pass it through `BucketDeployment.logGroup`, with the project's short retention and DESTROY policy. The boundary permits `logs:CreateLogStream` and `logs:PutLogEvents` only on that group's streams. Precreating it avoids CreateLogGroup and avoids a dependency cycle from referring to the provider function name in the role's boundary. The boundary references bucket/distribution/log-group resources, never the function or role it constrains. Confirm the resulting graph has no cycle before deployment. This is one additional bounded log-group resource, not another monitoring service.

Boundary Allow statements contain only:

- `s3:GetObject` on BOOT/PREFIX/*; `s3:ListBucket` on BOOT with `s3:prefix=PREFIX*`; `s3:GetBucketLocation` on BOOT if needed by the provider path.
- `s3:ListBucket` and `s3:GetBucketLocation` on WEB, and `s3:GetObject`, `PutObject`, `DeleteObject` on WEB/*; source-bucket deletes and writes remain denied. Add `s3:AbortMultipartUpload` on WEB/* only if the provider's tested upload path needs cleanup. Do not include retention/legal-hold, ACL, bucket configuration or other generated wildcard actions.
- `cloudfront:CreateInvalidation` and `GetInvalidation` on DIST only.
- `kms:Decrypt` on KEY with the verified S3 ViaService/caller/encryption-context constraints, plus the scoped log actions above. Add the corresponding identity Allow if absent; a boundary never grants KMS access by itself.

The generated identity policy may remain broader, but effective identity permissions are its intersection with this ceiling. Review resource policies for direct grants to role sessions that can bypass an **implicit** boundary deny; do not accept such grants on source/destination/KMS resources. If they exist, remove them through a reviewed administrator change or design explicit denies before activation. Do not claim the boundary by itself constrains all resource-based grants. [IAM boundary evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)

Required synthesis assertions follow the custom resource's ServiceToken to the actual function, then its Role to the IAM resource, rather than matching a historical generated name. They assert that role's PermissionsBoundary is this managed policy, its effective allowlist resources reference only BOOT/PREFIX, WEB, DIST, KEY and the log group, and no other BucketDeployment shares the role with incompatible destinations. Fail on unresolved/unexpected provider topology. Re-run for every CDK/lockfile change and simulate changed function/role logical IDs in tests: a replacement must carry the boundary **at creation**, not acquire it later. Creation/replacement and policy document changes require the manual role; X cannot perform them. On rollback, inspect whether the old template lacks the boundary: if so, leave CI disabled and remigrate before handback. Recreated stacks resolve their new WEB/DIST/log IDs into the same policy design automatically; external X invocation permissions still require rebinding.

Transition detail: old web archives may be at bootstrap root. Before tightening, either stage the known-good archive under PREFIX and use it as the migration rollback source, or approve a temporary **exact old-object GetObject** allowance (plus only its required listing prefix) in the boundary. Never temporarily allow BOOT/*. Remove that exception after the new baseline and rollback test pass. If an upgrade needs new actions, deny and review the exact need; never widen the ceiling automatically to generated policy contents.

## CDK integration proposal (no code change in this review)

Add an explicit validated mode such as `-c releaseAccess=restricted` in `infra/bin/presentation.ts`; default remains the engineer mode, and `CI=true` must fail unless restricted mode was explicitly selected. Pass a synthesizer to **PresentationStack only**. The future release script supplies the mode to both prepare and execute invocations; nothing modifies GuardrailsStack.

Illustrative configuration, not applied:

```ts
new DefaultStackSynthesizer({
  qualifier: "hnb659fds",
  fileAssetsBucketName: "cdk-hnb659fds-assets-<ACCOUNT_ID>-ap-southeast-1",
  bucketPrefix: "cartoptix/presentation/",
  bootstrapStackVersionSsmParameter: "/cdk-bootstrap/hnb659fds/version",
  deployRoleArn: "arn:aws:iam::<ACCOUNT_ID>:role/cartoptix-presentation-cdk-deploy",
  fileAssetPublishingRoleArn: "arn:aws:iam::<ACCOUNT_ID>:role/cartoptix-presentation-file-publish",
  cloudFormationExecutionRole: "arn:aws:iam::<ACCOUNT_ID>:role/cartoptix-presentation-cfn-exec",
  useLookupRoleForStackOperations: false,
});
```

In engineer mode use the **same bucket/qualifier/prefix**, retaining the existing manual deploy/file-publishing/execution role selection. Otherwise every mode switch changes asset locations and provider policies, and the release guard correctly rejects it. Add no account lookups. Preserve bootstrap version validation. Current ECR image uses `fromRepositoryName` and is published outside CDK; assert the assembly has no Docker image assets. Unused synthesizer defaults may still mention bootstrap image/lookup roles: grant no assumption permission to them and fail if a manifest starts requiring them. Test fallback behaviour when assuming D/F fails: R must lack mutation/upload permissions so CDK cannot silently succeed using R credentials.

Inspect both templates and asset/stack manifests offline: expect role metadata changes, prefixed template/web/provider assets and associated source IAM grants during the **engineer migration only**. The prefix migration may change provider Lambda code locations/layer references as well as web source keys. After migration, synthesize the same releases in both modes and require identical resource templates; role choices belong in assembly deployment metadata. Future provider-code changes belong to manual infrastructure updates, never a broadened X policy. [Synthesizer properties](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.DefaultStackSynthesizerProps.html), [pinned synthesizer source](https://raw.githubusercontent.com/aws/aws-cdk/v2.273.0/packages/aws-cdk-lib/core/lib/stack-synthesizers/default-synthesizer.ts)

Reusing the qualifier alone provides no privilege isolation. The explicit role ARNs, prefix restrictions and boundaries provide it. Reuse is conditional on the bucket policy permitting these same-account principals and not granting them wider access. Existing engineer roles can still write the shared bucket; they remain trusted administrators. A separate bucket is the fallback if ownership/policy constraints prevent prefix isolation; a new qualifier/bootstrap stack is not the default solution and must not provision another administrator execution role for CI.

## One-time setup and controlled service-role transition

These are future steps after team approval, not commands to execute during this proposal.

The administrator procedure below is the required operational detail for these steps. Its stop gates take precedence over an abbreviated checklist; no failed or skipped gate permits activation.

1. **Disable deployment effectively.** Confirm repository, organisation and any environment variable scopes. Verify no inherited `AWS_DEPLOY_ROLE_ARN` activates the job. Stop/drain existing releases and SSM migrations. Variable removal alone does not revoke running STS sessions; use administrator-controlled trust/permission blocking and wait for session expiry where necessary. Keep the ECR publisher working.
2. **Capture evidence.** Record current stack ARN, RoleARN, template, parameters including resolved AMI, outputs and resource IDs; role policies/boundaries/trust; bootstrap version, bucket encryption/policy and key ARN; instance tags and service-linked role; provider function/role; effective organisation policies. Do not export secrets. Resolve placeholders and identify previous API/web assets needed for rollback.
3. **Provision dedicated IAM through an engineer-owned mechanism.** Create the four tagged roles and per-role ceilings outside the application stack, with R initially disabled. Authorise only the matrix's verified subset plus reviewed test-proven provider operations. Apply the ECR DescribeImages delta separately after checking the existing boundary. Do not run `cdk bootstrap` or edit manual-role permissions.
4. **Migrate asset prefix using the existing engineer path.** Review an infrastructure change set for the new synthesizer configuration, source grants and any provider/layer asset paths. Keep release values and capacity unchanged. Use the existing manual execution role for this operation; restricted X deliberately cannot update provider code or IAM grants. Retain old assets until rollback is proven. This is an explicit infrastructure deployment, not an application-release guard exception.
5. **Transition the stack's associated service role explicitly.** An authorised engineer passes X in a controlled stack update or change set and verifies the resulting stack `RoleARN`. Creating X or changing synthesizer metadata does not re-associate a live stack. Do not rely on an empty CDK change set: CDK may discard it. Test whether an explicit role-only UpdateStack is accepted; if it reports no updates, review a harmless output-only change with X specified, then execute it and confirm association. No application or resource change should be smuggled into this step. [CloudFormation service-role semantics](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html)
6. **Remove stale executable change sets** under the reserved CI name patterns, especially any prepared with the administrator role. Record existing manual sets and remove or isolate them before CI activation. CreateChangeSet can require X, but ExecuteChangeSet cannot use a RoleArn condition. A name prefix alone cannot prevent an engineer from accidentally creating a privileged set in that namespace. Reserve it exclusively for restricted releases.
7. **Bind exact current resource IDs, verify effective permissions, then test.** Enable R only for the controlled validation window. Keep GitHub deployment unset until the verification gates below pass. After re-association, exercise API/web update and rollback, not just prepare-only runs.

CloudFormation persists a supplied role for future operations and permits stack operators to use the associated role without a fresh PassRole check. The omission path is therefore a privilege-escalation risk while the administrator role remains associated. Require RoleArn=X at creation, but also verify the real association and outstanding change sets; do not claim PassRole restriction alone solves it. [CreateChangeSet RoleARN](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)

### Administrator transition runbook

**Owners:** an account administrator operates IAM and service-role association; an infrastructure engineer prepares the reviewed template and records results; a second reviewer signs the handback record. Neither the GitHub role nor a workflow performs this procedure. Use independently authenticated engineer credentials and record their principal. Do not edit the shared administrator execution role's policy; explicitly selecting it for a controlled manual update preserves the existing engineer workflow.

Private configuration inputs: `STACK_ARN`, `MANUAL_EXEC_ROLE_ARN`, `RESTRICTED_EXEC_ROLE_ARN`, R/D/F ARNs, current template/parameters/tags, baseline API/web/infra SHAs, reviewed asset hashes and current resource-binding manifest. Every request uses the exact stack ARN, not a name copied from a different session. Region stays `ap-southeast-1`. These are symbolic inputs, not shell variables populated from untrusted output.

| Stage | Administrator action | Required result / stop condition |
| --- | --- | --- |
| 1. Quiesce | Coordinate maintenance; block new R federation and R-to-D/F assumptions through administrator-controlled policies. Apply a temporary release freeze denying R/D/F service operations (or revoke their sessions and wait for all existing sessions to expire). Include separately assumed downstream sessions. Disable effective deployment variables without disturbing publisher configuration. | Record freeze policy version and timestamp. No queued/running release, in-flight stack operation, provider invocation or pending migration may be ignored. Trust removal alone does not invalidate existing sessions. Wait for terminal state; do not stop X mid-update. |
| 2. Inventory | Verify account/region, exact StackId and current RoleARN; save templates, parameters, resource map and rollback artifacts securely. List all change sets with pagination and record IDs/status/RoleARN. | Expected stable stack status and known baseline. Unknown state, unresolved migration or missing rollback asset means stop. |
| 3. Clear pending sets | Review and delete all stale/unexecuted sets on this stack, including manual/admin-role sets, before changing association; coordinate with their owners. Re-list to confirm none remain. Do not touch other stacks. | Clean slate, not merely a filtered list of CI-named sets. Executed/obsolete records may already be absent. Reserve `cartoptix-*-api/web` exclusively for restricted releases; manual names use `admin-issue88-*`. |
| 4. Infrastructure migration | Engineer prepares explicit UPDATE change set with RoleARN=MANUAL_EXEC_ROLE_ARN, exact STACK, reviewed capabilities and full intended inputs. Check provider boundary/log group/prefix changes, unchanged application SHAs/capacity, resolved AMI and no unrelated changes. Administrator executes only the reviewed set. | Stable UPDATE_COMPLETE; actual provider role has boundary, log group and scoped resources. Failure: remain frozen; let rollback finish, inspect live association and boundary, and repair with manual role as necessary. Never assume rollback restored the intended restrictions. |
| 5. Restrict association | Prepare an administrator-owned UPDATE change set specifying RoleARN=RESTRICTED_EXEC_ROLE_ARN and the approved post-migration template/inputs. The restricted role must already exist and be passable by the administrator. | Inspect DescribeChangeSet RoleARN, template diff, parameters and resource changes before execution. The transition must not invoke the provider or replace instances unintentionally. |
| 6. Handle no-op | If CloudFormation/CDK reports no changes or deletes the set, **do not report success**. A documented UpdateStack request can explicitly supply RoleARN and UsePreviousTemplate; acceptance of a role-only no-op remains a live test, not an assumption. | Use this direct path only after evaluating parameter re-resolution and under an approved maintenance procedure. If it rejects, stop and approve a persistent, CDK-represented output-only transition marker with X in a new reviewed UPDATE change set. Do not make an out-of-band template edit that future synth would remove. |
| 7. Execute and verify | Execute the approved transition set (or observe the approved role-only update); wait for terminal success, then DescribeStacks. Read back role and policy versions and re-list pending sets. | Stack RoleARN exactly equals X, template and parameters match approved post-transition baseline, and no stale executable set remains. An API success response or change-set RoleARN alone is insufficient. |
| 8. Hand back | Refresh bindings, run negative tests and a bounded release/rollback rehearsal, then have reviewer sign the private handback record. Remove the freeze under administrator control; activate effective GitHub variable only after every gate passes. | Confirm actual association still X immediately before enabling. Record actor, time, StackId, RoleARN, policy hashes/versions, provider role+boundary, resource-binding hash, pending-set check and test evidence. Publish only a redacted summary. |

SSM parameter values can re-resolve on stack updates even when previous parameter inputs are reused. Compare **resolved** AMI and bootstrap parameters, not just their names. If the AMI has advanced, treat it as a separate reviewed engineer infrastructure update before transition. Do not call a supposedly harmless role-only UpdateStack blindly, and do not change app/capacity merely to force a nonempty change set. [UpdateStack RoleARN and parameter semantics](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_UpdateStack.html)

ExecuteChangeSet has no RoleARN override: the role was supplied when preparing the set. If it is wrong, delete/recreate the set; do not try to repair it at execution. AWS also removes other stack change sets on execution, but still verify cleanup explicitly, especially after failed/no-op preparations. [ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)

**Abort/recovery:** keep the release freeze. If a migration/transition rolls back successfully, inspect the *actual* RoleARN, provider boundary and template before retrying. If it reaches UPDATE_ROLLBACK_FAILED, capture failure events, prefer a justified narrow fix, and have the administrator call ContinueUpdateRollback with an explicit reviewed RoleARN (manual role if recovery requires it). Record any ResourcesToSkip and reconcile drift before further releases; never enable CI with skipped/inconsistent resources. Once recovered, repeat stages 2–8. An administrator-role recovery is temporary and requires another explicit X transition. [ContinueUpdateRollback](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ContinueUpdateRollback.html)

## Later manual deployment, rollback and teardown

Manual infrastructure changes still need the existing broader execution role. Before such a deployment, disable/revoke the release path and drain its sessions, record the role association and rollback assets, and explicitly select the engineer execution role. After the manual update, transition back to X, clear incompatible pending sets, refresh exact IAM resource bindings, verify the template/InfraRelease and role association, and only then re-enable CI. Make this a future runbook/script preflight requirement; leaving the stack associated with administrator execution is not a completed handback.

Normal API failure has two paths: CloudFormation automatically rolls back a failed rolling update using X; readiness failure after a successful update triggers a new guarded change set restoring the previous API SHA. Both need tested launch-template/ASG permissions. A failed web update invokes the provider with previous source keys; keep those archives readable. A web failure leaves the successful API release in place. Neither path reverses database migrations: migrations must remain backward-compatible, and database repair is an engineer action.

For `UPDATE_ROLLBACK_FAILED`, stop CI; an engineer reviews events and corrects the specific permission/resource failure. Prefer fixing X narrowly and continuing rollback. If broader recovery is necessary, explicitly pass the engineer execution role to the recovery operation, record the temporary escalation, and repeat the X handback afterward. Do not grant ContinueUpdateRollback or administrator-role PassRole to R/D for convenience. Skipping resources is a last-resort engineer decision with drift reconciliation before resuming releases.

Destroy remains manual and must explicitly use a lifecycle-capable execution role: X cannot delete RDS, networking or the web auto-delete provider. Disable CI before teardown; invalidate exact-stack permissions after deletion. Recreating `CartOptixPresentation` gives a different stack UUID and resource IDs, so repeat bindings and role transition before reactivation. Never solve this by widening mutation scope to every stack incarnation. Destroy when idle, check daily, preserve one build instance / two evaluation instances, and finish teardown by **13 November 2026**.

For **every later manual deployment**, repeat transition-runbook stages 1–3 before preparing a set with the manual role. The engineer's normal CDK mode can re-associate the administrator execution role; using the same stack name does not preserve X automatically. After the manual deployment repeat stages 5–8, including a fresh actual-role read. If handback cannot complete, leave the release freeze in place and label the stack “manual access only”; a working website is not evidence that CI is safe to resume.

### Repeatable teardown and recreation rebinding

Keep an administrator-owned, access-controlled binding manifest outside the public repo, versioned by exact StackId and infrastructure commit. It records STACK, LT, ASG, API instance role/profile, subnets/SG/AMI, provider function/role/boundary/log group, WEB, DIST, bootstrap bucket/prefix/key/version and validated instance target tags. Store evidence timestamps and policy versions; never credentials or secret values.

1. Freeze the entire release chain and drain operations using the transition runbook. Save evidence and required data. An administrator deletes the exact old stack with explicit manual RoleARN. Wait for deletion to complete; investigate retained resources/costs separately.
2. Remove the old stack/resource bindings from R/D/X identities **and their boundaries**, or leave these roles fully disabled with no active mutation binding. Do not leave a union of old/new ARNs as a convenience. F may keep the unchanged bootstrap prefix ceiling, but remains frozen. The stack-owned provider role/boundary/log group should be deleted by the manual lifecycle; confirm any leftovers.
3. Engineer creates the new stack with the manual execution role and the approved CDK boundary attachment in its template. CI cannot create it: D's old UUID does not authorise the new stack, even with the same name. Do not temporarily widen D to `CartOptixPresentation/*`. The newly created provider gets its boundary with references to the new WEB/DIST/log group before its initial deployment invocation.
4. Administrator collects the fresh binding manifest from the actual stack/resource inventory, verifies resource ownership and tags, and reviews a diff against the old manifest. Never derive new ARNs by replacing UUID strings or assume generated names stayed the same.
5. Render the approved identity policies and per-role ceilings from that manifest; inspect every changed ARN, condition and action. Update R/D/X and applicable F/KMS/SSM scopes while frozen. Policies become effective asynchronously: wait and verify reads/simulation before testing mutations. Retain policy-version history for audit, but do not restore obsolete resource grants to fix a failed new deployment.
6. Re-run negative tests for **old UUID/resources, new UUID/resources, another stack, missing stack and CREATE**. A new exact binding permits only the current incarnation. Refresh migration instance eligibility from verified propagated stack/ASG tags; instance-ID allowlists otherwise require maintenance on every replacement.
7. Transition the new stack to X and complete the signed handback. Test API/web rollback using assets and images applicable to the new baseline. Only then remove the freeze and reactivate deployment.

If any collection, policy update or transition fails, the safe result is an engineer-created stack with CI disabled. This procedure is intentionally an administrator dependency of daily recreation. It does not promise an IAM condition can identify “the currently existing stack” by name; exact ARN rebinding supplies that control.

## Missing evidence collection checklist

**Not collected in this design revision.** After separate authorisation, the named owners gather the following in a private evidence bundle. API operation names below describe read-only collection, not commands run here and not grants to add to CI. Public comments report pass/fail and unresolved categories only.

| Owner / evidence | Collection and required acceptance record |
| --- | --- |
| Administrator: stack | CloudFormation DescribeStacks, GetTemplate, ListStackResources, ListChangeSets/DescribeChangeSet (all pages): exact StackId, current RoleARN, stable status, parameters including resolved AMI, outputs, template hash, all pending-set roles and IDs. |
| Infrastructure engineer: physical resources | Correlate logical IDs to LT ID/version, ASG ARN/name/capacity/process state/scaling policy, API role/profile, subnets/SGs/AMI, web bucket, distribution and provider function/layer/log-group identities. Inspect tags on actual healthy/replacement instances. Record which are AWS-managed versus stack-owned. |
| Administrator: provider | Lambda configuration and resource policy; IAM GetRole, ListAttachedRolePolicies, ListRolePolicies, GetRolePolicy, GetPolicy/GetPolicyVersion: actual execution role, trust, managed+inline documents, boundary ARN/default version and log destination. Confirm source, destination, invalidation and KMS powers, not only generated template intent. |
| Administrator: effective IAM | For R/D/F/X, publisher, legacy role, provider and EC2 role: all identity/trust/boundary policies and versions, session-policy restrictions, relevant SCP/RCP controls, resource-policy session grants and cross-role assumptions. Evaluate the shared publisher boundary delta independently. Record explicit denies and missing grants. |
| Administrator: S3/KMS/bootstrap | Actual bucket owner, policy, encryption/key ARN, Bucket Keys, versioning/lifecycle and rollback objects; bootstrap qualifier/version parameter; KMS key policy and any relevant grants. No secret reads needed. Verify same-account access and prefix isolation. |
| Repository owner: OIDC | Inspect repository/org OIDC subject customisation and capture only decoded `iss`, `aud`, `sub` from an approved main-branch token-claims probe; do not assume AWS or print/persist the raw JWT. Confirm owner/repository IDs, branch and any environment semantics. Record exact subject privately and compare with trust substitution. |
| Organisation owner: GitHub variables | Inspect repository Actions variables, organisation Actions variable values **and selected-repository visibility**, and each relevant environment. Record presence/absence, source and effective deployment ARN privately. An inaccessible organisation scope is “unknown”, not “unset”. Confirm publisher variable unchanged. Current workflow does not declare an environment; review again if that changes. |
| Joint reviewer: authorisation tests | Record simulator inputs/results for every role and live bounded tests of trust, condition context, resource policies, provider operations and rollback. Identify principal per denied call. Separate a documentation mapping, simulation result and live success in the evidence record. |

Do not use `GetSecretValue`, fetch instance environment files or dump database content to establish these identities. OIDC tokens and command output may be sensitive even when account IDs are merely identifiers. Failure to inspect organisational controls or resource policies leaves activation blocked; do not fill the gap with wider permissions.

## Proposal-file treatment in the infrastructure-change guard

**Safest immediate treatment:** leave `infra/scripts/release_scope.py` and all deployment logic unchanged in this revision. The four proposal files are not executable inputs, but the current path rules classify them as infrastructure. Keep deployment disabled until the normal, reviewed engineer migration establishes the correct InfraRelease; do not manually edit the stack output just to conceal a guard failure.

If these documents must merge separately before that migration, the smallest future code change is an **exact four-file exclusion**, reviewed with tests, for this document, its draft README and the two `.proposal.json` files. Do not exclude all Markdown, all JSON, a whole `infra/` subtree or future files in the drafts directory. Before approval verify no script/CDK/import/glob consumes these files; if any becomes an executable policy input, remove its exclusion in that same change. Moving everything under `infra/scripts` merely to exploit its existing exclusion is not recommended. No exclusion is implemented here.

Future regression cases extend `scripts/test_release_scope.py` using its temporary Git fixtures (root and infra working-directory cases):

- Under the unchanged rules, each proposal addition/edit/deletion is `infra=true` (document this current behaviour). Under the separately approved exact exclusions, each is `infra=false, api=false, web=false`.
- An excluded proposal plus API, web or contracts changes still selects those services correctly; proposal plus real infrastructure change must set `infra=true`.
- `infra/bin/presentation.ts`, `infra/src/*`, CDK context/config/package files, `pnpm-lock.yaml`, workspace config and patches remain infrastructure changes.
- A fifth JSON in the draft directory, a similarly named `.ts`, or moving/renaming a proposal into a deployable policy path remains `infra=true`. Test both source deletion and destination addition for renames.
- Missing history still fails closed. Existing RUNBOOK/scripts behaviour is not broadened. Scan source imports and file readers to prove all four excluded paths remain documentation only.

These tests are a recommendation for the later guard change, not tests claimed to exist or pass in this revision.

## Verification plan and activation checklist

All AWS/GitHub tests below are **not run**. They require a separately authorised implementation/testing phase. Simulator success is not proof of bucket policies, trust, service-role behaviour, resource providers or real STS effective permissions.

| Gate | Positive and negative evidence required |
| --- | --- |
| Offline synthesis | Both modes produce equivalent post-migration resources and only intended role metadata; all file destinations under PREFIX; no Docker assets, lookups or guardrails deployment; template checks reject provider/IAM/SG/capacity/AMI changes. |
| Trust | Main's actual audience/subject succeeds; feature branch, PR subject, another repo and wrong audience fail. R cannot assume default bootstrap, legacy deployment or X roles. D/F cannot chain onward. Test required session tags. |
| CloudFormation | Current exact STACK allows prepare/describe/template read/execute/delete; another stack, Guardrails, CDKToolkit and a newly recreated UUID fail. Missing/administrator RoleArn in CreateChangeSet fails. Test CREATE change-set bypass with simulator/disposable approved resources, not production. |
| Associated role and pending sets | Verify actual RoleARN=X, no privileged sets under CI names; attempt execution outside reserved names must fail. Explicitly test stale/admin-set scenario before claiming isolation. |
| Files/KMS | Fresh upload, existing-object skip, prefix list, SSE-KMS read by consumer, multipart failure cleanup and previous-asset rollback work. Other prefixes, root list, object deletion, ACL/bucket-policy changes and other keys fail. Confirm bucket-key context and caller identity. |
| Migration | Benign authorised command, polling/output, duplicate-run blocking, timeout/cancellation and uncertain-state handling work. Wrong document, untagged instance, another project's instance and legacy CartOptix instance fail. Record unavoidable regional List/Get/Cancel powers. Never test by cancelling unrelated real work. |
| X and providers | API-only, web-only, combined release, identical web assets and rollback work. Deny unrelated LT/ASG, IAM mutation/pass, provider-code changes, arbitrary Lambda invoke, RDS/network/CloudFront configuration and direct web-bucket writes by R/D/F. Capture denied calls and CloudTrail principal chain, then justify each adjustment individually. |
| Workflow semantics | Docs-only does not deploy; absent stack skips; infra drift refuses; migration failure blocks rollout; API failure blocks web; web failure preserves API; immutable ECR rerun skips publish correctly. |
| Recovery/lifecycle | Prove engineer recovery, role handback, explicit-role teardown and recreation rebinding. CI cannot create/delete/restore a stack. |

Before setting `AWS_DEPLOY_ROLE_ARN` to R: team approves residual powers, all resource placeholders are resolved, policies/trust/boundaries are reviewed, publisher delta passes, mode integration is merged with CI passing, engineer migration/association is recorded, negative tests and rollback pass, organisation fallback is checked, and operational owners accept the disable/handback procedure. Set the variable **last**. Preserve `AWS_PUBLISH_ROLE_ARN` and existing publisher trust. `DRY_RUN=true` still uploads assets and creates/deletes live change sets; it is a future integration test, not an offline check and not proof that X can execute a release.

## Expected changes, costs and unresolved decisions

Expected future AWS changes: four IAM roles and their policies/boundaries/tags; a minimal publisher-policy delta (possibly boundary ceiling); new objects under an existing bucket prefix; a stack-owned provider boundary, dedicated short-retention log group and asset-location changes during engineer migration; explicit stack service-role reassociation. No new ECS, compute, database, network, KMS key or bootstrap stack is proposed. No manual role or existing publisher trust change is justified.

IAM configuration itself does not add running application capacity. Verification can incur S3 storage/requests, KMS requests, provider Lambda/logs, CloudFront invalidations and replacement EC2/EBS/IPv4 runtime. The proposed dedicated provider log group incurs ingestion/storage costs; preserve short retention and inspect the superseded implicit group for retained costs. Prefix migration duplicates retained artifacts; multipart leftovers and obsolete versions need engineer-owned cleanup after the rollback retention window. Quantities and affordability have **not** been measured. Use the E1 SGD 84 budget and existing Project tag controls and schedule tests in an already approved working window. No logging resources are created during this design revision.

Decisions still required:

1. Accept app-instance shell authority and regional SSM command visibility/cancellation, or redesign migrations with a fixed document/broker and revised scripts.
2. Accept resource-scoped LT/ASG/custom-resource authority, or require enforcement outside the modifiable workflow for property-level restrictions.
3. Confirm actual immutable OIDC subject, organisation variable fallback, current role policies/boundaries, bucket policy/key details and all physical IDs.
4. Verify precise CloudFormation rolling-update/provider call set, including RunInstances validation, transient capacity and rollback operations. Keep T candidates out of deployment JSON until justified.
5. Confirm required CDK session tags, template-fetch credential principal, exact CLI supplemental reads and file multipart operations.
6. Approve shared bucket prefix and rollback retention; confirm manual synthesis consumes the same prefix and other stacks do not. If assets must be immutable against CI, redesign storage/publishing rather than claiming hashes enforce immutability.
7. Assign an engineer to rebind exact resources after every recreation and enforce the manual-role handback. If this operational burden is unacceptable, redesign the lifecycle boundary; do not broaden CI silently.
8. Use the guard-treatment section's unchanged-rule default; only approve an exact four-path exclusion with the specified regression cases if an independent documentation merge requires it. Never advance InfraRelease by an out-of-band edit.

### Redacted GitHub issue-comment draft (not posted)

> Revised the #88 design with a durable provider boundary, an administrator-only execution-role transition/handback runbook, documented CloudFormation action/condition mappings, and an exact-stack recreation rebinding checklist. Activation remains blocked on private account evidence, provider/rollback authorisation tests and acceptance of the documented residual powers. Deployment logic and AWS/GitHub settings are unchanged. The proposal-file guard treatment is documented for a separate reviewed change if needed.

Do not append live ARNs, account/repository IDs, actual OIDC subject or private evidence to this comment. Link the design and report sanitised test outcomes instead.

Recommended implementation sequence: approve the design and residual powers; resolve account evidence; finish bounded policies/tests; implement offline CDK mode with manifest assertions; create disabled IAM roles and publisher delta; engineer prefix migration; explicit X association and exact-resource binding; controlled positive/negative/rollback tests; update the runbook and enable GitHub deployment last. This proposal does not complete E3's deployed-release acceptance criteria.

## Draft JSON and local validation

The adjacent `issue-88-policy-drafts/` contains only the well-understood OIDC trust and repository-scoped publisher delta. They are proposals, not installation inputs. Full identity/boundary/execution policies are deliberately withheld until the matrix's unresolved runtime details and account bindings are settled. The release orchestration uses shell AWS CLI calls and CDK-generated providers, not application SDK calls; an SDK-source policy generator cannot establish this complete permission chain.

`pnpm check` was attempted on the baseline checkout. After dependency installation it failed at Biome with 156 formatting errors in existing files (CRLF working-tree content); subsequent type/test/synth stages did not run through that command. No baseline files were reformatted.

Separately, `pnpm --filter @cartoptix/web build` and an explicit local `cdk synth --quiet` using the baseline SHA and a placeholder alert email passed. This executed no deployment or context lookup. The presentation asset manifest contains five file assets (auto-delete provider, AWS CLI layer, bucket-deployment provider, web archive and stack template) and zero Docker image assets. The baseline manifest has default deploy/execution/file roles and no additional STS session-tag options. This validates the baseline topology only; the proposed mode and restricted policies have not been implemented or exercised.

`pnpm exec biome check infra/issue-88-policy-drafts` passed for both JSON files. `git diff --check` passed for tracked changes; the four proposal files are new and untracked, so ordinary `git diff --stat` reports no changes until they are staged. No files were staged or committed.

Independent-review revision validation: reran `pnpm check`; it again stopped at the same 156 baseline formatting errors, before later stages. Both revised JSON files passed Biome and JSON parsing. All four files passed explicit trailing-whitespace and account/immutable-ID scans; public examples retain placeholders. Local Markdown file links were checked. No application logic or tests were modified; proposed synthesis, guard, IAM and lifecycle regression tests remain future work. Prior baseline build/synth results above were not rerun or represented as tests of the unimplemented design.
