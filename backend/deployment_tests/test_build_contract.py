from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def test_dockerfile_does_not_require_a_local_apk() -> None:
    """A clean GitHub checkout must be sufficient to build the API image."""

    dockerfile = (BACKEND_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert ".apk" not in dockerfile.lower()


@pytest.mark.parametrize("ignore_name", [".dockerignore", ".railwayignore"])
def test_deployment_context_excludes_local_apks(ignore_name: str) -> None:
    """Release binaries must not silently re-enter Railway's build context."""

    rules = {
        line.strip()
        for line in (BACKEND_ROOT / ignore_name).read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }

    assert "app/static/downloads/" in rules
    assert not any(rule.startswith("!") and "app/static/downloads" in rule for rule in rules)


def test_git_ignores_new_local_apk_builds() -> None:
    """A normal ``git add`` must not pick up a developer's APK build."""

    gitignore = (BACKEND_ROOT.parent / ".gitignore").read_text(encoding="utf-8").splitlines()

    assert "backend/app/static/downloads/*.apk" in {line.strip() for line in gitignore}
