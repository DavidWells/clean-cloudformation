const fs = require('fs').promises
const yaml = require('js-yaml')
const path = require('path')
const Ajv = require('ajv')
// const $RefParser = require('@apidevtools/json-schema-ref-parser')

// Create AJV instance with schema loading capability
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false, // Disable format validation
  validateSchema: false,  // Disable schema validation
  allowUnionTypes: true,  // Allow union types
})

/* // Debug regex validation. DO NOT REMOVE
// Override the existing pattern keyword
ajv.removeKeyword('pattern')
ajv.addKeyword({
  keyword: 'pattern',
  type: 'string',
  schemaType: 'string',
  compile: (pattern) => {
    try {
      const regex = new RegExp(pattern)
      return (data) => {
        try {
          return typeof data === 'string' && regex.test(data)
        } catch (e) {
          console.warn(`Warning: Error testing pattern ${pattern}:`, e.message)
          return true; // Skip validation on error
        }
      }
    } catch (e) {
      console.warn(`Warning: Invalid regex pattern in schema: ${pattern}`)
      return () => true; // Skip validation for invalid patterns
    }
  }
})
/** */

const schemaCache = new Map()

// Load a single schema by resource type
async function loadSchema(resourceType) {
  if (schemaCache.has(resourceType)) {
    return schemaCache.get(resourceType)
  }

  try {
    const schemaPath = path.join(__dirname, 'schemas', `${resourceType}.json`)
    const content = await fs.readFile(schemaPath, 'utf8')
    const schema = JSON.parse(content)
    schemaCache.set(resourceType, schema)
    return schema
  } catch (err) {
    console.warn(`Warning: Could not load schema for ${resourceType}:`, err.message)
    return null
  }
}

