// https://regex101.com/r/rS5Ijq/1
const NUMBER_IN_FIRST_FOUR_CHARS = /^(?=[A-Z0-9]{8}$)(?=[A-Z0-9]{0,3}[0-9])[A-Z0-9]{8}/
const IS_REST = /^POST|GET|PUT|DELETE|PATCH|OPTIONS|HEAD/
const debugKey = ''

/**
 * Find common random strings (like hex codes) in a list of IDs
 * @param {string[]} ids - List of IDs to search through
 * @returns {Map<string, number>} Map of random strings to their frequency
 */
function findCommonRandomStringsInIds(logicalIds, debug = false) {
  const postfixes = new Map(); // Map to store postfix -> [count, matches[], pattern]
  const seenMatches = new Map(); // Track which IDs have matched which postfixes
  const matchedRanges = new Map(); // Track matched ranges for each ID: ID -> [[start, end]]
  
  function hasOverlap(id, start, end) {
    const ranges = matchedRanges.get(id) || [];
    return ranges.some(([existingStart, existingEnd]) => {
      return (start >= existingStart && start <= existingEnd) || 
             (end >= existingStart && end <= existingEnd);
    });
  }

  function addRange(id, start, end) {
    const ranges = matchedRanges.get(id) || [];
    ranges.push([start, end]);
    matchedRanges.set(id, ranges);
  }

  // Look for patterns at the end of logical IDs that:
  // 1. 64-char hex pattern (like dcd2c84fda5b77d0d4b17b94d3581fbec6b5bd107cd4f898c2961d5b16e24cab)
  // 2. 40-char hex pattern (like 663240D697c3cdfc601da74f263d2bb8dcbb4a90)
  // 3. Standard 8-char pattern (like ADDA7DEB)
  // 4. Longer hex pattern (like 1cd5ccdaa0c6)
  const patterns = [
    /[a-f0-9]{64}/g,  // 64-char hex hash (SHA-256)
    /[A-Fa-f0-9]{40}$/g,  // 40-char hex deployment id
    /[A-Z0-9]{8}$/g,    // Standard pattern (ADDA7DEB)
  
    ///\d[A-Z0-9]{7}/g,  // Starts with number (03AA31B2)
    /[A-Z][0-9A-Z]{7}/g, // Starts with letter (E5522E5D)
    /[a-f0-9]{12}$/g,   // 12-char lowercase hex
    /\d[A-Z0-9]{7}/g,  // Starts with number (03AA31B2)
  ]
  
  for (const id of logicalIds) {
    // Try each pattern
    for (const pattern of patterns) {
      const matches = Array.from(id.matchAll(pattern));
      for (const match of matches) {
        const postfix = match[0];
        const matchStart = match.index;
        const matchEnd = matchStart + postfix.length - 1;
        
        // Skip if we've already seen this postfix for this ID
        const key = `${id}:${postfix}`;
        if (seenMatches.has(key)) continue;

        // Skip if this match overlaps with an existing match
        if (hasOverlap(id, matchStart, matchEnd)) continue;

        // For standard 8-char patterns
        if (postfix.length === 8) {
          if (IS_REST.test(postfix)) continue;
          /* Matches must have 1 digit and 1 letter in the first 4 characters or start with 4 capital letters */
          if (/[0-9]/.test(postfix) && (NUMBER_IN_FIRST_FOUR_CHARS.test(postfix) || /^[A-Z]{4}/.test(postfix))) {
            const existing = postfixes.get(postfix) || [0, [], pattern];
            existing[0] += 1;
            existing[1].push(id);
            postfixes.set(postfix, existing);
            addRange(id, matchStart, matchEnd);
          }
        }
        // For longer hex patterns
        else if (postfix.length === 40 || postfix.length === 64 || postfix.length === 12) {
          if (/[A-Fa-f]/.test(postfix) && /[0-9]/.test(postfix)) {
            const existing = postfixes.get(postfix) || [0, [], pattern];
            existing[0] += 1;
            existing[1].push(id);
            postfixes.set(postfix, existing);
            addRange(id, matchStart, matchEnd);
          }
        }
      }
    }
  }

  return Array.from(postfixes.entries())
    .map(([postfix, [count, matches, pattern]]) => 
      debug 
        ? [postfix, count, matches, pattern]
        : [postfix, count, matches]
    )
    .sort(([p1, c1], [p2, c2]) => {
      // First sort by length (descending)
      if (p1.length !== p2.length) {
        return p2.length - p1.length;
      }
      // Then by count (descending)
      return c2 - c1;
    });
}

module.exports = {
  findCommonRandomStringsInIds
} 