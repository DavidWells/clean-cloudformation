const Ajv = require('ajv')
const { loadSchema, schemaCache } = require('./schemas')
const { resolveResources, getResourcesEntries } = require('./resolve-resources')

// Create AJV instance with schema loading capability
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false, // Disable format validation
  validateSchema: false,  // Disable schema validation
  allowUnionTypes: true,  // Allow union types
})

async function validateTemplate(template) {
  let isValid = true
  const { Resources, via } = resolveResources(template)
  if (!Resources) {
    console.log(`No Resources found in ${via} template`)
    return isValid
  }

  const resources = getResourcesEntries(template)
  console.log('resources', resources)

  // Validate no resources have the same logical ID
  const logicalIds = resources.map(([logicalId]) => logicalId)
  const uniqueLogicalIds = new Set(logicalIds)
  if (uniqueLogicalIds.size !== logicalIds.length) {
    console.error('Duplicate logical IDs found in Resources')
    return false
  }

  // Process all resources in parallel
  const validations = resources.map(async ([logicalId, resource]) => {
    if (!resource.Type) {
      console.error(`Resource ${logicalId} missing Type property`)
      return false
    }

    const props = resource.Properties || {}
    const resourceValid = await validateResource(resource.Type, props, logicalId)
    
    if (!resourceValid) {
      console.error(`Invalid properties in resource ${logicalId} (${resource.Type})`)
      return false
    }
    return true
  })

  // Wait for all validations to complete
  const results = await Promise.all(validations)
  return results.every(result => result)
}

async function validateResource(resourceType, properties, logicalId) {
  // Skip validation for Custom:: resources
  if (resourceType.startsWith('Custom::')) {
    // console.warn(`Warning: Skipping validation for custom resource type ${resourceType}`)
    return true
  }

  const schema = await loadSchema(resourceType)
  if (!schema) {
    console.warn(`Warning: No schema found for resource type ${resourceType}`)
    return true
  }

  // First validate required properties
  const requiredValid = validateRequiredProperties(schema, properties, logicalId, resourceType)

  try {
    // Get or compile validator for this schema
    const validatorKey = `validator-${resourceType}`
    if (!schemaCache.has(validatorKey)) {
      const validationSchema = {
        type: 'object',
        properties: schema.properties || {},
        definitions: schema.definitions || {},
        additionalProperties: false
        // Note: We're not including required here since we handle it separately
      }

      const validator = ajv.compile(validationSchema)
      schemaCache.set(validatorKey, validator)
    }

    const validator = schemaCache.get(validatorKey)
    
    // Create a copy of properties for validation, removing intrinsic functions
    const validationProps = {}
    for (const [key, value] of Object.entries(properties)) {
      if (!hasIntrinsicFunction(value)) {
        validationProps[key] = value
      }
    }

    const valid = validator(validationProps)

    if (!valid) {
      console.log('───────────────────────────────')
      console.error(`\nValidation errors in \n"${logicalId}" for ${resourceType}:`)
      validator.errors.forEach(error => {
        // Get the full property path
        const propertyPath = error.instancePath.split('/').slice(1)
        
        // Check if any part of the path contains an intrinsic function
        let currentObj = properties
        let hasIntrinsic = false
        for (const pathPart of propertyPath) {
          if (!currentObj || typeof currentObj !== 'object') break
          if (hasIntrinsicFunction(currentObj[pathPart])) {
            hasIntrinsic = true
            break
          }
          currentObj = currentObj[pathPart]
        }

        // Only show errors for properties that don't use intrinsic functions
        if (!hasIntrinsic) {
          const path = error.instancePath || 'root'
          if (error.keyword === 'additionalProperties') {
            console.error(`- ${path}: Invalid property "${error.params.additionalProperty}"`)
          } else {
            console.error(`- ${path}: ${error.message}`)
          }
          console.error('  Error details:', JSON.stringify(error, null, 2))
        }
      })
    }

    return valid && requiredValid;  // Both validations must pass
  } catch (err) {
    console.error(`Error validating ${resourceType} in "${logicalId}":`, err.message)
    console.error('Stack:', err.stack)
    return false
  }
}