// Add after loadSchema function
async function loadAllSchemas() {
  try {
    const schemasDir = path.join(__dirname, 'schemas')
    const schemaFiles = await fs.readdir(schemasDir)
    
    // Load all schemas in parallel
    await Promise.all(schemaFiles.map(async file => {
      if (file.endsWith('.json') && file !== '_meta.json') {
        try {
          const content = await fs.readFile(path.join(schemasDir, file), 'utf8')
          const schema = JSON.parse(content)
          schemaCache.set(schema.typeName, schema)
        } catch (err) {
          console.warn(`Warning: Could not load schema file ${file}:`, err.message)
        }
      }
    }))

    return schemaCache
  } catch (err) {
    console.error('Error loading schemas:', err.message)
    throw err
  }
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

async function validateTemplate(template) {
  let isValid = true
  
  if (!template.Resources) return isValid

  // Process all resources in parallel
  const validations = Object.entries(template.Resources).map(async ([logicalId, resource]) => {
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

async function cleanCloudFormation(template, options = {}) {
  if (!template) {
    throw new Error('Template is required')
  }
  /*
  console.log('template', template)
  /** */

  // Clean CDK-specific elements
  removeRootCdkNag(template)
  removeBootstrapVersionRule(template)
  removeBootstrapVersionParameter(template)

  // Clean template structure
  cleanMetadata(template)
  removeCdkMetadata(template)
  removeMetadataCondition(template)
  cleanConditionNames(template)
  cleanResourceNames(template)
  removeCdkTags(template)
  transformParameterArrays(template)
  sortResourceKeys(template)

  /* Handle logical ID replacements if specified */
  if (options.replaceLogicalIds) {
    for (const { pattern, replacement } of options.replaceLogicalIds) {
      replaceLogicalIds(template, pattern, replacement)
    }
  }

  // Transform and sort
  const transformedTemplate = transformIntrinsicFunctions(sortTopLevelKeys(template))
  
  // Validate the transformed template
  const isValid = await validateTemplate(transformedTemplate)

  if (!isValid && options.strict) {
    throw new Error('Template validation failed')
  }

  // Convert to YAML
  let yamlContent = yaml.dump(transformedTemplate, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    noArrayIndent: false,
    flowStyle: false,
    styles: {
      '!!null': 'empty',
      '!!str': 'plain'
    },
    quotingType: '"',  // Use double quotes instead of single quotes
    forceQuotes: false // Only quote when necessary
  })

  // Fix array indentation
  yamlContent = yamlContent.replace(/^(\s+)[^-\s].*:\n\1-\s/gm, '$1$&  ')

  // Apply YAML formatting
  yamlContent = yamlContent.replace(/Ref::/g, '!')
  yamlContent = yamlContent.replace(/!(Ref|GetAtt|Join|Sub|Select|Split|FindInMap|If|Not|Equals|And|Or):/g, '!$1')
  
  /* Fold DependsOn arrays if 2 or less into a single line */
  yamlContent = yamlContent.replace(
    /^(\s+)DependsOn:\n(?:\1[\s-]+.+?\n)+/gm,
    (match) => {
      const values = match
        .split('\n')
        .filter(line => line.includes('-'))
        .map(line => line.substring(line.indexOf('-') + 1).trim())
        .filter(Boolean)

      // Only transform if there are 1 or 2 values
      if (values.length > 2) {
        return match
      }

      const indent = match.match(/^\s+/)[0]
      return `${indent}DependsOn: [ ${values.join(', ')} ]\n`
    }
  )

  yamlContent = insertBlankLines(yamlContent)
  yamlContent = yamlContent.replace(/(^Resources:\n)\n/, '$1')
  yamlContent = yamlContent.replace(/^(\s+)!(Equals)\n\1-\s+(.+?)\n\1-\s+(.+?)$/gm, '$1!$2 [ $3, $4 ]')
  yamlContent = yamlContent.replace(
    /^(\s+)-\s+!Equals\n\1\s+-\s+(.+?)\n\1\s+-\s+(.+?)$/gm,
    '$1- !Equals [ $2, $3 ]'
  )
  yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!(?:Sub|Ref|GetAtt)\s.+)$/gm, '$1$2: $3')
  yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!Equals\s+\[.+?\])$/gm, '$1$2: $3')
  
  /* Fold AllowedValues arrays into a single line */
  yamlContent = yamlContent.replace(
    /^(\s+)AllowedValues:\n(?:\1\s*-\s+(.+?)(?:\n|$))+/gm,
    (match) => {
      const values = match
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => {
          const value = line.substring(line.indexOf('-') + 1).trim()
          // If value is already quoted, keep it as is, otherwise add quotes
          return value.match(/^["'].*["']$/) ? value : `"${value}"`
        })
        .filter(Boolean)

      const indent = match.match(/^\s+/)[0]
      return `${indent}AllowedValues: [${values.join(', ')}]\n`
    }
  )

  yamlContent = yamlContent.replace(/\n\n\n+/g, '\n\n')

  // Collect names before any transformations
  const names = collectNames(template, {
    //returnAll: true
  })

  // Log collected names at the end
  if (names.length > 0) {
    console.log('\nFound the following resource names that probably need renaming:')
    
    // Get longest resource type
    const longestResourceType = names.reduce((max, { resourceType }) => {
      return Math.max(max, resourceType.length)
    }, 0)

    // Lookup naming constraints from schema file
    const details = names.map(async ({ path, value, resourceType }) => {
      // console.log('--------------------------------')
      // console.log(`Resource: ${resourceType}`)
      // console.log(`Path:     ${path}`)
      // console.log(`Value:    ${value}`)
      
      const schema = await loadSchema(resourceType)
      const validation = await validateNamePattern(schema, path, value, resourceType)
      
      // if (validation.constraints) {
      //   console.log(`\nNaming Convention for ${resourceType} - ${path}:`)
      //   console.log(`Description: ${validation.description}`)
      //   if (validation.constraints.pattern) {
      //     console.log(`Pattern:     ${validation.constraints.pattern}`)
      //   }
      //   if (validation.constraints.minLength !== undefined) {
      //     console.log(`Min Length:  ${validation.constraints.minLength}`)
      //   }
      //   if (validation.constraints.maxLength !== undefined) {
      //     console.log(`Max Length:  ${validation.constraints.maxLength}`)
      //   }
      //   if (validation.constraints.enum) {
      //     console.log(`Allowed Values: ${validation.constraints.enum.join(', ')}`)
      //   }
      //   if (!validation.isValid) {
      //     console.log('\nValidation Errors:')
      //     validation.validationErrors.forEach(error => {
      //       console.log(`- ${error}`)
      //     })
      //   }
      // }

      const constraints = validation.constraints || {}

      return {
        path,
        value,
        resourceType,
        validation: {
          description: validation.description || `See ${resourceType} CloudFormation schema for details`,
          pattern: constraints.pattern || /^[a-zA-Z0-9-]{1,128}$/,
          minLength: constraints.minLength || 1,
          maxLength: constraints.maxLength || 128,
          // enum: constraints.enum,
          // isValid: validation.isValid,
          // validationErrors: validation.validationErrors
        }
      }
    })

    const results = await Promise.all(details)

    if (options.asPrompt) {
      const prompt = `
Please rename the following Cloudformation resources to be more descriptive and easier to understand.

Naming Rules:

- Resource names must be unique within the template.
- Use !Sub and AWS::StackName to create unique names. For example: !Sub "\${AWS::StackName}-[resource-name]"
- Resource names must follow AWS rules and naming conventions for the given CloudFormation resourceType.
- Resource names must follow the rules defined in \`description\` if they are specified.
- Any rules found in \`description\` are highest priority, use them over \`pattern\`, \`minLength\`, and \`maxLength\`.

Update the below resources to be more descriptive and easier to understand, following the rules above.

${results.map(({ path, value, resourceType, validation }) => {
  // Format description with proper indentation and wrapping
  const description = validation.description
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0) // Remove empty lines
    .map(line => {
      // Wrap text at 120 chars with proper indentation
      const words = line.split(' ')
      const lines = []
      let currentLine = ''
      
      words.forEach(word => {
        if ((currentLine + ' ' + word).length > 160) {
          lines.push(currentLine)
          currentLine = word
        } else {
          currentLine = currentLine ? currentLine + ' ' + word : word
        }
      })
      if (currentLine) lines.push(currentLine)
      
      return lines.join('\n      ')
    })
    .join('\n      ')

  return `- Value: ${value}
  - location: ${path}
  - resourceType: ${resourceType}
  - description: ${description}
  - pattern: ${validation.pattern}
  - minLength: ${validation.minLength}
  - maxLength: ${validation.maxLength}
`}).join('\n')}
`
      console.log(prompt)
    }

  }

  return yamlContent
}

