#!/bin/bash

# List Structure Changes Script
# Shows files changed since last push to origin/main, excluding client/* files
# For each file: displays filename, change summary, and diff
#
# Usage:
#   ./list-structure-changes.sh              # Uses origin/main or auto-detects last merge
#   ./list-structure-changes.sh <commit>     # Uses specified commit as base

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Determine base commit
if [ -n "$1" ]; then
    BASE_COMMIT="$1"
    echo -e "${CYAN}Using provided base commit: ${BASE_COMMIT}${NC}"
else
    # Try origin/main first
    BASE_COMMIT="origin/main"
    
    # Check if origin/main has any differences
    diff_check=$(git --no-pager diff --name-only "$BASE_COMMIT"..HEAD 2>/dev/null)
    
    if [ -z "$diff_check" ]; then
        # Try to find the last merge commit from origin
        MERGE_COMMIT=$(git --no-pager log --oneline --merges -1 --format="%H" 2>/dev/null)
        
        if [ -n "$MERGE_COMMIT" ]; then
            BASE_COMMIT="$MERGE_COMMIT"
            echo -e "${CYAN}Using last merge commit as base: ${BASE_COMMIT:0:7}${NC}"
        else
            # Fall back to finding commits with "Merge" in message
            MERGE_COMMIT=$(git --no-pager log --oneline --grep="Merge" -1 --format="%H" 2>/dev/null)
            if [ -n "$MERGE_COMMIT" ]; then
                BASE_COMMIT="$MERGE_COMMIT"
                echo -e "${CYAN}Using merge commit as base: ${BASE_COMMIT:0:7}${NC}"
            fi
        fi
    fi
fi

# Get list of changed files, excluding client/* and attached_assets/*
changed_files=$(git --no-pager diff --name-only "$BASE_COMMIT"..HEAD -- ':!client/*' ':!attached_assets/*' 2>/dev/null)

if [ -z "$changed_files" ]; then
    echo -e "${YELLOW}No files changed since ${BASE_COMMIT} (excluding client/* and attached_assets/*).${NC}"
    echo ""
    echo -e "${CYAN}Tip: You can specify a base commit manually:${NC}"
    echo "  ./list-structure-changes.sh <commit-hash>"
    exit 0
fi

# Count files
file_count=$(echo "$changed_files" | wc -l)
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Files Changed Since: ${BASE_COMMIT:0:12}${NC}"
echo -e "${BLUE}  (excluding client/* and attached_assets/*)${NC}"
echo -e "${BLUE}  Total: ${file_count} file(s)${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Process each file
for file in $changed_files; do
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
    echo -e "${GREEN}📄 FILE: ${YELLOW}${file}${NC}"
    echo -e "${GREEN}────────────────────────────────────────────────────────────────${NC}"
    
    # Get insertions and deletions count
    stats=$(git --no-pager diff --numstat "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null)
    insertions=$(echo "$stats" | awk '{print $1}')
    deletions=$(echo "$stats" | awk '{print $2}')
    
    # Handle binary files
    if [ "$insertions" = "-" ]; then
        echo -e "${CYAN}📊 SUMMARY:${NC} Binary file changed"
    else
        echo -e "${CYAN}📊 SUMMARY:${NC} +${insertions:-0} insertions, -${deletions:-0} deletions"
    fi
    echo ""
    
    echo -e "${CYAN}📝 DIFF:${NC}"
    echo ""
    
    # Show the diff with context
    git --no-pager diff "$BASE_COMMIT"..HEAD -- "$file" 2>/dev/null
    
    echo ""
done

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  End of Changes Report${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
