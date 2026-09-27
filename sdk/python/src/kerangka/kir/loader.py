"""
Kerangka KIR Document Loader in Python.
"""

import json
from pathlib import Path
from typing import Dict, Any


def load_kir(file_path: str | Path) -> Dict[str, Any]:
    """Loads and decodes a Kerangka Intermediate Representation (KIR) JSON file."""
    path = Path(file_path)
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