// Add this new function at the start
function removeRootCdkNag(template) {
  if (template.Metadata && template.Metadata.cdk_nag) {
    delete template.Metadata.cdk_nag
    
    // Remove empty Metadata object
    if (Object.keys(template.Metadata).length === 0) {
      delete template.Metadata
    }
  }
}

// Add this new function after removeRootCdkNag
function removeBootstrapVersionRule(template) {
  if (template.Rules && template.Rules.CheckBootstrapVersion) {
    delete template.Rules.CheckBootstrapVersion
    
    // Remove empty Rules object
    if (Object.keys(template.Rules).length === 0) {
      delete template.Rules
    }
  }
}

// Add this new function after removeBootstrapVersionRule
function removeBootstrapVersionParameter(template) {
  if (template.Parameters && 
      template.Parameters.BootstrapVersion && 
      template.Parameters.BootstrapVersion.Default && 
      template.Parameters.BootstrapVersion.Default.startsWith('/cdk-bootstrap/')) {
    
    delete template.Parameters.BootstrapVersion
    
    // Remove empty Parameters object
    if (Object.keys(template.Parameters).length === 0) {
      delete template.Parameters
    }
  }
}

// Add this new function after removeBootstrapVersionParameter
function sortTopLevelKeys(template) {
  const order = [
    'AWSTemplateFormatVersion',
    'Transform',
    'Description',
    'Metadata',
    'Rules',
    'Mappings',
    'Parameters',
    'Conditions',
    'Resources',
    'Outputs'
  ]

  // Create a new object with sorted keys
  const sortedTemplate = {}
  
  // Add keys in specified order if they exist
  order.forEach(key => {
    if (template[key] !== undefined) {
      sortedTemplate[key] = template[key]
    }
  })

  // Add any remaining keys that weren't in our order list
  Object.keys(template).forEach(key => {
    if (!order.includes(key)) {
      sortedTemplate[key] = template[key]
    }
  })

  return sortedTemplate
}

