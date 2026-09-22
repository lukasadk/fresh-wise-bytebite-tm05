from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import (
    BaseSettings,
    JsonConfigSettingsSource,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
API_CONFIG_PATH = PROJECT_ROOT / "models" / "config" / "external_api.json"


class Settings(BaseSettings):
    """Runtime settings, overridable through WW_* environment variables."""

    model_config = SettingsConfigDict(
        env_prefix="WW_",
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        json_file=API_CONFIG_PATH,
        json_file_encoding="utf-8",
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        """Load editable API JSON below explicit values, environment and .env."""

        return (
            init_settings,
            env_settings,
            dotenv_settings,
            JsonConfigSettingsSource(settings_cls),
            file_secret_settings,
        )

    app_name: str = "WasteWise Grocery VLM"
    app_env: str = "development"
    service_api_key: SecretStr | None = None
    backend: Literal["qwen", "mock"] = "qwen"
    model_profiles_path: Path = PROJECT_ROOT / "models" / "config" / "model_profiles.json"
    prompt_path: Path = PROJECT_ROOT / "models" / "config" / "grocery_prompt.txt"
    api_base_url: str | None = None
    api_key: SecretStr | None = None
    api_key_required: bool = False
    api_model: str | None = None
    api_recipe_model: str | None = None
    api_prompt_path: Path = PROJECT_ROOT / "models" / "config" / "api_grocery_prompt.txt"
    api_receipt_prompt_path: Path = PROJECT_ROOT / "models" / "config" / "api_receipt_prompt.txt"
    api_timeout_seconds: float = Field(default=120.0, gt=0.0, le=600.0)
    api_json_mode: bool = True
    api_image_max_edge: int = Field(default=2048, ge=640, le=4096)
    api_max_tokens: int = Field(default=768, ge=64, le=4096)
    preload_model: bool = False
    confidence_threshold: float = Field(default=0.72, ge=0.0, le=1.0)
    max_new_tokens: int = Field(default=768, ge=64, le=4096)
    max_recognized_items: int = Field(default=60, ge=1, le=200)
    structured_retry_count: Literal[0, 1] = 1
    max_upload_mb: int = Field(default=12, ge=1, le=100)
    max_image_pixels: int = Field(default=25_000_000, ge=1_000_000)
    inference_image_max_edge: int = Field(default=2048, ge=640, le=4096)
    review_image_max_edge: int = Field(default=2048, ge=640, le=4096)
    recognition_job_history_limit: int = Field(default=100, ge=10, le=1000)
    recognition_job_queue_capacity: int = Field(default=4, ge=1, le=32)
    database_path: Path = PROJECT_ROOT / "data" / "wastewise.sqlite3"
    off_timeout_seconds: float = Field(default=5.0, gt=0.0, le=30.0)

    @field_validator("api_prompt_path", "api_receipt_prompt_path", mode="after")
    @classmethod
    def resolve_api_prompt_path(cls, value: Path) -> Path:
        return value if value.is_absolute() else PROJECT_ROOT / value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
