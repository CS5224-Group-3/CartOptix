#!/usr/bin/env python3
"""Decide which services a release must deploy.

Pathspecs are anchored at the repository root, so the answer does not depend on
the caller's working directory (the release scripts run from infra/).
"""

import argparse
import json
import subprocess
import sys

# Release tooling and docs under infra/ do not change the deployed stack.
INFRA_PATHS = [
    "infra",
    ":(exclude)infra/RUNBOOK.md",
    ":(exclude)infra/scripts",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "patches",
]


def _git(root, *args):
    return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)


def changed(root, base, head, *paths):
    for sha in (base, head):
        if _git(root, "cat-file", "-e", f"{sha}^{{commit}}").returncode != 0:
            raise ValueError(f"missing commit {sha}; fetch full history before releasing")
    result = _git(root, "diff", "--quiet", base, head, "--", *paths)
    if result.returncode not in (0, 1):
        raise ValueError(f"could not compare {base} with {head}: {result.stderr.strip()}")
    return result.returncode == 1


def scope(root, release, api, web, infra):
    return {
        "infra": changed(root, infra, release, *INFRA_PATHS),
        "api": changed(root, api, release, "apps/api", "packages/contracts"),
        "web": changed(root, web, release, "apps/web", "packages/contracts"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release")
    parser.add_argument("deployed_api")
    parser.add_argument("deployed_web")
    parser.add_argument("deployed_infra")
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    try:
        top = _git(args.root, "rev-parse", "--show-toplevel").stdout.strip()
        print(json.dumps(scope(top, args.release, args.deployed_api, args.deployed_web, args.deployed_infra)))
    except ValueError as error:
        print(f"release scope: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