// Function to recursively remove aws:cdk:path and cfn_nag from Metadata
function cleanMetadata(obj) {
  if (obj && typeof obj === 'object') {
    if (obj.Metadata) {
      // Remove aws:cdk:path
      if (obj.Metadata['aws:cdk:path']) {
        delete obj.Metadata['aws:cdk:path']
      }
      // Remove cfn_nag
      if (obj.Metadata.cfn_nag) {
        delete obj.Metadata.cfn_nag
      }
      // Remove cdk_nag
      if (obj.Metadata.cdk_nag) {
        delete obj.Metadata.cdk_nag
      }
      // Remove aws:asset keys
      Object.keys(obj.Metadata).forEach(key => {
        if (key.startsWith('aws:asset:')) {
          delete obj.Metadata[key]
        }
      })
      // Remove empty Metadata objects
      if (Object.keys(obj.Metadata).length === 0) {
        delete obj.Metadata
      }
    }

    // Recursively process all properties
    for (const key in obj) {
      cleanMetadata(obj[key])
    }
  }
}

// Function to remove CDK Metadata resources
function removeCdkMetadata(template) {
  const resources = template.Resources
  for (const key in resources) {
    if (resources[key].Type === 'AWS::CDK::Metadata') {
      delete resources[key]
    }
  }
}

// Add this function after the existing functions
function shouldTransformJoinToSub(joinArgs) {
  // Only transform if it's a Join with empty string separator
  if (!Array.isArray(joinArgs) || joinArgs[0] !== '' || !Array.isArray(joinArgs[1])) {
    return false
  }

  // Check if any of the elements are Ref or GetAtt
  return joinArgs[1].some(
    (item) => typeof item === 'object' && (item['Ref::Ref'] !== undefined || item['Ref::GetAtt'] !== undefined),
  )
}

function transformJoinToSub(joinArgs) {
  const parts = joinArgs[1]
  let template = ''

  for (const part of parts) {
    if (typeof part === 'string') {
      template += part
    } else if (part['Ref::Ref']) {
      template += '${' + part['Ref::Ref'] + '}'
    } else if (part['Ref::GetAtt']) {
      template += '${' + part['Ref::GetAtt'] + '}'
    }
  }

  return { 'Ref::Sub': template }
}

