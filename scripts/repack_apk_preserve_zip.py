from __future__ import annotations

import argparse
import os
import zipfile
from pathlib import Path


def copy_info(src: zipfile.ZipInfo, arcname: str | None = None) -> zipfile.ZipInfo:
    dst = zipfile.ZipInfo(arcname or src.filename, src.date_time)
    dst.comment = src.comment
    dst.extra = src.extra
    dst.internal_attr = src.internal_attr
    dst.external_attr = src.external_attr
    dst.create_system = src.create_system
    dst.compress_type = src.compress_type
    dst._compresslevel = getattr(src, "_compresslevel", None)
    return dst


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-apk", required=True)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--out-apk", required=True)
    args = parser.parse_args()

    base_apk = Path(args.base_apk)
    bundle = Path(args.bundle)
    out_apk = Path(args.out_apk)
    target = "assets/index.android.bundle"

    if not base_apk.is_file():
        raise FileNotFoundError(base_apk)
    if not bundle.is_file():
        raise FileNotFoundError(bundle)

    out_apk.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_apk.with_suffix(out_apk.suffix + ".tmp")
    if tmp.exists():
        tmp.unlink()

    with zipfile.ZipFile(base_apk, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        bundle_info: zipfile.ZipInfo | None = None
        for src_info in zin.infolist():
            name = src_info.filename.replace("\\", "/")
            if name.startswith("META-INF/"):
                continue
            if name == target:
                bundle_info = src_info
                continue
            data = zin.read(src_info.filename)
            dst_info = copy_info(src_info, name)
            zout.writestr(dst_info, data)

        if bundle_info is None:
            bundle_info = zipfile.ZipInfo(target)
            bundle_info.compress_type = zipfile.ZIP_DEFLATED
        dst_bundle_info = copy_info(bundle_info, target)
        dst_bundle_info.file_size = os.path.getsize(bundle)
        zout.writestr(dst_bundle_info, bundle.read_bytes())

    tmp.replace(out_apk)


if __name__ == "__main__":
    main()
