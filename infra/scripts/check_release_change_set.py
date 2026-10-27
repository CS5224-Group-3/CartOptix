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

# Logical-id prefix -> (resource type, upstream resource that may cause a
# dynamic change). The template diff proves these resources' own properties are
# untouched, so the only way they change is through the upstream resource: the
# ASG follows the launch template's new version; the scaling policy and
# dashboard reference the ASG.
RESOURCES = {
    "api": {
        "ApiLaunchTemplate": ("AWS::EC2::LaunchTemplate", None),
        "ApiGroupASG": ("AWS::AutoScaling::AutoScalingGroup", "ApiLaunchTemplate"),
        "ApiGroupScalingPolicy": ("AWS::AutoScaling::ScalingPolicy", "ApiGroupASG"),
        "ObservabilityDashboard": ("AWS::CloudWatch::Dashboard", "ApiGroupASG"),
    },
    "web": {"WebDeployment": ("Custom::CDKBucketDeployment", None)},
}
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


def _release_only(old, new, releases):
    """True when the values differ only by api_from -> api_to, applied everywhere."""
    before, after = json.dumps(old, default=repr), json.dumps(new, default=repr)
    if releases["api_from"] not in before or releases["api_to"] in before or releases["api_from"] in after:
        return False
    return before.replace(releases["api_from"], releases["api_to"]) == after


def _allowed(stage, path, old, new, releases):
    if stage == "api":
        if path == ("Outputs", "Release", "Value"):
            return (old, new) == (releases["api_from"], releases["api_to"])
        if _under(path, "ApiLaunchTemplate", ("Properties", "LaunchTemplateData", "UserData")):
            return _release_only(old, new, releases)
        return False
    if path == WEB_RELEASE_OUTPUT:
        return (old, new) == (releases["web_from"], releases["web_to"])
    return _under(path, "WebDeployment", ("Properties", "SourceObjectKeys"))


def _check_user_data_moved(template, releases):
    """The launch template must run the new release and keep no trace of the old one."""
    found = False
    for logical_id, resource in template.get("Resources", {}).items():
        if logical_id.startswith("ApiLaunchTemplate") and resource.get("Type") == RESOURCES["api"]["ApiLaunchTemplate"][0]:
            found = True
            text = json.dumps(resource.get("Properties", {}).get("LaunchTemplateData", {}).get("UserData"), default=repr)
            if releases["api_to"] not in text or releases["api_from"] in text:
                raise ValueError(f"{logical_id} user data does not fully move to release {releases['api_to']}")
    if not found:
        raise ValueError("api release has no launch template")


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
        rule = next((r for prefix, r in RESOURCES[stage].items() if logical_id.startswith(prefix)), None)
        if change.get("Type") != "Resource" or rule is None or resource.get("ResourceType") != rule[0]:
            raise ValueError(f"{stage} release would change unexpected resource {logical_id!r}")
        driver = rule[1]
        if resource.get("Action") != "Modify" or resource.get("Replacement") not in (None, "False", "Conditional"):
            raise ValueError(f"{stage} release would replace or remove resource {logical_id!r}")
        for detail in resource.get("Details") or []:
            if detail.get("Target", {}).get("Attribute") != "Properties":
                raise ValueError(f"{stage} release changes a non-property attribute of {logical_id!r}")
            dynamic_from_driver = detail.get("Evaluation") == "Dynamic" and driver and str(detail.get("CausingEntity", "")).startswith(driver)
            if detail.get("Evaluation") == "Dynamic" and not dynamic_from_driver:
                raise ValueError(f"{stage} release has an unresolved dynamic change on {logical_id!r}")
            if detail.get("Target", {}).get("RequiresRecreation") not in (None, "Never") and not dynamic_from_driver:
                raise ValueError(f"{stage} release would replace or remove resource {logical_id!r}")
        if resource.get("Replacement") == "Conditional" and not any(
            d.get("Evaluation") == "Dynamic" for d in resource.get("Details") or []
        ):
            raise ValueError(f"{stage} release would conditionally replace resource {logical_id!r}")


def _live_web_release(stack):
    return next((o.get("OutputValue") for o in stack.get("Outputs") or [] if o.get("OutputKey") == "WebRelease"), None)


def validate(stage, description, stack, current, proposed, releases):
    if stage not in RESOURCES:
        raise ValueError(f"unknown release stage: {stage}")
    status = description.get("Status")
    reason = str(description.get("StatusReason", ""))
    if status == "FAILED" and reason.startswith(NO_CHANGES):
        # Nothing to execute is only a success if the live stack already runs
        # the requested release; a change set that went missing must not pass.
        if stage == "web" and _live_web_release(stack) == releases["web_to"]:
            return "noop"
        raise ValueError(f"{stage} release has no change set, and the stack does not show {releases['web_to']} as deployed")
    if status != "CREATE_COMPLETE":
        raise ValueError(f"change set is {status!r}: {reason}")
    if _parameters(stack.get("Parameters")) != _parameters(description.get("Parameters")):
        raise ValueError("stack parameters would change (for example a new AMI); deploy infrastructure first")

    current, proposed = _template(current), _template(proposed)
    if stage == "api":
        _check_user_data_moved(proposed, releases)
    paths = []
    for path, old, new in leaf_diffs(current, proposed):
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