// Function to transform intrinsic functions to shorthand
function transformIntrinsicFunctions(obj) {
  if (obj && typeof obj === 'object') {
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map((item) => transformIntrinsicFunctions(item))
    }

    // Create new object to store transformed key-values
    const transformed = {}

    for (const [key, value] of Object.entries(obj)) {
      // Transform the known intrinsic functions to shorthand
      switch (key) {
        case 'Fn::Join':
          const transformedValue = transformIntrinsicFunctions(value)
          if (shouldTransformJoinToSub(transformedValue)) {
            Object.assign(transformed, transformJoinToSub(transformedValue))
          } else {
            transformed['Ref::Join'] = transformedValue
          }
          break
        case 'Fn::Sub':
          transformed['Ref::Sub'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::GetAtt':
          // Convert from array format to dot notation
          if (Array.isArray(value)) {
            transformed['Ref::GetAtt'] = value.join('.')
          } else {
            transformed['Ref::GetAtt'] = value
          }
          break
        case 'Fn::Select':
          transformed['Ref::Select'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Split':
          transformed['Ref::Split'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::FindInMap':
          transformed['Ref::FindInMap'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::If':
          transformed['Ref::If'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Not':
          transformed['Ref::Not'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Equals':
          transformed['Ref::Equals'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::And':
          transformed['Ref::And'] = transformIntrinsicFunctions(value)
          break
        case 'Fn::Or':
          transformed['Ref::Or'] = transformIntrinsicFunctions(value)
          break
        case 'Ref':
          transformed['Ref::Ref'] = value
          break
        default:
          // Recursively transform nested objects
          transformed[key] = transformIntrinsicFunctions(value)
      }
    }
    return transformed
  }
  return obj
}

// Add this new function
function removeMetadataCondition(template) {
  if (template.Conditions && template.Conditions.CDKMetadataAvailable) {
    delete template.Conditions.CDKMetadataAvailable

    // Remove the Conditions object if it's empty
    if (Object.keys(template.Conditions).length === 0) {
      delete template.Conditions
    }
  }
}

// Add this new function after removeMetadataCondition
function cleanConditionNames(template) {
  // Skip if no conditions
  if (!template.Conditions) return

  // Updated pattern to match:
  // - Any alphanumeric characters followed by
  // - 8 character hex code at the end
  const postfixPattern = /^([A-Za-z0-9]+?)([0-9A-F]{8})$/
  const conditionRenames = {}

  // First pass: identify conditions that can be renamed
  for (const conditionName of Object.keys(template.Conditions)) {
    const match = conditionName.match(postfixPattern)
    if (match) {
      const baseName = match[1]
      // Check if base name already exists
      const baseNameExists = Object.keys(template.Conditions).some(
        (name) =>
          name !== conditionName && // not the same condition
          (name === baseName || name.startsWith(baseName + '[')), // exact match or array index
      )

      if (!baseNameExists) {
        conditionRenames[conditionName] = baseName
      }
    }
  }

  // Helper function to update condition references in an object
  function updateConditionRefs(obj) {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      obj.forEach((item) => updateConditionRefs(item))
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Condition' && typeof value === 'string' && conditionRenames[value]) {
        obj[key] = conditionRenames[value]
      } else if (key === 'Fn::If' && Array.isArray(value) && conditionRenames[value[0]]) {
        value[0] = conditionRenames[value[0]]
      } else if (typeof value === 'object') {
        updateConditionRefs(value)
      }
    }
  }

  // Second pass: rename conditions and update references
  for (const [oldName, newName] of Object.entries(conditionRenames)) {
    // Rename the condition
    template.Conditions[newName] = template.Conditions[oldName]
    delete template.Conditions[oldName]
  }

  // Update all condition references in the template
  updateConditionRefs(template.Resources)
  updateConditionRefs(template.Outputs)
}

// Add this new function after cleanConditionNames
function cleanResourceNames(template) {
  // Skip if no resources
  if (!template.Resources) return

  const postfixPattern = /^([A-Za-z0-9]+?)([0-9A-F]{8})$/
  const resourceRenames = {}

  // First pass: identify resources that can be renamed
  for (const resourceName of Object.keys(template.Resources)) {
    const match = resourceName.match(postfixPattern)
    if (match) {
      const baseName = match[1]
      // Check if base name already exists
      const baseNameExists = Object.keys(template.Resources).some(
        (name) =>
          name !== resourceName && // not the same resource
          (name === baseName || name.startsWith(baseName + '[')), // exact match or array index
      )

      if (!baseNameExists) {
        resourceRenames[resourceName] = baseName
      }
    }
  }

  // Helper function to update resource references in an object
  function updateResourceRefs(obj) {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      // Handle DependsOn arrays
      if (obj.some((item) => typeof item === 'string' && resourceRenames[item])) {
        for (let i = 0; i < obj.length; i++) {
          if (typeof obj[i] === 'string' && resourceRenames[obj[i]]) {
            obj[i] = resourceRenames[obj[i]]
          }
        }
      } else {
        obj.forEach((item) => updateResourceRefs(item))
      }
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Ref' && typeof value === 'string' && resourceRenames[value]) {
        obj[key] = resourceRenames[value]
      } else if (key === 'Fn::GetAtt' && Array.isArray(value) && resourceRenames[value[0]]) {
        value[0] = resourceRenames[value[0]]
      } else if (key === 'DependsOn') {
        // Handle both string and array DependsOn
        if (typeof value === 'string' && resourceRenames[value]) {
          obj[key] = resourceRenames[value]
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] === 'string' && resourceRenames[value[i]]) {
              value[i] = resourceRenames[value[i]]
            }
          }
        }
      } else if (typeof value === 'object') {
        updateResourceRefs(value)
      }
    }
  }

  // Second pass: rename resources and update references
  for (const [oldName, newName] of Object.entries(resourceRenames)) {
    // Rename the resource
    template.Resources[newName] = template.Resources[oldName]
    delete template.Resources[oldName]
  }

  // Update all resource references in the template
  updateResourceRefs(template.Resources)
  updateResourceRefs(template.Outputs)
  if (template.Conditions) {
    updateResourceRefs(template.Conditions)
  }
}

// Add this new function after cleanResourceNames
function removeCdkTags(template) {
  if (!template.Resources) return

  for (const resource of Object.values(template.Resources)) {
    if (resource.Properties && resource.Properties.Tags) {
      // Ensure Tags is an array
      const tags = Array.isArray(resource.Properties.Tags) 
        ? resource.Properties.Tags 
        : [resource.Properties.Tags]

      // Filter out aws-cdk: tags and cr-owned tags
      resource.Properties.Tags = tags.filter(tag => {
        // Check if tag is a valid object with a Key property
        return tag && 
               typeof tag === 'object' && 
               tag.Key && 
               typeof tag.Key === 'string' && 
               !tag.Key.startsWith('aws-cdk:') && 
               !tag.Key.includes('cr-owned:')
      })

      // Remove empty Tags array
      if (resource.Properties.Tags.length === 0) {
        delete resource.Properties.Tags
      }
    }
  }
}

