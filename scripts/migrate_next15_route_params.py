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
    r")"
    r"(?!\s*const\s+resolvedParams\s*=\s*await\s+params\s*;)",
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

CONTEXT_AWAIT_PATTERN = re.compile(
    r"const\s+resolvedParams\s*=\s*await\s+"
    r"(?P<context_name>[A-Za-z_$][\w$]*)\.params\s*;"
)


def migrate_context_type(source: str) -> tuple[str, bool]:
    if "params: Promise<" in source:
        return source, False

    migrated, count = ROUTE_CONTEXT_PATTERN.subn(
        lambda match: (
            f"{match.group(1)}params: Promise<{{"
            f"{match.group('body')}"
            f"\n  }}>;"
            f"{match.group('suffix')}"
        ),
        source,
        count=1,
    )
    return migrated, count > 0


def insert_missing_awaits(source: str) -> tuple[str, int]:
    migrated, destructured_count = DESTRUCTURED_HANDLER_PATTERN.subn(
        lambda match: f"{match.group(1)}\n  const resolvedParams = await params;",
        source,
    )

    context_count = 0
    context_names = {
        match.group("context_name")
        for match in CONTEXT_HANDLER_PATTERN.finditer(migrated)
    }
    for context_name in context_names:
        declaration = f"const resolvedParams = await {context_name}.params;"
        if declaration in migrated:
            continue

        pattern = re.compile(
            r"("
            r"(?:export\s+async\s+function\s+\w+\s*\(|export\s+const\s+\w+\s*=\s*async\s*\()"
            rf".*?{re.escape(context_name)}\s*:\s*RouteContext\s*"
            r"(?:\)\s*\{|=>\s*\{)"
            r")",
            re.DOTALL,
        )
        migrated, count = pattern.subn(
            lambda match: f"{match.group(1)}\n  {declaration}",
            migrated,
        )
        context_count += count

    return migrated, destructured_count + context_count


def cleanup_param_usages(source: str) -> str:
    migrated = source

    context_declarations = list(CONTEXT_AWAIT_PATTERN.finditer(migrated))
    for index, match in enumerate(context_declarations):
        context_name = match.group("context_name")
        declaration = match.group(0)
        token = f"__ALGO_NEXT_CONTEXT_AWAIT_{index}__"
        migrated = migrated.replace(declaration, token)
        migrated = migrated.replace(f"{context_name}.params", "resolvedParams")
        migrated = migrated.replace(token, declaration)

    destructured_declaration = "const resolvedParams = await params;"
    if destructured_declaration in migrated:
        token = "__ALGO_NEXT_DESTRUCTURED_AWAIT__"
        migrated = migrated.replace(destructured_declaration, token)
        migrated = migrated.replace("params.", "resolvedParams.")
        migrated = re.sub(r"=\s*params\s*;", "= resolvedParams;", migrated)
        migrated = migrated.replace(token, destructured_declaration)

    return migrated


def migrate_route(path: Path) -> tuple[bool, str | None]:
    original = path.read_text(encoding="utf-8")
    if "type RouteContext" not in original:
        return False, None

    migrated, context_changed = migrate_context_type(original)
    if not context_changed and "params: Promise<" not in migrated:
        return False, "unrecognized RouteContext declaration"

    migrated, inserted_awaits = insert_missing_awaits(migrated)
    migrated = cleanup_param_usages(migrated)

    if migrated == original:
        return False, None

    if inserted_awaits == 0 and "const resolvedParams = await" not in migrated:
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
