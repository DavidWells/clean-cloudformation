// https://regex101.com/r/rS5Ijq/1
const NUMBER_IN_FIRST_FOUR_CHARS = /^(?=[A-Z0-9]{8}$)(?=[A-Z0-9]{0,3}[0-9])[A-Z0-9]{8}/

/**
 * Find common random strings (like hex codes) in a list of IDs
 * @param {string[]} ids - List of IDs to search through
 * @returns {Map<string, number>} Map of random strings to their frequency
 */
function findCommonRandomStringsInIds(logicalIds, debug = false) {
  const postfixes = new Map(); // Map to store postfix -> [count, matches[], pattern]
  const seenMatches = new Map(); // Track which IDs have matched which postfixes
  
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
    /[a-f0-9]{12}$/g,   // 12-char lowercase hex
    // 8 digits
    /\d{8}/g
  ];

  const debugKey = 'SendEmailEndPointsendmailPOSTApiPermissionTestPythonStackSendEmailEndPoint74996537POSTsendmail'
  
  for (const id of logicalIds) {

    // Try each pattern
    for (const pattern of patterns) {
      const matches = Array.from(id.matchAll(pattern));
      for (const match of matches) {
        const postfix = match[0];
    
        // Skip if we've already seen this postfix for this ID
        const key = `${id}:${postfix}`;
        if (seenMatches.has(key)) continue;
        seenMatches.set(key, true);

        // For standard 8-char patterns
        if (postfix.length === 8) {
          
          // NUMBER_IN_FIRST_FOUR_CHARS OR first 4 chars capital or all digits
          if (NUMBER_IN_FIRST_FOUR_CHARS.test(postfix) || /^[A-Z]{4}/.test(postfix) || /\d{8}/.test(postfix)) {
            if (id === debugKey) {
              console.log('postfix', postfix, /\d{8}/.test(postfix))
              // process.exit(0)
            }
            const existing = postfixes.get(postfix) || [0, [], pattern];
            existing[0] += 1;
            existing[1].push(id);
            postfixes.set(postfix, existing);
          }
        }
        // For longer hex patterns (40, 64, or 12 chars)
        else if (postfix.length === 40 || postfix.length === 64 || postfix.length === 12) {
          if (/[A-Fa-f]/.test(postfix) && /[0-9]/.test(postfix)) {
            const existing = postfixes.get(postfix) || [0, [], pattern];
            existing[0] += 1;
            existing[1].push(id);
            postfixes.set(postfix, existing);
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