// Add this new function after removeCdkTags
function transformParameterArrays(template) {
  if (!template.Parameters) return

  for (const param of Object.values(template.Parameters)) {
    if (param.AllowedValues && 
        Array.isArray(param.AllowedValues) && 
        param.AllowedValues.every(v => typeof v === 'string')) {
      // Mark this array for compact formatting
      Object.defineProperty(param.AllowedValues, 'isCompactStringArray', {
        value: true,
        enumerable: false
      })
    }
  }
}

// Add this new function after transformParameterArrays
function sortIAMPolicyProperties(resource) {
  if (resource.Type !== 'AWS::IAM::Policy' || !resource.Properties) {
    return resource
  }

  const order = [
    'PolicyName',
    'Roles',
    'PolicyDocument',
  ]

  const sortedProperties = {}
  
  // Add properties in specified order if they exist
  order.forEach(key => {
    if (resource.Properties[key] !== undefined) {
      sortedProperties[key] = resource.Properties[key]
    }
  })

  // Add any remaining properties that weren't in our order list
  Object.keys(resource.Properties).forEach(key => {
    if (!order.includes(key)) {
      sortedProperties[key] = resource.Properties[key]
    }
  })

  resource.Properties = sortedProperties
  return resource
}

// Modify the sortResourceKeys function to include IAM Policy sorting
function sortResourceKeys(template) {
  if (!template.Resources) return

  const order = [
    'Type',
    'Condition',
    'DependsOn',
    'DeletionPolicy',
    'CreationPolicy',
    'UpdatePolicy',
    'UpdateReplacePolicy',
    'Properties',
    'Metadata'
  ]

  for (const resourceKey in template.Resources) {
    const resource = template.Resources[resourceKey]
    const sortedResource = {}
    
    // Add keys in specified order if they exist
    order.forEach(key => {
      if (resource[key] !== undefined) {
        sortedResource[key] = resource[key]
      }
    })

    // Add any remaining keys that weren't in our order list
    Object.keys(resource).forEach(key => {
      if (!order.includes(key)) {
        sortedResource[key] = resource[key]
      }
    })

    // Sort IAM Policy properties if applicable
    template.Resources[resourceKey] = sortIAMPolicyProperties(sortedResource)
  }
}

function insertBlankLines(content) {
  const twoSpaces = '  '
  
  // Add blank lines before top-level keys
  content = content.replace(
    /^(Description|Metadata|Rules|Mappings|Parameters|Conditions|Resources|Outputs):/gm,
    '\n$1:'
  )
  
  // Add blank lines before resources (existing functionality)
  content = content.replace(
    /((?<!^\s*$\n)^  [A-Za-z0-9_-]+:\s*\n\s+Type:\s+(?:AWS|Custom|[A-Za-z0-9]+)::[A-Za-z0-9:]+)/gm,
    '\n$1'
  )

  return content
}

async function loadData(fileContents) {
  // Parse the template - try JSON first, then YAML if that fails
  let template
  try {
    template = JSON.parse(fileContents)
  } catch (e) {
    template = yaml.load(fileContents)
  }
  return template
}

function splitResourceType(resourceType) {
  const [vendor, service, type] = resourceType.split('::')
  return {
    vendor,
    service,
    type,
    name: service + type
  }
}


function handleReplacement(pattern, replacement, logicalId, resource) {
  if (typeof replacement === 'string') {
    return logicalId.replace(pattern, replacement)
  } else if (replacement instanceof RegExp) {
    return logicalId.replace(pattern, replacement)
  } else if (typeof replacement === 'function') {
    const resourceDetails = splitResourceType(resource.Type)
    const payload = {
      logicalId,
      resourceDetails,
      resource,
      pattern
    }
    return replacement(payload)
  }
}

