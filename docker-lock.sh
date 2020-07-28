#!/usr/bin/env bash

set -eou pipefail

repo="${1}"
owner="${2}"
token="${3}"
tmp_dir="${4}"

cd "./${tmp_dir}"

# https://developer.github.com/apps/building-github-apps/authenticating-with-github-apps/
git clone "https://x-access-token:${token}@github.com/${owner}/${repo}.git"
cd "${repo}"

lockfile="docker-lock.json"

docker lock generate
mv "${lockfile}" ../

# if docker-lock.json does not exist, diffs will contain "DOES NOT EXIST"
# if docker-lock.json exists, will contain diffs (if there are no diffs, will contain "")
# TODO: default branch instead of master
diffs=$(git diff "master:${lockfile}" "${lockfile}" 2>/dev/null || echo "DOES NOT EXIST")

if [[ "${diffs}" != "" ]]; then
    echo "true"
    exit 0
fi
echo "false"
