#!/usr/bin/env bash
#
# bump-version.sh — Semantic version bump for JetLag
#
# Usage:
#   ./scripts/bump-version.sh major    # 0.2.0 → 1.0.0
#   ./scripts/bump-version.sh minor    # 0.2.0 → 0.3.0
#   ./scripts/bump-version.sh patch    # 0.2.0 → 0.2.1
#   ./scripts/bump-version.sh set 1.5.0  # set explicit version
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION_FILE="$ROOT_DIR/VERSION"
PACKAGE_JSON="$ROOT_DIR/frontend/package.json"
CONFLUENCE_DOC="$ROOT_DIR/docs/confluence-jetlag.md"

if [ ! -f "$VERSION_FILE" ]; then
    echo "ERROR: VERSION file not found at $VERSION_FILE"
    exit 1
fi

CURRENT=$(cat "$VERSION_FILE" | tr -d '[:space:]')
echo "Current version: $CURRENT"

# Parse current version (strip any prerelease suffix for arithmetic)
CORE="${CURRENT%%-*}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CORE"

case "${1:-}" in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
    set)
        if [ -z "${2:-}" ]; then
            echo "Usage: $0 set <version>"
            exit 1
        fi
        NEW_VERSION="$2"
        ;;
    *)
        echo "Usage: $0 {major|minor|patch|set <version>}"
        echo ""
        echo "Current version: $CURRENT"
        exit 1
        ;;
esac

NEW_VERSION="${NEW_VERSION:-$MAJOR.$MINOR.$PATCH}"

echo "New version:     $NEW_VERSION"
echo ""

# 1. Update VERSION file
echo "$NEW_VERSION" > "$VERSION_FILE"
echo "  ✓ VERSION"

# 2. Update frontend/package.json
if [ -f "$PACKAGE_JSON" ]; then
    if command -v sed &>/dev/null; then
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
        rm -f "${PACKAGE_JSON}.bak"
        echo "  ✓ frontend/package.json"
    else
        echo "  ⚠ sed not available — update frontend/package.json manually"
    fi
fi

# 3. Update Confluence doc version header and footer
if [ -f "$CONFLUENCE_DOC" ]; then
    sed -i.bak "s/\*\*Version:\*\* [0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*/\*\*Version:\*\* $NEW_VERSION/" "$CONFLUENCE_DOC"
    sed -i.bak "s/JetLag v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*/JetLag v$NEW_VERSION/g" "$CONFLUENCE_DOC"
    rm -f "${CONFLUENCE_DOC}.bak"
    echo "  ✓ docs/confluence-jetlag.md"
fi

echo ""
echo "Version bumped to $NEW_VERSION"
echo ""
echo "Next steps:"
echo "  git add VERSION frontend/package.json docs/confluence-jetlag.md"
echo "  git commit -m \"chore: bump version to $NEW_VERSION\""
echo "  git tag v$NEW_VERSION"
