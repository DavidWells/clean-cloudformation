// Cache for resource blocks
const resourceBlockCache = new Map()

function getCacheKey(yamlString, logicalId, options) {
  // Include options in cache key
  return `${yamlString.length}:${logicalId}:${JSON.stringify(options)}`
}

function getYamlBlock(yamlString, logicalId, options = {}) {
  const defaultOptions = {
    key: 'Resources',
    keyIndentation: 0,
    removeIndent: true,
    preserveEmptyLines: true
  }
  const opts = { ...defaultOptions, ...options }
  
  const cacheKey = getCacheKey(yamlString, logicalId, opts)
  
  if (resourceBlockCache.has(cacheKey)) {
    return resourceBlockCache.get(cacheKey)
  }

  const lines = yamlString.split('\n')
  let inResource = false
  let resourceIndent = 0
  let result = []
  let currentIndent = 0

  // First pass: find the Resources section and resource indentation
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(\s*)([\w]+):/)
    if (match && match[2] === opts.key) {
      resourceIndent = match[1].length
      break
    }
  }

  // Second pass: collect the resource block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(\s*)([\w]+):/)
    
    if (match) {
      const [, indent, key] = match
      currentIndent = indent.length

      // Found target resource
      if (key === logicalId && currentIndent === resourceIndent + 2) {
        inResource = true
        if (opts.removeIndent) {
          result.push(`${logicalId}:`)
        } else {
          result.push(line)
        }
        continue
      }

      // Found next resource at same level
      if (inResource && currentIndent === resourceIndent + 2 && key !== logicalId) {
        break
      }
    }

    if (inResource) {
      const isEmpty = !line.trim()
      
      if (isEmpty && !opts.preserveEmptyLines) {
        continue
      }

      if (opts.removeIndent) {
        if (isEmpty) {
          result.push('')
        } else {
          const indent = line.match(/^\s*/)[0]
          if (indent.length > resourceIndent + 2) {
            result.push(line.slice(resourceIndent + 2))
          }
        }
      } else {
        result.push(line)
      }
    }
  }

  let block = result.join('\n')
  
  // Remove trailing empty line if it exists
  if (block.endsWith('\n')) {
    block = block.replace(/\n+$/, '')
  }
  
  resourceBlockCache.set(cacheKey, block)
  return block
}

// Clear cache if needed
function clearYamlBlockCache() {
  resourceBlockCache.clear()
}

module.exports = {
  getYamlBlock,
  clearYamlBlockCache
} 