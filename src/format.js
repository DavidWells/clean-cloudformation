const removeEmptyTopLevelKeys = require('./utils/formatters/clean-empty-object-keys')
const { findCommonRandomStringsInIds } = require('./utils/find-common-strings')
const {
  removeCDKRootNag,
  removeCDKBootstrapVersionRule,
  removeCDKBootstrapVersionParameter,
  removeCDKMetadata,
  removeCDKResourceMetadata,
  removeCDKTagsFromResources,
  removeCDKMetadataCondition
} = require('./utils/formatters/clean-cdk-object')


/**
 * Formats and cleans a CloudFormation template by removing empty keys, CDK-specific elements,
 * cleaning up condition/resource names, transforming parameter arrays, and sorting resource keys
 * @param {Object} template - The CloudFormation template object to format
 * @returns {{template: Object, randomStrings: string[]}} The formatted template and array of removed random strings
 * @throws {Error} If template is missing or not an object
 */
function formatTemplateObject(template) {
  if (!template) {
    throw new Error('Template is required')
  }
  if (typeof template !== 'object') {
    throw new Error('Template must be an object')
  }

  /* Trim empty top level keys */
  removeEmptyTopLevelKeys(template)

  /* Clean CDK-specific elements */
  removeCDKRootNag(template)
  removeCDKBootstrapVersionRule(template)
  removeCDKBootstrapVersionParameter(template)
  removeCDKMetadata(template)
  removeCDKResourceMetadata(template)
  removeCDKMetadataCondition(template)
  removeCDKTagsFromResources(template)
  
  /* Remove Hex postfix from conditions, resource names, and parameters */
  const conditionMatches = cleanConditionNames(template) || []
  const resourceMatches = cleanResourceNames(template) || []
  const parameterMatches = cleanParameterNames(template) || []

  // console.log('template.Parameters', template.Parameters)
  // process.exit(1)
  
  transformParameterArrays(template)
  
  sortResourceKeys(template)

  return {
    template,
    randomStrings: [...conditionMatches, ...resourceMatches, ...parameterMatches]
  }
}

