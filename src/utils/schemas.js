const fs = require('fs').promises
const path = require('path')
const yaml = require('js-yaml')

// Cache for loaded schemas
const schemaCache = new Map()

// Load a single schema file
async function loadSchema(resourceType) {
  // Return cached schema if available
  if (schemaCache.has(resourceType)) {
    return schemaCache.get(resourceType)
  }

  const [vendor, service, type] = resourceType.split('::')
  const schemaPath = path.join(__dirname, '../..', 'schemas', `${vendor}::${service}::${type}.json`)

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

function getCfnYamlSchema() {
  // Define CloudFormation tags schema
  const cfnTags = [
    new yaml.Type('!Ref', {
      kind: 'scalar',
      construct: function(data) {
        return { 'Ref': data }
      }
    }),
    new yaml.Type('!Sub', {
      kind: 'scalar',
      construct: function(data) {
        return { 'Fn::Sub': data }
      }
    }),
    new yaml.Type('!GetAtt', {
      kind: 'scalar',
      construct: function(data) {
        return { 'Fn::GetAtt': data.split('.') }
      }
    }),
    new yaml.Type('!Join', {
      kind: 'sequence',
      construct: function(data) {
        return { 'Fn::Join': data }
      }
    }),
    new yaml.Type('!Select', { kind: 'sequence' }),
    new yaml.Type('!Split', { kind: 'sequence' }),
    new yaml.Type('!FindInMap', { kind: 'sequence' }),
    new yaml.Type('!If', { kind: 'sequence' }),
    new yaml.Type('!Not', { kind: 'sequence' }),
    new yaml.Type('!Equals', { kind: 'sequence' }),
    new yaml.Type('!And', { kind: 'sequence' }),
    new yaml.Type('!Or', { kind: 'sequence' }),
    new yaml.Type('!Base64', { kind: 'scalar' }),
    new yaml.Type('!Cidr', { kind: 'sequence' }),
    new yaml.Type('!Transform', { kind: 'mapping' }),
    new yaml.Type('!ImportValue', { kind: 'scalar' }),
    new yaml.Type('!GetAZs', { kind: 'scalar' }),
    new yaml.Type('!Condition', { kind: 'scalar' })
  ]

  // Create a custom type for IAM Policy Version
  // const policyVersionType = new yaml.Type('tag:yaml.org,2002:str', {
  //   kind: 'scalar',
  //   resolve: function(data) {
  //     console.log('data', data)
  //     // Check if this looks like a policy version
  //     if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data)) {
  //       return true
  //     }
  //     return false
  //   },
  //   construct: function(data) {
  //     return data
  //   }
  // })

  // Create custom schema with CloudFormation tags and policy version handling
  return yaml.DEFAULT_SCHEMA.extend([
    ...cfnTags, 
    // policyVersionType
  ])
}

module.exports = {
  loadSchema,
  loadAllSchemas,
  schemaCache,
  getCfnYamlSchema
} 