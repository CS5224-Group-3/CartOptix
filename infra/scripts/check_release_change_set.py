#!/usr/bin/env python3
"""Fail closed unless a release change set only moves release pointers and assets.

The deployed template is diffed against the change set's template. Only an
explicit allowlist of properties may differ, and the change set's own resource
changes must stay inside the stage's resources. Prints "execute" or "noop".
"""

import argparse
import json
import sys

MISSING = object()
NO_CHANGES = ("The submitted information didn't contain changes.", "No updates are to be performed.")

RESOURCES = {
    "api": {
        "ApiLaunchTemplate": "AWS::EC2::LaunchTemplate",
        "ApiGroupASG": "AWS::AutoScaling::AutoScalingGroup",
    },
    "web": {"WebDeployment": "Custom::CDKBucketDeployment"},
}
# A dynamic change is accepted only when this resource caused it (the ASG
# follows the launch template's new version).
DYNAMIC_DRIVER = {"api": "ApiLaunchTemplate", "web": None}
WEB_RELEASE_OUTPUT = ("Outputs", "WebRelease", "Value")


def leaf_diffs(old, new, path=()):
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(old.keys() | new.keys()):
            yield from leaf_diffs(old.get(key, MISSING), new.get(key, MISSING), path + (key,))
    elif isinstance(old, list) and isinstance(new, list) and len(old) == len(new):
        for index, (a, b) in enumerate(zip(old, new)):
            yield from leaf_diffs(a, b, path + (index,))
    elif old != new:
        yield path, old, new


def _under(path, prefix, suffix):
    return len(path) > 1 and path[0] == "Resources" and str(path[1]).startswith(prefix) and path[2 : 2 + len(suffix)] == suffix


def _mask(value, releases):
    text = json.dumps(value, default=repr)
    return text.replace(releases["api_from"], "<API>").replace(releases["api_to"], "<API>")


def _allowed(stage, path, old, new, releases):
    if stage == "api":
        if path == ("Outputs", "Release", "Value"):
            return (old, new) == (releases["api_from"], releases["api_to"])
        if _under(path, "ApiLaunchTemplate", ("Properties", "LaunchTemplateData", "UserData")):
            return _mask(old, releases) == _mask(new, releases)
        return False
    if path == WEB_RELEASE_OUTPUT:
        return (old, new) == (releases["web_from"], releases["web_to"])
    return _under(path, "WebDeployment", ("Properties", "SourceObjectKeys"))


def _template(value):
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError("template is not a JSON object")
    return value


def _parameters(items):
    return {p["ParameterKey"]: p.get("ResolvedValue", p.get("ParameterValue")) for p in items or []}


def _check_changes(stage, changes):
    for change in changes:
        resource = change.get("ResourceChange", {})
        logical_id = resource.get("LogicalResourceId", "")
        expected = next((t for prefix, t in RESOURCES[stage].items() if logical_id.startswith(prefix)), None)
        if change.get("Type") != "Resource" or expected is None or resource.get("ResourceType") != expected:
            raise ValueError(f"{stage} release would change unexpected resource {logical_id!r}")
        if resource.get("Action") != "Modify" or resource.get("Replacement") not in (None, "False"):
            raise ValueError(f"{stage} release would replace or remove resource {logical_id!r}")
        driver = DYNAMIC_DRIVER[stage]
        for detail in resource.get("Details") or []:
            if detail.get("Target", {}).get("Attribute") != "Properties":
                raise ValueError(f"{stage} release changes a non-property attribute of {logical_id!r}")
            caused_by = str(detail.get("CausingEntity", ""))
            if detail.get("Evaluation") == "Dynamic" and not (driver and caused_by.startswith(driver)):
                raise ValueError(f"{stage} release has an unresolved dynamic change on {logical_id!r}")


def validate(stage, description, stack, current, proposed, releases):
    if stage not in RESOURCES:
        raise ValueError(f"unknown release stage: {stage}")
    status = description.get("Status")
    reason = str(description.get("StatusReason", ""))
    if status == "FAILED" and reason.startswith(NO_CHANGES):
        if stage == "web":
            return "noop"
        raise ValueError(f"{stage} release produced no change set")
    if status != "CREATE_COMPLETE":
        raise ValueError(f"change set is {status!r}: {reason}")
    if _parameters(stack.get("Parameters")) != _parameters(description.get("Parameters")):
        raise ValueError("stack parameters would change (for example a new AMI); deploy infrastructure first")

    paths = []
    for path, old, new in leaf_diffs(_template(current), _template(proposed)):
        if not _allowed(stage, path, old, new, releases):
            raise ValueError(f"{stage} release would change {'.'.join(map(str, path))}")
        paths.append(path)

    changes = description.get("Changes") or []
    if changes:
        _check_changes(stage, changes)
    elif stage == "api":
        raise ValueError("api release produced no resource changes")
    elif any(path != WEB_RELEASE_OUTPUT for path in paths):
        raise ValueError("web release changed the template but produced no resource changes")
    return "execute" if changes or paths else "noop"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage")
    for name in ("change-set", "stack", "current-template", "proposed-template"):
        parser.add_argument(f"--{name}", required=True)
    for name in ("api-from", "api-to", "web-from", "web-to"):
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()

    def load(path):
        with open(path) as handle:
            return json.load(handle)

    releases = {k: getattr(args, k) for k in ("api_from", "api_to", "web_from", "web_to")}
    try:
        print(
            validate(
                args.stage,
                load(args.change_set),
                load(args.stack),
                load(args.current_template),
                load(args.proposed_template),
                releases,
            )
        )
    except ValueError as error:
        print(f"release guard: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