function validateRequiredProperties(schema, properties, logicalId, resourceType) {
  if (!schema.required || !Array.isArray(schema.required)) {
    return true
  }

  let isValid = true
  const missingProps = []

  for (const requiredProp of schema.required) {
    // Check if property exists, even if it's an intrinsic function
    if (!(requiredProp in properties)) {
      missingProps.push(requiredProp)
      isValid = false
    }
  }

  if (missingProps.length > 0) {
    console.log('───────────────────────────────')
    console.error(`\nMissing required properties in \n"${logicalId}" for ${resourceType}:`)
    missingProps.forEach(prop => {
      console.error(`- ${prop}`)
    })
  }

  return isValid
}

async function validateNamePattern(schema, path, value, resourceType) {
  // Skip if no schema
  if (!schema) return {}

  // Split path into parts and remove 'Resources' prefix
  const pathParts = path.split('.').slice(1)
  
  // Navigate through schema to find the property definition
  let currentSchema = schema
  let propertyDef = null
  
  for (const part of pathParts) {
    if (!currentSchema) break
    
    // Check properties
    if (currentSchema.properties && currentSchema.properties[part]) {
      currentSchema = currentSchema.properties[part]
    }
    // Check if it references a definition
    else if (currentSchema.$ref) {
      const defName = currentSchema.$ref.split('/').pop()
      if (schema.definitions && schema.definitions[defName]) {
        currentSchema = schema.definitions[defName]
        // Check the next part in the definition's properties
        if (currentSchema.properties && currentSchema.properties[part]) {
          currentSchema = currentSchema.properties[part]
        }
      }
    }
    // Store the last valid schema we found
    propertyDef = currentSchema
  }

  // If we found a property definition with string constraints, validate it
  if (propertyDef && propertyDef.type === 'string') {
    const constraints = {
      pattern: propertyDef.pattern,
      minLength: propertyDef.minLength,
      maxLength: propertyDef.maxLength,
      enum: propertyDef.enum
    }

    let isValid = true
    const validationErrors = []

    // Check pattern if exists
    if (constraints.pattern) {
      try {
        const regex = new RegExp(constraints.pattern)
        if (!regex.test(value)) {
          isValid = false
          validationErrors.push(`must match pattern: ${constraints.pattern}`)
        }
      } catch (err) {
        console.warn(`Warning: Invalid regex pattern in schema: ${constraints.pattern}`)
      }
    }

    // Check length constraints
    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
      isValid = false
      validationErrors.push(`length must be >= ${constraints.minLength}`)
    }
    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
      isValid = false
      validationErrors.push(`length must be <= ${constraints.maxLength}`)
    }

    // Check enum if exists
    if (constraints.enum && !constraints.enum.includes(value)) {
      isValid = false
      validationErrors.push(`must be one of: ${constraints.enum.join(', ')}`)
    }

    return {
      isValid,
      pattern: constraints.pattern,
      description: propertyDef.description,
      constraints,
      validationErrors
    }
  }

  return {}
}

function hasIntrinsicFunction(value, path = []) {
  if (!value || typeof value !== 'object') return false
  
  // Check for transformed intrinsic functions (our format)
  const hasTransformed = Object.keys(value).some(key => 
    key.startsWith('Ref::') || 
    key === 'Ref::Ref' || 
    key === 'Ref::GetAtt'
  )
  if (hasTransformed) return true

  // Check for original CloudFormation format
  const hasOriginal = Object.keys(value).some(key => 
    key === 'Ref' || 
    key === 'Fn::GetAtt' || 
    key.startsWith('Fn::')
  )
  if (hasOriginal) return true

  // Check nested objects
  if (typeof value === 'object') {
    return Object.entries(value).some(([key, val]) => 
      hasIntrinsicFunction(val, [...path, key])
    )
  }

  return false
}

module.exports = {
  validateTemplate,
  validateResource,
  validateRequiredProperties,
  validateNamePattern
} 