// Add this new function at the start
function removeCDKRootNag(template) {
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


// Add this new function after removeCDKRootNag
function removeCDKBootstrapVersionRule(template) {
  if (template.Rules && template.Rules.CheckBootstrapVersion) {
    delete template.Rules.CheckBootstrapVersion
    
    // Remove empty Rules object
    if (Object.keys(template.Rules).length === 0) {
      delete template.Rules
    }
  }
}

// Add this new function after removeCDKBootstrapVersionRule
function removeCDKBootstrapVersionParameter(template) {
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
function removeCDKMetadata(obj) {
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
      removeCDKMetadata(obj[key])
    }
  }
}

// Function to remove CDK Metadata resources
function removeCDKResourceMetadata(template) {
  if (!template.Resources) return

  const resources = template.Resources
  for (const key in resources) {
    if (resources[key].Type === 'AWS::CDK::Metadata') {
      delete resources[key]
    }
  }
}

// Add this new function after cleanResourceNames
function removeCDKTagsFromResources(template) {
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

// Add this new function
function removeCDKMetadataCondition(template) {
  if (template.Conditions && template.Conditions.CDKMetadataAvailable) {
    delete template.Conditions.CDKMetadataAvailable

    // Remove the Conditions object if it's empty
    if (Object.keys(template.Conditions).length === 0) {
      delete template.Conditions
    }
  }
}

module.exports = {
  removeCDKRootNag,
  removeCDKBootstrapVersionRule,
  removeCDKBootstrapVersionParameter,
  removeCDKMetadata,
  removeCDKResourceMetadata,
  removeCDKTagsFromResources,
  removeCDKMetadataCondition
}