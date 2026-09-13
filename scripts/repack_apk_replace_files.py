from __future__ import annotations

import argparse
import os
import zipfile
from pathlib import Path


def clone_info(source: zipfile.ZipInfo, arcname: str) -> zipfile.ZipInfo:
    target = zipfile.ZipInfo(arcname, source.date_time)
    target.comment = source.comment
    target.extra = source.extra
    target.internal_attr = source.internal_attr
    target.external_attr = source.external_attr
    target.create_system = source.create_system
    target.compress_type = source.compress_type
    target._compresslevel = getattr(source, "_compresslevel", None)
    return target


def default_info(arcname: str, source_path: Path) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(arcname)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.file_size = os.path.getsize(source_path)
    return info


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-apk", required=True)
    parser.add_argument("--out-apk", required=True)
    parser.add_argument(
        "--replace",
        action="append",
        required=True,
        help="Replacement in the form apk/path=local/path. May be passed more than once.",
    )
    args = parser.parse_args()

    base_apk = Path(args.base_apk)
    out_apk = Path(args.out_apk)
    replacements: dict[str, Path] = {}
    for entry in args.replace:
        apk_path, sep, local_path = entry.partition("=")
        if not sep:
            raise ValueError(f"Invalid replacement: {entry!r}")
        apk_path = apk_path.replace("\\", "/").lstrip("/")
        path = Path(local_path)
        if not path.is_file():
            raise FileNotFoundError(path)
        replacements[apk_path] = path

    out_apk.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_apk.with_suffix(out_apk.suffix + ".tmp")
    if tmp.exists():
        tmp.unlink()

    seen: set[str] = set()
    with zipfile.ZipFile(base_apk, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        for source_info in zin.infolist():
            apk_path = source_info.filename.replace("\\", "/")
            if apk_path.startswith("META-INF/"):
                continue
            replacement = replacements.get(apk_path)
            if replacement is not None:
                info = clone_info(source_info, apk_path)
                info.file_size = os.path.getsize(replacement)
                zout.writestr(info, replacement.read_bytes())
                seen.add(apk_path)
                continue
            zout.writestr(clone_info(source_info, apk_path), zin.read(source_info.filename))

        for apk_path, replacement in replacements.items():
            if apk_path in seen:
                continue
            zout.writestr(default_info(apk_path, replacement), replacement.read_bytes())

    tmp.replace(out_apk)


if __name__ == "__main__":
    main()
