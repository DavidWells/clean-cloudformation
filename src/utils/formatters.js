// Functions for formatting and cleaning CloudFormation templates

function formatTemplate(template) {
  if (!template) {
    throw new Error('Template is required')
  }
  if (typeof template !== 'object') {
    throw new Error('Template must be an object')
  }
  // Clean CDK-specific elements
  removeRootCdkNag(template)
  removeBootstrapVersionRule(template)
  removeBootstrapVersionParameter(template)

  // Clean template structure
  cleanMetadata(template)
  removeCdkMetadata(template)
  removeMetadataCondition(template)
  cleanConditionNames(template)
  /* Remove Hex postfix from resource names */
  cleanResourceNames(template)
  /* Remove CDK tags from resources */
  removeCdkTags(template)
  transformParameterArrays(template)
  sortResourceKeys(template)

  return template
}

// Add this new function at the start
function removeRootCdkNag(template) {
  if (!template.Metadata) return

  // Remove CDK Nag metadata from root level
  if (template.Metadata['aws:cdk:path']) {
    delete template.Metadata['aws:cdk:path']
  }

  if (template.Metadata && template.Metadata.cdk_nag) {
    delete template.Metadata.cdk_nag
  }
  // Remove empty Metadata object
  if (Object.keys(template.Metadata).length === 0) {
    delete template.Metadata
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
  if (!template.Resources) return

  const resources = template.Resources
  for (const key in resources) {
    if (resources[key].Type === 'AWS::CDK::Metadata') {
      delete resources[key]
    }
  }
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

module.exports = {
  removeRootCdkNag,
  removeCdkMetadata,
  formatTemplate
} 