"""
dataset_package.py
==================
Ready-made dataset packages, so a deployment can be filled without running
the full pipeline.

Package = ``.tar.gz`` containing processed files (flat, no directories) plus
``tidewatch-dataset.json``:

    {"format": "tidewatch-dataset", "format_version": 1, "created_at": …,
     "model_version": "2.2.0", "regions": [...],
     "files": [{"name": …, "region": …, "bytes": …, "sha256": …}],
     "pipeline": {region: <manifest entry>}}

Import is defensive: only regular files with whitelisted names, SHA-256 must
match, every JSON must pass the same validation as a fresh build, the
model's major version must match, and files are installed atomically per
region (old files for that region are removed first so versions never mix).

Usage:
    python data/dataset_package.py export --regions gulf_coast --output dist/
    python data/dataset_package.py import --source dist/tidewatch-data-….tar.gz
    python data/dataset_package.py import --source https://example.org/tidewatch-data.tar.gz
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
from pathlib import Path

if __package__:
    from .common import MODEL_VERSION, PROCESSED_DIR, REGIONS, make_session, progress, utc_now_iso, write_json
    from .build_dataset import validate_output
else:
    from common import MODEL_VERSION, PROCESSED_DIR, REGIONS, make_session, progress, utc_now_iso, write_json
    from build_dataset import validate_output

FORMAT = "tidewatch-dataset"
FORMAT_VERSION = 1
MANIFEST_NAME = "tidewatch-dataset.json"
MAX_DOWNLOAD_BYTES = 8 * 1024 ** 3
_KINDS = "elevation|tides|tracks|census|surge|exposure|lookup"
FILE_RE = re.compile(rf"^({_KINDS})_([a-z_]+?)(_cat[1-5]_\d{{4}}|_blocks|_density|_elev|_flood|_pop|_tract)?"
                     r"\.(json|npz|png|f32|u16|i16)$")


def _public_entry(entry: dict, data_dir: Path) -> dict:
    """Manifest entry without server paths (older manifests stored absolute paths)."""
    entry = dict(entry or {})
    entry["files"] = sorted({Path(f).name for f in entry.get("files", [])})
    entry["errors"] = [str(e).replace(str(Path(data_dir).resolve()), "<data>").replace(str(data_dir), "<data>")
                       for e in entry.get("errors", [])]
    return entry


def region_of(name: str) -> str | None:
    """Region key for a processed file name (longest matching configured key)."""
    m = FILE_RE.match(name)
    if not m:
        return None
    stem = name.split(".", 1)[0].split("_", 1)[1]
    for key in sorted(REGIONS, key=len, reverse=True):
        if stem == key or stem.startswith(key + "_"):
            return key
    return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_package(regions: list[str], data_dir: Path, output_dir: Path) -> Path:
    data_dir, output_dir = Path(data_dir), Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in data_dir.iterdir() if p.is_file() and region_of(p.name) in regions)
    if not files:
        raise RuntimeError(f"No processed files for {regions} in {data_dir}")
    try:
        pipeline = json.loads((data_dir / "pipeline_manifest.json").read_text()).get("regions", {})
    except (OSError, ValueError):
        pipeline = {}
    entries = []
    for i, path in enumerate(files):
        progress("export", i, len(files), f"Hashing {path.name}")
        entries.append({"name": path.name, "region": region_of(path.name),
                        "bytes": path.stat().st_size, "sha256": sha256_file(path)})
    manifest = {"format": FORMAT, "format_version": FORMAT_VERSION, "created_at": utc_now_iso(),
                "model_version": MODEL_VERSION, "regions": sorted(regions), "files": entries,
                "pipeline": {k: _public_entry(pipeline[k], data_dir) for k in regions if k in pipeline}}
    stamp = utc_now_iso().replace(":", "").replace("-", "")
    target = output_dir / f"tidewatch-data-{'-'.join(sorted(regions)) if len(regions) <= 3 else f'{len(regions)}regions'}-v{MODEL_VERSION}-{stamp}.tar.gz"
    tmp = target.with_name(target.name + ".part")
    with tarfile.open(tmp, "w:gz") as tar:
        data = json.dumps(manifest, indent=2).encode()
        info = tarfile.TarInfo(MANIFEST_NAME)
        info.size = len(data)
        import io
        tar.addfile(info, io.BytesIO(data))
        for i, path in enumerate(files):
            progress("export", i, len(files), f"Packing {path.name}")
            tar.add(path, arcname=path.name, recursive=False)
    tmp.replace(target)
    progress("export", 1, 1, f"Package ready: {target.name}")
    print(f"✓ Package: {target} ({target.stat().st_size / 1e6:.1f} MB, {len(files)} files)")
    return target


def _download(url: str, dest: Path) -> Path:
    if not url.startswith("https://"):
        raise ValueError("Only https:// package URLs are accepted")
    with make_session() as session, session.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        total = int(response.headers.get("Content-Length") or 0)
        if total > MAX_DOWNLOAD_BYTES:
            raise ValueError("Package is larger than the 8 GB limit")
        got = 0
        with dest.open("wb") as out:
            for chunk in response.iter_content(1 << 20):
                got += len(chunk)
                if got > MAX_DOWNLOAD_BYTES:
                    raise ValueError("Package exceeded the 8 GB limit")
                out.write(chunk)
                progress("download", got, total or None, f"Downloaded {got / 1e6:.0f} MB")
    return dest


def _major(version: str) -> str:
    return str(version).split(".")[0]


def import_package(source: str, data_dir: Path, allow_other_model: bool = False, label: str | None = None) -> dict:
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="_import_", dir=data_dir))
    try:
        archive = Path(source)
        if source.startswith("https://") or source.startswith("http://"):
            archive = _download(source, staging / "package.tar.gz")
        if not archive.is_file():
            raise FileNotFoundError(f"Package not found: {source}")
        with tarfile.open(archive, "r:*") as tar:
            members = tar.getmembers()
            names = {m.name: m for m in members}
            if MANIFEST_NAME not in names:
                raise ValueError("Not a TIDEWATCH dataset package (manifest missing)")
            manifest = json.load(tar.extractfile(names[MANIFEST_NAME]))
            if manifest.get("format") != FORMAT or manifest.get("format_version") != FORMAT_VERSION:
                raise ValueError("Unsupported package format/version")
            if _major(manifest.get("model_version", "0")) != _major(MODEL_VERSION) and not allow_other_model:
                raise ValueError(f"Package model {manifest.get('model_version')} is incompatible with "
                                 f"this installation ({MODEL_VERSION})")
            expected = {f["name"]: f for f in manifest.get("files", [])}
            unknown_regions = [r for r in manifest.get("regions", []) if r not in REGIONS]
            if unknown_regions:
                raise ValueError(f"Package contains regions not configured here: {unknown_regions}")
            for i, (name, entry) in enumerate(expected.items()):
                member = names.get(name)
                if member is None or not member.isfile() or "/" in name or "\\" in name or region_of(name) is None:
                    raise ValueError(f"Missing or disallowed file in package: {name}")
                if member.size != entry["bytes"]:
                    raise ValueError(f"Size mismatch for {name}")
                progress("import", i, len(expected), f"Verifying {name}")
                src = tar.extractfile(member)
                digest = hashlib.sha256()
                with (staging / name).open("wb") as out:
                    for chunk in iter(lambda: src.read(1 << 20), b""):
                        digest.update(chunk)
                        out.write(chunk)
                if digest.hexdigest() != entry["sha256"]:
                    raise ValueError(f"Checksum mismatch for {name}")
        for name in expected:
            if name.endswith(".json") and not validate_output(staging / name):
                raise ValueError(f"{name} failed validation")

        installed = []
        for region in manifest["regions"]:
            for old in data_dir.iterdir():
                if old.is_file() and region_of(old.name) == region:
                    old.unlink()
            for name, entry in expected.items():
                if entry["region"] == region:
                    os.replace(staging / name, data_dir / name)
                    installed.append(name)
        manifest_path = data_dir / "pipeline_manifest.json"
        try:
            pipeline = json.loads(manifest_path.read_text())
        except (OSError, ValueError):
            pipeline = {"model_version": manifest["model_version"], "regions": {}}
        for region, entry in (manifest.get("pipeline") or {}).items():
            if entry:
                pipeline.setdefault("regions", {})[region] = {**entry, "imported_at": utc_now_iso(),
                                                             "imported_from": label or os.path.basename(source)}
        pipeline["generated_at"] = utc_now_iso()
        pipeline.setdefault("model_version", manifest["model_version"])
        write_json(manifest_path, pipeline)
        progress("import", 1, 1, f"Installed {len(installed)} files")
        print(f"✓ Imported {len(installed)} files for {', '.join(manifest['regions'])}")
        return {"regions": manifest["regions"], "files": len(installed), "model_version": manifest["model_version"]}
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Export or import TIDEWATCH dataset packages")
    sub = parser.add_subparsers(dest="command", required=True)
    exp = sub.add_parser("export")
    exp.add_argument("--regions", nargs="+", required=True, choices=list(REGIONS))
    exp.add_argument("--output", type=Path, required=True)
    exp.add_argument("--data-dir", type=Path, default=PROCESSED_DIR)
    imp = sub.add_parser("import")
    imp.add_argument("--source", required=True, help="Path or https:// URL of a .tar.gz package")
    imp.add_argument("--data-dir", type=Path, default=PROCESSED_DIR)
    imp.add_argument("--allow-other-model", action="store_true")
    imp.add_argument("--label", help="Name to record as the package source")
    args = parser.parse_args(argv)
    if args.command == "export":
        export_package(args.regions, args.data_dir, args.output)
    else:
        import_package(args.source, args.data_dir, args.allow_other_model, args.label)
    return 0


if __name__ == "__main__":
    import signal
    import sys
    # Cancel from the Data panel sends SIGTERM: exit through finally-blocks so
    # staging folders are removed and existing outputs stay untouched.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    raise SystemExit(main())
