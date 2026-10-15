import runpy
import unittest
from pathlib import Path
from unittest.mock import patch


class StartupTests(unittest.TestCase):
    def test_direct_python_entry_starts_existing_app_on_localhost(self):
        with patch("uvicorn.run") as serve:
            namespace = runpy.run_path(
                str(Path(__file__).resolve().parents[1] / "app.py"),
                run_name="__main__",
            )
        serve.assert_called_once_with(namespace["app"], host="127.0.0.1", port=8765)


if __name__ == "__main__":
    unittest.main()
