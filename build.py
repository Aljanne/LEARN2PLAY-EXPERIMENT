"""Prepare Flask static assets for Vercel's public asset serving."""

from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parent
shutil.copytree(ROOT / "static", ROOT / "public" / "static", dirs_exist_ok=True)
