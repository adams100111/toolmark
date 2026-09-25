#!/usr/bin/env bash
# Release tag guard (SEC-15), run by release.yml's "Git tags and GitHub releases" step before and
# after each `gh release create`: `gh release create` attaches a release to an existing tag and
# ignores `--target`, so an existing `<name>@<version>` tag must point at this run's commit.
#
#   scripts/require-tag-at-sha.sh [--must-exist] <remote> <tag> <commit-sha>
#
# Reads the tag with `git ls-remote` (annotated tags peeled to the commit through the `^{}` entry)
# and matches the ref name exactly. Exits 0 when the tag is absent (unless --must-exist) or points
# at <commit-sha>; 1 when it points anywhere else, is absent with --must-exist, or the remote
# cannot be read (fail closed); 2 on a usage error. With --must-exist an absent tag is re-read up
# to $REQUIRE_TAG_ATTEMPTS times (default 5, 3 s apart) to ride out replication lag.
set -euo pipefail

usage() {
  echo "usage: require-tag-at-sha.sh [--must-exist] <remote> <tag> <40-hex commit sha>" >&2
  exit 2
}

must_exist=false
if [ "${1:-}" = --must-exist ]; then
  must_exist=true
  shift
fi
[ "$#" -eq 3 ] || usage
remote=$1
tag=$2
sha=$3
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || usage
# Also rejects the glob characters `*`, `?` and `[` that `git ls-remote` patterns would expand.
[ -n "$tag" ] && git check-ref-format "refs/tags/$tag" || usage
attempts=${REQUIRE_TAG_ATTEMPTS:-5}
[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || usage

ref="refs/tags/$tag"
at=
for ((i = 1; ; i++)); do
  # The `^{}` pattern is needed: with a pattern, ls-remote lists a peeled entry only if asked.
  if ! out=$(git ls-remote --tags "$remote" "$ref" "$ref^{}"); then
    echo "::error::cannot read tag $tag from $remote; refusing to release it"
    exit 1
  fi
  # Exact ref names only (ls-remote patterns match any ref ending in the pattern); the peeled
  # `^{}` entry of an annotated tag wins over the tag object itself.
  at=$(awk -v r="$ref" '$2 == r "^{}" { p = $1 } $2 == r { d = $1 } END { print (p != "" ? p : d) }' <<< "$out")
  if [ -n "$at" ] || [ "$must_exist" = false ] || [ "$i" -ge "$attempts" ]; then break; fi
  sleep 3
done

if [ -z "$at" ]; then
  if [ "$must_exist" = true ]; then
    echo "::error::tag $tag does not exist after the release was created"
    exit 1
  fi
  echo "tag $tag does not exist yet"
  exit 0
fi
if [ "$at" != "$sha" ]; then
  echo "::error::tag $tag points at $at, not $sha; refusing to release it"
  exit 1
fi
echo "tag $tag points at $sha"
