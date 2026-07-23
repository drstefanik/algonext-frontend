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

DESTRUCTURED_HANDLER_PATTERN = re.compile(
    r"("
    r"(?:export\s+async\s+function\s+\w+\s*\(|export\s+const\s+\w+\s*=\s*async\s*\()"
    r".*?\{\s*params\s*\}\s*:\s*RouteContext\s*"
    r"(?:\)\s*\{|=>\s*\{)"
    r")",
    re.DOTALL,
)

CONTEXT_HANDLER_PATTERN = re.compile(
    r"("
    r"(?:export\s+async\s+function\s+\w+\s*\(|export\s+const\s+\w+\s*=\s*async\s*\()"
    r".*?(?P<context_name>[A-Za-z_$][\w$]*)\s*:\s*RouteContext\s*"
    r"(?:\)\s*\{|=>\s*\{)"
    r")",
    re.DOTALL,
)


def migrate_route(path: Path) -> tuple[bool, str | None]:
    original = path.read_text(encoding="utf-8")
    if "type RouteContext" not in original or "params: Promise<" in original:
        return False, None

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
        return False, "unrecognized RouteContext declaration"

    handler_count = 0

    migrated, destructured_count = DESTRUCTURED_HANDLER_PATTERN.subn(
        lambda match: f"{match.group(1)}\n  const resolvedParams = await params;",
        migrated,
    )
    if destructured_count:
        handler_count += destructured_count
        migrated = migrated.replace("params.", "resolvedParams.")

    context_names = {
        match.group("context_name")
        for match in CONTEXT_HANDLER_PATTERN.finditer(migrated)
    }
    for context_name in context_names:
        pattern = re.compile(
            r"("
            r"(?:export\s+async\s+function\s+\w+\s*\(|export\s+const\s+\w+\s*=\s*async\s*\()"
            rf".*?{re.escape(context_name)}\s*:\s*RouteContext\s*"
            r"(?:\)\s*\{|=>\s*\{)"
            r")",
            re.DOTALL,
        )
        migrated, count = pattern.subn(
            lambda match: (
                f"{match.group(1)}\n"
                f"  const resolvedParams = await {context_name}.params;"
            ),
            migrated,
        )
        if count:
            handler_count += count
            migrated = migrated.replace(
                f"{context_name}.params.",
                "resolvedParams.",
            )

    if handler_count == 0:
        return False, "unrecognized route handler signature"

    path.write_text(migrated, encoding="utf-8")
    return True, None


def main() -> None:
    changed: list[str] = []
    skipped: list[tuple[str, str]] = []

    for path in sorted(Path("app").rglob("route.ts")):
        migrated, reason = migrate_route(path)
        if migrated:
            changed.append(path.as_posix())
        elif reason:
            skipped.append((path.as_posix(), reason))

    if changed:
        print("Migrated Next.js 15 route params:")
        for path in changed:
            print(f"- {path}")
    else:
        print("No recognized synchronous RouteContext declarations remain.")

    if skipped:
        print("Skipped route files requiring manual review:")
        for path, reason in skipped:
            print(f"- {path}: {reason}")


if __name__ == "__main__":
    main()