// Add this new function to handle logical ID replacements
function replaceLogicalIds(template, pattern, replacement) {
  if (!template.Resources) return

  const replacements = {}
  const existingNames = new Set(Object.keys(template.Resources))
  const proposedNames = new Map(); // Track all proposed new names

  // First pass: identify resources to rename and check for collisions
  for (const logicalId of Object.keys(template.Resources)) {
    let newLogicalId
    if (typeof pattern === 'string') {
      // String replacement
      newLogicalId = handleReplacement(pattern, replacement, logicalId, template.Resources[logicalId])
    } else if (pattern instanceof RegExp) {
      // Regex replacement
      newLogicalId = handleReplacement(pattern, replacement, logicalId, template.Resources[logicalId])
    }

    if (newLogicalId && newLogicalId !== logicalId) {
      // Check if the new name would collide with:
      // 1. An existing resource that won't be renamed
      // 2. Another resource that would be renamed to the same name
      const wouldCollide = (
        (existingNames.has(newLogicalId) && !proposedNames.has(logicalId)) || 
        Array.from(proposedNames.values()).includes(newLogicalId)
      )

      if (wouldCollide) {
        console.warn(`Warning: Skipping rename of '${logicalId}' to '${newLogicalId}' due to potential collision`)
        continue
      }

      proposedNames.set(logicalId, newLogicalId)
      replacements[logicalId] = newLogicalId
    }
  }

  // Helper function to update references
  function updateReferences(obj) {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      // Handle DependsOn arrays
      if (obj.some(item => typeof item === 'string' && replacements[item])) {
        for (let i = 0; i < obj.length; i++) {
          if (typeof obj[i] === 'string' && replacements[obj[i]]) {
            obj[i] = replacements[obj[i]]
          }
        }
      } else {
        obj.forEach(item => updateReferences(item))
      }
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Ref' && typeof value === 'string' && replacements[value]) {
        obj[key] = replacements[value]
      } else if (key === 'Fn::GetAtt' && Array.isArray(value) && replacements[value[0]]) {
        value[0] = replacements[value[0]]
      } else if (key === 'DependsOn') {
        if (typeof value === 'string' && replacements[value]) {
          obj[key] = replacements[value]
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] === 'string' && replacements[value[i]]) {
              value[i] = replacements[value[i]]
            }
          }
        }
      } else if (typeof value === 'object') {
        updateReferences(value)
      }
    }
  }

  // Second pass: rename resources and update references
  for (const [oldId, newId] of Object.entries(replacements)) {
    template.Resources[newId] = template.Resources[oldId]
    delete template.Resources[oldId]
  }

  // Update all references
  updateReferences(template.Resources)
  updateReferences(template.Outputs)
  if (template.Conditions) {
    updateReferences(template.Conditions)
  }
}

const ignoreNames = [
  'AttributeName',
  'HeaderName'
]

const ignorePaths = [
  'AccountRecoverySetting'
]

// Add this new function to collect names
function collectNames(template, options = {}) {
  const defaultOptions = {
    returnAll: false
  }
  options = { ...defaultOptions, ...options }
  const names = new Set()
  
  function findNames(obj, path = [], resourceType = null) {
    if (!obj || typeof obj !== 'object') return

    // If we're at a resource root, get its type
    if (path.length === 2 && path[0] === 'Resources' && obj.Type) {
      resourceType = obj.Type
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => findNames(item, [...path, index], resourceType))
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && 
          (key === 'Name' || 
           key === 'AliasName' || 
           key === 'PolicyName' || 
           key === 'RoleName' ||
           key === 'BucketName' ||
           key === 'TableName' ||
           key === 'FunctionName' ||
           key.endsWith('Name'))
        ) {
        
        if (ignoreNames.includes(key) && !options.returnAll) {
          return
        }
        const keyPath = [...path, key].join('.')

        // if (resourceType === 'AWS::DynamoDB::Table' && keyPath.includes('GlobalSecondaryIndexes') && !options.returnAll) {
        //   console.log(path, key)
        //   return
        // }

        if (ignorePaths.some(ignorePath => keyPath.includes(ignorePath)) && !options.returnAll) {
          return
        }

        names.add({
          path: keyPath,
          value: value,
          resourceType: resourceType
        })
      } else if (typeof value === 'object') {
        findNames(value, [...path, key], resourceType)
      }
    }
  }

  findNames(template.Resources, ['Resources'])
  
  return Array.from(names).sort((a, b) => a.path.localeCompare(b.path))
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

module.exports = {
  cleanCloudFormation,
  loadData,
  collectNames,
  splitResourceType,
  loadAllSchemas
}
