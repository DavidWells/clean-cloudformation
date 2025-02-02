const fs = require('fs').promises
const path = require('path')

// Get project root directory (2 levels up from scripts/)
const projectRoot = path.resolve(__dirname, '..')

// Helper function to get relative path from project root
function getRelativePath(absolutePath) {
  return './' + path.relative(projectRoot, absolutePath)
}

async function validateSchemas() {
  const schemasDir = path.join(__dirname, '..', 'schemas')
  const files = await fs.readdir(schemasDir)
  let hasErrors = false
  const failedPatterns = []

  console.log('Validating regex patterns in schema files...\n')

  for (const file of files) {
    if (!file.endsWith('.json')) continue
    
    const filePath = path.join(schemasDir, file)
    const relativePath = getRelativePath(filePath)

    try {
      const content = await fs.readFile(filePath, 'utf8')
      const schema = JSON.parse(content)
      
      // Find all regex patterns in the schema
      const patterns = findPatterns(schema)
      
      if (patterns.length > 0) {
        console.log(`\nChecking ${relativePath}:`)
        
        // Test each pattern
        patterns.forEach(({ pattern, path }) => {
          try {
            new RegExp(pattern)
            console.log(`  ✓ Valid pattern at ${path}: ${pattern}`)
          } catch (err) {
            hasErrors = true
            console.error(`  ✗ Invalid pattern at ${path}: ${pattern}`)
            console.error(`    Error: ${err.message}`)
            failedPatterns.push({
              file: relativePath,
              path,
              pattern,
              error: err.message
            })
          }
        })
      }
    } catch (err) {
      hasErrors = true
      console.error(`Error processing ${relativePath}:`, err.message)
    }
  }

  if (hasErrors) {
    console.error('\nValidation failed - Found invalid regex patterns:')
    console.error('\nSummary of failed patterns:')
    failedPatterns.forEach(({ file, path, pattern, error }) => {
      console.error(`\nFile: ${file}`)
      console.error(`Path: ${path}`)
      console.error(`Pattern: ${pattern}`)
      console.error(`Error: ${error}`)
    })
    process.exit(1)
  } else {
    console.log('\nAll regex patterns are valid!')
    process.exit(0)
  }
}

function findPatterns(obj, path = [], patterns = []) {
  if (!obj || typeof obj !== 'object') return patterns

  if (obj.pattern) {
    patterns.push({
      pattern: obj.pattern,
      path: path.join('.')
    })
  }

  // Recursively search through properties and definitions
  if (obj.properties) {
    Object.entries(obj.properties).forEach(([key, value]) => {
      findPatterns(value, [...path, 'properties', key], patterns)
    })
  }

  if (obj.definitions) {
    Object.entries(obj.definitions).forEach(([key, value]) => {
      findPatterns(value, [...path, 'definitions', key], patterns)
    })
  }

  // Handle arrays of schemas (like allOf, anyOf, oneOf)
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      findPatterns(item, [...path, index], patterns)
    })
  }

  // Recursively check all other object properties
  Object.entries(obj).forEach(([key, value]) => {
    if (typeof value === 'object' && !['properties', 'definitions'].includes(key)) {
      findPatterns(value, [...path, key], patterns)
    }
  })

  return patterns
}

validateSchemas().catch(err => {
  console.error('Validation failed:', err)
  process.exit(1)
}) 