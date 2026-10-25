#!/usr/bin/env python3
"""Fail closed when an application release change set touches infrastructure."""

import json
import sys


ALLOWED = {
    "api": {
        "ApiLaunchTemplate": "AWS::EC2::LaunchTemplate",
        "ApiGroupASG": "AWS::AutoScaling::AutoScalingGroup",
    },
    "web": {"WebDeployment": "Custom::CDKBucketDeployment"},
}


def validate(stage: str, changes: list[dict]) -> None:
    if stage not in ALLOWED:
        raise ValueError(f"unknown release stage: {stage}")
    checked = 0
    for change in changes:
        resource = change.get("ResourceChange", {})
        logical_id = resource.get("LogicalResourceId", "")
        expected_type = next(
            (value for prefix, value in ALLOWED[stage].items() if logical_id.startswith(prefix)),
            None,
        )
        if expected_type is None or resource.get("ResourceType") != expected_type:
            raise ValueError(f"{stage} release would change unexpected resource {logical_id!r}")
        if resource.get("Action") != "Modify" or resource.get("Replacement") not in (None, "False"):
            raise ValueError(f"{stage} release would replace or remove resource {logical_id!r}")
        checked += 1
    if checked == 0:
        raise ValueError(f"{stage} release produced no application resource changes")


if __name__ == "__main__":
    try:
        document = json.load(sys.stdin)
        validate(sys.argv[1], document.get("Changes", []))
    except (IndexError, json.JSONDecodeError, ValueError) as error:
        print(f"release change-set check: {error}", file=sys.stderr)
        sys.exit(1)
