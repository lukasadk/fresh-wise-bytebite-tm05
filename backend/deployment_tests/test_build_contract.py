import json
from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent


@pytest.mark.parametrize(
    "dockerfile_path",
    [REPO_ROOT / "Dockerfile", BACKEND_ROOT / "Dockerfile"],
)
def test_dockerfiles_do_not_require_a_local_apk(dockerfile_path: Path) -> None:
    """A clean GitHub checkout must be sufficient to build the API image."""

    dockerfile = dockerfile_path.read_text(encoding="utf-8")

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


def test_repo_root_build_packages_the_backend_only() -> None:
    """A Railway import at repository root must select the FastAPI service."""

    dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    dockerignore = (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()

    assert "COPY backend/requirements.txt ./requirements.txt" in dockerfile
    assert "COPY backend/app/ ./app/" in dockerfile
    assert "COPY backend/src/ ./src/" in dockerfile
    assert "COPY package.json" not in dockerfile
    assert dockerignore[0].startswith("#")
    assert "**" in dockerignore
    assert "!backend/app/**" in dockerignore
    assert "backend/app/static/downloads/" in dockerignore


@pytest.mark.parametrize(
    ("config_path", "expected_dockerfile"),
    [
        (REPO_ROOT / "railway.json", "Dockerfile"),
        (BACKEND_ROOT / "railway.json", "Dockerfile"),
    ],
)
def test_railway_profiles_have_health_checked_docker_builds(
    config_path: Path,
    expected_dockerfile: str,
) -> None:
    config = json.loads(config_path.read_text(encoding="utf-8"))

    assert config["build"] == {
        "builder": "DOCKERFILE",
        "dockerfilePath": expected_dockerfile,
    }
    assert config["deploy"]["healthcheckPath"] == "/health"
    assert config["deploy"]["healthcheckTimeout"] == 100
