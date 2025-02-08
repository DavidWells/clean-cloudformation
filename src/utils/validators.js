const Ajv = require('ajv')
const { loadSchema, schemaCache } = require('./schemas')
const { resolveResources, getResourcesEntries } = require('./get-resources')
const { getIntrinsicValue } = require('./get-intrinsic')

// Create AJV instance with schema loading capability
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false, // Disable format validation
  validateSchema: false,  // Disable schema validation
  allowUnionTypes: true,  // Allow union types
})

// Known validation exceptions to ignore
const VALIDATION_EXCEPTIONS = new Map([
  ['AWS::CloudFormation::CustomResource', {
    ignoredProperties: ['resourceType'],
    reason: 'Valid property missing from schema'
  }],
  // Add more exceptions as needed
  ['AWS::Lambda::Function', {
    ignoredProperties: ['Handler'],  // Example of another potential exception
    reason: 'Schema validation too strict for Handler property'
  }]
])

async function validateTemplate(template) {
  const allErrors = []
  let isValid = true
  const { Resources, via } = resolveResources(template)
  if (!Resources) {
    console.log(`No Resources found in ${via} template`)
    return { isValid, errors: allErrors }
  }

  const resources = getResourcesEntries(template)
  // console.log('resources', resources)

  // Validate no resources have the same logical ID
  const logicalIds = resources.map(([logicalId]) => logicalId)
  const uniqueLogicalIds = new Set(logicalIds)
  if (uniqueLogicalIds.size !== logicalIds.length) {
    isValid = false
    allErrors.push({
      path: 'template',
      message: 'Duplicate logical IDs found in Resources',
      details: { duplicateIds: logicalIds.filter(id => logicalIds.filter(x => x === id).length > 1) }
    })
    console.error('Duplicate logical IDs found in Resources')
    return { isValid, errors: allErrors }
  }

  // Process all resources in parallel
  const validations = await Promise.all(resources.map(async ([logicalId, resource]) => {
    if (!resource.Type) {
      const error = {
        path: logicalId,
        message: 'Resource missing Type property',
        details: { resource }
      }
      console.error(`Resource ${logicalId} missing Type property`)
      return { isValid: false, errors: [error] }
    }

    const props = resource.Properties || {}
    return validateResource(resource.Type, props, logicalId)
  }))

  // Combine all validation results
  validations.forEach(result => {
    if (!result.isValid) {
      isValid = false
    }
    allErrors.push(...result.errors)
  })

  return { isValid, errors: allErrors }
}

async function validateResource(resourceType, properties, logicalId) {
  const errors = []

  // Skip validation for Custom:: resources
  if (resourceType.startsWith('Custom::')) {
    // console.warn(`Warning: Skipping validation for custom resource type ${resourceType}`)
    return { isValid: true, errors }
  }

  const schema = await loadSchema(resourceType)
  if (!schema) {
    console.warn(`Warning: No schema found for resource type ${resourceType}`)
    return { isValid: true, errors }
  }

  // First validate required properties
  const {
    isValid: requiredValid, 
    errors: requiredErrors 
  } = validateRequiredProperties(schema, properties, logicalId, resourceType)
  errors.push(...requiredErrors)

  try {
    // Get or compile validator for this schema
    const validatorKey = `validator-${resourceType}`
    if (!schemaCache.has(validatorKey)) {
      const validationSchema = {
        type: 'object',
        properties: schema.properties || {},
        definitions: schema.definitions || {},
        additionalProperties: false
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

    let valid = validator(validationProps)

    if (!valid) {
      console.log('───────────────────────────────')
      console.error(`\nValidation errors in \n"${logicalId}" for ${resourceType}:`)
      
      // Get exceptions for this resource type
      const exceptions = VALIDATION_EXCEPTIONS.get(resourceType)
      
      // Track if all errors are in exceptions
      let allErrorsExcepted = true
      
      validator.errors.forEach(error => {
        // Skip if this error is in our exceptions list
        if (exceptions?.ignoredProperties?.includes(error.params.additionalProperty)) {
          console.log(`Ignoring known issue: ${error.params.additionalProperty} in ${resourceType} (${exceptions.reason})`)
          return
        }

        // If we get here, we found an error that's not excepted
        allErrorsExcepted = false

        // Rest of the error handling stays the same...
        const propertyPath = error.instancePath.split('/').slice(1)
        
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

        if (!hasIntrinsic) {
          const path = error.instancePath || 'root'
          let errorMessage
          if (error.keyword === 'additionalProperties') {
            errorMessage = `${path}: Invalid property "${error.params.additionalProperty}"`
          } else {
            errorMessage = `${path}: ${error.message}`
          }
          
          errors.push({
            path,
            message: errorMessage,
            details: error
          })

          console.error(`- ${errorMessage}`)
          console.error('  Error details:', JSON.stringify(error, null, 2))
        }
      })

      // Update valid flag based on if all errors were excepted
      if (allErrorsExcepted) {
        valid = true
      }
    }

    return {
      isValid: valid && requiredValid,
      errors
    }

  } catch (err) {
    console.error(`Error validating ${resourceType} in "${logicalId}":`, err.message)
    console.error('Stack:', err.stack)
    errors.push({
      path: 'validation',
      message: `Error validating ${resourceType}: ${err.message}`,
      details: err
    })
    return { isValid: false, errors }
  }
}

function validateRequiredProperties(schema, properties, logicalId, resourceType) {
  const errors = []
  let isValid = true

  if (!schema.required || !Array.isArray(schema.required)) {
    return { isValid, errors }
  }

  // Check each required property
  schema.required.forEach(propName => {
    const propValue = properties[propName]
    if (propValue === undefined) {
      isValid = false
      const error = {
        path: propName,
        message: `Missing required property: ${propName}`,
        details: {
          keyword: 'required',
          params: { missingProperty: propName }
        }
      }
      errors.push(error)
      console.error(`Required property missing in "${logicalId}" (${resourceType}):`, propName)
    }
  })

  return { isValid, errors }
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
    // key === 'Ref::Sub'
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

function isMultilineString(value) {
  if (typeof value === 'string') {
    return value.includes('\n')
  }

  // Check for Sub with newlines
  const subValue = getIntrinsicValue(value, 'Sub')
  if (subValue && typeof subValue === 'string') {
    return subValue.includes('\n')
  }

  return false
}

module.exports = {
  validateTemplate,
  validateResource,
  validateRequiredProperties,
  validateNamePattern,
  isMultilineString
} 