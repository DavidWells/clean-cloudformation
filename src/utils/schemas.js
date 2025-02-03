const fs = require('fs').promises
const path = require('path')

// Cache for loaded schemas
const schemaCache = new Map()

// Load a single schema file
async function loadSchema(resourceType) {
  // Return cached schema if available
  if (schemaCache.has(resourceType)) {
    return schemaCache.get(resourceType)
  }

  const [vendor, service, type] = resourceType.split('::')
  const schemaPath = path.join(__dirname, '..', 'schemas', `${vendor}::${service}::${type}.json`)

  try {
    const schemaContent = await fs.readFile(schemaPath, 'utf8')
    const schema = JSON.parse(schemaContent)
    schemaCache.set(resourceType, schema)
    return schema
  } catch (err) {
    console.warn(`Warning: No schema found for ${resourceType}`)
    return null
  }
}

// Load all schemas from the schemas directory
async function loadAllSchemas() {
  const schemasDir = path.join(__dirname, '..', 'schemas')
  const files = await fs.readdir(schemasDir)
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    
    const content = await fs.readFile(path.join(schemasDir, file), 'utf8')
    const schema = JSON.parse(content)
    
    if (schema.typeName) {
      schemaCache.set(schema.typeName, schema)
    }
  }
}

module.exports = {
  loadSchema,
  loadAllSchemas,
  schemaCache
} 