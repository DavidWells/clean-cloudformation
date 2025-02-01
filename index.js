const fs = require('fs')
const yaml = require('js-yaml')

// Add this new function at the start
function removeRootCdkNag(template) {
  if (template.Metadata && template.Metadata.cdk_nag) {
    delete template.Metadata.cdk_nag;
    
    // Remove empty Metadata object
    if (Object.keys(template.Metadata).length === 0) {
      delete template.Metadata;
    }
  }
}

// Add this new function after removeRootCdkNag
function removeBootstrapVersionRule(template) {
  if (template.Rules && template.Rules.CheckBootstrapVersion) {
    delete template.Rules.CheckBootstrapVersion;
    
    // Remove empty Rules object
    if (Object.keys(template.Rules).length === 0) {
      delete template.Rules;
    }
  }
}

// Add this new function after removeBootstrapVersionRule
function removeBootstrapVersionParameter(template) {
  if (template.Parameters && 
      template.Parameters.BootstrapVersion && 
      template.Parameters.BootstrapVersion.Default && 
      template.Parameters.BootstrapVersion.Default.startsWith('/cdk-bootstrap/')) {
    
    delete template.Parameters.BootstrapVersion;
    
    // Remove empty Parameters object
    if (Object.keys(template.Parameters).length === 0) {
      delete template.Parameters;
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
  ];

  // Create a new object with sorted keys
  const sortedTemplate = {};
  
  // Add keys in specified order if they exist
  order.forEach(key => {
    if (template[key] !== undefined) {
      sortedTemplate[key] = template[key];
    }
  });

  // Add any remaining keys that weren't in our order list
  Object.keys(template).forEach(key => {
    if (!order.includes(key)) {
      sortedTemplate[key] = template[key];
    }
  });

  return sortedTemplate;
}

// Read and parse the CloudFormation template
// const template = JSON.parse(fs.readFileSync('./fixtures/dirty-cloudformation.json', 'utf8'))
const template = JSON.parse(fs.readFileSync('./fixtures/passwordless.json', 'utf8'))

// Add these lines before other cleanup functions
removeRootCdkNag(template)
removeBootstrapVersionRule(template)
removeBootstrapVersionParameter(template)

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
          delete obj.Metadata[key];
        }
      });
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
  if (!template.Resources) return;

  for (const resource of Object.values(template.Resources)) {
    if (resource.Properties && resource.Properties.Tags) {
      // Ensure Tags is an array
      const tags = Array.isArray(resource.Properties.Tags) 
        ? resource.Properties.Tags 
        : [resource.Properties.Tags];

      // Filter out aws-cdk: tags and cr-owned tags
      resource.Properties.Tags = tags.filter(tag => {
        // Check if tag is a valid object with a Key property
        return tag && 
               typeof tag === 'object' && 
               tag.Key && 
               typeof tag.Key === 'string' && 
               !tag.Key.startsWith('aws-cdk:') && 
               !tag.Key.includes('cr-owned:');
      });

      // Remove empty Tags array
      if (resource.Properties.Tags.length === 0) {
        delete resource.Properties.Tags;
      }
    }
  }
}

// Add this new function after removeCdkTags
function transformParameterArrays(template) {
  if (!template.Parameters) return;

  for (const param of Object.values(template.Parameters)) {
    if (param.AllowedValues && 
        Array.isArray(param.AllowedValues) && 
        param.AllowedValues.every(v => typeof v === 'string')) {
      // Mark this array for compact formatting
      Object.defineProperty(param.AllowedValues, 'isCompactStringArray', {
        value: true,
        enumerable: false
      });
    }
  }
}

// Add this new function after transformParameterArrays
function sortResourceKeys(template) {
  if (!template.Resources) return;

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
  ];

  for (const resourceKey in template.Resources) {
    const resource = template.Resources[resourceKey];
    const sortedResource = {};
    
    // Add keys in specified order if they exist
    order.forEach(key => {
      if (resource[key] !== undefined) {
        sortedResource[key] = resource[key];
      }
    });

    // Add any remaining keys that weren't in our order list
    Object.keys(resource).forEach(key => {
      if (!order.includes(key)) {
        sortedResource[key] = resource[key];
      }
    });

    template.Resources[resourceKey] = sortedResource;
  }
}

