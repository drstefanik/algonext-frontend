from __future__ import annotations

import re
from pathlib import Path


ROUTE_CONTEXT_PATTERN = re.compile(
    r"(type\s+RouteContext\s*=\s*\{\s*\n\s*)params:\s*\{"
    r"(?P<body>.*?)"
    r"\n\s*\};"
    r"(?P<suffix>\s*\n\};)",
    re.DOTALL,
)

HANDLER_PATTERN = re.compile(
    r"(export\s+async\s+function\s+\w+\s*\(.*?"
    r"\{\s*params\s*\}\s*:\s*RouteContext\s*\)\s*\{)",
    re.DOTALL,
)


def migrate_route(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    if "type RouteContext" not in original or "params: Promise<" in original:
        return False

    migrated, context_count = ROUTE_CONTEXT_PATTERN.subn(
        lambda match: (
            f"{match.group(1)}params: Promise<{{"
            f"{match.group('body')}"
            f"\n  }}>;"
            f"{match.group('suffix')}"
        ),
        original,
        count=1,
    )
    if context_count == 0:
        return False

    migrated, handler_count = HANDLER_PATTERN.subn(
        lambda match: f"{match.group(1)}\n  const resolvedParams = await params;",
        migrated,
    )
    if handler_count == 0:
        raise RuntimeError(f"RouteContext migrated but no handler matched: {path}")

    migrated = migrated.replace("params.", "resolvedParams.")
    path.write_text(migrated, encoding="utf-8")
    return True


def main() -> None:
    changed: list[str] = []
    for path in sorted(Path("app").rglob("route.ts")):
        if migrate_route(path):
            changed.append(path.as_posix())

    if changed:
        print("Migrated Next.js 15 route params:")
        for path in changed:
            print(f"- {path}")
    else:
        print("No synchronous RouteContext declarations remain.")


if __name__ == "__main__":
    main()
