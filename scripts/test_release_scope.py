import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from infra.scripts.release_scope import scope

FILES = {
    "apps/api/src/a.ts": "a",
    "apps/web/src/w.ts": "w",
    "packages/contracts/src/c.ts": "c",
    "infra/src/stack.ts": "s",
    "infra/RUNBOOK.md": "r",
    "infra/scripts/deploy-release.sh": "d",
    "docs/spec.md": "d",
    "pnpm-lock.yaml": "l",
}
ENV = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}


def git(root, *args):
    return subprocess.run(["git", "-C", root, *args], check=True, capture_output=True, text=True, env=ENV).stdout.strip()


class ReleaseScopeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        git(self.root, "init", "-q")
        self.edit(FILES)
        self.base = self.commit("base")

    def tearDown(self):
        self._tmp.cleanup()

    def edit(self, files):
        for name, text in files.items():
            path = Path(self.root, name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)

    def commit(self, message):
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", message)
        return git(self.root, "rev-parse", "HEAD")

    def scope_after(self, changes):
        self.edit(changes)
        head = self.commit("change")
        # Run from infra/, like the release scripts, to prove the root anchoring.
        cwd = os.getcwd()
        os.chdir(Path(self.root, "infra"))
        try:
            return scope(self.root, head, self.base, self.base, self.base)
        finally:
            os.chdir(cwd)

    def test_api_only(self):
        self.assertEqual(self.scope_after({"apps/api/src/a.ts": "2"}), {"infra": False, "api": True, "web": False})

    def test_web_only(self):
        self.assertEqual(self.scope_after({"apps/web/src/w.ts": "2"}), {"infra": False, "api": False, "web": True})

    def test_contracts_deploy_both(self):
        self.assertEqual(self.scope_after({"packages/contracts/src/c.ts": "2"}), {"infra": False, "api": True, "web": True})

    def test_infrastructure_is_flagged(self):
        self.assertEqual(self.scope_after({"infra/src/stack.ts": "2"}), {"infra": True, "api": False, "web": False})

    def test_lockfile_counts_as_infrastructure(self):
        self.assertTrue(self.scope_after({"pnpm-lock.yaml": "2"})["infra"])

    def test_docs_and_release_tooling_deploy_nothing(self):
        changes = {"docs/spec.md": "2", "infra/RUNBOOK.md": "2", "infra/scripts/deploy-release.sh": "2"}
        self.assertEqual(self.scope_after(changes), {"infra": False, "api": False, "web": False})

    def test_missing_commit_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "missing commit"):
            scope(self.root, self.base, "f" * 40, self.base, self.base)


if __name__ == "__main__":
    unittest.main()