// Add this new function after removeCDKMetadataCondition
function cleanConditionNames(template) {
  // Skip if no conditions
  if (!template.Conditions) return

  // Updated pattern to match:
  // - Any alphanumeric characters followed by
  // - 8 character hex code at the end
  const postfixPattern = /^([A-Za-z0-9]+?)([0-9A-F]{8})$/
  const conditionRenames = {}
  const allMatches = []

  // First pass: identify conditions that can be renamed
  for (const conditionName of Object.keys(template.Conditions)) {
    const match = conditionName.match(postfixPattern)
    if (match) {
      console.log('cleanConditionNames match', match)
      const baseName = match[1]
      // Check if base name already exists
      const baseNameExists = Object.keys(template.Conditions).some(
        (name) =>
          name !== conditionName && // not the same condition
          (name === baseName || name.startsWith(baseName + '[')), // exact match or array index
      )

      if (!baseNameExists) {
        conditionRenames[conditionName] = baseName
        allMatches.push(match[2])
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

  return allMatches
}

// Add this new function after cleanConditionNames
function cleanResourceNames(template) {
  // Skip if no resources
  if (!template.Resources) return

  const postfixPattern = /^([A-Za-z0-9]+?)([0-9A-F]{8})$/
  const resourceRenames = {}
  const allMatches = []
  // First pass: identify resources that can be renamed
  for (const resourceName of Object.keys(template.Resources)) {
    const match = resourceName.match(postfixPattern)
    if (match) {
      console.log('cleanResourceNames match', match)
      const baseName = match[1]
      // Check if base name already exists
      const baseNameExists = Object.keys(template.Resources).some(
        (name) =>
          name !== resourceName && // not the same resource
          (name === baseName || name.startsWith(baseName + '[')), // exact match or array index
      )

      if (!baseNameExists) {
        resourceRenames[resourceName] = baseName
        allMatches.push(match[2])
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
  return allMatches
}

// Add this new function after removeCDKTagsFromResources
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

// Add after cleanResourceNames
function cleanParameterNames(template) {
  if (!template.Parameters) return

  const parameterRenames = {}
  const allMatchesSet = new Set()

  // Get parameter names
  const parameterNames = Object.keys(template.Parameters)

  // Find common random strings in parameter names
  const commonRandomStrings = findCommonRandomStringsInIds(parameterNames)
  
  // Track parameter name changes
  const parameterChanges = new Map(
    parameterNames.map(name => [name, name])
  )

  // Create replacement patterns for random strings
  for (const [randomString, count] of commonRandomStrings) {
    if (count >= 1) {
      // Find parameters containing this random string
      parameterNames.forEach(originalName => {
        const currentName = parameterChanges.get(originalName)
        if (currentName.includes(randomString)) {
          console.log('paramName', currentName, randomString)
          // Create new name by removing the random string
          const newName = currentName.replace(randomString, '')
          console.log('newName', newName)
          parameterChanges.set(originalName, newName)
          allMatchesSet.add(randomString)
        }
      })
    }
  }

  // After all replacements are done, create the final renames
  for (const [originalName, finalName] of parameterChanges) {
    if (originalName !== finalName) {
      parameterRenames[originalName] = finalName
    }
  }

  /*
  console.log('parameterRenames', parameterRenames)
  console.log('allMatches', [...allMatchesSet])
  process.exit(1)
  /** */

  // Helper function to update parameter references in an object
  function updateParameterRefs(obj) {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      obj.forEach(item => updateParameterRefs(item))
      return
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'Ref' && typeof value === 'string' && parameterRenames[value]) {
        obj[key] = parameterRenames[value]
      } else if (typeof value === 'object') {
        updateParameterRefs(value)
      }
    }
  }

  // Second pass: rename parameters and update references
  for (const [oldName, newName] of Object.entries(parameterRenames)) {
    // Only rename if the new name doesn't already exist
    if (!template.Parameters[newName]) {
      template.Parameters[newName] = template.Parameters[oldName]
      delete template.Parameters[oldName]

      // Update all parameter references in the template
      updateParameterRefs(template.Resources)
      updateParameterRefs(template.Outputs)
      if (template.Conditions) {
        updateParameterRefs(template.Conditions)
      }
    }
  }

  return [...allMatchesSet]
}

const RESOURCE_KEY_ORDER = [
  'Type',
  'Version',
  'Description',
  'Condition',
  'DependsOn',
  'DeletionPolicy',
  'CreationPolicy',
  'UpdatePolicy',
  'UpdateReplacePolicy',
  'Properties',
  'Metadata'
]

const COMMON_PROPERTY_ORDER = [
  'Name',
  'Description',
  'Tags',
  'ServiceToken'
]

// Resource type specific property orders
const PROPERTY_ORDERS = {
  'AWS::Lambda::Function': { 
    sort: [
      'FunctionName',
      'Description',
      'Role',
      'Runtime',
      'Architectures',
      'Handler',
      'MemorySize',
      'Timeout',
      'Code',
      'Environment',
      'VpcConfig',
    ],
    getAlwaysLast: (properties) => {
      const alwaysLast = []
      if (properties.Code?.ZipFile && isMultilineString(properties.Code.ZipFile)) {
        alwaysLast.push('Code')
      }
      return alwaysLast
    }
  },
  'AWS::S3::Bucket': { 
    sort: [
      'BucketName',
      'AccessControl',
      'BucketEncryption',
      'PublicAccessBlockConfiguration',
      'VersioningConfiguration',
      'WebsiteConfiguration',
    ],
    alwaysLast: ['Runtime']
  },
  'AWS::CloudFront::Function': { 
    sort: [
      'Name',
      'Description',
      'AutoPublish'
    ],
    getAlwaysLast: (properties) => {
      const alwaysLast = []
      if (properties.FunctionCode && isMultilineString(properties.FunctionCode)) {
        alwaysLast.push('FunctionCode')
      }
      return alwaysLast
    }
  },
  // Add more resource types as needed
}

function isMultilineString(value) {
  // Check if it's a string with newlines
  if (typeof value === 'string' && value.includes('\n')) {
    return true
  }

  // Check if it's an object with Fn::Sub
  if (value && typeof value === 'object') {
    const subValue = value['Fn::Sub'] || value['Ref::Sub']
    if (typeof subValue === 'string' && subValue.includes('\n')) {
      return true
    }
    const joinValue = value['Fn::Join'] || value['Ref::Join']
    if (joinValue && Array.isArray(joinValue) && joinValue.length > 1) {
      return joinValue.some(item => isMultilineString(item))
    }
  }

  return false
}

function sortProperties(properties, resourceType) {
  if (!properties || typeof properties !== 'object') return properties

  const sortedProps = {}
  const resourceTypeConfig = PROPERTY_ORDERS[resourceType] || {}
  const propertyOrder = resourceTypeConfig.sort || COMMON_PROPERTY_ORDER
  
  // Get alwaysLast properties - either from function or static array
  const alwaysLast = resourceTypeConfig.getAlwaysLast 
    ? resourceTypeConfig.getAlwaysLast(properties)
    : (resourceTypeConfig.alwaysLast || [])
  
  // Remove Tags and alwaysLast properties from propertyOrder
  const orderWithoutSpecial = propertyOrder.filter(key => 
    key !== 'Tags' && !alwaysLast.includes(key)
  )
  
  // Add properties in specified order (except Tags and alwaysLast)
  orderWithoutSpecial.forEach(key => {
    if (properties[key] !== undefined) {
      sortedProps[key] = properties[key]
    }
  })

  // Add remaining properties (except Tags and alwaysLast)
  Object.keys(properties).forEach(key => {
    if (key !== 'Tags' && !alwaysLast.includes(key) && !orderWithoutSpecial.includes(key)) {
      sortedProps[key] = properties[key]
    }
  })

  // Add Tags if it exists
  if (properties.Tags !== undefined) {
    sortedProps.Tags = properties.Tags
  }

  // Add alwaysLast properties in order after Tags
  alwaysLast.forEach(key => {
    if (properties[key] !== undefined) {
      sortedProps[key] = properties[key]
    }
  })

  return sortedProps
}

function sortResourceKeys(template) {
  if (!template.Resources) return

  for (const resourceKey in template.Resources) {
    const resource = template.Resources[resourceKey]
    
    // Skip if resource is an array (e.g., Fn::ForEach)
    if (Array.isArray(resource)) {
      continue
    }
    
    const sortedResource = {}
    
    // Add keys in specified order if they exist
    RESOURCE_KEY_ORDER.forEach(key => {
      if (resource[key] !== undefined) {
        if (key === 'Properties') {
          // Sort properties based on resource type
          sortedResource[key] = sortProperties(resource[key], resource.Type)
        } else if (Array.isArray(resource[key])) {
          sortedResource[key] = [...resource[key]]
        } else {
          sortedResource[key] = resource[key]
        }
      }
    })

    // Add any remaining keys that weren't in our order list
    Object.keys(resource).forEach(key => {
      if (!RESOURCE_KEY_ORDER.includes(key)) {
        if (Array.isArray(resource[key])) {
          sortedResource[key] = [...resource[key]]
        } else {
          sortedResource[key] = resource[key]
        }
      }
    })

    // Sort IAM Policy properties if applicable
    template.Resources[resourceKey] = sortIAMPolicyProperties(sortedResource)
  }
}

const IAM_RESOURCE_TYPES = [
  'AWS::IAM::Policy',
  'AWS::IAM::Role',
  'AWS::IAM::User',
  'AWS::IAM::Group',
]

const IAM_SORT_ORDER = [
  'PolicyName',
  'ManagedPolicyArns',
  'Roles',
  'PolicyDocument',
]

const POLICY_DOCUMENT_SORT_ORDER = [
  'Version',
  'Id',
  'Sid',
  'Statement',
]

function sortPolicyDocument(policyDoc) {
  if (!policyDoc || typeof policyDoc !== 'object') return policyDoc

  const sortedPolicyDoc = {}
  
  // Add keys in specified order if they exist
  POLICY_DOCUMENT_SORT_ORDER.forEach(docKey => {
    if (policyDoc[docKey] !== undefined) {
      sortedPolicyDoc[docKey] = policyDoc[docKey]
    }
  })

  // Add any remaining keys
  Object.keys(policyDoc).forEach(docKey => {
    if (!POLICY_DOCUMENT_SORT_ORDER.includes(docKey)) {
      sortedPolicyDoc[docKey] = policyDoc[docKey]
    }
  })

  return sortedPolicyDoc
}

function sortIAMPolicyProperties(resource) {
  if (!IAM_RESOURCE_TYPES.includes(resource.Type) || !resource.Properties) {
    return resource
  }

  const sortedProperties = {}
  
  // Add properties in specified order if they exist
  IAM_SORT_ORDER.forEach(key => {
    if (resource.Properties[key] !== undefined) {
      if (key === 'PolicyDocument' || key === 'AssumeRolePolicyDocument') {
        sortedProperties[key] = sortPolicyDocument(resource.Properties[key])
      } else {
        sortedProperties[key] = resource.Properties[key]
      }
    }
  })

  // Add any remaining properties that weren't in our order list
  Object.keys(resource.Properties).forEach(key => {
    if (!IAM_SORT_ORDER.includes(key)) {
      if (key === 'AssumeRolePolicyDocument') {
        sortedProperties[key] = sortPolicyDocument(resource.Properties[key])
      } else {
        sortedProperties[key] = resource.Properties[key]
      }
    }
  })

  resource.Properties = sortedProperties
  return resource
}

module.exports = {
  formatTemplateObject
} 