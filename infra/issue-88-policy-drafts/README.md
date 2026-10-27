# Issue #88 policy fragments — proposals only

Read [the design](../issue-88-release-access-proposal.md) before using these files. Neither file is deployment-ready, a complete role definition, or an instruction to modify AWS.

- `release-oidc-trust.proposal.json`: proposed trust for the new release role. Account and immutable subject IDs are placeholders; actual token claims remain unverified. It is not a trust update for either existing GitHub role.
- `publisher-describe-images.proposal.json`: additive identity-policy fragment for the existing publisher, not a replacement for its working policy. Check whether the shared permissions boundary already permits the same action/resource. Do not alter publisher trust or remove its legacy repository permissions.

Other role identities, boundaries and the CloudFormation execution policy remain design matrices until resource bindings and provider calls have been verified. Do not treat these two fragments as the complete access implementation.

## Substitution and review

An administrator substitutes `<ACCOUNT_ID>`, `<OWNER>`, `<OWNER_ID>`, `<REPOSITORY>` and `<REPOSITORY_ID>` using the private evidence checklist in the design. The subject must match the actual approved main token exactly; if its format differs, review that discrepancy instead of accepting multiple forms. The region and repository name in the ECR fragment describe this project's intended scope and must also be checked against inventory.

These files are valid JSON but intentionally not valid deployable IAM inputs until substitution and review. Reject unresolved placeholders, unexpected accounts/regions and wildcard subjects. Keep rendered account-specific policies and evidence outside public issue comments; retain their reviewed hashes/versions in the administrator record. JSON parsing and Biome checks establish syntax/style only, not IAM validity or effective authorisation.

The provider boundary is specified in the design as a CloudFormation-managed policy with resource references and attachment to the actual handler role. No static JSON is added for it: substituting guessed physical IDs would not encode its replacement lifecycle. Its eventual CDK implementation and synthesis assertions require a separate reviewed change.
