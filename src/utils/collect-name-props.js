const { loadSchema } = require('./schemas')
const { validateNamePattern } = require('./validators')
const { resolveResources, getResourcesEntries } = require('./resolve-resources')

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
    prompt: generatePrompt(results)
  }
}

function generatePrompt(results) {
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
  return prompt
}


module.exports = {
  collectNames
}