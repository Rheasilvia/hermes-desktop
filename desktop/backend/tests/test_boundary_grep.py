import subprocess
from pathlib import Path


def test_check_boundaries_script_passes():
    script = Path(__file__).parent.parent / "scripts" / "check_boundaries.sh"
    result = subprocess.run([str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
