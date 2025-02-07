
// Cache for resource blocks
const resourceBlockCache = new Map()

function getCacheKey(yamlString, logicalId) {
  // Simple cache key combining the yaml length and logicalId
  return `${yamlString.length}:${logicalId}`
}

function getResourceBlock(yamlString, logicalId) {
  const cacheKey = getCacheKey(yamlString, logicalId)
  
  // Check cache first
  if (resourceBlockCache.has(cacheKey)) {
    return resourceBlockCache.get(cacheKey)
  }

  // Parse YAML to get indentation info
  const lines = yamlString.split('\n')
  let inResource = false
  let resourceIndent = 0
  let result = []
  let currentIndent = 0

  // Find the resource and its content
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(\s*)([\w]+):/)
    
    if (match) {
      const [, indent, key] = match
      currentIndent = indent.length

      // Check if we're at Resources: top-level
      if (key === 'Resources') {
        resourceIndent = currentIndent
        continue
      }

      // Check if we're at the target resource
      if (currentIndent === resourceIndent + 2 && key === logicalId) {
        inResource = true
        // Start with the resource name at correct indentation
        result.push(`${logicalId}:`)
        continue
      }

      // Check if we've moved to the next resource
      if (inResource && currentIndent === resourceIndent + 2 && key !== logicalId) {
        break
      }
    }

    // Collect lines while in the resource
    if (inResource && line.trim()) {
      // Remove the base indentation + 2 (for Resources:)
      const indent = line.match(/^\s*/)[0]
      if (indent.length > resourceIndent + 2) {
        result.push(line.slice(resourceIndent + 2))
      }
    }
  }

  const block = result.join('\n')
  
  // Cache the result
  resourceBlockCache.set(cacheKey, block)
  
  return block
}

// Clear cache if needed
function clearResourceBlockCache() {
  resourceBlockCache.clear()
}

module.exports = {
  getResourceBlock,
  clearResourceBlockCache
} 