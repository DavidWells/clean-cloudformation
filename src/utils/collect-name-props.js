const { loadSchema } = require('./schemas')
const { validateNamePattern } = require('./validators')
const { resolveResources, getResourcesEntries } = require('./resolve-resources')
const { generateNamePrompt } = require('./prompts/resource-names')

const ignoreNames = [
  'AttributeName',
  'HeaderName'
]

const ignorePaths = [
  'AccountRecoverySetting'
]

// Add this new function to collect names
async function collectNames(template, options = {}) {
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
           key === 'QueueName' ||
           key === 'TopicName' ||
           key === 'RuleName' ||
           key === 'ScheduleName' ||
           key === 'StreamName' ||
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
  const { Resources } = resolveResources(template)
  console.log('resources', Resources)
  findNames(Resources, ['Resources'])

  const foundNames = Array.from(names)

  if (foundNames.length === 0) {
    return {
      foundPropNames: [],
      prompt: ''
    }
  }

  // Lookup naming constraints from schema file
  const details = foundNames.map(async ({ path, value, resourceType }) => {
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
  
  return {
    foundPropNames: Array.from(results).sort((a, b) => a.path.localeCompare(b.path)),
    prompt: generateNamePrompt(results)
  }
}

module.exports = {
  collectNames
}