// Clean the template
cleanMetadata(template)
removeCdkMetadata(template)
removeMetadataCondition(template)
cleanConditionNames(template)
cleanResourceNames(template)
removeCdkTags(template)
transformParameterArrays(template)
sortResourceKeys(template)

// Transform intrinsic functions
const transformedTemplate = transformIntrinsicFunctions(sortTopLevelKeys(template))

// Convert to YAML
let yamlContent = yaml.dump(transformedTemplate, {
  indent: 2,
  lineWidth: -1, // Prevent line wrapping
  noRefs: true, // Handle circular references
  noArrayIndent: true, // Prevent extra indentation for arrays
  flowStyle: false,
  styles: {
    '!!null': 'empty',
    '!!str': 'plain',
  },
})

// Replace our temporary Ref:: prefix with ! for CloudFormation functions
yamlContent = yamlContent.replace(/Ref::/g, '!')

// Remove the colon after intrinsic function names
yamlContent = yamlContent.replace(/!(Ref|GetAtt|Join|Sub|Select|Split|FindInMap|If|Not|Equals|And|Or):/g, '!$1')

// Convert short DependsOn arrays to inline syntax (1-2 items only)
yamlContent = yamlContent.replace(
  /^(\s+)DependsOn:\n(?:(?:\1-\s+.+?\n){1,2})(?!\1-)/gm,
  (match) => {
    const values = match
      .split('\n')
      .filter(line => line.includes('-'))
      .map(line => line.substring(line.indexOf('-') + 1).trim())
      .filter(Boolean);

    // Only transform if there are 1 or 2 values
    if (values.length > 2) {
      return match;
    }

    const indent = match.match(/^\s+/)[0];
    return `${indent}DependsOn: [ ${values.join(', ')} ]\n`;
  }
);

// Add newlines between resources in the Resources section
yamlContent = yamlContent.replace(
  /(Resources:.*?)(?=^  \w+:)/gms,
  '$1\n'
);

// Add a second pass to ensure consistent spacing
yamlContent = yamlContent.replace(
  /^(  \w[^\n]+:\n(?:(?:    .*\n)*))/gm,
  '\n$1'
);

// Remove any triple newlines that might have been created
yamlContent = yamlContent.replace(/\n\n\n+/g, '\n\n');

// Convert multi-line arrays to inline arrays for specific functions
yamlContent = yamlContent.replace(/^(\s+)!(Equals)\n\1-\s+(.+?)\n\1-\s+(.+?)$/gm, '$1!$2 [ $3, $4 ]')

// Convert nested !Equals arrays to inline syntax
yamlContent = yamlContent.replace(
  /^(\s+)-\s+!Equals\n\1\s+-\s+(.+?)\n\1\s+-\s+(.+?)$/gm,
  '$1- !Equals [ $2, $3 ]'
)

// Collapse single-line values to the same line as their key
yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!(?:Sub|Ref|GetAtt)\s.+)$/gm, '$1$2: $3')

// Collapse single-line Equals conditions
yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!Equals\s+\[.+?\])$/gm, '$1$2: $3')

// Convert AllowedValues arrays to inline syntax
yamlContent = yamlContent.replace(
  /^(\s+)AllowedValues:\n(?:\1-\s+(.+?)(?:\n|$))+/gm,
  (match) => {
    const values = match
      .split('\n')
      .filter(line => line.includes('-'))
      .map(line => {
        // Get everything after the dash, trimming whitespace
        const value = line.substring(line.indexOf('-') + 1).trim();
        // If it's quoted, keep the quotes, otherwise use as-is
        return value.match(/^['"].*['"]$/) ? value : value;
      })
      .filter(Boolean); // Remove any empty values

    const indent = match.match(/^\s+/)[0];
    return `${indent}AllowedValues: [${values.join(', ')}]\n`;
  }
);

// Write the cleaned YAML to a file
// fs.writeFileSync('outputs/clean-cloudformation.yaml', yamlContent)
fs.writeFileSync('outputs/clean-passwordless.yaml', yamlContent)

console.log('Transformation complete! Output written to clean-cloudformation.yaml')
