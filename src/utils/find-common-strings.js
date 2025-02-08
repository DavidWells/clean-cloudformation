/**
 * Find common random strings (like hex codes) in a list of IDs
 * @param {string[]} ids - List of IDs to search through
 * @returns {Map<string, number>} Map of random strings to their frequency
 */
function findCommonRandomStringsInIds(logicalIds) {
  const postfixes = new Map(); // Map to store postfix -> count
  
  // Look for patterns at the end of logical IDs that:
  // 1. 64-char hex pattern (like dcd2c84fda5b77d0d4b17b94d3581fbec6b5bd107cd4f898c2961d5b16e24cab)
  // 2. 40-char hex pattern (like 663240D697c3cdfc601da74f263d2bb8dcbb4a90)
  // 3. Standard 8-char pattern (like ADDA7DEB)
  // 4. Longer hex pattern (like 1cd5ccdaa0c6)
  const patterns = [
    /[a-f0-9]{64}/g,  // 64-char hex hash (SHA-256)
    /[A-Fa-f0-9]{40}$/g,  // 40-char hex deployment id
    /[A-Z0-9]{8}/g,    // Standard pattern (ADDA7DEB)
    /\d[A-Z0-9]{7}/g,  // Starts with number (03AA31B2)
    /[A-Z][0-9A-Z]{7}/g, // Starts with letter (E5522E5D)
    /[a-f0-9]{12}$/g   // 12-char lowercase hex
  ];
  
  for (const id of logicalIds) {
    // Try each pattern
    for (const pattern of patterns) {
      const matches = Array.from(id.matchAll(pattern));
      for (const match of matches) {
        const postfix = match[0];
        // For standard 8-char patterns
        if (postfix.length === 8) {
          if (/[A-Z]/.test(postfix) && /[0-9]/.test(postfix)) {
            postfixes.set(postfix, (postfixes.get(postfix) || 0) + 1);
          }
        }
        // For longer hex patterns (40, 64, or 12 chars)
        else if (postfix.length === 40 || postfix.length === 64 || postfix.length === 12) {
          if (/[A-Fa-f]/.test(postfix) && /[0-9]/.test(postfix)) {
            postfixes.set(postfix, (postfixes.get(postfix) || 0) + 1);
          }
        }
      }
    }
  }

  return Array.from(postfixes.entries())
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