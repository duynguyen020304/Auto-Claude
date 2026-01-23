#!/bin/bash

# Script to scan for hardcoded strings in React components
# This script searches for common patterns of hardcoded user-facing strings

echo "# i18n Audit Report - Hardcoded Strings Found"
echo ""
echo "## Scanning Summary"
echo "- Scanning directory: apps/frontend/src/renderer/"
echo "- Total TSX/JSX files: $(find apps/frontend/src/renderer -type f \( -name "*.tsx" -o -name "*.jsx" \) | wc -l)"
echo "- Files using i18n: $(grep -r "useTranslation" apps/frontend/src/renderer --include="*.tsx" --include="*.jsx" -l | wc -l)"
echo ""

echo "## Findings by Category"
echo ""

# Function to search for patterns
search_pattern() {
    local pattern="$1"
    local category="$2"
    local description="$3"

    echo "### $category"
    echo "$description"
    echo ""
    echo "| File | Line | Hardcoded String | Suggested Translation Key |"
    echo "|------|------|------------------|---------------------------|"

    grep -rn "$pattern" apps/frontend/src/renderer --include="*.tsx" | grep -v "test\.tsx" | grep -v "t('" | while IFS=: read -r file line content; do
        # Extract the hardcoded string from the content
        if [[ $content =~ $pattern ]]; then
            string_value="${BASH_REMATCH[1]}"
            # Only show if it looks like a user-facing string
            if [[ $string_value =~ [A-Z][a-zA-Z\s]+ ]]; then
                echo "| $file | $line | $string_value | TODO |"
            fi
        fi
    done
    echo ""
}

# Search for DialogTitle with hardcoded text
echo "### Dialog Titles"
echo "| File | Line | Hardcoded String | Suggested Translation Key |"
echo "|------|------|------------------|---------------------------|"
grep -rn '<DialogTitle[^>]*>' apps/frontend/src/renderer --include="*.tsx" | grep -v "test\.tsx" | grep -v "t('" | grep -E '>[A-Z]' | while IFS=: read -r file line content; do
    if [[ $content =~ \>([^<]+)\< ]]; then
        title="${BASH_REMATCH[1]}"
        if [[ $title =~ [A-Z][a-zA-Z\s]+ ]]; then
            echo "| $file | $line | $title | dialogs:titles.* |"
        fi
    fi
done
echo ""

# Search for Button text
echo "### Button Text"
echo "| File | Line | Hardcoded String | Suggested Translation Key |"
echo "|------|------|------------------|---------------------------|"
grep -rn '<Button[^>]*>' apps/frontend/src/renderer --include="*.tsx" | grep -v "test\.tsx" | grep -v "t('" | grep '>' | head -50 | while IFS=: read -r file line content; do
    if [[ $content =~ \>([^<]+)\< ]]; then
        text="${BASH_REMATCH[1]}"
        if [[ $text =~ [A-Z][a-zA-Z]+ ]]; then
            echo "| $file | $line | $text | common:buttons.* |"
        fi
    fi
done
echo ""

# Search for Label components
echo "### Labels"
echo "| File | Line | Hardcoded String | Suggested Translation Key |"
echo "|------|------|------------------|---------------------------|"
grep -rn '<Label[^>]*>' apps/frontend/src/renderer --include="*.tsx" | grep -v "test\.tsx" | grep -v "htmlFor" | grep -v "t('" | grep '>' | head -50 | while IFS=: read -r file line content; do
    if [[ $content =~ \>([^<]+)\< ]]; then
        label="${BASH_REMATCH[1]}"
        if [[ $label =~ [A-Z][a-zA-Z]+ ]]; then
            echo "| $file | $line | $label | common:labels.* |"
        fi
    fi
done
echo ""

echo "## Next Steps"
echo "1. Review each hardcoded string"
echo "2. Check if a translation key already exists"
echo "3. Add new translation keys if needed"
echo "4. Replace hardcoded strings with t() function calls"
