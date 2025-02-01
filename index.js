const fs = require('fs')
const yaml = require('js-yaml')

// Read and parse the CloudFormation template
const template = JSON.parse(fs.readFileSync('./dirty-cloudformation.json', 'utf8'))

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
  return joinArgs[1].some(item => 
    typeof item === 'object' && 
    (item['Ref::Ref'] !== undefined || item['Ref::GetAtt'] !== undefined)
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
        delete template.Conditions.CDKMetadataAvailable;
        
        // Remove the Conditions object if it's empty
        if (Object.keys(template.Conditions).length === 0) {
            delete template.Conditions;
        }
    }
}

// Add this new function after removeMetadataCondition
function cleanConditionNames(template) {
    // Skip if no conditions
    if (!template.Conditions) return;

    // Updated pattern to match:
    // - Any alphanumeric characters followed by
    // - 8 character hex code at the end
    const postfixPattern = /^([A-Za-z0-9]+?)([0-9A-F]{8})$/;
    const conditionRenames = {};

    // First pass: identify conditions that can be renamed
    for (const conditionName of Object.keys(template.Conditions)) {
        const match = conditionName.match(postfixPattern);
        if (match) {
            const baseName = match[1];
            // Check if base name already exists
            const baseNameExists = Object.keys(template.Conditions).some(name => 
                name !== conditionName && // not the same condition
                (name === baseName || name.startsWith(baseName + '[')) // exact match or array index
            );
            
            if (!baseNameExists) {
                conditionRenames[conditionName] = baseName;
            }
        }
    }

    // Helper function to update condition references in an object
    function updateConditionRefs(obj) {
        if (!obj || typeof obj !== 'object') return;
        
        if (Array.isArray(obj)) {
            obj.forEach(item => updateConditionRefs(item));
            return;
        }

        for (const [key, value] of Object.entries(obj)) {
            if (key === 'Condition' && typeof value === 'string' && conditionRenames[value]) {
                obj[key] = conditionRenames[value];
            } else if (key === 'Fn::If' && Array.isArray(value) && conditionRenames[value[0]]) {
                value[0] = conditionRenames[value[0]];
            } else if (typeof value === 'object') {
                updateConditionRefs(value);
            }
        }
    }

    // Second pass: rename conditions and update references
    for (const [oldName, newName] of Object.entries(conditionRenames)) {
        // Rename the condition
        template.Conditions[newName] = template.Conditions[oldName];
        delete template.Conditions[oldName];
    }

    // Update all condition references in the template
    updateConditionRefs(template.Resources);
    updateConditionRefs(template.Outputs);
}

// Clean the template
cleanMetadata(template)
removeCdkMetadata(template)
removeMetadataCondition(template)
cleanConditionNames(template)

// Transform intrinsic functions
const transformedTemplate = transformIntrinsicFunctions(template)

// Convert to YAML
let yamlContent = yaml.dump(transformedTemplate, {
  indent: 2,
  lineWidth: -1, // Prevent line wrapping
  noRefs: true, // Handle circular references
  noArrayIndent: true, // Prevent extra indentation for arrays
  flowStyle: false,
  styles: {
    '!!null': 'empty',
    '!!str': 'plain'
  }
})

// Replace our temporary Ref:: prefix with ! for CloudFormation functions
yamlContent = yamlContent.replace(/Ref::/g, '!')

// Remove the colon after intrinsic function names
yamlContent = yamlContent.replace(/!(Ref|GetAtt|Join|Sub|Select|Split|FindInMap|If|Not|Equals|And|Or):/g, '!$1')

// Convert multi-line arrays to inline arrays for specific functions
yamlContent = yamlContent.replace(
  /^(\s+)!(Equals)\n\1-\s+(.+?)\n\1-\s+(.+?)$/gm,
  '$1!$2 [ $3, $4 ]'
)

// Collapse single-line values to the same line as their key
yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!(?:Sub|Ref|GetAtt)\s.+)$/gm, '$1$2: $3')

// Collapse single-line Equals conditions
yamlContent = yamlContent.replace(/^(\s+)(.+?):\n\1\s+(!Equals\s+\[.+?\])$/gm, '$1$2: $3')

// Write the cleaned YAML to a file
fs.writeFileSync('clean-cloudformation.yaml', yamlContent)

console.log('Transformation complete! Output written to clean-cloudformation.yaml')
